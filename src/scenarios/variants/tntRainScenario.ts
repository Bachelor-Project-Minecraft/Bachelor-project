import type { Agent } from '../../agent';
import type { MinecraftServer } from '../../minecraftServer';
import { Scenario } from '../scenario';

export class TntRainScenario extends Scenario {
    constructor() {
        super('TntRainScenario', 'Spawns TNT above each agent every 20 seconds.');
    }

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        await super.start(server, agents);

        setInterval(() => {
            agents.forEach((agent) => {
                if (!agent.isAlive) return;
                this.runCommandAtAgent(agent, 'summon tnt ~ ~8 ~');
            });
        }, 20000);
    }
}
