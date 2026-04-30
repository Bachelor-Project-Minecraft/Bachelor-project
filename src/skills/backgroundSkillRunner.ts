import type { Bot } from "mineflayer";

export interface BackgroundSkillToken {
    cancelled: boolean;
    name: string;
}

const activeBackgroundSkills = new WeakMap<Bot, BackgroundSkillToken>();

const stopBotActivity = (bot: Bot): void => {
    bot.pvp?.stop();
    bot.pathfinder?.stop();
    bot.clearControlStates();
    bot.deactivateItem();
};

export const stopActiveBackgroundSkill = (bot: Bot): void => {
    const activeSkill = activeBackgroundSkills.get(bot);
    if (!activeSkill) {
        return;
    }

    activeSkill.cancelled = true;
    activeBackgroundSkills.delete(bot);
    stopBotActivity(bot);
};

export const startBackgroundSkill = (
    bot: Bot,
    name: string,
    work: (token: BackgroundSkillToken) => Promise<void>
): void => {
    stopActiveBackgroundSkill(bot);

    const token: BackgroundSkillToken = { cancelled: false, name };
    activeBackgroundSkills.set(bot, token);

    void work(token)
        .catch((error) => {
            if (!token.cancelled) {
                console.error(`Background skill ${name} failed:`, error);
            }
        })
        .finally(() => {
            if (activeBackgroundSkills.get(bot) === token) {
                activeBackgroundSkills.delete(bot);
            }
        });
};
