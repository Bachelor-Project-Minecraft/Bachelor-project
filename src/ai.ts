import { Ollama } from 'ollama';
import { Agent } from './agent';
import { config } from './config';
import { SkillRegistry } from './skills/skillRegistry';
import { Skill } from './types';
import { getSummarizeHistoryPrompt, getSystemPrompt, getToolRepairPrompt } from './utils/prompts';
import { GeneratedActionService } from './skills/generatedActionService';

type ChatMessage = { role: string; content: string };

type ToolCall = {
    function: {
        name: string;
        arguments: unknown;
    };
};

type ValidationResult =
    | { success: true; data: unknown }
    | { success: false; error: string };

export class AIController {
    private ollama: Ollama;
    private agent: Agent;
    private registry: SkillRegistry;
    private history: ChatMessage[] = [];
    private memory: string = ''; // Store summarized memory
    private environmentSnapshot: string = ''; // Store latest environment snapshot
    private isProcessing: boolean = false; // Prevent overlapping thoughts

    constructor(agent: Agent) {
        this.agent = agent;
        this.ollama = new Ollama({ host: config.ollama.baseUrl });
        this.registry = SkillRegistry.getInstance();
        this.registry.initializeBuiltIns(
            new GeneratedActionService(
                this.ollama,
                (definition, executeAction) => this.registry.createGeneratedSkill(definition, executeAction),
                (skill) => this.registry.registerGeneratedSkill(skill)
            )
        );

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

            console.log("Starting AI response generation...");
            const response = await this.requestChat(this.history);
            const toolCalls = (response.message.tool_calls ?? []) as ToolCall[];
            console.log("Finished AI response generation.");

            console.log("---------------------------------------------------------------")
            console.log("Response message content: " + (response.message.content || "<NO CONTENT>"));
            for (const tool of toolCalls) {
                console.log(`Tool call: ${tool.function.name} with args ${JSON.stringify(tool.function.arguments)}`);
            }
            console.log("---------------------------------------------------------------")

            if (toolCalls.length === 0) {
                console.log("The model decided on no tool calls");
                console.log("---------------------------------------------------------------")
                console.log("History:")
                console.log(this.history)
                console.log("---------------------------------------------------------------")

                this.agent.setFreeze(false);
                this.agent.server.setFreeze(false);

                return;
            }

            this.agent.setFreeze(false);
            this.agent.server.setFreeze(false);

            for (const toolCall of toolCalls) {
                const result = await this.executeToolCall(toolCall);
                if (!result) {
                    continue;
                }

                this.history.push({
                    role: 'tool',
                    content: `Me ${result}`
                });
            }
        } catch (error) {
            console.error('AI Error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    private async executeToolCall(toolCall: ToolCall): Promise<string | null> {
        const skill = this.registry.getSkill(toolCall.function.name);
        if (!skill) {
            return null;
        }

        const resolvedArgs = await this.resolveToolArguments(skill, toolCall.function.arguments);
        if (!resolvedArgs) {
            return null;
        }

        console.log(`Executing skill: ${skill.name}`);

        try {
            return await skill.execute(this.agent.bot, resolvedArgs);
        } catch (error) {
            console.error(`Skill execution failed for ${skill.name}:`, error);
            return null;
        }
    }

    private async resolveToolArguments(skill: Skill, rawArgs: unknown): Promise<unknown | null> {
        rawArgs = this.normalizeToolArguments(skill, rawArgs);
        let validation = this.validateToolArguments(skill, rawArgs);
        if (validation.success) {
            return validation.data;
        }

        for (let attempt = 1; attempt <= config.actions.generationRetries; attempt++) {
            console.warn(
                `Invalid arguments for ${skill.name} on attempt ${attempt}: ${validation.error}\n\n Raw arguments: ${this.stringifyArgs(rawArgs)}`
            );

            const repairPrompt = getToolRepairPrompt(
                skill.name,
                this.stringifyArgs(rawArgs),
                validation.error
            );

            const repairResponse = await this.requestChat([
                ...this.history,
                { role: 'user', content: repairPrompt }
            ]);

            const repairedToolCalls = (repairResponse.message.tool_calls ?? []) as ToolCall[];
            const repairedToolCall = repairedToolCalls.find(
                (candidate) => candidate.function.name === skill.name
            );

            if (!repairedToolCall) {
                rawArgs = repairResponse.message.content || rawArgs;
                validation = {
                    success: false,
                    error: `The repair response did not call ${skill.name}.`
                };
                continue;
            }

            rawArgs = this.normalizeToolArguments(skill, repairedToolCall.function.arguments);
            validation = this.validateToolArguments(skill, rawArgs);

            if (validation.success) {
                return validation.data;
            }
        }

        console.warn(`Skipping ${skill.name} after repeated invalid tool arguments.`);
        return null;
    }

    private validateToolArguments(skill: Skill, rawArgs: unknown): ValidationResult {
        const result = skill.parameters.safeParse(rawArgs);
        if (result.success) {
            return { success: true, data: result.data };
        }

        const error = result.error.issues
            .map((issue) => {
                const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
                return `${path}: ${issue.message}`;
            })
            .join(' | ');

        return {
            success: false,
            error
        };
    }

    private normalizeToolArguments(skill: Skill, rawArgs: unknown): unknown {
        if (skill.name !== 'use_action' || !rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
            return rawArgs;
        }

        const candidate = rawArgs as Record<string, unknown>;
        if (typeof candidate.args !== 'string') {
            return rawArgs;
        }

        const trimmedArgs = candidate.args.trim();
        if (!trimmedArgs.startsWith('[') && !trimmedArgs.startsWith('{')) {
            return rawArgs;
        }

        try {
            return {
                ...candidate,
                args: JSON.parse(trimmedArgs)
            };
        } catch {
            return rawArgs;
        }
    }

    private stringifyArgs(value: unknown): string {
        try {
            return JSON.stringify(value, null, 2) ?? String(value);
        } catch {
            return String(value);
        }
    }

    private async requestChat(messages: ChatMessage[]) {
        console.log("---------------------------------------------------------------")
        console.log("Available tools for this request:");
        for (const tool of this.registry.getTools()) {
            console.log(`- ${tool.function.name}: ${tool.function.description}`);
        }
        console.log("---------------------------------------------------------------")
        return this.ollama.chat({
            model: config.ollama.model,
            messages,
            tools: this.registry.getTools() as any,
            think: "medium"
        });
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
