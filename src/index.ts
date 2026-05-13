import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';

import { Agent } from './agent/agent';
import { config } from './config';
import { AgentLogStore } from './evolution/agentLogStore';
import { Evolution } from './evolution/evolution';
import { MinecraftServer } from './server/minecraftServer';
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

async function main() {
    try {
        const hasExistingGenerationLine = Evolution.hasExistingGenerationLine();
            
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
        stopWhenAllAgentsAreDead(server, agents);
        void agents;
    } catch (error) {
        console.error('Failed to boot Minecraft server:', error);
        process.exitCode = 1;
    }
}

function stopWhenAllAgentsAreDead(server: MinecraftServer, agents: Agent[]): void {
    if (process.env.AUTO_STOP_WHEN_AGENTS_DEAD !== 'true') {
        return;
    }

    const interval = setInterval(() => {
        const allAgentsSpawned = agents.length > 0 && agents.every((agent) => agent.hasSpawned);
        const allAgentsDead = allAgentsSpawned && agents.every((agent) => !agent.isAlive);

        if (!allAgentsDead) {
            return;
        }

        clearInterval(interval);
        console.log('[AutoRun] All agents are dead. Stopping generation.');
        server.stop();

        setTimeout(() => {
            AgentLogStore.finalizeGeneration();
            writeAutoRunCompletionMarker();
            process.exit(0);
        }, 5000);
    }, 1000);
}

function writeAutoRunCompletionMarker(): void {
    const markerPath = process.env.AUTO_RUN_COMPLETE_MARKER;
    if (!markerPath) {
        return;
    }

    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, 'complete', 'utf8');
}

main();
