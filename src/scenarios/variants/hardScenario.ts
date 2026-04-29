import type { Agent } from '../../agent';
import type { MinecraftServer } from '../../minecraftServer';
import { Scenario } from '../scenario';
import type { AgentItem } from '../types';

const cataclysmOffsets = [
    { x: 6, z: 0 },
    { x: -6, z: 0 },
    { x: 0, z: 6 },
    { x: 0, z: -6 },
    { x: 5, z: 3 },
    { x: -5, z: 3 },
    { x: 5, z: -3 },
    { x: -5, z: -3 },
    { x: 3, z: 5 },
    { x: -3, z: 5 },
    { x: 3, z: -5 },
    { x: -3, z: -5 },
];

export class HardScenario extends Scenario {
    constructor() {
        super(
            'HardScenario',
            'Hard: rapid mixed waves, baby zombies, and armored elites over time.'
        );
    }

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        await super.start(server, agents);

        let wave = 0;
        this.runOnActiveInterval(server, 16000, () => {
            const aliveAgents = agents.filter((agent) => agent.isAlive);
            if (aliveAgents.length === 0) return;

            wave += 1;
            const zombieCount = Math.min(3 + Math.floor(wave / 2), 8);
            const skeletonCount = Math.min(1 + Math.floor(wave / 2), 4);
            const babyZombieCount = wave >= 3 && wave % 3 === 0 ? 1 : 0;
            const eliteCount = wave >= 4 && wave % 4 === 0 ? 1 : 0;

            aliveAgents.forEach((agent) => {
                for (let i = 0; i < zombieCount; i += 1) {
                    const offset = cataclysmOffsets[(wave + i) % cataclysmOffsets.length];
                    this.runCommandAtAgent(agent, `summon zombie ~${offset.x} ~ ~${offset.z}`);
                }

                for (let i = 0; i < skeletonCount; i += 1) {
                    const offset = cataclysmOffsets[(wave + zombieCount + i) % cataclysmOffsets.length];
                    this.runCommandAtAgent(agent, `summon skeleton ~${offset.x} ~ ~${offset.z}`);
                }

                for (let i = 0; i < babyZombieCount; i += 1) {
                    const offset = cataclysmOffsets[(wave + zombieCount + skeletonCount + i) % cataclysmOffsets.length];
                    this.runCommandAtAgent(
                        agent,
                        `summon zombie ~${offset.x} ~ ~${offset.z} {IsBaby:1b,CanBreakDoors:1b}`
                    );
                }

                for (let i = 0; i < eliteCount; i += 1) {
                    const offset = cataclysmOffsets[(wave + zombieCount + skeletonCount + babyZombieCount + i) % cataclysmOffsets.length];
                    this.runCommandAtAgent(
                        agent,
                        `summon zombie ~${offset.x} ~ ~${offset.z} {ArmorItems:[{},{},{id:"minecraft:iron_chestplate",count:1},{id:"minecraft:iron_helmet",count:1}],HandItems:[{id:"minecraft:iron_sword",count:1},{}],HandDropChances:[0.0f,0.0f]}`
                    );
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
