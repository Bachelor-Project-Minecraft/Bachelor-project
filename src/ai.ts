import { Ollama } from 'ollama';
import { config } from './config';
import { SkillRegistry } from './skills/skillRegistry';
import { Bot } from 'mineflayer';
import { getSummarizeHistoryPrompt, getSystemPrompt } from './utils/prompts';

export class AIController {
    private ollama: Ollama;
    private bot: Bot;
    private registry: SkillRegistry;
    private history: { role: string; content: string }[] = [];
    private memory: string = ''; // Store summarized memory
    private isProcessing: boolean = false; // Prevent overlapping thoughts

    constructor(bot: Bot) {
        this.bot = bot;
        this.ollama = new Ollama({ host: config.ollama.baseUrl });
        this.registry = new SkillRegistry();
        
        this.history.push({
            role: 'system',
            content: getSystemPrompt(config.username, this.memory)
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

        try {
            console.log(this.history.length)
            if (this.shouldSummarizeHistory()) {
                await this.summarizeHistory();
                console.log(this.history)
                console.log(this.memory)
            }

            const response = await this.ollama.chat({
                model: config.ollama.model,
                messages: this.history,
                tools: this.registry.getTools() as any
            });

            this.history.push(response.message);

            if (response.message.tool_calls) {
                for (const tool of response.message.tool_calls) {
                    const skill = this.registry.getSkill(tool.function.name);
                    if (skill) {
                        console.log(`Executing skill: ${skill.name}`);
                        const result = await skill.execute(this.bot, tool.function.arguments);
                        
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
                prompt: getSummarizeHistoryPrompt(config.username, this.memory, toSummarize)
            });

            const updatedMemory = summary.response.trim();
            if (updatedMemory) {
                this.memory = updatedMemory;
                this.updateSystemPrompt();
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

    private updateSystemPrompt() {
        this.history[0] = {
            role: 'system',
            content: getSystemPrompt(config.username, this.memory)
        };
    }
}
