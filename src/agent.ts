import mineflayer, { Bot } from 'mineflayer';
import { config } from './config';
import { AIController } from './ai';
import { Environment } from './environment/environment';

export class Agent {
    public bot: Bot;
    public ai: AIController;
    private lastDanger: number = 0; // Timestamp to prevent spamming danger alerts
    private environment: Environment;

    constructor() {
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: config.username,
            auth: config.auth
        });

        this.ai = new AIController(this.bot);
        this.environment = new Environment(this.bot);
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

    private observeEnvironment() {
        return this.environment.getEnvironmentSnapshot()
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
}