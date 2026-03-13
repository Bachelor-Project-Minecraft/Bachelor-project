import { Bot } from "mineflayer";
import { z } from "zod";

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface Skill {
    name: string;
    description: string;
    parameters: z.ZodTypeAny;
    execute: (bot: Bot, args: any) => Promise<string>;
}
