import type { Agent } from '../agent';
import type { MinecraftServer } from '../minecraftServer';
import { Scenario } from './scenario';

const zombieTag = 'scenario_respawn_zombie';
const respawnMarkerTag = 'scenario_respawn_zombie_marker';

export class ZombieRespawnScenario extends Scenario {
    constructor() {
        super('ZombieRespawnScenario', 'Spawns a zombie near each agent on spawn and then respawns zombies once all zombies are dead.');
    }

    public start(_server: MinecraftServer, agents: Agent[]): void {
        setInterval(() => {
            const aliveAgents = agents.filter((agent) => agent.isAlive);
            if (aliveAgents.length === 0) return;

            aliveAgents.forEach((agent) => {
                this.runCommandAtAgent(
                    agent,
                    `execute unless entity @e[type=zombie,tag=${zombieTag}] unless entity @e[type=marker,tag=${respawnMarkerTag}] run summon marker ~ ~ ~ {Tags:["${respawnMarkerTag}"]}`
                );
            });

            aliveAgents.forEach((agent) => {
                this.runCommandAtAgent(
                    agent,
                    `execute if entity @e[type=marker,tag=${respawnMarkerTag}] run summon zombie ~4 ~ ~1 {Tags:["${zombieTag}"]}`
                );
            });

            aliveAgents[0].server.sendCommand(`kill @e[type=marker,tag=${respawnMarkerTag}]`);
        }, 2000);
    }

    public onAgentSpawn(agent: Agent): void {
        this.runCommandAtAgent(agent, `summon zombie ~4 ~ ~1 {Tags:["${zombieTag}"]}`);
    }
}
