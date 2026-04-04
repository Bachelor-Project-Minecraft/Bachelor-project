import type { Agent } from '../agent';
import type { MinecraftServer } from '../minecraftServer';
import { Scenario } from './scenario';

export class TntRainScenario extends Scenario {
    public start(_server: MinecraftServer, agents: Agent[]): void {
        setInterval(() => {
            agents.forEach((agent) => {
                if (!agent.isAlive) return;
                this.runCommandAtAgent(agent, 'summon tnt ~ ~8 ~');
            });
        }, 20000);
    }
}
