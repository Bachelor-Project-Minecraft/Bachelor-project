import { Scenario } from './scenario';
import { TntRainScenario } from './tntRainScenario';
import { ZombieOnSpawnScenario } from './zombieOnSpawnScenario';
import { ZombieRespawnScenario } from './zombieRespawnScenario';

export { Scenario } from './scenario';

export const availableScenarios: Scenario[] = [
    new TntRainScenario(),
    new ZombieOnSpawnScenario(),
    new ZombieRespawnScenario(),
];
