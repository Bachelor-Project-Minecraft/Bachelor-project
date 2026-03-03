import { Agent } from './agent';
import { MinecraftServer } from './minecraftServer';

async function main() {
    const server = new MinecraftServer();
    
    try {
        await server.start();
        const agent = new Agent();
    } catch (error) {
        console.error('Failed to boot Minecraft server:', error);
    }
}

main();