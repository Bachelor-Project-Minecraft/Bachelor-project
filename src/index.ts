import "dotenv/config";

import { existsSync } from 'fs';
import { Agent } from './agent';
import { config } from './config';
import { AgentLogStore } from './evolution/agentLogStore';
import { Evolution } from './evolution/evolution';
import { MinecraftServer } from './minecraftServer';
import {
    availableScenarios,
    clearSelectedScenario,
    getDefaultScenario,
    persistSelectedScenario,
} from './scenarios';
import {
    promptToContinueCurrentGenerationLine,
    promptToSelectScenario,
} from './utils/terminalPrompts';
import { getRuntimePath } from './utils/util';

async function main() {
    try {
        const hasExistingGenerationLine =
            existsSync(getRuntimePath('evolution', 'generations.txt'))
            || existsSync(getRuntimePath('evolution', 'knowledgebase.txt'))
            || existsSync(getRuntimePath('evolution', 'generationSkills.json'));
            
        const shouldContinueGenerationLine = hasExistingGenerationLine
            ? await promptToContinueCurrentGenerationLine()
            : true;

        if (!shouldContinueGenerationLine) {
            Evolution.resetGenerationLine();
            clearSelectedScenario();
        }

        AgentLogStore.initializeCondensedMetrics(shouldContinueGenerationLine);

        const selectedScenario = await promptToSelectScenario(
            availableScenarios,
            getDefaultScenario()
        );
        persistSelectedScenario(selectedScenario);

        const server = new MinecraftServer();
        if (hasExistingGenerationLine && shouldContinueGenerationLine) {
            Evolution.updateGenerationSkills();
            await Evolution.updateKnowledgebase();
        }
        AgentLogStore.resetLogsDirectory();
        server.resetWorld();
        await server.start();

        config.admins.forEach(admin => {
            server.sendCommand(`op ${admin}`);
        });
        server.sendCommand('gamerule spawnRadius 0');
        server.sendCommand('gamerule send_command_feedback false');

        config.admins.forEach(admin => {
            server.onPlayerJoin(admin, (playerName) => {
                server.sendCommand(`gamemode spectator ${playerName}`);
                console.log(`[Server] ${playerName} joined - automatically set to spectator mode.`);
            });
        });

        const agents = config.agents.map((agentName) => new Agent(server, agentName, selectedScenario));
        await selectedScenario.start(server, agents);
        void agents;
    } catch (error) {
        console.error('Failed to boot Minecraft server:', error);
    }
}

main();