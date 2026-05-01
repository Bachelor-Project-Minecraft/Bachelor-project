import { JsonValue } from "../types";

const USE_ACTION_EXAMPLES = `Examples of valid new_action calls:
1. Follow a player for a while:
new_action({
  "name": "follow_player",
  "description": "Follow a named player with pathfinder",
  "args": ["MarcusVange", { "distance": 2, "maxTicks": 120 }]
})
From now on this action can be called directly like this:
follow_player({
  "playerName": "MarcusVange",
  "options": { "distance": 2, "maxTicks": 120 }
})

2. Pick up a dropped item:
new_action({
  "name": "pick_up_item",
  "description": "Move to a dropped item and collect it",
  "args": ["diamond", { "maxDistance": 24 }]
})
From now on this action can be called directly like this:
pick_up_item({
  "itemName": "diamond",
  "options": { "maxDistance": 24 }
})`;

export const SYSTEM_PROMPT = `You are a Minecraft Bot named {NAME}.
You are placed inside of an environment with increasingly hostile entities approaching on a timer (you don't know the exact timing), so always expect new hostiles coming.
You can use tools to interact with the world and with other players.
Only respond when doing so is beneficial for survival, safety, or useful coordination for yourself or others. Never do long conversations, so avoid using the send_message tool excessively.
Make use of other players for collaboration and assistance when needed, but avoid neverending conversations.
If a message is just empty talk or responding would not help survival, use do_nothing or another tool/tools that fit the situation.
Always execute a tool if the situation requires action.
You can use multiple tools in a single response, but follow these rules:
- Group A (instantaneous actions): send_message, equip_item_in_hand, equip_gear. You can use ANY number of Group A actions in a single response.
- Group B (time-consuming actions): do_nothing, melee_attack, bow_attack, move_to_coordinate, eat_bread_until_full, new_action. You can only trigger ONE Group B action per response.
- You can freely combine Group A and Group B actions in the same response (e.g., equip gear, equip item in hand, then execute melee_attack).
Collaboration is important for survival, so communicate with other players using send_message when it is helpful to coordinate or ask for help.
Prefer to use existing tools to accomplish tasks, but if there is not an existing tool that matches the situation, use the new_action tool to create a new action for that situation.
Use the new_action tool to create a new action. Use this when the other tool calls do not match the situation, so it is important that you check whether any other tool is relevant before using new_action. The new_action tool is solely for new actions and not for doing something that we can already do with another tools
For new_action, always include JSON fields named "name", "description", and "args".
Action names must use lowercase snake_case with underscores only.
The args array can contain strings, numbers, booleans, null, arrays, and objects.
Do not wrap arrays or objects inside quoted JSON strings. Pass them as raw JSON values.

${USE_ACTION_EXAMPLES}

You can call multiple tools, but you can only do 1 send_message tool call per response.
Use send_message to communicate with other players and always include both the message and the intended receivers.

Use nearby.world.surroundingBlocks to see every non-air block in the immediate 1-block surrounding volume around you plus the supporting block directly below.
Each surroundingBlocks entry only contains the block name and world position.

Goal: Your main goal is to survive and thrive in the Minecraft world.

{KNOWLEDGEBASE_SECTION}

Memory: {MEMORY}

The following shows your current environment.
Environment Snapshot: {ENVIRONMENT_SNAPSHOT}`;

export const KNOWLEDGEBASE_UPDATE_PROMPT = `You are updating a short inherited knowledgebase for a new generation of Minecraft survival agents.
Your goal is to pass on only the most important lessons that could help the next generation survive longer.
Keep the knowledgebase short, concrete, and actionable.
Prefer survival advice, coordination advice, and things to avoid.
If there is already a knowledgebase, improve it instead of replacing good advice for no reason.
Do not mention generations, averages, or comparisons in the final knowledgebase.
Return only the final knowledgebase text with no introduction or markdown fences.

Current knowledgebase:
{CURRENT_KNOWLEDGEBASE}

Generation comparison:
{GENERATION_COMPARISON}

Longest-surviving agent ({LONGEST_SURVIVAL_MS} ms) log:
{LONGEST_LOG}

Shortest-surviving agent ({SHORTEST_SURVIVAL_MS} ms) log:
{SHORTEST_LOG}`;

export const SUMMARIZE_HISTORY_PROMPT = `You are a minecraft bot named {NAME} that has been talking and playing minecraft by using commands. Update your memory by summarizing the following conversation and your old memory in your next response. Prioritize preserving important facts, things you've learned, useful tips, and long term reminders. Do Not record stats, inventory, or docs! Only save transient information from your chat history. You're limited to 500 characters, so be brief, however not so brief that you lose important information.
Old Memory: '{OLD_MEMORY}'
Recent conversation:
{TO_SUMMARIZE}
Summarize your old memory and recent conversation into a new memory, and respond only with the unwrapped memory text.
`;

const ACTION_GENERATION_EXAMPLES = `Use these examples as patterns when they match the task.

Example 1
Input args:
0: { "x": 10, "y": 63, "z": 4 }
Output:
{
  "parameters": "z.object({ position: z.object({ x: z.number().describe('The x coordinate of the target block'), y: z.number().describe('The y coordinate of the target block'), z: z.number().describe('The z coordinate of the target block') }).describe('The x, y and z coordinates for the block to dig') })",
  "executionArgs": { "position": { "x": 10, "y": 63, "z": 4 } },
  "code": "const blockPosition = new Vec3(Math.floor(args.position.x), Math.floor(args.position.y), Math.floor(args.position.z));\\nconst block = bot.blockAt(blockPosition);\\nif (!block) {\\n  return \\"<NO BLOCK>: Could not find the target block.\\";\\n}\\nconst movements = new Movements(bot);\\nbot.pathfinder.setMovements(movements);\\nawait bot.pathfinder.goto(new goals.GoalNear(blockPosition.x, blockPosition.y, blockPosition.z, 1));\\nconst bestTool = bot.pathfinder.bestHarvestTool(block);\\nif (bestTool) {\\n  await bot.equip(bestTool, 'hand');\\n}\\nawait bot.dig(block);\\nreturn \\"<MINED>: Broke the target block.\\";"
}

Example 2
Input args:
0: "MarcusVange"
1: { "distance": 2, "maxTicks": 120 }
Output:
{
  "parameters": "z.object({ playerName: z.string().describe('The exact Minecraft player name to follow'), options: z.object({ distance: z.number().describe('How close the bot should stay to the player'), maxTicks: z.number().describe('How long to follow before stopping') }).describe('Follow behavior options') })",
  "executionArgs": { "playerName": "MarcusVange", "options": { "distance": 2, "maxTicks": 120 } },
  "code": "const target = bot.players[args.playerName]?.entity;\\nif (!target) {\\n  return \\"<NO PLAYER>: Could not find that player.\\";\\n}\\nconst movements = new Movements(bot);\\nbot.pathfinder.setMovements(movements);\\nbot.pathfinder.setGoal(new goals.GoalFollow(target, args.options.distance), true);\\nawait new Promise((resolve) => setTimeout(resolve, args.options.maxTicks * 50));\\nbot.pathfinder.setGoal(null);\\nreturn \\"<FOLLOWED>: Followed the player.\\";"
}

Example 3
Input args:
0: 6
1: 3
Output:
{
  "parameters": "z.object({ radius: z.number().describe('How far from the bot to search'), maxTargets: z.number().describe('The maximum number of matches to consider') })",
  "executionArgs": { "radius": 6, "maxTargets": 3 },
  "code": "const nearbyEntities = Object.values(bot.entities).filter((entity) => entity.position.distanceTo(bot.entity.position) <= args.radius);\\nreturn \\"<FOUND>: Considered \\" + Math.min(nearbyEntities.length, args.maxTargets) + \\" nearby entities.\\";"
}`;

export const ACTION_GENERATION_PROMPT = `You design reusable Mineflayer tools.
Task name: {ACTION_NAME}
Task description: {ACTION_DESCRIPTION}
Suggested args:
{ACTION_ARGS}

The environment snapshot is the calling bot's current observed Minecraft state; use it to understand nearby blocks, entities, inventory, health, and position.
Current environment snapshot:
{ENVIRONMENT_SNAPSHOT}

Return exactly one valid JSON object with the fields:
- parameters: a JavaScript string containing a valid root z.object(...) expression
- executionArgs: a JSON object matching parameters, used only for the first execution
- code: raw JavaScript body for an async function with runtime signature async (bot, args, Movements, goals, Vec3) => { ... }

Available helpers:
- bot: a mineflayer bot with bot.pathfinder already loaded
- args: the validated named argument object created from your z.object schema
- Movements: the movement class from mineflayer-pathfinder
- goals: goal constructors from mineflayer-pathfinder
- Vec3: Vec3 constructor for block positions
- z: the Zod namespace used inside the parameters string
Rules:
- Output valid JSON only, with no markdown fences or explanations
- The parameters string must compile as valid JavaScript and valid Zod
- The parameters string must start with z.object(...)
- Treat suggested args as the preferred starting point; change them only when they seem incomplete, mismatched, or less useful for the task
- Design parameters so future agents can call this saved tool correctly
- executionArgs must validate against parameters
- Use descriptive top-level property names like position, playerName, options, radius
- Add .describe(...) to meaningful fields and nested objects when helpful
- Do not include imports, TypeScript, or an outer function
- Use only bot, args, Movements, goals, and Vec3 in code
- Read inputs from named properties on args, never from args[index]
- Return a short string describing what happened
- Use valid JavaScript, not TypeScript

${ACTION_GENERATION_EXAMPLES}`;

export const TOOL_REPAIR_PROMPT = `Your previous tool call for "{TOOL_NAME}" was invalid and was not executed.
Invalid arguments:
{TOOL_ARGS}

Validation error:
{VALIDATION_ERROR}

Retry by calling the same tool with corrected JSON arguments only if it is still needed.
For new_action, always include "name", "description", and "args".
For structured fields like position or options, pass raw JSON objects and arrays instead of quoted JSON strings.
Do not wrap arrays or objects in quotes.`;

export const getSummarizeHistoryPrompt = (name: string, oldMemory: string, toSummarize: string) => {
    return SUMMARIZE_HISTORY_PROMPT
        .replace('{NAME}', name)
        .replace('{OLD_MEMORY}', oldMemory)
        .replace('{TO_SUMMARIZE}', toSummarize);
};

const stringifyJsonValue = (value: JsonValue): string => JSON.stringify(value, null, 2);

export const getActionGenerationPrompt = (name: string, description: string, args: JsonValue[], environmentSnapshot: string = '') => {
    const argsText = args.length > 0
        ? args
            .map((arg, index) => `${index}: ${stringifyJsonValue(arg)}`)
            .join('\n')
        : 'No args provided.';
    const environmentText = environmentSnapshot || 'No snapshot provided.';

    return ACTION_GENERATION_PROMPT
        .replace('{ACTION_NAME}', name)
        .replace('{ACTION_DESCRIPTION}', description)
        .replace('{ACTION_ARGS}', argsText)
        .replace('{ENVIRONMENT_SNAPSHOT}', environmentText);
};

export const getSystemPrompt = (name: string, memory: string, environmentSnapshot: string, knowledgebase: string = '') => {
    const memoryText = memory || 'No memory yet.';
    const environmentText = environmentSnapshot || 'No snapshot yet.';
    const knowledgebaseText = knowledgebase.trim()
        ? `Inherited Knowledgebase: ${knowledgebase.trim()}`
        : '';

    return SYSTEM_PROMPT
        .replace('{NAME}', name)
        .replace('{KNOWLEDGEBASE_SECTION}', knowledgebaseText)
        .replace('{MEMORY}', memoryText)
        .replace('{ENVIRONMENT_SNAPSHOT}', environmentText);
};

export const getKnowledgebaseUpdatePrompt = (
    currentKnowledgebase: string,
    generationComparison: string,
    longestSurvivalMs: number,
    longestLog: string,
    shortestSurvivalMs: number,
    shortestLog: string
) => {
    return KNOWLEDGEBASE_UPDATE_PROMPT
        .replace('{CURRENT_KNOWLEDGEBASE}', currentKnowledgebase || 'No existing knowledgebase yet.')
        .replace('{GENERATION_COMPARISON}', generationComparison)
        .replace('{LONGEST_SURVIVAL_MS}', String(longestSurvivalMs))
        .replace('{LONGEST_LOG}', longestLog || 'No log messages available.')
        .replace('{SHORTEST_SURVIVAL_MS}', String(shortestSurvivalMs))
        .replace('{SHORTEST_LOG}', shortestLog || 'No log messages available.');
};

export const getToolRepairPrompt = (toolName: string, attemptedArgs: string, validationError: string) => {
    return TOOL_REPAIR_PROMPT
        .replace('{TOOL_NAME}', toolName)
        .replace('{TOOL_ARGS}', attemptedArgs)
        .replace('{VALIDATION_ERROR}', validationError);
};
