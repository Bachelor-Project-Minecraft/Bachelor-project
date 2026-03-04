import { Skill } from "../types";
import { z } from "zod";

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
        return `Sent message: "${message}"`;
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
            return "No enemies nearby to attack.";
        }

        bot.lookAt(enemy.position.offset(0, enemy.height, 0));
        bot.attack(enemy);
        return `Attacked ${enemy.name}!`;
    }
};