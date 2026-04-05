import { Bot } from "mineflayer";
import { z } from "zod";

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface GeneratedSkillDefinition {
    parameters: string;
    code: string;
}

export type ToolSchema = Record<string, unknown>;

export type LlmProvider = "ollama" | "openrouter";

export type LlmReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type LlmReasoningSummary = "auto" | "concise" | "detailed";

export interface LlmReasoningConfig {
    effort?: LlmReasoningEffort;
    enabled?: boolean;
    summary?: LlmReasoningSummary;
    maxTokens?: number;
}

export interface LlmModelConfig {
    provider: LlmProvider;
    model: string;
    reasoning?: LlmReasoningConfig;
}

export interface LlmToolDefinition {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: ToolSchema;
    };
}

export interface LlmToolCall {
    id: string;
    function: {
        name: string;
        arguments: unknown;
    };
}

export interface LlmMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    thinking?: string;
    toolCallId?: string;
    toolName?: string;
    toolCalls?: LlmToolCall[];
}

export interface LlmChatRequest {
    messages: LlmMessage[];
    tools?: LlmToolDefinition[];
    jsonSchema?: ToolSchema;
    reasoning?: LlmReasoningConfig;
    useActionModel?: boolean;
}

export interface LlmGenerateRequest {
    prompt: string;
    jsonSchema?: ToolSchema;
    reasoning?: LlmReasoningConfig;
    useActionModel?: boolean;
}

export interface LlmChatResponse {
    provider?: LlmProvider;
    model?: string;
    reasoningConfig?: LlmReasoningConfig;
    thinking?: string;
    content: string;
    toolCalls: LlmToolCall[];
}

export interface LlmGenerateResponse {
    provider?: LlmProvider;
    model?: string;
    reasoningConfig?: LlmReasoningConfig;
    thinking?: string;
    content: string;
}

export interface LlmSystemPromptLog {
    content: string;
    memory: string;
    environmentSnapshot: unknown;
}

export interface LlmCallLogBase {
    timestamp: string;
    systemPrompt: LlmSystemPromptLog | null;
}

export interface LlmChatCallLog extends LlmCallLogBase {
    kind: "chat";
    request: Omit<LlmChatRequest, "tools"> & { tools?: string[] };
    response: LlmChatResponse;
}

export interface LlmGenerateCallLog extends LlmCallLogBase {
    kind: "generate";
    request: LlmGenerateRequest;
    response: LlmGenerateResponse;
}

export type LlmCallLog = LlmChatCallLog | LlmGenerateCallLog;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(JsonValueSchema),
        z.record(z.string(), JsonValueSchema)
    ])
);

export interface Skill {
    name: string;
    description: string;
    parameters: z.ZodTypeAny;
    toolParameters?: ToolSchema;
    execute: (bot: Bot, args: any) => Promise<string>;
}
