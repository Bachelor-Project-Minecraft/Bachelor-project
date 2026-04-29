import { Scenario } from '../scenario';
import type { AgentItem } from '../types';

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

    protected getAgentInventories(): Record<string, AgentItem[]> {
        return {
            Bot1: [
                { item: 'minecraft:iron_sword', count: 1 },
                { item: 'minecraft:cooked_beef', count: 16 }
            ],
            Bot2: [
                { item: 'minecraft:bow', count: 1 },
                { item: 'minecraft:arrow', count: 64 },
                { item: 'minecraft:leather_chestplate', count: 1 }
            ]
        };
    }

    protected getEntitySpawns() {
        return [
            { type: 'zombie', position: { x: 10, y: 0, z: 0 } },
            { type: 'zombie', position: { x: 0, y: 0, z: 10 } },
        ];
    }
}
