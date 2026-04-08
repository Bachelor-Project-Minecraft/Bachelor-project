import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { getRuntimePath } from '../utils/util';
import { Scenario } from './scenario';
import { TntRainScenario } from './variants/tntRainScenario';
import { ZombieOnSpawnScenario } from './variants/zombieOnSpawnScenario';
import { ZombieRespawnScenario } from './variants/zombieRespawnScenario';

export { Scenario } from './scenario';

export const availableScenarios: Scenario[] = [
    new TntRainScenario(),
    new ZombieOnSpawnScenario(),
    new ZombieRespawnScenario(),
];

const chosenScenarioPath = getRuntimePath('scenarios', 'chosenScenario.txt');

export function getDefaultScenario(): Scenario {
    try {
        const chosenScenarioName = readFileSync(chosenScenarioPath, 'utf8').trim();
        return availableScenarios.find((scenario) => scenario.name === chosenScenarioName) ?? availableScenarios[0];
    } catch {
        return availableScenarios[0];
    }
}

export function persistSelectedScenario(scenario: Scenario): void {
    writeFileSync(chosenScenarioPath, scenario.name, 'utf8');
}

export function clearSelectedScenario(): void {
    try {
        unlinkSync(chosenScenarioPath);
    } catch {}
}
