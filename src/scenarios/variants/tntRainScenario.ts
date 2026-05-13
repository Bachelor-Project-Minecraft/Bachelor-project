import type { Agent } from '../../agent/agent';
import type { MinecraftServer } from '../../server/minecraftServer';
import { Scenario } from '../scenario';

export class TntRainScenario extends Scenario {
    constructor() {
        super('TntRainScenario', 'Spawns TNT above each agent every 20 seconds.');
    }

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        await super.start(server, agents);

        this.runOnActiveInterval(server, 20000, () => {
            agents.forEach((agent) => {
                if (!agent.isAlive) return;
                this.runCommandAtAgent(agent, 'summon tnt ~ ~8 ~');
            });
        });
    }
}
