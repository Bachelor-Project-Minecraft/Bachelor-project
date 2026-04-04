import type { Agent } from '../agent';
import type { MinecraftServer } from '../minecraftServer';

export class Scenario {
    public start(_server: MinecraftServer, _agents: Agent[]): void {}

    public onAgentSpawn(_agent: Agent): void {}

    protected runCommandAtAgent(agent: Agent, command: string): void {
        agent.server.sendCommand(`execute at ${agent.bot.username} run ${command}`);
    }
}
