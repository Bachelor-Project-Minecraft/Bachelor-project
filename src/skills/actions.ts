import { JsonValue, JsonValueSchema, Skill, ToolSchema } from "../types";
import { z } from "zod";
import { GeneratedActionService } from "./generatedActionService";

import { Vec3 } from "vec3";
import { Movements, goals } from "mineflayer-pathfinder";

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

export const MineBlockSkill: Skill = {
    name: 'mine_block_at',
    description: 'Move to a block and dig it.',
    parameters: z.object({ 
        position: z.object({ 
            x: z.number().describe('The x coordinate of the target block'), 
            y: z.number().describe('The y coordinate of the target block'), 
            z: z.number().describe('The z coordinate of the target block') 
        }).describe('The x, y and z coordinates for the block to dig') 
    }),
    execute: async (bot, args) => {
        const blockPosition = new Vec3(Math.floor(args.position.x), Math.floor(args.position.y), Math.floor(args.position.z));
        const block = bot.blockAt(blockPosition);
        
        if (!block) {
            return "<NO BLOCK>: Could not find the target block.";
        }
        
        const movements = new Movements(bot);
        bot.pathfinder.setMovements(movements);
        await bot.pathfinder.goto(new goals.GoalNear(blockPosition.x, blockPosition.y, blockPosition.z, 1));
        const bestTool = bot.pathfinder.bestHarvestTool(block);
        
        if (bestTool) {
            await bot.equip(bestTool, 'hand');
        }
        
        await bot.dig(block);
        
        return "<MINED>: Broke the target block.";
    }
};

export const UseActionParameters = z.object({
    name: z.string().describe('The reusable action name'),
    description: z.string().describe('What the action should do'),
    args: z.array(JsonValueSchema).describe('Ordered JSON arguments for the action')
});

const UseActionToolParameters: ToolSchema = {
    type: 'object',
    properties: {
        name: {
            type: 'string',
            description: 'The reusable action name'
        },
        description: {
            type: 'string',
            description: 'What the action should do'
        },
        args: {
            type: 'array',
            description: 'Ordered JSON arguments for the action. Use simple JSON values like strings, numbers, booleans, arrays, or objects.'
        }
    },
    required: ['name', 'description', 'args']
};

export const createUseActionSkill = (actionService: GeneratedActionService): Skill => ({
    name: 'use_action',
    description: 'Execute a reusable Minecraft action by name, generating and saving it if needed.',
    parameters: UseActionParameters,
    toolParameters: UseActionToolParameters,
    execute: async (bot, args) => {
        const parsedArgs = UseActionParameters.safeParse(args);
        if (!parsedArgs.success) {
            return '<NO ACTION>: Invalid use_action arguments.';
        }

        return actionService.useAction(bot, parsedArgs.data);
    }
});
