import mineflayer, { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Entity } from 'prismarine-entity';
import { MinecraftServer } from './minecraftServer';
import { config } from './config';
import { AIController } from './ai';
import { Environment } from './environment/environment';

export class Agent {
    public bot: Bot;
    public ai: AIController;
    private lastDanger: number = 0; // Timestamp to prevent spamming danger alerts
    private lastTntAlert: number = 0; // Timestamp to prevent spamming TNT alerts
    private environment: Environment;
    public server: MinecraftServer;
    public isFrozen: boolean;

    constructor(server: MinecraftServer) {
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: config.username,
            auth: config.auth
        });

        this.environment = new Environment(this.bot);
        this.isFrozen = false;
        this.server = server;
        this.ai = new AIController(this);
        
        this.initializeEvents();
        this.startSensors();
        setTimeout(() => {
            console.log(JSON.stringify(this.observeEnvironment()));
        }, 5000);
    }

    private initializeEvents(): void {
        this.bot.once('spawn', () => {
            console.log(`Mineflayer bot spawned as ${this.bot.username}`);
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

        this.bot.on('entitySpawn', (entity) => {
            if (this.isNearbyTnt(entity, 8)) {
                this.alertTnt(entity);
            }
        });

        this.bot.on('entityMoved', (entity) => {
            if (this.isNearbyTnt(entity, 6)) {
                this.alertTnt(entity);
            }
        });

        this.bot.on('blockUpdate', (_oldBlock, newBlock) => {
            if (this.isNearbyPlacedTnt(newBlock, 6)) {
                const dist = newBlock.position.distanceTo(this.bot.entity.position).toFixed(1);
                this.ai.processEvent(this.bot.username, `A TNT block was placed nearby, It is ${dist} blocks away. I must act quickly.`);
            }
        });

        this.bot.on('error', (err) => console.log('Error:', err));
        this.bot.on('kicked', (reason) => console.log('Kicked:', reason));
    }

    public observeEnvironment() {
        return this.environment.getEnvironmentSnapshot();
    }

    private startSensors() {
        setInterval(() => {
            this.checkForDanger();
        }, 2000);
    }

    private isNearbyTnt(entity: Entity, radius: number): boolean {
        const name = entity.name?.toLowerCase() ?? '';
        const displayName = entity.displayName?.toLowerCase() ?? '';
        const isTntLike = name.includes('tnt') || displayName.includes('tnt');

        return isTntLike && entity.position.distanceTo(this.bot.entity.position) <= radius;
    }

    private isNearbyPlacedTnt(block: Block | null, radius: number): boolean {
        return block?.name === 'tnt' && block.position.distanceTo(this.bot.entity.position) <= radius;
    }

    private alertTnt(entity: Entity): void {
        const now = Date.now();
        if (now - this.lastTntAlert < 3000) return;

        this.lastTntAlert = now;
        const dist = entity.position.distanceTo(this.bot.entity.position).toFixed(1);
        this.ai.processEvent(this.bot.username, `TNT is dangerously close, it is ${dist} blocks away. I must act quickly.`);
    }

    private checkForDanger() {
        // Find the nearest hostile mob within 10 blocks
        const nearestMob = this.bot.nearestEntity((entity) => {
            return entity.type === 'hostile' && entity.position.distanceTo(this.bot.entity.position) < 10;
        });

        if (nearestMob) {
            const now = Date.now();
            if (now - this.lastDanger > 10000) {
                this.lastDanger = now;
                const dist = nearestMob.position.distanceTo(this.bot.entity.position).toFixed(1);
                this.ai.processEvent(this.bot.username, `A ${nearestMob.name} is approaching! It is ${dist} blocks away.`);
            }
        }
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