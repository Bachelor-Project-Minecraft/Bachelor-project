import "dotenv/config";

import * as readline from 'readline';
import { Agent } from './agent';
import { config } from './config';
import { AgentLogStore } from './evolution/agentLogStore';
import { Evolution } from './evolution/evolution';
import { MinecraftServer } from './minecraftServer';

async function promptToContinueCurrentGenerationLine(): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return true;
    }

    return new Promise((resolve) => {
        let selectedIndex = 0;

        const render = () => {
            const options = ['Yes', 'No']
                .map((option, index) => index === selectedIndex ? `[${option}]` : option)
                .join(' / ');
            process.stdout.write(`\r\x1b[KDo you want to continue the current generation line ${options}`);
        };

        const cleanup = () => {
            process.stdin.removeListener('keypress', handleKeypress);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\n');
        };

        const handleKeypress = (_: string, key: readline.Key) => {
            if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                resolve(selectedIndex === 0);
                return;
            }

            if (key.name === 'right' || key.name === 'down') {
                selectedIndex = 1;
                render();
                return;
            }

            if (key.name === 'left' || key.name === 'up') {
                selectedIndex = 0;
                render();
                return;
            }

            if (key.ctrl && key.name === 'c') {
                cleanup();
                process.kill(process.pid, 'SIGINT');
            }
        };

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('keypress', handleKeypress);
        render();
    });
}

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