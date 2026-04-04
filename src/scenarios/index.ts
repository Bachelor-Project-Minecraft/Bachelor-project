import { Scenario } from './scenario';
import { ZombieOnSpawnScenario } from './zombieOnSpawnScenario';

export { Scenario } from './scenario';

export const activeScenario: Scenario = new ZombieOnSpawnScenario();
