import { Bot } from "mineflayer";
import { z } from "zod";

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface GeneratedSkillParameterDefinition {
    name: string;
    description: string;
}

export interface GeneratedSkillDefinition {
    name: string;
    description: string;
    parameters: GeneratedSkillParameterDefinition[];
    code: string;
}

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
    execute: (bot: Bot, args: any) => Promise<string>;
}
