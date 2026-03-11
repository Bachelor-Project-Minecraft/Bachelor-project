export const SYSTEM_PROMPT = `You are a Minecraft Bot named {NAME}.
                      If you are in danger, use your tools to survive.
                      If you see a player, be friendly.
                      Always execute a tool if the situation requires action.
                      Memory: {MEMORY}

                      The following shows your current environment.
                      Environment Snapshot: {ENVIRONMENT_SNAPSHOT}`;

export const SUMMARIZE_HISTORY_PROMPT = `You are a minecraft bot named {NAME} that has been talking and playing minecraft by using commands. Update your memory by summarizing the following conversation and your old memory in your next response. Prioritize preserving important facts, things you've learned, useful tips, and long term reminders. Do Not record stats, inventory, or docs! Only save transient information from your chat history. You're limited to 500 characters, so be brief, however not so brief that you lose important information.
    Old Memory: '{OLD_MEMORY}'
    Recent conversation:
    {TO_SUMMARIZE}
    Summarize your old memory and recent conversation into a new memory, and respond only with the unwrapped memory text.
`

export const getSummarizeHistoryPrompt = (name: string, oldMemory: string, toSummarize: string) => {
    return SUMMARIZE_HISTORY_PROMPT
        .replace('{NAME}', name)
        .replace('{OLD_MEMORY}', oldMemory)
        .replace('{TO_SUMMARIZE}', toSummarize);
};

export const getSystemPrompt = (name: string, memory: string, environmentSnapshot: string) => {
    const memoryText = memory || 'No memory yet.';
    const environmentText = environmentSnapshot || 'No snapshot yet.';

    return SYSTEM_PROMPT
        .replace('{NAME}', name)
        .replace('{MEMORY}', memoryText)
        .replace('{ENVIRONMENT_SNAPSHOT}', environmentText);
};
