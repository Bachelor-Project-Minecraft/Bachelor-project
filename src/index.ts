import "dotenv/config";

import { Agent } from './agent';
import { config } from './config';
import { MinecraftServer } from './minecraftServer';

async function main() {
    const server = new MinecraftServer();
    
    try {
        server.resetWorld();
        await server.start();

        config.admins.forEach(admin => {
            server.sendCommand(`op ${admin}`);
        });
        server.sendCommand('gamerule send_command_feedback false');

        const agents = config.agents.map((agentName) => new Agent(server, agentName));
        void agents;
    } catch (error) {
        console.error('Failed to boot Minecraft server:', error);
    }
}

main();