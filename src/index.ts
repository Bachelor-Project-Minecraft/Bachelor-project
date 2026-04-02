import "dotenv/config";

import { Agent } from './agent';
import { config } from './config';
import { AgentLogStore } from './evolution/agentLogStore';
import { Evolution } from './evolution/evolution';
import { MinecraftServer } from './minecraftServer';
import { promptToContinueCurrentGenerationLine } from './utils/generationLinePrompt';

async function main() {
    try {
        const shouldContinueGenerationLine = await promptToContinueCurrentGenerationLine();

        if (!shouldContinueGenerationLine) {
            Evolution.resetGenerationLine();
        }

        const server = new MinecraftServer();
        if (shouldContinueGenerationLine) {
            await Evolution.updateKnowledgebase();
        }
        AgentLogStore.resetLogsDirectory();
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