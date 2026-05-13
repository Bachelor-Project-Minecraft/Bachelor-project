import type { Agent } from '../agent/agent';
import type { MinecraftServer } from '../server/minecraftServer';
import type { EntitySpawn, Position, AgentItem } from './types';

const defaultAgentSpawnPosition: Position = { x: 0, y: 0, z: 0 };

export class Scenario {
    constructor(
        public readonly name: string = 'Base Scenario',
        public readonly description: string = 'This is a base scenario where no hostile entities are spawned'
    ) {}

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        const configuredSpawnPositions = this.getAgentSpawnPositions();
        const configuredInventories = this.getAgentInventories();
        const agentsToPlace = agents;

        while (agentsToPlace.some((agent) => !agent.isAlive)) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        agentsToPlace.forEach((agent) => {
            const position = configuredSpawnPositions[agent.username] ?? defaultAgentSpawnPosition;

            server.sendCommand(
                `tp ${agent.username} ${position.x} ${position.y} ${position.z}`
            );

            const inventory = configuredInventories[agent.username];
            if (inventory) {
                inventory.forEach(({ item, count, nbt }) => {
                    const amount = count ?? 1;
                    const nbtData = nbt ? nbt : '';
                    // Syntax: /give <player> <item>[nbt] <count>
                    server.sendCommand(`give ${agent.username} ${item}${nbtData} ${amount}`);
                });
            }
        });

        this.getEntitySpawns().forEach(({ type, position, nbt }) => {
            server.sendCommand(
                `summon ${type} ${position.x} ${position.y} ${position.z}${nbt ? ` ${nbt}` : ''}`
            );
        });
    }

    public onAgentSpawn(_agent: Agent): void {}

    protected getAgentSpawnPositions(): Record<string, Position> {
        return {};
    }

    protected getAgentInventories(): Record<string, AgentItem[]> {
        return {};
    }

    protected getEntitySpawns(): EntitySpawn[] {
        return [];
    }

    protected runCommandAtAgent(agent: Agent, command: string): void {
        agent.server.sendCommand(`execute at ${agent.bot.username} run ${command}`);
    }

    protected runOnActiveInterval(
        server: MinecraftServer,
        intervalMs: number,
        callback: () => void,
        pollMs: number = 100
    ): NodeJS.Timeout {
        let lastTriggeredActiveMs = Date.now() - server.timefrozen;

        return setInterval(() => {
            const activeNowMs = Date.now() - server.timefrozen;
            if (activeNowMs - lastTriggeredActiveMs < intervalMs) {
                return;
            }

            lastTriggeredActiveMs = activeNowMs;
            callback();
        }, pollMs);
    }
}
