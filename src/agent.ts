import mineflayer, { Bot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import type { Block } from 'prismarine-block';
import type { Entity } from 'prismarine-entity';
import { MinecraftServer } from './minecraftServer';
import { config } from './config';
import { AIController } from './ai';
import { Environment } from './environment/environment';

export class Agent {
    public bot: Bot;
    public ai: AIController;
    private lastDangerAlert: number = 0; // Timestamp to prevent spamming danger alerts
    private environment: Environment;
    public server: MinecraftServer;
    public isFrozen: boolean;
    public isAlive: boolean;

    constructor(server: MinecraftServer, name: string) {
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: name,
            auth: config.auth
        });
        this.bot.loadPlugin(pathfinder);

        this.environment = new Environment(this.bot);
        this.isFrozen = false;
        this.isAlive = false;
        this.server = server;
        this.ai = new AIController(this, name);
        
        this.initializeEvents();
        this.startSensors();
    }

    private initializeEvents(): void {
        this.bot.on('spawn', () => {
            this.isAlive = true;
            console.log(`Mineflayer bot spawned as ${this.bot.username}`);
        });

        this.bot.on('death', () => {
            this.isAlive = false;
        });

        this.bot.on('chat', (username, message) => {
            if (username === this.bot.username || username === 'Server') return;
            this.ai.processChat(username, message);
        });

        // Immediate Reaction: Physical Damage
        this.bot.on('entityHurt', (entity) => {
            if (entity === this.bot.entity) {
                this.ai.processEvent(this.bot.username, `I just took damage! I must respond immediately to protect myself.`);
            }
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
            this.checkForDanger();
        }, 2000);
    }

    private isTntEntity(entity: Entity): boolean {
        const name = entity.name?.toLowerCase() ?? '';
        const displayName = entity.displayName?.toLowerCase() ?? '';
        return name.includes('tnt') || displayName.includes('tnt');
    }

    private getNearbyTntBlocks(radius: number): Block[] {
        const maxBlockSearchCount = Math.pow(radius * 2 + 1, 3);
        const tntPositions = this.bot.findBlocks({
            matching: (block) => block.name === 'tnt',
            maxDistance: radius,
            count: maxBlockSearchCount
        });

        return tntPositions
            .map((position) => this.bot.blockAt(position))
            .filter((block): block is Block => block !== null)
            .sort((left, right) => left.position.distanceTo(this.bot.entity.position) - right.position.distanceTo(this.bot.entity.position));
    }

    private getNearbyTntEntities(radius: number): Entity[] {
        return Object.values(this.bot.entities)
            .filter((entity) => this.isTntEntity(entity) && entity.position.distanceTo(this.bot.entity.position) <= radius)
            .sort((left, right) => left.position.distanceTo(this.bot.entity.position) - right.position.distanceTo(this.bot.entity.position));
    }

    private getNearbyHostileMobs(radius: number): Entity[] {
        return Object.values(this.bot.entities)
            .filter((entity) => entity.type === 'hostile' && entity.position.distanceTo(this.bot.entity.position) < radius)
            .sort((left, right) => left.position.distanceTo(this.bot.entity.position) - right.position.distanceTo(this.bot.entity.position));
    }

    private formatTntMessage(tntDistances: number[]): string {
        if (tntDistances.length === 1) {
            return `TNT is dangerously close, it is ${tntDistances[0].toFixed(1)} blocks away. I must act quickly.`;
        }

        const lines = tntDistances.map((distance) => `- TNT block is ${distance.toFixed(1)} blocks away`);
        return `Multiple TNT blocks are dangerously close:\n${lines.join('\n')}`;
    }

    private formatMobMessage(mobs: Entity[]): string {
        if (mobs.length === 1) {
            const mob = mobs[0];
            const mobName = mob.name ?? 'hostile mob';
            const dist = mob.position.distanceTo(this.bot.entity.position).toFixed(1);
            return `A ${mobName} is approaching! It is ${dist} blocks away.`;
        }

        const lines = mobs.map((mob) => {
            const mobName = mob.name ?? 'hostile mob';
            const dist = mob.position.distanceTo(this.bot.entity.position).toFixed(1);
            return `- ${mobName} is ${dist} blocks away`;
        });

        return `Multiple hostile mobs are approaching:\n${lines.join('\n')}`;
    }

    private checkForDanger() {
        if (!this.bot.entity) return;

        const now = Date.now();
        if (now - this.lastDangerAlert < 5000) return;

        const hostileMobs = this.getNearbyHostileMobs(10);
        const tntThreats = [
            ...this.getNearbyTntEntities(8).map((entity) => entity.position.distanceTo(this.bot.entity.position)),
            ...this.getNearbyTntBlocks(8).map((block) => block.position.distanceTo(this.bot.entity.position))
        ].sort((left, right) => left - right);

        const messageParts: string[] = [];

        if (tntThreats.length > 0) {
            messageParts.push(this.formatTntMessage(tntThreats));
        }

        if (hostileMobs.length > 0) {
            messageParts.push(this.formatMobMessage(hostileMobs));
        }

        if (messageParts.length === 0) return;

        this.lastDangerAlert = now;
        this.ai.processEvent(this.bot.username, messageParts.join('\n\n'));
    }

    public setFreeze(freeze: boolean): void {
        if (freeze) {
            console.log('Freezing bot...');
        } else {
            console.log('Unfreezing bot...');
        }
        this.isFrozen = freeze;
        this.bot.physicsEnabled = !freeze;
    }
}