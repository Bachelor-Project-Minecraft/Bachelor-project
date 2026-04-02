import "dotenv/config";

import { existsSync } from 'fs';
import { Agent } from './agent';
import { config } from './config';
import { AgentLogStore } from './evolution/agentLogStore';
import { Evolution } from './evolution/evolution';
import { MinecraftServer } from './minecraftServer';
import { promptToContinueCurrentGenerationLine } from './utils/generationLinePrompt';
import { getRuntimePath } from './utils/util';

async function main() {
    try {
        const hasExistingGenerationLine =
            existsSync(getRuntimePath('evolution', 'generations.txt'))
            || existsSync(getRuntimePath('evolution', 'knowledgebase.txt'));
            
        const shouldContinueGenerationLine = hasExistingGenerationLine
            ? await promptToContinueCurrentGenerationLine()
            : true;

        if (!shouldContinueGenerationLine) {
            Evolution.resetGenerationLine();
        }

        const server = new MinecraftServer();
        if (hasExistingGenerationLine && shouldContinueGenerationLine) {
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