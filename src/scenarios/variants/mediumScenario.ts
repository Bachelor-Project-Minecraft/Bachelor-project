import type { Agent } from '../../agent';
import type { MinecraftServer } from '../../minecraftServer';
import { Scenario } from '../scenario';
import type { AgentItem } from '../types';

const siegeOffsets = [
    { x: 5, z: 1 },
    { x: -5, z: -1 },
    { x: 1, z: 5 },
    { x: -1, z: -5 },
    { x: 4, z: 4 },
    { x: -4, z: 4 },
    { x: 4, z: -4 },
    { x: -4, z: -4 },
];

export class mediumScenario extends Scenario {
    constructor() {
        super(
            'mediumScenario',
            'Medium undead siege: mixed zombie and skeleton waves ramp up with periodic husk pressure.'
        );
    }

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        await super.start(server, agents);

        let wave = 0;
        this.runOnActiveInterval(server, 22000, () => {
            const aliveAgents = agents.filter((agent) => agent.isAlive);
            if (aliveAgents.length === 0) return;

            wave += 1;
            const zombieCount = Math.min(2 + Math.floor(wave / 2), 6);
            const skeletonCount = wave >= 2 ? Math.min(1 + Math.floor(wave / 3), 3) : 0;
            const huskCount = wave >= 4 && wave % 3 === 0 ? 1 : 0;

            aliveAgents.forEach((agent) => {
                for (let i = 0; i < zombieCount; i += 1) {
                    const offset = siegeOffsets[(wave + i) % siegeOffsets.length];
                    this.runCommandAtAgent(agent, `summon zombie ~${offset.x} ~ ~${offset.z} {equipment:{head:{id:stone_button}}}`);
                }

                for (let i = 0; i < skeletonCount; i += 1) {
                    const offset = siegeOffsets[(wave + zombieCount + i) % siegeOffsets.length];
                    this.runCommandAtAgent(agent, `summon skeleton ~${offset.x} ~ ~${offset.z} {equipment:{head:{id:stone_button}}}`);
                }

                for (let i = 0; i < huskCount; i += 1) {
                    const offset = siegeOffsets[(wave + zombieCount + skeletonCount + i) % siegeOffsets.length];
                    this.runCommandAtAgent(agent, `summon husk ~${offset.x} ~ ~${offset.z} {equipment:{head:{id:stone_button}}}`);
                }
            });
        });
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
                { item: 'minecraft:stone_sword', count: 1 },
                { item: 'minecraft:bow', count: 1 },
                { item: 'minecraft:arrow', count: 24 },
                { item: 'minecraft:leather_chestplate', count: 1 },
                { item: 'minecraft:bread', count: 12 },
            ],
            Bot2: [
                { item: 'minecraft:stone_sword', count: 1 },
                { item: 'minecraft:bow', count: 1 },
                { item: 'minecraft:arrow', count: 24 },
                { item: 'minecraft:leather_chestplate', count: 1 },
                { item: 'minecraft:bread', count: 12 },
            ],
        };
    }
}
