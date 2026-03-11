import { Agent } from './agent';
import { config } from './config';
import { MinecraftServer } from './minecraftServer';

async function main() {
    const server = new MinecraftServer();
    
    try {
        await server.start();

        config.admins.forEach(admin => {
            server.sendCommand(`op ${admin}`);
        });

        const agent = new Agent(server);
    } catch (error) {
        console.error('Failed to boot Minecraft server:', error);
    }
}

main();