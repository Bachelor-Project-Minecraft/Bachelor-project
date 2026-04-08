import type { Agent } from '../agent';
import type { MinecraftServer } from '../minecraftServer';

type Position = {
    x: number;
    y: number;
    z: number;
};

type EntitySpawn = {
    type: string;
    position: Position;
    nbt?: string;
};

export class Scenario {
    constructor(
        public readonly name: string = 'Scenario',
        public readonly description: string = 'No description provided yet.'
    ) {}

    public async start(server: MinecraftServer, agents: Agent[]): Promise<void> {
        const configuredSpawnPositions = this.getAgentSpawnPositions();
        const agentsToPlace = agents.filter((agent) => configuredSpawnPositions[agent.username]);

        while (agentsToPlace.some((agent) => !agent.isAlive)) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        agentsToPlace.forEach((agent) => {
            const position = configuredSpawnPositions[agent.username];
            if (!position) return;

            server.sendCommand(
                `tp ${agent.username} ${position.x} ${position.y} ${position.z}`
            );
        });

        this.getEntitySpawns().forEach(({ type, position, nbt }) => {
            server.sendCommand(
                `summon ${type} ${position.x} ${position.y} ${position.z}${nbt ? ` ${nbt}` : ''}`
            );
        });
    }

    public onAgentSpawn(_agent: Agent): void {}

    protected getAgentSpawnPositions(): Record<string, Position> {
        return {};
    }

    protected getEntitySpawns(): EntitySpawn[] {
        return [];
    }

    protected runCommandAtAgent(agent: Agent, command: string): void {
        agent.server.sendCommand(`execute at ${agent.bot.username} run ${command}`);
    }
}
