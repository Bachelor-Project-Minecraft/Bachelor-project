import { Ollama } from 'ollama';
import { config } from './config';
import { SkillRegistry } from './skills/skillRegistry';
import { getSummarizeHistoryPrompt, getSystemPrompt } from './utils/prompts';
import { Agent } from './agent';

export class AIController {
    private ollama: Ollama;
    private agent: Agent;
    private registry: SkillRegistry;
    private history: { role: string; content: string }[] = [];
    private memory: string = ''; // Store summarized memory
    private environmentSnapshot: string = ''; // Store latest environment snapshot
    private isProcessing: boolean = false; // Prevent overlapping thoughts

    constructor(agent: Agent) {
        this.agent = agent;
        this.ollama = new Ollama({ host: config.ollama.baseUrl });
        this.registry = new SkillRegistry();

        this.history.push({
            role: 'system',
            content: getSystemPrompt(this.agent.bot.username, this.memory, this.environmentSnapshot)
        });
    }

    public async processEvent(eventRespondent: string, eventDescription: string) {
        if (this.isProcessing) return;

        console.log(`${eventRespondent} <Event>: ${eventDescription}`);
        this.history.push({
            role: 'assistant',
            content: `${eventRespondent} <Event>: ${eventDescription}`
        });

        await this.generateResponse();
    }

    public async processChat(sender: string, message: string) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const role = 'user';
        const content = `${sender} <MESSAGE>: ${message}`;
        this.history.push({ role, content });

        await this.generateResponse();
    }

    private async generateResponse() {
        this.isProcessing = true;

        this.agent.setFreeze(true);
        this.agent.server.setFreeze(true);

        try {
            this.updateSystemPromptEnvironment();

            if (this.shouldSummarizeHistory()) {
                await this.summarizeHistory();
            }

            const response = await this.ollama.chat({
                model: config.ollama.model,
                messages: this.history,
                tools: this.registry.getTools() as any
            });

            this.agent.setFreeze(false);
            this.agent.server.setFreeze(false);

            if (!response.message.tool_calls) {
                this.history.push({
                    role: 'assistant',
                    content: `Me <NO ACTION RESPONSE>: ${response.message.content || ''}`
                });
            } else {
                for (const tool of response.message.tool_calls) {
                    const skill = this.registry.getSkill(tool.function.name);
                    if (skill) {
                        console.log(`Executing skill: ${skill.name}`);
                        const result = await skill.execute(this.agent.bot, tool.function.arguments);
                        
                        this.history.push({
                            role: 'tool',
                            content: `Me ${result}`,
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

    private async summarizeHistory() {
        const summarizeChunkSize = Math.max(1, config.ai.summarizeChunkSize);

        const chunk = this.history.slice(1, 1 + summarizeChunkSize);
        if (chunk.length === 0) return;

        const toSummarize = chunk
            .map((message) => `[${message.role}] ${message.content}`)
            .join('\n');

        try {
            const summary = await this.ollama.generate({
                model: config.ollama.model,
                prompt: getSummarizeHistoryPrompt(this.agent.bot.username, this.memory, toSummarize)
            });

            const updatedMemory = summary.response.trim();
            if (updatedMemory) {
                this.memory = updatedMemory;
                this.updateSystemPromptMemory();
            }

            this.history.splice(1, chunk.length);
        } catch (error) {
            console.error('History summarization error:', error);
        }
    }

    private shouldSummarizeHistory() {
        const maxHistoryMessages = Math.max(1, config.ai.maxHistoryMessages);
        return this.history.length - 1 >= maxHistoryMessages;
    }

    private updateSystemPromptEnvironment() {
        this.environmentSnapshot = JSON.stringify(this.agent.observeEnvironment());
        this.history[0] = {
            role: 'system',
            content: getSystemPrompt(this.agent.bot.username, this.memory, this.environmentSnapshot)
        };
    }

    private updateSystemPromptMemory() {
        this.history[0] = {
            role: 'system',
            content: getSystemPrompt(this.agent.bot.username, this.memory, this.environmentSnapshot)
        };
    }
}
