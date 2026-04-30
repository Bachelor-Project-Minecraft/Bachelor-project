import { Agent } from './agent';
import { config } from './config';
import { LLMClient } from './llmClient';
import { SkillRegistry } from './skills/skillRegistry';
import { LlmChatResponse, LlmMessage, LlmToolCall, LlmToolDefinition, Skill } from './types';
import { getSummarizeHistoryPrompt, getSystemPrompt, getToolRepairPrompt } from './utils/prompts';
import { GeneratedActionService } from './skills/generatedActionService';
import { z } from 'zod';
import { AgentLogStore } from './evolution/agentLogStore';
import { Evolution } from './evolution/evolution';

type ValidationResult =
    | { success: true; data: unknown }
    | { success: false; error: string };

export class AIController {
    private llm: LLMClient;
    private agent: Agent;
    private registry: SkillRegistry;
    private history: LlmMessage[] = [];
    private log: AgentLogStore;
    private readonly knowledgebase: string;
    private memory: string = ''; // Store summarized memory
    private environmentSnapshot: string = ''; // Store latest environment snapshot
    private isProcessing: boolean = false; // Prevent overlapping thoughts
    private deferredHistoryMessages: LlmMessage[] = [];

    constructor(agent: Agent, agentName: string) {
        this.agent = agent;
        this.log = new AgentLogStore(
            agentName,
            () => this.agent.isAlive,
            () => this.agent.server.timefrozen
        );
        this.llm = new LLMClient(this.log);
        this.registry = SkillRegistry.getInstance();
        this.registry.initializeBuiltIns(
            new GeneratedActionService(
                this.llm,
                (name, description, parameters, executeAction) =>
                    this.registry.createGeneratedSkill(name, description, parameters, executeAction),
                (skill) => this.registry.registerGeneratedSkill(skill),
                (work) => this.agent.server.runWhileWorldFrozen(work),
                () => JSON.stringify(this.agent.observeEnvironment())
            )
        );
        this.knowledgebase = Evolution.getKnowledgebase();

        this.history.push({
            role: 'system',
            content: getSystemPrompt(agentName, this.memory, this.environmentSnapshot, this.knowledgebase)
        });
    }

    public async processEvent(eventRespondent: string, eventDescription: string) {
        if (!this.agent.isAlive || this.agent.bot.health <= 0) return;

        const message: LlmMessage = {
            role: 'user',
            content: `${eventRespondent} <Event>: ${eventDescription}`
        };
        console.log(`${eventRespondent} <Event>: ${eventDescription}`);

        if (this.isProcessing) {
            this.deferMessageToHistory(message);
            console.log(`${eventRespondent} <Event>: deferred but not acted on because ${this.agent.bot.username} is already processing.`);
            return;
        }

        this.appendMessageToHistory(message);
        this.isProcessing = true;

        await this.generateResponse();
    }

    public async processMessage(sender: string, message: string) {
        if (!this.agent.isAlive || this.agent.bot.health <= 0) return;

        const role = 'user';
        const content = `${sender} <MESSAGE>: ${message}`;
        const historyMessage: LlmMessage = { role, content };
        console.log(content);

        if (this.isProcessing) {
            this.deferMessageToHistory(historyMessage);
            console.log(`${sender} <MESSAGE>: deferred but not acted on because ${this.agent.bot.username} is already processing.`);
            return;
        }

        this.appendMessageToHistory(historyMessage);
        this.isProcessing = true;

        const pendingEnvironmentChanges = this.agent.consumePendingEnvironmentChanges();
        if (pendingEnvironmentChanges) {
            this.appendMessageToHistory({
                role: 'user',
                content: `${this.agent.bot.username} <Event>: ${pendingEnvironmentChanges}`
            });
        }

        await this.generateResponse();
    }

    private async generateResponse() {
        try {
            this.agent.stopActivity();
            const response = await this.generateQueuedResponse();
            const toolCalls = response.toolCalls;

            this.recordAssistantResponse(response);

            if (toolCalls.length === 0) {
                return;
            }

            for (const toolCall of toolCalls) {
                if (!this.canAct()) {
                    break;
                }

                this.log.recordActionInvocation(toolCall.function.name);
                const result = await this.executeToolCall(toolCall);
                if (this.isHallucinationResult(result)) {
                    this.log.recordHallucination();
                }
                this.appendMessageToHistory({
                    role: 'tool',
                    content: `Me ${result}`,
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name
                });
            }
        } catch (error) {
            console.error('AI Error:', error);
        } finally {
            this.flushDeferredHistoryMessages();
            this.isProcessing = false;
        }
    }

    private async generateQueuedResponse(): Promise<LlmChatResponse> {
        return this.agent.server.runWhileWorldFrozen(async () => {
            this.updateSystemPromptEnvironment();

            if (this.shouldSummarizeHistory()) {
                await this.summarizeHistory();
            }

            console.log(this.agent.bot.username + " starting AI response generation...");
            const response = await this.requestChat(this.history);
            console.log("Finished AI response generation.");

            return response;
        });
    }

    private async executeToolCall(toolCall: LlmToolCall): Promise<string> {
        if (!this.canAct()) {
            return '<DEAD>: Cannot execute tool because I am no longer alive.';
        }

        const skill = this.registry.getSkill(toolCall.function.name);
        if (!skill) {
            return `<TOOL UNAVAILABLE>: Could not find tool "${toolCall.function.name}".`;
        }

        const resolvedArgs = await this.resolveToolArguments(skill, toolCall.function.arguments);
        if (!resolvedArgs) {
            return `<INVALID TOOL ARGUMENTS>: Could not resolve valid arguments for ${toolCall.function.name}.`;
        }

        console.log(`Executing skill: ${skill.name}`);

        try {
            return await skill.execute(this.agent.bot, resolvedArgs);
        } catch (error) {
            console.error(`Skill execution failed for ${skill.name}:`, error);
            return `<TOOL ERROR>: ${skill.name} failed: ${this.stringifyError(error)}.`;
        }
    }

    private canAct(): boolean {
        return this.agent.isAlive && this.agent.bot.health > 0;
    }

    private isHallucinationResult(result: string): boolean {
        const hallucinationPrefixes = new Set([
            '<TOOL UNAVAILABLE>',
            '<INVALID TOOL ARGUMENTS>',
            '<NO TARGET>',
            '<NO ITEM>',
            '<NO BREAD>',
            '<ALREADY FULL>',
            '<NOT GEAR>'
        ]);

        for (const prefix of hallucinationPrefixes) {
            if (result.startsWith(prefix)) {
                return true;
            }
        }

        return false;
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

            const repairResponse = await this.agent.server.runWhileWorldFrozen(async () =>
                this.requestChat([
                    ...this.history,
                    { role: 'user', content: repairPrompt }
                ])
            );

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

    private stringifySummaryValue(value: unknown): string {
        try {
            return JSON.stringify(value) ?? String(value);
        } catch {
            return String(value);
        }
    }

    private stringifyError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return this.stringifySummaryValue(error);
    }

    private appendMessageToHistory(message: LlmMessage): void {
        this.history.push(message);
        this.log.appendMessage(message);
    }

    private deferMessageToHistory(message: LlmMessage): void {
        this.deferredHistoryMessages.push(message);
    }

    private flushDeferredHistoryMessages(): void {
        const messages = this.deferredHistoryMessages.splice(0);
        for (const message of messages) {
            this.appendMessageToHistory(message);
        }
    }

    private recordAssistantResponse(response: LlmChatResponse) {
        if (!response.content && response.toolCalls.length === 0) {
            return;
        }

        this.appendMessageToHistory({
            role: 'assistant',
            thinking: response.thinking,
            content: response.content,
            toolCalls: response.toolCalls
        });
    }

    private async requestChat(messages: LlmMessage[]) {
        const tools = this.registry.getTools() as LlmToolDefinition[];
        //console.log("---------------------------------------------------------------")
        //console.log("Available tools for this request:");
        //for (const tool of tools) {
        //    console.log(`- ${tool.function.name}: ${tool.function.description}`);
        //}
        //console.log("---------------------------------------------------------------")

        return this.retryChatOnTimeout(() =>
            this.llm.chat({
                messages,
                tools
            })
        );
    }

    private async retryChatOnTimeout(operation: () => Promise<LlmChatResponse>): Promise<LlmChatResponse> {
        const retryCount = Math.max(0, config.ai.llmTimeoutRetries ?? 0);
        return this.retryOnTimeout(operation, retryCount, 'LLM chat request');
    }

    private async retryOnTimeout<T>(operation: () => Promise<T>, retryCount: number, label: string): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const hasRemainingRetries = attempt < retryCount;
                if (!this.isTimeoutError(error) || !hasRemainingRetries) {
                    throw error;
                }

                const currentAttempt = attempt + 1;
                const totalAttempts = retryCount + 1;
                console.warn(
                    `${label} timed out (attempt ${currentAttempt}/${totalAttempts}). Retrying same prompt...`
                );
            }
        }
    }

    private isTimeoutError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        const candidate = error as {
            code?: string;
            message?: string;
            status?: number;
            cause?: unknown;
            error?: unknown;
        };

        if (candidate.status === 408 || candidate.status === 504) {
            return true;
        }

        const code = (candidate.code ?? '').toLowerCase();
        if (code.includes('timedout') || code.includes('timeout') || code.includes('etimedout')) {
            return true;
        }

        const message = (candidate.message ?? '').toLowerCase();
        if (
            message.includes('timeout') ||
            message.includes('timed out') ||
            message.includes('deadline exceeded') ||
            message.includes('gateway timeout')
        ) {
            return true;
        }

        return this.isTimeoutError(candidate.cause) || this.isTimeoutError(candidate.error);
    }

    private async summarizeHistory() {
        const summarizeChunkSize = Math.max(1, config.ai.summarizeChunkSize);
        const chunk = this.getSummarizableHistoryChunk(summarizeChunkSize);

        if (chunk.length === 0) return;

        const toSummarize = chunk
            .map((message) => this.formatMessageForSummary(message))
            .join('\n');

        try {
            const summary = await this.retryOnTimeout(
                () => this.llm.generate({
                    prompt: getSummarizeHistoryPrompt(this.agent.bot.username, this.memory, toSummarize),
                    useSummaryModel: true
                }),
                3,
                'LLM history summarization request'
            );

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

    private getSummarizableHistoryChunk(maxMessages: number): LlmMessage[] {
        let index = 1;
        let selectedEnd = 1;

        while (index < this.history.length) {
            if (this.history[index].role !== 'user') {
                break;
            }

            while (index < this.history.length && this.history[index].role === 'user') {
                index += 1;
            }

            const assistantMessage = this.history[index];
            if (!assistantMessage || assistantMessage.role !== 'assistant') {
                break;
            }

            index += 1;

            const toolCallIds = assistantMessage.toolCalls?.map((toolCall) => toolCall.id) ?? [];
            let hasCompleteToolResults = true;
            for (const toolCallId of toolCallIds) {
                const toolMessage = this.history[index];
                if (!toolMessage || toolMessage.role !== 'tool' || toolMessage.toolCallId !== toolCallId) {
                    hasCompleteToolResults = false;
                    break;
                }

                index += 1;
            }

            if (!hasCompleteToolResults) {
                break;
            }

            selectedEnd = index;

            if (selectedEnd - 1 >= maxMessages) {
                break;
            }
        }

        return this.history.slice(1, selectedEnd);
    }

    private formatMessageForSummary(message: LlmMessage): string {
        if (message.role === 'assistant') {
            const parts: string[] = [];
            const content = message.content.trim();

            if (content) {
                parts.push(`[assistant] ${content}`);
            }

            if (message.toolCalls && message.toolCalls.length > 0) {
                const toolCalls = message.toolCalls
                    .map((toolCall) =>
                        `${toolCall.function.name}(${this.stringifySummaryValue(toolCall.function.arguments)})`
                    )
                    .join(', ');
                parts.push(`[assistant tool_calls] ${toolCalls}`);
            }

            return parts.length > 0 ? parts.join('\n') : '[assistant]';
        }

        if (message.role === 'tool') {
            const toolLabel = message.toolName ?? message.toolCallId ?? 'unknown_tool';
            return `[tool ${toolLabel}] ${message.content}`;
        }

        return `[${message.role}] ${message.content}`;
    }

    private shouldSummarizeHistory() {
        const maxHistoryMessages = Math.max(1, config.ai.maxHistoryMessages);
        return this.history.length - 1 >= maxHistoryMessages;
    }

    private updateSystemPromptEnvironment() {
        this.environmentSnapshot = JSON.stringify(this.agent.observeEnvironment());
        this.history[0] = {
            role: 'system',
            content: getSystemPrompt(this.agent.bot.username, this.memory, this.environmentSnapshot, this.knowledgebase)
        };
    }

    private updateSystemPromptMemory() {
        this.history[0] = {
            role: 'system',
            content: getSystemPrompt(this.agent.bot.username, this.memory, this.environmentSnapshot, this.knowledgebase)
        };
    }
}
