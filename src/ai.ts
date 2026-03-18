import { Agent } from './agent';
import { config } from './config';
import { LLMClient } from './llmClient';
import { SkillRegistry } from './skills/skillRegistry';
import { LlmChatResponse, LlmMessage, LlmToolCall, LlmToolDefinition, Skill } from './types';
import { getSummarizeHistoryPrompt, getSystemPrompt, getToolRepairPrompt } from './utils/prompts';
import { GeneratedActionService } from './skills/generatedActionService';
import { z } from 'zod';

type ValidationResult =
    | { success: true; data: unknown }
    | { success: false; error: string };

export class AIController {
    private llm: LLMClient;
    private agent: Agent;
    private registry: SkillRegistry;
    private history: LlmMessage[] = [];
    private memory: string = ''; // Store summarized memory
    private environmentSnapshot: string = ''; // Store latest environment snapshot
    private isProcessing: boolean = false; // Prevent overlapping thoughts

    constructor(agent: Agent) {
        this.agent = agent;
        this.llm = new LLMClient();
        this.registry = SkillRegistry.getInstance();
        this.registry.initializeBuiltIns(
            new GeneratedActionService(
                this.llm,
                (name, description, parameters, executeAction) =>
                    this.registry.createGeneratedSkill(name, description, parameters, executeAction),
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
            const toolCalls = response.toolCalls;
            console.log("Finished AI response generation.");

            console.log("---------------------------------------------------------------")
            console.log("Response message content: " + (response.content || "<NO CONTENT>"));
            for (const tool of toolCalls) {
                console.log(`Tool call: ${tool.function.name} with args ${JSON.stringify(tool.function.arguments)}`);
            }
            console.log("---------------------------------------------------------------")

            this.recordAssistantResponse(response);

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
                    content: `Me ${result}`,
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name
                });
            }
        } catch (error) {
            console.error('AI Error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    private async executeToolCall(toolCall: LlmToolCall): Promise<string | null> {
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

            const repairedToolCalls = repairResponse.toolCalls;
            const repairedToolCall = repairedToolCalls.find(
                (candidate) => candidate.function.name === skill.name
            );

            if (!repairedToolCall) {
                rawArgs = repairResponse.content || rawArgs;
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
        return this.normalizeValueForSchema(skill.parameters, rawArgs);
    }

    private normalizeValueForSchema(schema: z.ZodTypeAny, rawValue: unknown): unknown {
        const definition = schema.def as any;

        switch (definition?.type) {
            case 'optional':
            case 'nullable':
            case 'default':
            case 'catch':
            case 'readonly':
            case 'nonoptional':
                if (rawValue === undefined || rawValue === null) {
                    return rawValue;
                }

                return this.normalizeValueForSchema(definition.innerType as z.ZodTypeAny, rawValue);
            case 'pipe':
                return this.normalizeValueForSchema(definition.in as z.ZodTypeAny, rawValue);
            case 'object': {
                const parsedObject = this.parseStructuredJson(rawValue, 'object');
                if (!parsedObject || typeof parsedObject !== 'object' || Array.isArray(parsedObject)) {
                    return parsedObject;
                }

                const candidate = parsedObject as Record<string, unknown>;
                const normalizedEntries = Object.entries(definition.shape as Record<string, z.ZodTypeAny>)
                    .map(([key, childSchema]) => [key, this.normalizeValueForSchema(childSchema, candidate[key])]);

                return {
                    ...candidate,
                    ...Object.fromEntries(normalizedEntries)
                };
            }
            case 'array': {
                const parsedArray = this.parseStructuredJson(rawValue, 'array');
                if (!Array.isArray(parsedArray)) {
                    return parsedArray;
                }

                return parsedArray.map((item) => this.normalizeValueForSchema(definition.element as z.ZodTypeAny, item));
            }
            case 'tuple': {
                const parsedTuple = this.parseStructuredJson(rawValue, 'array');
                if (!Array.isArray(parsedTuple)) {
                    return parsedTuple;
                }

                const items = definition.items as z.ZodTypeAny[];
                return parsedTuple.map((item, index) => {
                    const itemSchema = items[index] ?? definition.rest;
                    return itemSchema ? this.normalizeValueForSchema(itemSchema as z.ZodTypeAny, item) : item;
                });
            }
            case 'record': {
                const parsedRecord = this.parseStructuredJson(rawValue, 'object');
                if (!parsedRecord || typeof parsedRecord !== 'object' || Array.isArray(parsedRecord)) {
                    return parsedRecord;
                }

                return Object.fromEntries(
                    Object.entries(parsedRecord as Record<string, unknown>)
                        .map(([key, value]) => [key, this.normalizeValueForSchema(definition.valueType as z.ZodTypeAny, value)])
                );
            }
            case 'union': {
                const parsedValue = this.parseStructuredJson(rawValue, 'any');
                const options = definition.options as z.ZodTypeAny[];

                for (const option of options) {
                    const normalizedOptionValue = this.normalizeValueForSchema(option, parsedValue);
                    if (option.safeParse(normalizedOptionValue).success) {
                        return normalizedOptionValue;
                    }
                }

                return parsedValue;
            }
            default:
                return rawValue;
        }
    }

    private parseStructuredJson(rawValue: unknown, expectedType: 'object' | 'array' | 'any'): unknown {
        if (typeof rawValue !== 'string') {
            return rawValue;
        }

        const trimmedValue = rawValue.trim();
        if (!trimmedValue) {
            return rawValue;
        }

        if (expectedType === 'object' && !trimmedValue.startsWith('{')) {
            return rawValue;
        }

        if (expectedType === 'array' && !trimmedValue.startsWith('[')) {
            return rawValue;
        }

        if (expectedType === 'any' && !trimmedValue.startsWith('{') && !trimmedValue.startsWith('[')) {
            return rawValue;
        }

        try {
            const parsedValue = JSON.parse(trimmedValue);

            if (expectedType === 'object' && (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue))) {
                return rawValue;
            }

            if (expectedType === 'array' && !Array.isArray(parsedValue)) {
                return rawValue;
            }

            return parsedValue;
        } catch {
            return rawValue;
        }
    }

    private stringifyArgs(value: unknown): string {
        try {
            return JSON.stringify(value, null, 2) ?? String(value);
        } catch {
            return String(value);
        }
    }

    private recordAssistantResponse(response: LlmChatResponse) {
        if (!response.content && response.toolCalls.length === 0) {
            return;
        }

        this.history.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls
        });
    }

    private async requestChat(messages: LlmMessage[]) {
        const tools = this.registry.getTools() as LlmToolDefinition[];
        console.log("---------------------------------------------------------------")
        console.log("Available tools for this request:");
        for (const tool of tools) {
            console.log(`- ${tool.function.name}: ${tool.function.description}`);
        }
        console.log("---------------------------------------------------------------")

        return this.llm.chat({
            messages,
            tools
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
            const summary = await this.llm.generate({
                prompt: getSummarizeHistoryPrompt(this.agent.bot.username, this.memory, toSummarize)
            });

            const updatedMemory = summary.content.trim();
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
