import mineflayer, { Bot } from 'mineflayer';
import { MinecraftServer } from './minecraftServer';
import { config } from './config';
import { AIController } from './ai';

export class Agent {
    public bot: Bot;
    public ai: AIController;
    private lastDanger: number = 0; // Timestamp to prevent spamming danger alerts
    public server: MinecraftServer;

    public isFrozen: boolean;

    constructor(server: MinecraftServer) {
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: config.username,
            auth: config.auth
        });
        this.isFrozen = false;
        this.server = server;
        this.ai = new AIController(this);
        this.initializeEvents();
        this.startSensors();
    }

    private initializeEvents(): void {
        this.bot.once('spawn', () => {
            console.log(`Mineflayer bot spawned as ${this.bot.username}`);
        });

        this.bot.on('chat', (username, message) => {
            if (username === this.bot.username) return;
            this.ai.processChat(username, message);
        });

        // Immediate Reaction: Physical Damage
        this.bot.on('entityHurt', (entity) => {
            if (entity === this.bot.entity) {
                this.ai.processEvent("I just took damage! Check surroundings immediately.");
            }
        });

        this.bot.on('error', (err) => console.log('Error:', err));
        this.bot.on('kicked', (reason) => console.log('Kicked:', reason));
    }

    private startSensors() {
        setInterval(() => {
            this.checkForDanger();
        }, 2000);
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
                this.ai.processEvent(`WARNING: A ${nearestMob.name} is approaching! It is ${dist} blocks away.`);
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