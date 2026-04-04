import mineflayer, { Bot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin } from 'mineflayer-pvp';
import { MinecraftServer } from './minecraftServer';
import { config } from './config';
import { AIController } from './ai';
import { Environment } from './environment/environment';
import type { Scenario } from './scenarios';
import type { EnvironmentChangeStep, EnvironmentSnapshot, SnapshotEntity, SnapshotInventoryItem } from './environment/types';

export class Agent {
    public bot: Bot;
    public ai: AIController;
    private environment: Environment;
    private previousEnvironmentSnapshot: EnvironmentSnapshot | null = null;
    public server: MinecraftServer;
    private scenario: Scenario;
    public isFrozen: boolean;
    public isAlive: boolean;

    constructor(server: MinecraftServer, username: string, scenario: Scenario) {
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username,
            auth: config.auth
        });
        this.bot.loadPlugin(pathfinder);
        this.bot.loadPlugin(plugin);

        this.environment = new Environment(this.bot);
        this.isFrozen = false;
        this.isAlive = false;
        this.server = server;
        this.scenario = scenario;
        this.server.registerAgent(this);
        this.ai = new AIController(this, username);

        this.initializeEvents();
        this.startSensors();
    }

    private initializeEvents(): void {
        this.bot.on('spawn', () => {
            this.isAlive = true;
            console.log(`Mineflayer bot spawned as ${this.bot.username}`);
            this.scenario.onAgentSpawn(this);
        });

        this.bot.on('death', () => {
            this.isAlive = false;
            this.bot.quit();
        });

        this.bot.on('whisper', (username, message) => {
            if (username === this.bot.username) return;
            this.ai.processMessage(username, message);
        });

        this.bot.on('error', (err) => console.log('Error:', err));
        this.bot.on('kicked', (reason) => console.log('Kicked:', reason));
        this.bot.on('end', () => {
            this.isAlive = false;
        });
    }

    public observeEnvironment() {
        return this.environment.getEnvironmentSnapshot();
    }

    private startSensors() {
        setInterval(() => {
            if (this.isFrozen) return;
            this.checkForDanger();
        }, 2000);
    }

    private updateEnvironmentSnapshot(): EnvironmentChangeStep[] {
        const currentSnapshot = this.observeEnvironment();
        const previousSnapshot = this.previousEnvironmentSnapshot;
        this.previousEnvironmentSnapshot = currentSnapshot;

        if (!previousSnapshot) {
            return [];
        }

        return this.compareEnvironmentSnapshots(previousSnapshot, currentSnapshot);
    }

    private compareEnvironmentSnapshots(previous: EnvironmentSnapshot, current: EnvironmentSnapshot): EnvironmentChangeStep[] {
        const steps: EnvironmentChangeStep[] = [];
        const criticalHealthThreshold = 8;
        const criticalFoodThreshold = 8;
        const closeThreatThreshold = 3;
        const significantDistanceDelta = 1;

        const previousHostiles = this.toEntityMap(previous.nearby.hostiles);
        const currentHostiles = this.toEntityMap(current.nearby.hostiles);
        const removedHostiles = previous.nearby.hostiles.filter((hostile) => !currentHostiles.has(hostile.id));
        const addedHostiles = current.nearby.hostiles.filter((hostile) => !previousHostiles.has(hostile.id));
        const movedCloserHostiles = current.nearby.hostiles
            .flatMap((hostile) => {
                const previousHostile = previousHostiles.get(hostile.id);
                if (!previousHostile) {
                    return [];
                }

                const distanceDelta = previousHostile.distance - hostile.distance;
                if (distanceDelta < significantDistanceDelta) {
                    return [];
                }

                return [`- ${hostile.name} id ${hostile.id} moved from ${previousHostile.distance.toFixed(1)} to ${hostile.distance.toFixed(1)} blocks away`];
            });

        if (removedHostiles.length > 0) {
            steps.push({
                title: 'The following are no longer a threat:',
                details: removedHostiles.map((hostile) => `- ${hostile.name} id ${hostile.id}`),
                shouldTriggerPrompt: false
            });
        }

        if (addedHostiles.length > 0) {
            steps.push({
                title: addedHostiles.length === 1
                    ? 'A new hostile mob is approaching:'
                    : 'Multiple new hostile mobs are approaching:',
                details: addedHostiles.map((hostile) => `- ${hostile.name} id ${hostile.id} is ${hostile.distance.toFixed(1)} blocks away`),
                shouldTriggerPrompt: true
            });
        }

        if (movedCloserHostiles.length > 0) {
            steps.push({
                title: 'Hostile mobs are getting closer:',
                details: movedCloserHostiles,
                shouldTriggerPrompt: false
            });
        }

        const closeThreats = current.nearby.hostiles.filter((hostile) => hostile.distance <= closeThreatThreshold);
        const previousCloseThreatIds = new Set(previous.nearby.hostiles
            .filter((hostile) => hostile.distance <= closeThreatThreshold)
            .map((hostile) => hostile.id));
        const newCloseThreats = closeThreats.filter((hostile) => !previousCloseThreatIds.has(hostile.id));

        if (newCloseThreats.length > 0) {
            steps.push({
                title: 'Hostiles are now in immediate range:',
                details: newCloseThreats.map((hostile) => `- ${hostile.name} id ${hostile.id} is ${hostile.distance.toFixed(1)} blocks away`),
                shouldTriggerPrompt: false
            });
        }

        if (current.health < previous.health - 4) {
            const healthLoss = previous.health - current.health;
            steps.push({
                title: current.health <= criticalHealthThreshold ? 'My health is low!' : 'I just took damage.',
                details: [`- Health changed from ${previous.health.toFixed(1)} to ${current.health.toFixed(1)} (${healthLoss.toFixed(1)} lost)`],
                shouldTriggerPrompt: true
            });
        }

/*         if (current.food < previous.food && current.food <= criticalFoodThreshold) {
            steps.push({
                title: 'I am getting hungry.',
                details: [`- Food changed from ${previous.food.toFixed(1)} to ${current.food.toFixed(1)}`],
                shouldTriggerPrompt: true
            });
        } */

        const inventoryDiff = this.diffInventory(previous.inventory.items, current.inventory.items);
        if (inventoryDiff.pickedUp.length > 0) {
            steps.push({
                title: 'I have picked up:',
                details: inventoryDiff.pickedUp.map((item) => `- ${item.delta} ${item.name}`),
                shouldTriggerPrompt: true
            });
        }

        if (inventoryDiff.usedOrLost.length > 0) {
            steps.push({
                title: 'I used or lost:',
                details: inventoryDiff.usedOrLost.map((item) => `- ${item.delta} ${item.name}`),
                shouldTriggerPrompt: false
            });
        }

/*         const previousPlayers = this.toEntityMap(previous.allPlayers);
        const currentPlayers = this.toEntityMap(current.allPlayers);
        const newPlayers = current.allPlayers.filter((player) => !previousPlayers.has(player.id));
        const missingPlayers = previous.allPlayers.filter((player) => !currentPlayers.has(player.id));

        if (newPlayers.length > 0) {
            steps.push({
                title: 'New players are nearby:',
                details: newPlayers.map((player) => `- ${player.name} id ${player.id}`),
                shouldTriggerPrompt: false
            });
        }

        if (missingPlayers.length > 0) {
            steps.push({
                title: 'Players are no longer nearby:',
                details: missingPlayers.map((player) => `- ${player.name} id ${player.id}`),
                shouldTriggerPrompt: false
            });
        } */

/*         const previousDroppedItems = new Map(previous.nearby.droppedItems.map((item) => [item.id, item]));
        const currentDroppedItems = new Map(current.nearby.droppedItems.map((item) => [item.id, item]));
        const newDroppedItems = current.nearby.droppedItems.filter((item) => !previousDroppedItems.has(item.id));
        const removedDroppedItems = previous.nearby.droppedItems.filter((item) => !currentDroppedItems.has(item.id));

        if (newDroppedItems.length > 0) {
            steps.push({
                title: 'New dropped items are nearby:',
                details: newDroppedItems.map((item) => `- ${item.count} ${item.name} id ${item.id} at ${item.distance.toFixed(1)} blocks`),
                shouldTriggerPrompt: false
            });
        }

        if (removedDroppedItems.length > 0) {
            steps.push({
                title: 'Dropped items disappeared nearby:',
                details: removedDroppedItems.map((item) => `- ${item.count} ${item.name} id ${item.id}`),
                shouldTriggerPrompt: false
            });
        }

        const previousFluids = new Map(previous.nearby.world.fluids.map((fluid) => [this.toBlockKey(fluid.name, fluid.position), fluid]));
        const currentFluids = new Map(current.nearby.world.fluids.map((fluid) => [this.toBlockKey(fluid.name, fluid.position), fluid]));
        const newFluids = current.nearby.world.fluids.filter((fluid) => !previousFluids.has(this.toBlockKey(fluid.name, fluid.position)));
        const removedFluids = previous.nearby.world.fluids.filter((fluid) => !currentFluids.has(this.toBlockKey(fluid.name, fluid.position)));

        if (newFluids.length > 0) {
            const shouldTriggerPrompt = newFluids.some((fluid) => fluid.name === 'lava' && fluid.distance <= 4);

            steps.push({
                title: 'New fluids detected nearby:',
                details: newFluids.map((fluid) => `- ${fluid.name} at ${fluid.distance.toFixed(1)} blocks`),
                shouldTriggerPrompt
            });
        }

        if (removedFluids.length > 0) {
            steps.push({
                title: 'Fluids are no longer nearby:',
                details: removedFluids.map((fluid) => `- ${fluid.name} at ${fluid.distance.toFixed(1)} blocks`),
                shouldTriggerPrompt: false
            });
        }

        const previousSurrounding = new Set(previous.nearby.world.surroundingBlocks.map((block) => this.toBlockKey(block.name, block.position)));
        const currentSurrounding = new Set(current.nearby.world.surroundingBlocks.map((block) => this.toBlockKey(block.name, block.position)));

        const addedSurrounding = current.nearby.world.surroundingBlocks
            .filter((block) => !previousSurrounding.has(this.toBlockKey(block.name, block.position)));
        const removedSurrounding = previous.nearby.world.surroundingBlocks
            .filter((block) => !currentSurrounding.has(this.toBlockKey(block.name, block.position)));

        if (addedSurrounding.length > 0 || removedSurrounding.length > 0) {
            const summaryLines: string[] = [];

            if (addedSurrounding.length > 0) {
                summaryLines.push(`- ${addedSurrounding.length} new surrounding blocks appeared`);
            }

            if (removedSurrounding.length > 0) {
                summaryLines.push(`- ${removedSurrounding.length} surrounding blocks disappeared`);
            }

            const shouldTriggerPrompt = addedSurrounding.some((block) =>
                block.name === 'lava' || block.name === 'fire' || block.name === 'cactus'
            );

            steps.push({
                title: 'Surrounding blocks changed:',
                details: summaryLines,
                shouldTriggerPrompt
            });
        }

        const directionalChanges = this.diffDirectionalBlocks(
            previous.nearby.world.directionalBlocks,
            current.nearby.world.directionalBlocks
        );
        if (directionalChanges.length > 0) {
            const shouldTriggerPrompt = directionalChanges.some((line) =>
                line.startsWith('- front:') || line.startsWith('- feet:') || line.includes(' lava') || line.includes(' water')
            );

            steps.push({
                title: 'Nearby terrain changed:',
                details: directionalChanges,
                shouldTriggerPrompt
            });
        } */

        return steps;
    }

    private toEntityMap(entities: SnapshotEntity[]): Map<number, SnapshotEntity> {
        return new Map(entities.map((entity) => [entity.id, entity]));
    }

/*     private toBlockKey(name: string, position: { x: number; y: number; z: number }): string {
        return `${name}:${position.x},${position.y},${position.z}`;
    }

    private diffDirectionalBlocks(
        previous: EnvironmentSnapshot['nearby']['world']['directionalBlocks'],
        current: EnvironmentSnapshot['nearby']['world']['directionalBlocks']
    ): string[] {
        const changed: string[] = [];
        const keys = Object.keys(current) as Array<keyof EnvironmentSnapshot['nearby']['world']['directionalBlocks']>;

        for (const key of keys) {
            const previousBlock = previous[key];
            const currentBlock = current[key];

            if (previousBlock.name !== currentBlock.name) {
                changed.push(`- ${String(key)}: ${previousBlock.name} -> ${currentBlock.name}`);
            }
        }

        return changed.slice(0, 8);
    } */

    private diffInventory(previous: SnapshotInventoryItem[], current: SnapshotInventoryItem[]) {
        const toTotals = (items: SnapshotInventoryItem[]) => {
            const totals = new Map<string, number>();
            for (const item of items) {
                const key = item.displayName || item.name;
                const existing = totals.get(key) ?? 0;
                totals.set(key, existing + item.count);
            }
            return totals;
        };

        const previousTotals = toTotals(previous);
        const currentTotals = toTotals(current);
        const allNames = new Set([...previousTotals.keys(), ...currentTotals.keys()]);

        const pickedUp: Array<{ name: string; delta: number }> = [];
        const usedOrLost: Array<{ name: string; delta: number }> = [];

        for (const name of allNames) {
            const previousCount = previousTotals.get(name) ?? 0;
            const currentCount = currentTotals.get(name) ?? 0;
            const delta = currentCount - previousCount;

            if (delta > 0) {
                pickedUp.push({ name, delta });
            }

            if (delta < 0) {
                usedOrLost.push({ name, delta: Math.abs(delta) });
            }
        }

        return { pickedUp, usedOrLost };
    }

    private formatEnvironmentChanges(steps: EnvironmentChangeStep[]): string {
        return steps
            .map((step) => {
                const triggerLine = step.shouldTriggerPrompt ? 'Trigger prompt: true' : 'Trigger prompt: false';
                return `${step.title}\n${step.details.join('\n')}\n${triggerLine}`;
            })
            .join('\n\n');
    }

    private hasTriggeringChanges(steps: EnvironmentChangeStep[]): boolean {
        return steps.some((step) => step.shouldTriggerPrompt);
    }

    private checkForDanger() {
        if (!this.bot.entity) return;

        const environmentChanges = this.updateEnvironmentSnapshot();
        if (environmentChanges.length === 0) return;
        if (!this.hasTriggeringChanges(environmentChanges)) return;

        this.ai.processEvent(this.bot.username, this.formatEnvironmentChanges(environmentChanges));
    }

    public setFreeze(freeze: boolean): void {
        this.isFrozen = freeze;
        this.bot.physicsEnabled = !freeze;
    }
}