import type { Agent } from '../agent';
import { Scenario } from './scenario';

export class ZombieOnSpawnScenario extends Scenario {
    public onAgentSpawn(agent: Agent): void {
        this.runCommandAtAgent(agent, 'summon zombie ~4 ~ ~1');
    }
}
