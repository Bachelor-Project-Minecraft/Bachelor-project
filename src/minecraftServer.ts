import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { config } from './config';
import * as fs from 'fs';
import { Agent } from './agent';
import { getRuntimePath } from './utils/util';

export class MinecraftServer {
    private serverProcess: ChildProcessWithoutNullStreams | null = null;
    private jarName: string;
    private port: number;
    private minRam: string;
    private maxRam: string;
    private agentExecutionQueue: Promise<void>;
    private frozenAccumulatedMs: number;
    private frozenStartedAt: number | null;
    private playerJoinCallbacks: Map<string, (playerName: string) => void> = new Map();

    public isFrozen: Boolean;
    public agents: Set<Agent> = new Set();

    constructor() {
        this.port = config.port;
        this.jarName = config.jarName;
        this.minRam = config.minRam;
        this.maxRam = config.maxRam;
        this.agentExecutionQueue = Promise.resolve();
        this.isFrozen = false;
        this.frozenAccumulatedMs = 0;
        this.frozenStartedAt = null;
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.serverProcess) {
                console.warn('Server is already running!');
                return resolve(); 
            }

            console.log(`Starting Minecraft server on port ${this.port}...`);

            const serverDirectory = getRuntimePath('server');

            this.serverProcess = spawn('java', [
                `-Xms${this.minRam}`,
                `-Xmx${this.maxRam}`,
                '-jar', this.jarName,
                'nogui',
                '--port', this.port.toString()
            ], {
                cwd: serverDirectory
            });

            this.serverProcess.stdout.on('data', (data) => {
                const output = data.toString();

                if (output.includes('For help, type "help"')) {
                    console.log('[Server] Server boot complete.');
                    resolve();
                }

                const playerJoinMatch = output.match(/\[\d+:\d+:\d+\]\s+\[.*?\]:\s*(\w+)\s+joined the game/);
                if (playerJoinMatch) {
                    const playerName = playerJoinMatch[1];
                    const callbacks = this.playerJoinCallbacks.get(playerName);
                    if (callbacks) {
                        callbacks(playerName);
                    }
                }
            });

            this.serverProcess.stderr.on('data', (data) => {
                process.stderr.write(`[Server] Error: ${data.toString()}`);
            });

            this.serverProcess.on('close', (code) => {
                console.log(`[Server] Closed with code: ${code}`);
                this.stopFrozenInterval();
                this.isFrozen = false;
                this.serverProcess = null;
            });

            this.serverProcess.on('error', reject);
        });
    }

    public sendCommand(command: string): void {
        if (this.serverProcess && this.serverProcess.stdin.writable) {
            this.serverProcess.stdin.write(`${command}\n`);
        } else {
            console.error('Cannot send command: Server is not running.');
        }
    }

    public stop(): void {
        console.log('Stopping server...');
        this.sendCommand('stop');
    }

    public registerAgent(agent: Agent): void {
        this.agents.add(agent);
    }

    public async runWhileWorldFrozen<T>(work: () => Promise<T>): Promise<T> {
        // All LLM work goes through this queue so exactly one agent freezes
        // the world, does an LLM call and then unfreezes again.
        const previousExecution = this.agentExecutionQueue;
        let releaseExecution!: () => void;

        this.agentExecutionQueue = new Promise<void>((resolve) => {
            releaseExecution = resolve;
        });

        await previousExecution;
        this.freezeWorld();

        try {
            return await work();
        } finally {
            this.unfreezeWorld();
            releaseExecution();
        }
    }

    private freezeWorld(): void {
        if (!this.isFrozen && this.frozenStartedAt === null) {
            this.frozenStartedAt = Date.now();
        }

        this.isFrozen = true;
        this.agents.forEach((agent) => {
            agent.setFreeze(true);
        });
        this.sendCommand('tick freeze');
    }

    private unfreezeWorld(): void {
        this.stopFrozenInterval();
        this.isFrozen = false;
        this.agents.forEach((agent) => {
            agent.setFreeze(false);
        });
        this.sendCommand('tick unfreeze');
    }

    private stopFrozenInterval(): void {
        if (this.frozenStartedAt !== null) {
            this.frozenAccumulatedMs += Date.now() - this.frozenStartedAt;
            this.frozenStartedAt = null;
        }
    }

    public get timefrozen(): number {
        if (this.frozenStartedAt !== null) {
            return this.frozenAccumulatedMs + (Date.now() - this.frozenStartedAt);
        }
        return this.frozenAccumulatedMs;
    }

    public onPlayerJoin(playerName: string, callback: (playerName: string) => void): void {
        this.playerJoinCallbacks.set(playerName, callback);
    }

    public resetWorld(): void{
        if (this.serverProcess) {
            console.error('Server is currently running. Cannot reset');
            return;
        }

        const serverDirectory = getRuntimePath('server');
        const worldPath = path.join(serverDirectory, 'world');
        const cleanWorldPath = path.join(serverDirectory, 'world_clean');
        const skillsPath = getRuntimePath('skills', 'generatedSkills.json');

        try {
            if (!fs.existsSync(cleanWorldPath)) {
                console.error('Reset failed, could not find:', cleanWorldPath);
                return;
            }

            if (fs.existsSync(worldPath)) {
                fs.rmSync(worldPath, { recursive: true, force: true });
            }

            fs.cpSync(cleanWorldPath, worldPath, { recursive: true });
            fs.writeFileSync(skillsPath, '[]', 'utf8');

        } catch (error) {
            console.error('Error during world reset:', error);
        }
    }
}
