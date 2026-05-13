import type { Agent } from '../../agent/agent';
import type { MinecraftServer } from '../../server/minecraftServer';
import { Scenario } from '../scenario';
import type { AgentItem } from '../types';

const waveOffsets = [
    { x: 4, z: 0 },
    { x: -4, z: 0 },
    { x: 0, z: 4 },
    { x: 0, z: -4 },
    { x: 3, z: 3 },
    { x: -3, z: 3 },
    { x: 3, z: -3 },
    { x: -3, z: -3 },
];

export class easyScenario extends Scenario {
    constructor() {
        super(
            'easyScenario',
            'easy: zombie waves increase in size and gain light ranged support over time.'
        );
    }

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        await super.start(server, agents);

        let wave = 0;
        this.runOnActiveInterval(server, 30000, () => {
            const aliveAgents = agents.filter((agent) => agent.isAlive);
            if (aliveAgents.length === 0) return;

            wave += 1;
            const zombieCount = Math.min(1 + Math.floor(wave / 2), 4);
            const skeletonCount = wave >= 4 ? Math.min(1 + Math.floor((wave - 4) / 3), 2) : 0;

            aliveAgents.forEach((agent) => {
                for (let i = 0; i < zombieCount; i += 1) {
                    const offset = waveOffsets[(wave + i) % waveOffsets.length];
                    this.runCommandAtAgent(agent, `summon zombie ~${offset.x} ~ ~${offset.z} {equipment:{head:{id:stone_button}}}`);
                }

                for (let i = 0; i < skeletonCount; i += 1) {
                    const offset = waveOffsets[(wave + zombieCount + i) % waveOffsets.length];
                    this.runCommandAtAgent(agent, `summon skeleton ~${offset.x} ~ ~${offset.z} {equipment:{head:{id:stone_button}}}`);
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
                { item: 'minecraft:oak_planks', count: 40 },
            ],
            Bot2: [
                { item: 'minecraft:stone_sword', count: 1 },
                { item: 'minecraft:bow', count: 1 },
                { item: 'minecraft:arrow', count: 24 },
                { item: 'minecraft:leather_chestplate', count: 1 },
                { item: 'minecraft:bread', count: 12 },
                { item: 'minecraft:oak_planks', count: 40 },
            ],
        };
    }
}
