import { JsonValue } from "../types";

const USE_ACTION_EXAMPLES = `Examples of valid use_action calls:
1. Move to coordinates:
use_action({
  "name": "GoToPosition",
  "description": "Walk to a target world position using pathfinder",
  "args": [{ "x": 5.2, "y": 64, "z": -3.5 }]
})

2. Follow a player for a while:
use_action({
  "name": "FollowPlayer",
  "description": "Follow a named player with pathfinder",
  "args": ["MarcusVange", { "distance": 2, "maxTicks": 120 }]
})

3. Mine a block at coordinates:
use_action({
  "name": "MineBlockAt",
  "description": "Move to a block and dig it",
  "args": [{ "x": 10, "y": 63, "z": 4 }]
})

4. Pick up a dropped item:
use_action({
  "name": "PickUpItem",
  "description": "Move to a dropped item and collect it",
  "args": ["diamond", { "maxDistance": 24 }]
})`;

// export const SYSTEM_PROMPT = `You are a Minecraft Bot named {NAME}.
// If you are in danger, use your tools to survive.
// If you see a player, be friendly.
// Always execute a tool if the situation requires action.
// Use the use_action tool when you need a reusable Minecraft action.
// For use_action, always include JSON fields named "name", "description", and "args".
// The args array can contain strings, numbers, booleans, null, arrays, and objects.
// You can call multiple tools, but you can only send one chat message per response.

export const SYSTEM_PROMPT = `You are a Minecraft Bot named {NAME}.
You can use tools to interact with the world and with other players.
If you see a player, be friendly.
Always execute a tool if the situation requires action.
Prefer to use existing tools to accomplish tasks, but if there is not an existing tool that matches the situation, use the use_action tool to create a new action for that situation.
Use the use_action tool to create a new action. Use this when the other tool calls do not match the situation.
For use_action, always include JSON fields named "name", "description", and "args".
The args array can contain strings, numbers, booleans, null, arrays, and objects.
Do not wrap arrays or objects inside quoted JSON strings. Pass them as raw JSON values.
You can call multiple tools, but you can only send one chat message per response.

Goal: Your main goal is to survive and thrive in the Minecraft world.

${USE_ACTION_EXAMPLES}

Memory: {MEMORY}

The following shows your current environment.
Environment Snapshot: {ENVIRONMENT_SNAPSHOT}`;

export const SUMMARIZE_HISTORY_PROMPT = `You are a minecraft bot named {NAME} that has been talking and playing minecraft by using commands. Update your memory by summarizing the following conversation and your old memory in your next response. Prioritize preserving important facts, things you've learned, useful tips, and long term reminders. Do Not record stats, inventory, or docs! Only save transient information from your chat history. You're limited to 500 characters, so be brief, however not so brief that you lose important information.
Old Memory: '{OLD_MEMORY}'
Recent conversation:
{TO_SUMMARIZE}
Summarize your old memory and recent conversation into a new memory, and respond only with the unwrapped memory text.
`;

const ACTION_CODE_EXAMPLES = `Use these examples as patterns when they match the task.

Example tool call:
use_action({
  "name": "GoToPosition",
  "description": "Walk to a target world position using pathfinder",
  "args": [{ "x": 5.2, "y": 64, "z": -3.5 }]
})
Example body:
const target = args[0];
if (!target || typeof target !== 'object' || Array.isArray(target)) {
  return "<NO TARGET>: Missing position object.";
}
if (typeof target.x !== 'number' || typeof target.y !== 'number' || typeof target.z !== 'number') {
  return "<NO TARGET>: Position must include numeric x, y, z.";
}
const movements = new Movements(bot);
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(
  new goals.GoalNear(
    Math.floor(target.x),
    Math.floor(target.y),
    Math.floor(target.z),
    1
  )
);
return "<MOVED>: Reached the target position.";

Example tool call:
use_action({
  "name": "FollowPlayer",
  "description": "Follow a named player with pathfinder",
  "args": ["MarcusVange", { "distance": 2, "maxTicks": 120 }]
})
Example body:
const playerName = typeof args[0] === 'string' ? args[0] : null;
const options = args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) ? args[1] : {};
if (!playerName) {
  return "<NO PLAYER>: Missing player name.";
}
const target = bot.players[playerName]?.entity;
if (!target) {
  return "<NO PLAYER>: Could not find that player.";
}
const followDistance = typeof options.distance === 'number' ? options.distance : 2;
const maxTicks = typeof options.maxTicks === 'number' ? options.maxTicks : 120;
const movements = new Movements(bot);
bot.pathfinder.setMovements(movements);
bot.pathfinder.setGoal(new goals.GoalFollow(target, followDistance), true);
await new Promise((resolve) => setTimeout(resolve, maxTicks * 50));
bot.pathfinder.setGoal(null);
return "<FOLLOWED>: Followed the player.";

Example tool call:
use_action({
  "name": "MineBlockAt",
  "description": "Move to a block and dig it",
  "args": [{ "x": 10, "y": 63, "z": 4 }]
})
Example body:
const target = args[0];
if (!target || typeof target !== 'object' || Array.isArray(target)) {
  return "<NO TARGET>: Missing block position.";
}
if (typeof target.x !== 'number' || typeof target.y !== 'number' || typeof target.z !== 'number') {
  return "<NO TARGET>: Block position must include numeric x, y, z.";
}
const blockPosition = new Vec3(
  Math.floor(target.x),
  Math.floor(target.y),
  Math.floor(target.z)
);
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

Example tool call:
use_action({
  "name": "PickUpItem",
  "description": "Move to a dropped item and collect it",
  "args": ["diamond", { "maxDistance": 24 }]
})
Example body:
const requestedName = typeof args[0] === 'string' ? args[0].toLowerCase() : null;
const options = args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) ? args[1] : {};
const maxDistance = typeof options.maxDistance === 'number' ? options.maxDistance : 24;
const targetEntity = Object.values(bot.entities)
  .filter((entity) => entity.type === 'object' && entity.position.distanceTo(bot.entity.position) <= maxDistance)
  .filter((entity) => {
    const droppedItem = entity.getDroppedItem();
    if (!droppedItem) {
      return false;
    }
    if (!requestedName) {
      return true;
    }
    return droppedItem.name.toLowerCase().includes(requestedName);
  })
  .sort((left, right) => left.position.distanceTo(bot.entity.position) - right.position.distanceTo(bot.entity.position))[0];
if (!targetEntity) {
  return "<NO ITEM>: Could not find a matching dropped item.";
}
const movements = new Movements(bot);
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalNear(targetEntity.position.x, targetEntity.position.y, targetEntity.position.z, 1));
return "<PICKED UP>: Moved to the dropped item.";`;

const ACTION_JSON_EXAMPLE = `Example JSON output:
{
  "name": "GoToPosition",
  "description": "Walk to a target world position using pathfinder",
  "parameters": [
    {
      "name": "target",
      "description": "World position object with numeric x, y, and z fields"
    }
  ],
  "code": "const target = args[0];\\nif (!target || typeof target !== 'object' || Array.isArray(target)) {\\n  return \\"<NO TARGET>: Missing position object.\\";\\n}\\nif (typeof target.x !== 'number' || typeof target.y !== 'number' || typeof target.z !== 'number') {\\n  return \\"<NO TARGET>: Position must include numeric x, y, z.\\";\\n}\\nconst movements = new Movements(bot);\\nbot.pathfinder.setMovements(movements);\\nawait bot.pathfinder.goto(new goals.GoalNear(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z), 1));\\nreturn \\"<MOVED>: Reached the target position.\\";"
}`;

export const ACTION_GENERATION_PROMPT = `You design reusable Mineflayer tools.
Task name: {ACTION_NAME}
Task description: {ACTION_DESCRIPTION}
Current args:
{ACTION_ARGS}

Return exactly one valid JSON object with the fields:
- name: canonical tool name
- description: short tool description
- parameters: ordered array of parameter descriptors with "name" and "description"
- code: raw JavaScript body for an async function with runtime signature async (bot, args, Movements, goals, Vec3) => { ... }

Available helpers:
- bot: a mineflayer bot with bot.pathfinder already loaded
- args: ordered JSON values
- Movements: the movement class from mineflayer-pathfinder
- goals: goal constructors from mineflayer-pathfinder
- Vec3: Vec3 constructor for block positions
Rules:
- Output valid JSON only, with no markdown fences or explanations
- The tool name and each parameter name must match ^[A-Za-z][A-Za-z0-9_]*$
- Keep parameters in the same order as the current args you expect to read from args[index]
- Do not include imports, TypeScript, or an outer function
- Use only bot, args, Movements, goals, and Vec3
- Read inputs from args[index]
- Return a short string describing what happened
- Use valid JavaScript, not TypeScript

${ACTION_JSON_EXAMPLE}

${ACTION_CODE_EXAMPLES}`;

export const TOOL_REPAIR_PROMPT = `Your previous tool call for "{TOOL_NAME}" was invalid and was not executed.
Invalid arguments:
{TOOL_ARGS}

Validation error:
{VALIDATION_ERROR}

Retry by calling the same tool with corrected JSON arguments only if it is still needed.
For use_action, always include "name", "description", and "args".
Do not wrap arrays or objects in quotes.`;

export const getSummarizeHistoryPrompt = (name: string, oldMemory: string, toSummarize: string) => {
    return SUMMARIZE_HISTORY_PROMPT
        .replace('{NAME}', name)
        .replace('{OLD_MEMORY}', oldMemory)
        .replace('{TO_SUMMARIZE}', toSummarize);
};

const stringifyJsonValue = (value: JsonValue): string => JSON.stringify(value, null, 2);

export const getActionGenerationPrompt = (name: string, description: string, args: JsonValue[]) => {
    const argsText = args.length > 0
        ? args
            .map((arg, index) => `${index}: ${stringifyJsonValue(arg)}`)
            .join('\n')
        : 'No args provided.';

    return ACTION_GENERATION_PROMPT
        .replace('{ACTION_NAME}', name)
        .replace('{ACTION_DESCRIPTION}', description)
        .replace('{ACTION_ARGS}', argsText);
};

export const getSystemPrompt = (name: string, memory: string, environmentSnapshot: string) => {
    const memoryText = memory || 'No memory yet.';
    const environmentText = environmentSnapshot || 'No snapshot yet.';

    return SYSTEM_PROMPT
        .replace('{NAME}', name)
        .replace('{MEMORY}', memoryText)
        .replace('{ENVIRONMENT_SNAPSHOT}', environmentText);
};

export const getToolRepairPrompt = (toolName: string, attemptedArgs: string, validationError: string) => {
    return TOOL_REPAIR_PROMPT
        .replace('{TOOL_NAME}', toolName)
        .replace('{TOOL_ARGS}', attemptedArgs)
        .replace('{VALIDATION_ERROR}', validationError);
};
