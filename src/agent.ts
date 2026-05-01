import mineflayer, { Bot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin } from 'mineflayer-pvp';
import { MinecraftServer } from './minecraftServer';
import { config } from './config';
import { AIController } from './ai';
import { Environment } from './environment/environment';
import type { Scenario } from './scenarios';
import type { EnvironmentChangeStep, EnvironmentSnapshot } from './environment/types';
import { stopActiveBackgroundSkill } from './skills/backgroundSkillRunner';

export class Agent {
    public bot: Bot;
    public ai: AIController;
    public readonly username: string;
    private environment: Environment;
    private previousEnvironmentSnapshot: EnvironmentSnapshot | null = null;
    public server: MinecraftServer;
    private scenario: Scenario;
    public isFrozen: boolean;
    public isAlive: boolean;
    public hasSpawned: boolean;

    constructor(server: MinecraftServer, username: string, scenario: Scenario) {
        this.username = username;
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
        this.hasSpawned = false;

        this.initializeEvents();
        this.startSensors();
    }

    private initializeEvents(): void {
        this.bot.on('spawn', () => {
            this.isAlive = true;
            this.hasSpawned = true;
            this.previousEnvironmentSnapshot = this.observeEnvironment();
            this.scenario.onAgentSpawn(this);
        });

        this.bot.on('death', () => {
            this.isAlive = false;
            this.stopActivity();
            this.bot.quit();
            console.log(this.bot.username + " died and left the game.");
        });

        this.bot.on('whisper', (username, message) => {
            if (username === this.bot.username) return;
            this.ai.processMessage(username, message);
        });

        this.bot.on('error', (err) => console.log('Error:', err));
        this.bot.on('kicked', (reason) => console.log('Kicked:', reason));
        this.bot.on('end', () => {
            this.isAlive = false;
            this.stopActivity();
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

    private detectEnvironmentChanges(currentSnapshot: EnvironmentSnapshot): EnvironmentChangeStep[] {
        const previousSnapshot = this.previousEnvironmentSnapshot;

        if (!previousSnapshot) {
            return [];
        }

        return this.environment.compareEnvironmentSnapshots(previousSnapshot, currentSnapshot);
    }

    private commitEnvironmentSnapshot(currentSnapshot: EnvironmentSnapshot): void {
        this.previousEnvironmentSnapshot = currentSnapshot;
    }

    private formatEnvironmentChanges(steps: EnvironmentChangeStep[]): string {
        return steps
            .map((step) => {
                const triggerLine = step.shouldTriggerPrompt ? 'Trigger prompt: true' : 'Trigger prompt: false';
                return `${step.title}\n${step.details.join('\n')}`;
            })
            .join('\n\n');
    }

    private hasTriggeringChanges(steps: EnvironmentChangeStep[]): boolean {
        return steps.some((step) => step.shouldTriggerPrompt);
    }

    public consumePendingEnvironmentChanges(): string | null {
        const currentSnapshot = this.observeEnvironment();
        const environmentChanges = this.detectEnvironmentChanges(currentSnapshot);

        if (environmentChanges.length === 0) {
            return null;
        }

        this.commitEnvironmentSnapshot(currentSnapshot);

        return this.formatEnvironmentChanges(environmentChanges);
    }

    private checkForDanger() {
        if (!this.bot.entity) return;

        const currentSnapshot = this.observeEnvironment();
        const environmentChanges = this.detectEnvironmentChanges(currentSnapshot);
        if (environmentChanges.length === 0) return;
        if (!this.hasTriggeringChanges(environmentChanges)) return;

        this.commitEnvironmentSnapshot(currentSnapshot);

        this.ai.processEvent(this.bot.username, this.formatEnvironmentChanges(environmentChanges));
    }

    public setFreeze(freeze: boolean): void {
        this.isFrozen = freeze;
        this.bot.physicsEnabled = !freeze;
    }

    public stopActivity(): void {
        try {
            stopActiveBackgroundSkill(this.bot);
            this.bot.pvp?.stop();
            this.bot.pathfinder?.stop();
            this.bot.clearControlStates();
            this.bot.deactivateItem();
        } catch (error) {
            console.warn(`Failed to stop activity for ${this.username}:`, error);
        }
    }
}
