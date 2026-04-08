import { Scenario } from '../scenario';

export class ZombieOnSpawnScenario extends Scenario {
    constructor() {
        super('ZombieOnSpawnScenario', 'Spawns 2 zombies near the agents when they spawn.');
    }

    protected getAgentSpawnPositions() {
        return {
            Bot1: { x: 0, y: 0, z: 1 },
            Bot2: { x: 1, y: 0, z: 0 },
        };
    }

    protected getEntitySpawns() {
        return [
            { type: 'zombie', position: { x: 10, y: 0, z: 0 } },
            { type: 'zombie', position: { x: 0, y: 0, z: 10 } },
        ];
    }
}
