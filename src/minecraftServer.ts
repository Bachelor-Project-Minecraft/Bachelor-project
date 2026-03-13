import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { config } from './config';
import * as fs from 'fs';

export class MinecraftServer {
    private serverProcess: ChildProcessWithoutNullStreams | null = null;
    private jarName: string;
    private port: number;
    private minRam: string;
    private maxRam: string;

    public isFrozen: Boolean;

    constructor() {
        this.port = config.port;
        this.jarName = config.jarName;
        this.minRam = config.minRam;
        this.maxRam = config.maxRam;
        this.isFrozen = false;
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.serverProcess) {
                console.warn('Server is already running!');
                return resolve(); 
            }

            console.log(`Starting Minecraft server on port ${this.port}...`);

            const serverDirectory = path.join(__dirname, 'server');

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
            });

            this.serverProcess.stderr.on('data', (data) => {
                process.stderr.write(`[Server] Error: ${data.toString()}`);
            });

            this.serverProcess.on('close', (code) => {
                console.log(`[Server] Closed with code: ${code}`);
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

    public setFreeze(freeze: boolean): void {
        if (freeze) {
            console.log('Freezing world...');
            this.isFrozen = true;
            this.sendCommand('tick freeze');
        } else {
            console.log('Unfreezing world...');
            this.isFrozen = false;
            this.sendCommand('tick unfreeze');
        }
    }

    public resetWorld(): void{
        if (this.serverProcess) {
            console.error('Server is currently running. Cannot reset');
            return;
        }

        const serverDirectory = path.join(__dirname, 'server');
        const worldPath = path.join(serverDirectory, 'world');
        const cleanWorldPath = path.join(serverDirectory, 'world_clean');
        const skillsPath = path.resolve(process.cwd(), 'src', 'skills', 'SKILLS.json');

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