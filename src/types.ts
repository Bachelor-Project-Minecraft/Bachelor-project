import { Bot } from "mineflayer";
import { z } from "zod";

export interface Skill {
    name: string;
    description: string;
    parameters: z.ZodObject;
    execute: (bot: Bot, args: any) => Promise<string>;
}