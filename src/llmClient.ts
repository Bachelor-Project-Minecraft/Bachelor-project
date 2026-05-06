import { OpenRouter } from "@openrouter/sdk";
import { Ollama } from "ollama";
import { config } from "./config";
import { AgentLogStore } from "./evolution/agentLogStore";
import { cloneJson, parseJsonOrOriginal } from "./utils/util";
import {
    LlmCallLog,
    LlmChatRequest,
    LlmChatResponse,
    LlmGenerateRequest,
    LlmGenerateResponse,
    LlmMessage,
    LlmModelConfig,
    LlmReasoningConfig,
    LlmSystemPromptLog,
    LlmToolCall,
    ToolSchema
} from "./types";

type OllamaThink = boolean | "high" | "medium" | "low" | undefined;

export class LLMClient {
    private readonly ollama?: Ollama;
    private readonly openRouter?: OpenRouter;

    constructor(private readonly logStore?: AgentLogStore) {
        const usesOllama =
            config.llm.chat.provider === "ollama" ||
            config.llm.action.provider === "ollama" ||
            config.llm.culture.provider === "ollama" ||
            config.llm.summary.provider === "ollama";
        const usesOpenRouter =
            config.llm.chat.provider === "openrouter" ||
            config.llm.action.provider === "openrouter" ||
            config.llm.culture.provider === "openrouter" ||
            config.llm.summary.provider === "openrouter";

        if (usesOllama) {
            this.ollama = new Ollama({ host: config.llm.ollama.baseUrl });
        }

        if (usesOpenRouter) {
            this.openRouter = new OpenRouter({ apiKey: config.llm.openRouter.apiKey });
        }
    }

    public async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
        const modelConfig = this.getModelConfig(request);
        const reasoning = request.reasoning ?? modelConfig.reasoning;
        let normalizedResponse: LlmChatResponse;

        if (modelConfig.provider === "ollama") {
            if (!this.ollama) {
                throw new Error("Ollama client is not initialized for the current configuration.");
            }

            const response = await this.ollama.chat({
                model: modelConfig.model,
                messages: this.toOllamaMessages(request.messages) as any,
                tools: request.tools as any,
                format: request.jsonSchema,
                keep_alive: config.llm.ollama.keepAlive,
                think: this.toOllamaThink(reasoning)
            });

            normalizedResponse = {
                provider: modelConfig.provider,
                model: modelConfig.model,
                reasoningConfig: reasoning,
                thinking: response.message.thinking,
                content: response.message.content ?? "",
                toolCalls: this.normalizeOllamaToolCalls(response.message.tool_calls)
            };
        } else {
            this.ensureOpenRouterApiKey();

            if (!this.openRouter) {
                throw new Error("OpenRouter client is not initialized for the current configuration.");
            }

            const response = await this.openRouter.chat.send({
                chatGenerationParams: {
                    model: modelConfig.model,
                    messages: this.toOpenRouterMessages(request.messages),
                    tools: request.tools as any,
                    responseFormat: this.toOpenRouterResponseFormat(request.jsonSchema) as any,
                    reasoning: this.toOpenRouterReasoning(reasoning) as any
                }
            } as any);

            const message = response.choices[0]?.message;
            normalizedResponse = {
                provider: modelConfig.provider,
                model: modelConfig.model,
                reasoningConfig: reasoning,
                thinking: message?.reasoning ?? undefined,
                content: this.normalizeContent(message?.content),
                toolCalls: this.normalizeOpenRouterToolCalls(message?.toolCalls)
            };
        }

        this.appendLlmCall({
            kind: "chat",
            timestamp: new Date().toISOString(),
            systemPrompt: this.getSystemPromptLog(request.messages),
            request: this.toLoggedChatRequest(request),
            response: cloneJson(normalizedResponse)
        });
        return normalizedResponse;
    }

    public async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
        const modelConfig = this.getModelConfig(request);
        const reasoning = request.reasoning ?? modelConfig.reasoning;
        let normalizedResponse: LlmGenerateResponse;

        if (modelConfig.provider === "ollama") {
            if (!this.ollama) {
                throw new Error("Ollama client is not initialized for the current configuration.");
            }

            const response = await this.ollama.generate({
                model: modelConfig.model,
                prompt: request.prompt,
                format: request.jsonSchema,
                keep_alive: config.llm.ollama.keepAlive,
                think: this.toOllamaThink(reasoning)
            });

            normalizedResponse = {
                provider: modelConfig.provider,
                model: modelConfig.model,
                reasoningConfig: reasoning,
                thinking: response.thinking,
                content: response.response ?? ""
            };
        } else {
            this.ensureOpenRouterApiKey();

            if (!this.openRouter) {
                throw new Error("OpenRouter client is not initialized for the current configuration.");
            }

            const response = await this.openRouter.chat.send({
                chatGenerationParams: {
                    model: modelConfig.model,
                    messages: [{ role: "user", content: request.prompt }],
                    responseFormat: this.toOpenRouterResponseFormat(request.jsonSchema) as any,
                    reasoning: this.toOpenRouterReasoning(reasoning) as any
                }
            } as any);

            const message = response.choices[0]?.message;
            normalizedResponse = {
                provider: modelConfig.provider,
                model: modelConfig.model,
                reasoningConfig: reasoning,
                thinking: message?.reasoning ?? undefined,
                content: this.normalizeContent(message?.content)
            };
        }

        this.appendLlmCall({
            kind: "generate",
            timestamp: new Date().toISOString(),
            systemPrompt: null,
            request: cloneJson(request),
            response: cloneJson(normalizedResponse)
        });
        return normalizedResponse;
    }

    private getModelConfig(request: { useActionModel?: boolean; useCultureModel?: boolean; useSummaryModel?: boolean }): LlmModelConfig {
        if (request.useCultureModel) {
            return config.llm.culture;
        }

        if (request.useSummaryModel) {
            return config.llm.summary;
        }

        return request.useActionModel ? config.llm.action : config.llm.chat;
    }

    private ensureOpenRouterApiKey(): void {
        if (!config.llm.openRouter.apiKey.trim()) {
            throw new Error("OPENROUTER_API_KEY is required when using the OpenRouter provider.");
        }
    }

    private toOllamaMessages(messages: LlmMessage[]) {
        return messages.map((message) => ({
            role: message.role,
            content: message.content,
            thinking: message.thinking,
            tool_name: message.toolName,
            tool_calls: message.toolCalls?.map((toolCall) => ({
                function: {
                    name: toolCall.function.name,
                    arguments: this.normalizeToolArguments(toolCall.function.arguments)
                }
            }))
        }));
    }

    private toOpenRouterMessages(messages: LlmMessage[]) {
        return messages.map((message) => {
            if (message.role === "tool") {
                return {
                    role: "tool",
                    content: message.content,
                    toolCallId: message.toolCallId ?? ""
                };
            }

            if (message.role === "assistant") {
                return {
                    role: "assistant",
                    content: message.content,
                    reasoning: message.thinking,
                    toolCalls: message.toolCalls?.map((toolCall) => ({
                        id: toolCall.id,
                        type: "function",
                        function: {
                            name: toolCall.function.name,
                            arguments: JSON.stringify(this.normalizeToolArguments(toolCall.function.arguments))
                        }
                    }))
                };
            }

            return {
                role: message.role,
                content: message.content
            };
        });
    }

    private normalizeOllamaToolCalls(toolCalls?: Array<{ function: { name: string; arguments: unknown } }>): LlmToolCall[] {
        return (toolCalls ?? []).map((toolCall, index) => ({
            id: this.createToolCallId(toolCall.function.name, index),
            function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments
            }
        }));
    }

    private normalizeOpenRouterToolCalls(
        toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
    ): LlmToolCall[] {
        return (toolCalls ?? []).map((toolCall, index) => ({
            id: toolCall.id || this.createToolCallId(toolCall.function.name, index),
            function: {
                name: toolCall.function.name,
                arguments: parseJsonOrOriginal(toolCall.function.arguments)
            }
        }));
    }

    private toOpenRouterResponseFormat(jsonSchema?: ToolSchema) {
        if (!jsonSchema) {
            return undefined;
        }

        return {
            type: "json_schema",
            jsonSchema: {
                name: "structured_output",
                schema: jsonSchema,
                strict: false
            }
        };
    }

    private toOpenRouterReasoning(reasoning?: LlmReasoningConfig) {
        if (!reasoning) {
            return undefined;
        }

        return {
            enabled: reasoning.enabled,
            effort: reasoning.effort,
            summary: reasoning.summary,
            maxTokens: reasoning.maxTokens
        };
    }

    private toOllamaThink(reasoning?: LlmReasoningConfig): OllamaThink {
        if (!reasoning) {
            return undefined;
        }

        if (reasoning.enabled === false || reasoning.effort === "none") {
            return false;
        }

        if (reasoning.enabled === true && !reasoning.effort) {
            return true;
        }

        switch (reasoning.effort) {
            case "minimal":
            case "low":
                return "low";
            case "medium":
                return "medium";
            case "high":
            case "xhigh":
                return "high";
            default:
                return undefined;
        }
    }

    private normalizeContent(content: unknown): string {
        if (typeof content === "string") {
            return content;
        }

        if (Array.isArray(content)) {
            return content
                .map((item) => {
                    if (typeof item === "string") {
                        return item;
                    }

                    if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
                        return item.text;
                    }

                    return "";
                })
                .filter(Boolean)
                .join("\n");
        }

        if (content === null || content === undefined) {
            return "";
        }

        return JSON.stringify(content);
    }

    private normalizeToolArguments(value: unknown): unknown {
        if (typeof value === "string") {
            return parseJsonOrOriginal(value);
        }

        return value;
    }

    private createToolCallId(name: string, index: number): string {
        return `${name}-${Date.now()}-${index}`;
    }

    private getSystemPromptLog(messages: LlmMessage[]): LlmSystemPromptLog | null {
        const firstMessage = messages[0];
        if (firstMessage?.role !== "system") {
            return null;
        }

        const content = firstMessage.content;
        const memoryMarker = "Memory: ";
        const environmentMarker = "\n\nThe following shows your current environment.\nEnvironment Snapshot: ";
        const memoryStart = content.indexOf(memoryMarker);
        const environmentStart = content.indexOf(environmentMarker);

        const memory =
            memoryStart >= 0 && environmentStart > memoryStart
                ? content.slice(memoryStart + memoryMarker.length, environmentStart)
                : "";

        const environmentSnapshotText =
            environmentStart >= 0
                ? content.slice(environmentStart + environmentMarker.length)
                : "";

        return {
            content,
            memory,
            environmentSnapshot: parseJsonOrOriginal(environmentSnapshotText)
        };
    }

    private toLoggedChatRequest(request: LlmChatRequest): Omit<LlmChatRequest, "tools"> & { tools?: string[] } {
        return {
            ...cloneJson(request),
            tools: request.tools?.map((tool) => tool.function.name)
        };
    }

    private appendLlmCall(call: LlmCallLog): void {
        if (!this.logStore) {
            return;
        }

        try {
            this.logStore.appendLlmCall(call);
        } catch (error) {
            console.error("Failed to append LLM log:", error);
        }
    }
}
