import { JsonValue, Skill } from "../types";
import { z } from "zod";
import { GeneratedActionService } from "./generatedActionService";

export const ChatSkill: Skill = {
    name: 'send_chat',
    description: 'Send a message to the public Minecraft chat. Use this to speak to players.',
    parameters: z.object({
        message: z.string().describe('The message to send')
    }),
    execute: async (bot, args) => {
        const message =
            typeof args?.message === 'string' && args.message.trim()
                ? args.message
                : "No response";

        bot.chat(message);
        return `<MESSAGE>: "${message}"`;
    }
};

// temp
export const AttackSkill: Skill = {
    name: 'attack_nearest',
    description: 'Attack the nearest hostile entity within range.',
    parameters: z.object({}),
    execute: async (bot) => {
        const enemy = bot.nearestEntity(e => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) < 5);

        if (!enemy) {
            return "<NO ENEMIES>: No enemies nearby to attack.";
        }

        bot.lookAt(enemy.position.offset(0, enemy.height, 0));
        bot.attack(enemy);
        return `<ATTACKED>: ${enemy.name}!`;
    }
};

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(JsonValueSchema),
        z.record(z.string(), JsonValueSchema)
    ])
);

export const UseActionParameters = z.object({
    name: z.string().describe('The reusable action name'),
    description: z.string().describe('What the action should do'),
    args: z.array(JsonValueSchema).describe('Ordered JSON arguments for the action')
});

export const createUseActionSkill = (actionService: GeneratedActionService): Skill => ({
    name: 'use_action',
    description: 'Execute a reusable Minecraft action by name, generating and saving it if needed.',
    parameters: UseActionParameters,
    execute: async (bot, args) => {
        const parsedArgs = UseActionParameters.safeParse(args);
        if (!parsedArgs.success) {
            return '<NO ACTION>: Invalid use_action arguments.';
        }

        return actionService.useAction(bot, parsedArgs.data);
    }
});
