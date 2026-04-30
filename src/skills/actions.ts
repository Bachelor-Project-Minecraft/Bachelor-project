import { JsonValue, JsonValueSchema, Skill, ToolSchema } from "../types";
import { z } from "zod";
import { GeneratedActionService } from "./generatedActionService";
import { startBackgroundSkill } from "./backgroundSkillRunner";

import { Vec3 } from "vec3";
import { Movements, goals } from "mineflayer-pathfinder";

export const SendMessageSkill: Skill = {
    name: 'send_message',
    description: 'Group A. Send a private message to one or more players. Use this only for survival-relevant coordination.',
    parameters: z.object({
        message: z.string().describe('The message to send'),
        receivers: z.array(z.string()).min(1).describe('The exact Minecraft usernames to message (must be valid and non-empty)')
    }),
    execute: async (bot, args) => {
        const message =
            typeof args?.message === 'string' && args.message.trim()
                ? args.message
                : "No response";
        const receivers = Array.isArray(args?.receivers)
            ? args.receivers.filter((receiver: unknown): receiver is string =>
                typeof receiver === 'string' && receiver.trim().length > 0
            )
            : [];

        if (receivers.length === 0) {
            return "<NO RECEIVERS>: Could not send message because no valid receivers were provided.";
        }

        for (const receiver of receivers) {
            bot.whisper(receiver, message);
        }

        // Show the message in the Minecraft chat as well for better observability of communication inside the game.
        const recipientList = receivers.join(', ');
        bot.chat(`[whisper to ${recipientList}] ${message}`);

        return `<MESSAGE to ${receivers.join(', ')}>: "${message}"`;
    }
};

export const DoNothingSkill: Skill = {
    name: 'do_nothing',
    description: 'Group B. Take no action',
    parameters: z.object({}),
    execute: async () => {
        return "<IDLE>: Chose not to act.";
    }
};

// temp
export const MeleeAttackSkill: Skill = {
    name: 'melee_attack',
    description: 'Group B. Attack a specific hostile entity by id within range.',
    parameters: z.object({
        enemyId: z.union([
            z.number().int(),
            z.string().min(1)
        ]).describe('The target hostile entity id from the environment snapshot')
    }),
    execute: async (bot, args) => {
        const pvp = bot.pvp;
        const maxTargetDistance = 16;
        const targetEnemyId = String(args.enemyId);

        const isValidHostileTarget = (entity: typeof pvp.target | null | undefined): entity is NonNullable<typeof pvp.target> => {
            return Boolean(
                entity
                && entity.isValid
                && entity.type === 'hostile'
                && String(entity.id) === targetEnemyId
                && entity.position.distanceTo(bot.entity.position) <= maxTargetDistance
            );
        };

        const currentTarget = pvp.target;
        const enemy = isValidHostileTarget(currentTarget)
            ? currentTarget
            : bot.nearestEntity((entity) => (
                entity.type === 'hostile'
                && entity.isValid
                && String(entity.id) === targetEnemyId
                && entity.position.distanceTo(bot.entity.position) <= maxTargetDistance
            ));

        if (!enemy) {
            console.log("agent hallucinated and tried to attack enemy that didn't exist");
            return `<NO TARGET>: Could not find hostile entity with id ${targetEnemyId} in range.`;
        }

        if (currentTarget && currentTarget.id !== enemy.id) {
            pvp.stop();
        }

        pvp.attack(enemy);
        return `<ATTACKING>: Engaging ${enemy.name ?? 'hostile mob'} until it is no longer a threat.`;
    }
};

export const BowAttackSkill: Skill = {
    name: 'bow_attack',
    description: 'Group B. Attack a specific hostile entity by id using a bow until it is dead or arrows run out.',
    parameters: z.object({
        enemyId: z.union([
            z.number().int(),
            z.string().min(1)
        ]).describe('The target hostile entity id from the environment snapshot')
    }),
    execute: async (bot, args) => {
        const targetEnemyId = String(args.enemyId);
        const maxEngagementMs = 45000;
        const holdDrawMs = 900;
        const cooldownMs = 350;
        const freezePollMs = 50;
        const arrowNames = new Set(['arrow', 'spectral_arrow', 'tipped_arrow']);
        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        const getArrowCount = () => bot.inventory
            .items()
            .filter((item) => arrowNames.has(item.name))
            .reduce((count, item) => count + item.count, 0);

        const findTarget = () => Object
            .values(bot.entities)
            .find((entity) => (
                entity.type === 'hostile'
                && entity.isValid
                && String(entity.id) === targetEnemyId
            ));

        const bow = bot.inventory.items().find((item) => item.name === 'bow');
        if (!bow) {
            console.log(`Could not start bow attack against ${targetEnemyId}: no bow in inventory.`);
            return `<BOW ATTACK FAILED>: Could not start bow attack against ${targetEnemyId}.`;
        }

        const initialArrows = getArrowCount();
        if (initialArrows <= 0) {
            console.log(`Could not start bow attack against ${targetEnemyId}: no arrows available.`);
            return `<BOW ATTACK FAILED>: Could not start bow attack against ${targetEnemyId}.`;
        }

        let target = findTarget();
        if (!target) {
            console.log(`Could not start bow attack against ${targetEnemyId}: target was not found.`);
            return `<BOW ATTACK FAILED>: Could not start bow attack against ${targetEnemyId}.`;
        }

        bot.pvp.stop();

        startBackgroundSkill(bot, 'bow_attack', async (token) => {
            const isBotAlive = () => bot.health > 0 && Boolean(bot.entity);
            const canContinue = () => !token.cancelled && isBotAlive();

            const waitUntilWorldActive = async () => {
                while (!bot.physicsEnabled) {
                    if (!canContinue()) {
                        return false;
                    }

                    await sleep(freezePollMs);
                }

                return canContinue();
            };

            const waitForActiveMs = async (activeMs: number) => {
                let remaining = activeMs;

                while (remaining > 0) {
                    if (!await waitUntilWorldActive()) {
                        return false;
                    }

                    const chunk = Math.min(remaining, freezePollMs);
                    const chunkStart = Date.now();
                    await sleep(chunk);

                    if (!canContinue()) {
                        return false;
                    }

                    if (!bot.physicsEnabled) {
                        continue;
                    }

                    const chunkElapsed = Math.max(0, Date.now() - chunkStart);
                    remaining -= Math.min(chunkElapsed, chunk);
                }

                return true;
            };

            const stopUsingBow = async () => {
                if (token.cancelled) {
                    bot.deactivateItem();
                    return;
                }

                if (await waitUntilWorldActive()) {
                    bot.deactivateItem();
                }
            };

            try {
                await bot.equip(bow, 'hand');
            } catch (error) {
                console.error(`Bow attack against ${targetEnemyId} failed while equipping bow:`, error);
                return;
            }

            let engagementElapsedMs = 0;
            let shotsFired = 0;

            while (engagementElapsedMs < maxEngagementMs) {
                if (!canContinue()) {
                    console.log(`Stopped bow attack against ${targetEnemyId} because it was cancelled or the bot is no longer alive.`);
                    return;
                }

                const arrowsLeft = getArrowCount();
                if (arrowsLeft <= 0) {
                    await stopUsingBow();
                    console.log(`Stopped bow attack against ${targetEnemyId}: fired ${shotsFired} shot(s) and ran out of arrows.`);
                    return;
                }

                target = findTarget();
                if (!target) {
                    await stopUsingBow();
                    console.log(`Stopped bow attack against ${targetEnemyId}: target is no longer alive or visible.`);
                    return;
                }

                const aimPosition = target.position.offset(0, Math.max(0.6, (target.height ?? 1.8) * 0.75), 0);
                if (!await waitUntilWorldActive()) {
                    console.log(`Stopped bow attack against ${targetEnemyId} before aiming.`);
                    return;
                }

                await bot.lookAt(aimPosition, true);

                if (!await waitUntilWorldActive()) {
                    console.log(`Stopped bow attack against ${targetEnemyId} before drawing.`);
                    return;
                }

                bot.activateItem();
                if (!await waitForActiveMs(holdDrawMs)) {
                    await stopUsingBow();
                    console.log(`Stopped bow attack against ${targetEnemyId} while drawing.`);
                    return;
                }

                await stopUsingBow();
                shotsFired += 1;

                if (!await waitForActiveMs(cooldownMs)) {
                    console.log(`Stopped bow attack against ${targetEnemyId} during cooldown.`);
                    return;
                }

                engagementElapsedMs += holdDrawMs + cooldownMs;
            }

            await stopUsingBow();
            console.log(`Stopped bow attack against ${targetEnemyId}: fired ${shotsFired} shot(s) and timed out.`);
        });

        return `<BOW ATTACK>: Attacking ${targetEnemyId} with a bow.`;
    }
};

export const MoveToCoordinateSkill: Skill = {
    name: 'move_to_coordinate',
    description: 'Group B. Move to a specific world coordinate using pathfinder.',
    parameters: z.object({
        position: z.object({
            x: z.number().describe('Target x coordinate'),
            z: z.number().describe('Target z coordinate')
        }).describe('The destination coordinates to move to'),
        radius: z.number().min(0).max(4).optional().describe('How close is close enough to the destination (default: 1)')
    }),
    execute: async (bot, args) => {
        const targetPosition = new Vec3(
            Math.floor(args.position.x),
            0,
            Math.floor(args.position.z)
        );
        const radius = typeof args.radius === 'number' ? Math.max(0, Math.min(4, args.radius)) : 1;

        startBackgroundSkill(bot, 'move_to_coordinate', async (token) => {
            const movements = new Movements(bot);
            bot.pathfinder.setMovements(movements);

            try {
                await bot.pathfinder.goto(new goals.GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, radius));
                if (!token.cancelled) {
                    console.log(`Finished moving toward (${targetPosition.x}, ${targetPosition.y}, ${targetPosition.z}) with radius ${radius}.`);
                }
            } catch (error) {
                if (!token.cancelled) {
                    console.error(`Failed moving toward (${targetPosition.x}, ${targetPosition.y}, ${targetPosition.z}):`, error);
                }
            }
        });

        return `<MOVING>: Moving toward (${targetPosition.x}, ${targetPosition.y}, ${targetPosition.z}) with radius ${radius}.`;
    }
};

export const EquipItemInHandSkill: Skill = {
    name: 'equip_item_in_hand',
    description: 'Group A. Equip an inventory item in the hand by item name. This is executed instantaneous, and should be paired with other skills.',
    parameters: z.object({
        itemName: z.string().min(1).describe('The inventory item to hold, for example iron_sword or st')
    }),
    execute: async (bot, args) => {
        const normalizeItemName = (value: string) => value
            .trim()
            .toLowerCase()
            .replace(/^minecraft:/, '')
            .replace(/\s+/g, '_');

        const requestedName = normalizeItemName(args.itemName);
        const inventoryItems = bot.inventory.items();

        const selectedItem = inventoryItems.find((item) => {
            const byName = normalizeItemName(item.name) === requestedName;
            const byDisplayName = typeof item.displayName === 'string'
                && normalizeItemName(item.displayName) === requestedName;
            return byName || byDisplayName;
        });

        if (!selectedItem) {
            return `<NO ITEM>: Could not find ${args.itemName} in inventory.`;
        }

        await bot.equip(selectedItem, 'hand');
        return `<EQUIPPED>: Now holding ${selectedItem.displayName ?? selectedItem.name}.`;
    }
};

export const EquipGearSkill: Skill = {
    name: 'equip_gear',
    description: 'Group A. Equip wearable gear (helmet, chestplate, leggings, boots) from inventory. This is executed instantaneous, and should be paired with other skills.',
    parameters: z.object({
        itemName: z.string().min(1).describe('The gear item to wear, for example leather_chestplate')
    }),
    execute: async (bot, args) => {
        const normalizeItemName = (value: string) => value
            .trim()
            .toLowerCase()
            .replace(/^minecraft:/, '')
            .replace(/\s+/g, '_');

        const requestedName = normalizeItemName(args.itemName);
        const inventoryItems = bot.inventory.items();

        const selectedItem = inventoryItems.find((item) => {
            const byName = normalizeItemName(item.name) === requestedName;
            const byDisplayName = typeof item.displayName === 'string'
                && normalizeItemName(item.displayName) === requestedName;
            return byName || byDisplayName;
        });

        if (!selectedItem) {
            console.log("agent hallucinated and tried to equip item that didn't exist");
            return `<NO ITEM>: Could not find ${args.itemName} in inventory.`;
        }

        const normalizedSelectedName = normalizeItemName(selectedItem.name);
        let destination: 'head' | 'torso' | 'legs' | 'feet' | null = null;

        if (normalizedSelectedName.includes('helmet')) {
            destination = 'head';
        } else if (normalizedSelectedName.includes('chestplate')) {
            destination = 'torso';
        } else if (normalizedSelectedName.includes('leggings')) {
            destination = 'legs';
        } else if (normalizedSelectedName.includes('boots')) {
            destination = 'feet';
        }

        if (!destination) {
            return `<NOT GEAR>: ${selectedItem.displayName ?? selectedItem.name} is not recognized as wearable gear.`;
        }

        await bot.equip(selectedItem, destination);
        return `<EQUIPPED GEAR>: Equipped ${selectedItem.displayName ?? selectedItem.name} to ${destination}.`;
    }
};

export const EatBreadUntilFullSkill: Skill = {
    name: 'eat_bread_until_full',
    description: 'Group B. Eat bread from inventory until hunger is full or bread runs out.',
    parameters: z.object({}),
    execute: async (bot) => {
        const maxFood = 20;
        const consumeMs = 1700;
        const settleMs = 120;
        const freezePollMs = 50;
        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        const findBread = () => bot.inventory.items().find((item) => item.name === 'bread');

        if ((bot.food ?? 0) >= maxFood) {
            console.log("agent hallucinated and tried to eat while at full hunger");
            return `<ALREADY FULL>: Hunger is already full (${bot.food ?? 0}/${maxFood}).`;
        }

        if (!findBread()) {
            console.log("agent hallucinated and tried to eat bread that didn't exist");
            return '<NO BREAD>: Cannot eat because no bread is in inventory.';
        }

        startBackgroundSkill(bot, 'eat_bread_until_full', async (token) => {
            const isBotAlive = () => bot.health > 0 && Boolean(bot.entity);
            const canContinue = () => !token.cancelled && isBotAlive();

            const waitUntilWorldActive = async () => {
                while (!bot.physicsEnabled) {
                    if (!canContinue()) {
                        return false;
                    }

                    await sleep(freezePollMs);
                }

                return canContinue();
            };

            const waitForActiveMs = async (activeMs: number) => {
                let remaining = activeMs;

                while (remaining > 0) {
                    if (!await waitUntilWorldActive()) {
                        return false;
                    }

                    const chunk = Math.min(remaining, freezePollMs);
                    const chunkStart = Date.now();
                    await sleep(chunk);

                    if (!canContinue()) {
                        return false;
                    }

                    if (!bot.physicsEnabled) {
                        continue;
                    }

                    const chunkElapsed = Math.max(0, Date.now() - chunkStart);
                    remaining -= Math.min(chunkElapsed, chunk);
                }

                return true;
            };

            let breadEaten = 0;

            while ((bot.food ?? 0) < maxFood) {
                if (!canContinue()) {
                    bot.deactivateItem();
                    console.log(`Stopped eating bread because it was cancelled or the bot is no longer alive.`);
                    return;
                }

                const bread = findBread();
                if (!bread) {
                    bot.deactivateItem();
                    console.log(`Stopped eating bread: ate ${breadEaten} bread and ran out. Hunger is ${bot.food ?? 0}/${maxFood}.`);
                    return;
                }

                await bot.equip(bread, 'hand');
                if (!await waitUntilWorldActive()) {
                    bot.deactivateItem();
                    console.log(`Stopped eating bread before consuming.`);
                    return;
                }

                bot.activateItem();
                if (!await waitForActiveMs(consumeMs)) {
                    bot.deactivateItem();
                    console.log(`Stopped eating bread while consuming.`);
                    return;
                }

                if (!await waitUntilWorldActive()) {
                    bot.deactivateItem();
                    console.log(`Stopped eating bread before settling.`);
                    return;
                }

                bot.deactivateItem();
                if (!await waitForActiveMs(settleMs)) {
                    console.log(`Stopped eating bread while settling.`);
                    return;
                }

                breadEaten += 1;
            }

            console.log(`Finished eating bread: ate ${breadEaten} bread and restored hunger to ${bot.food ?? 0}/${maxFood}.`);
        });

        return `<EATING>: Eating bread until hunger is full.`;
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

export const createNewActionSkill = (actionService: GeneratedActionService): Skill => ({
    name: 'new_action',
    description: 'Group B. Create and execute a new Minecraft action that does not yet exist',
    parameters: UseActionParameters,
    toolParameters: UseActionToolParameters,
    execute: async (bot, args) => {
        const parsedArgs = UseActionParameters.safeParse(args);
        if (!parsedArgs.success) {
            return '<NO ACTION>: Invalid new_action arguments.';
        }

        return actionService.useAction(bot, parsedArgs.data);
    }
});
