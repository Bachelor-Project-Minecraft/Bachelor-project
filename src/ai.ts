import { Ollama } from 'ollama';
import { config } from './config';
import { SkillRegistry } from './skills/skillRegistry';
import { Bot } from 'mineflayer';
import { Agent } from './agent';

export class AIController {
    private ollama: Ollama;
    private agent: Agent;
    private registry: SkillRegistry;
    private history: { role: string; content: string }[] = [];
    private isProcessing: boolean = false; // Prevent overlapping thoughts

    constructor(agent: Agent) {
        this.agent = agent;
        this.ollama = new Ollama({ host: config.ollama.baseUrl });
        this.registry = new SkillRegistry();
        
        this.history.push({
            role: 'system',
            content: `You are a Minecraft Bot named ${config.username}.
                      If you are in danger, use your tools to survive.
                      If you see a player, be friendly.
                      Always execute a tool if the situation requires action.`
        });
    }

    public async processEvent(eventDescription: string) {
        if (this.isProcessing) return;
        console.log(`[Event] ${eventDescription}`);
        await this.generateResponse('system', `EVENT: ${eventDescription}`);
    }

    public async processChat(username: string, message: string) {
        if (this.isProcessing) return;
        await this.generateResponse('user', `${username}: ${message}`);
    }

    private async generateResponse(role: string, content: string) {
        this.isProcessing = true;
        this.history.push({ role, content });

        this.agent.setFreeze(true);
        this.agent.server.setFreeze(true);

        try {
            const response = await this.ollama.chat({
                model: config.ollama.model,
                messages: this.history,
                tools: this.registry.getTools() as any
            });

            this.agent.setFreeze(false);
            this.agent.server.setFreeze(false);

            this.history.push(response.message);

            if (response.message.tool_calls) {
                for (const tool of response.message.tool_calls) {
                    const skill = this.registry.getSkill(tool.function.name);
                    if (skill) {
                        console.log(`Executing skill: ${skill.name}`);
                        const result = await skill.execute(this.agent.bot, tool.function.arguments);
                        
                        this.history.push({
                            role: 'tool',
                            content: result,
                        });
                    }
                }
            }
        } catch (error) {
            console.error("AI Error:", error);
        } finally {
            this.isProcessing = false;
        }
    }
}