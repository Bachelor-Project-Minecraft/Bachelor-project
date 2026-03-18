import { OpenRouter } from "@openrouter/sdk";
import { Ollama } from "ollama";
import { config } from "./config";
import {
    LlmChatRequest,
    LlmChatResponse,
    LlmGenerateRequest,
    LlmGenerateResponse,
    LlmMessage,
    LlmModelConfig,
    LlmReasoningConfig,
    LlmToolCall,
    ToolSchema
} from "./types";

type OllamaThink = boolean | "high" | "medium" | "low" | undefined;

export class LLMClient {
    private readonly ollama?: Ollama;
    private readonly openRouter?: OpenRouter;

    constructor() {
        const usesOllama =
            config.llm.chat.provider === "ollama" ||
            config.llm.action.provider === "ollama";
        const usesOpenRouter =
            config.llm.chat.provider === "openrouter" ||
            config.llm.action.provider === "openrouter";

        if (usesOllama) {
            this.ollama = new Ollama({ host: config.llm.ollama.baseUrl });
        }

        if (usesOpenRouter) {
            this.openRouter = new OpenRouter({ apiKey: config.llm.openRouter.apiKey });
        }
    }

    public async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
        const modelConfig = this.getModelConfig(request.useActionModel);
        const reasoning = request.reasoning ?? modelConfig.reasoning;

        if (modelConfig.provider === "ollama") {
            if (!this.ollama) {
                throw new Error("Ollama client is not initialized for the current configuration.");
            }

            const response = await this.ollama.chat({
                model: modelConfig.model,
                messages: this.toOllamaMessages(request.messages) as any,
                tools: request.tools as any,
                format: request.jsonSchema,
                think: this.toOllamaThink(reasoning)
            });

            return {
                content: response.message.content ?? "",
                toolCalls: this.normalizeOllamaToolCalls(response.message.tool_calls)
            };
        }

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

        return {
            content: this.normalizeContent(message?.content),
            toolCalls: this.normalizeOpenRouterToolCalls(message?.toolCalls)
        };
    }

    public async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
        const modelConfig = this.getModelConfig(request.useActionModel);
        const reasoning = request.reasoning ?? modelConfig.reasoning;

        if (modelConfig.provider === "ollama") {
            if (!this.ollama) {
                throw new Error("Ollama client is not initialized for the current configuration.");
            }

            const response = await this.ollama.generate({
                model: modelConfig.model,
                prompt: request.prompt,
                format: request.jsonSchema,
                think: this.toOllamaThink(reasoning)
            });

            return {
                content: response.response ?? ""
            };
        }

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

        return {
            content: this.normalizeContent(response.choices[0]?.message?.content)
        };
    }

    private getModelConfig(useActionModel?: boolean): LlmModelConfig {
        return useActionModel ? config.llm.action : config.llm.chat;
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
                arguments: this.parseJson(toolCall.function.arguments)
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
                strict: true
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
            return this.parseJson(value);
        }

        return value;
    }

    private parseJson(value: string): unknown {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    private createToolCallId(name: string, index: number): string {
        return `${name}-${Date.now()}-${index}`;
    }
}
