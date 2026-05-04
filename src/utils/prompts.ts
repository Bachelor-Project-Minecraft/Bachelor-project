import { JsonValue } from "../types";
import { stringifyJson } from "./util";

const USE_ACTION_EXAMPLES = `Examples of valid new_action calls:
1. Create a basic movement action when no movement tool exists yet:
new_action({
  "name": "move_to_coordinate",
  "description": "Move to a target x/z coordinate using pathfinder",
  "args": [{ "x": 10, "z": 4, "radius": 1 }]
})
From now on this action can be called directly like this:
move_to_coordinate({
  "position": { "x": 10, "z": 4 },
  "radius": 1
})

2. Create a reusable survival tactic:
new_action({
  "name": "kite_nearest_hostile",
  "description": "Back away from the nearest hostile while keeping distance",
  "args": [{ "preferredDistance": 8, "retreatBlocks": 6, "maxTicks": 80 }]
})
From now on this action can be called directly like this:
kite_nearest_hostile({
  "options": { "preferredDistance": 8, "retreatBlocks": 6, "maxTicks": 80 }
})`;

export const SYSTEM_PROMPT = `Goal: You are a Minecraft Bot named {NAME}. Your primary directive is to survive in a hostile environment through combat, evasion, strategy, and collaboration.

Environment: 
You are in a flat world with no trees, buildings, or hills. Increasingly hostile entities spawn on a timer, so you must always be prepared for combat.

Tool Usage Rules:
You must ALWAYS execute at least one tool per response. If no physical action or communication is beneficial for survival, use 'do_nothing'.
Only three built-in tools are guaranteed at the start: 'send_message', 'do_nothing', and 'new_action'. Other physical tools may appear only if they were inherited from earlier generations or created during this run.
Read the currently available tool list carefully. Never assume that movement, combat, eating, equipping, building, digging, following, or item pickup tools exist unless they are actually listed.
Use at most one physical/time-consuming tool per response. Physical/time-consuming tools include 'new_action' and any generated action that moves, fights, eats, equips, builds, digs, waits, follows, or loops over time.
You may combine one survival-relevant 'send_message' with one physical/time-consuming tool when both are useful. Do not combine 'do_nothing' with any other tool.
When a needed physical behavior is missing, call 'new_action' to create and immediately execute it. Once a generated action exists, call that named action directly instead of recreating it.

Communication & Collaboration:
You are encouraged to talk, share knowledge, plan strategies, and develop cooperative tactics with other players. However, to survive, planning must immediately be followed by action.
Follow these strict conversational rules:
- Add New Information Only: Only use 'send_message' to propose a NEW plan, share NEW knowledge, or warn of NEW danger. 
- Agree With Actions, Not Words: NEVER send messages to agree, acknowledge, or say "Got it", "Roger", "Thanks", or "What can I do?". 
- The Action Protocol: If another player proposes a plan and you agree with it, DO NOT reply verbally. Immediately execute the physical tool required to help with that plan. Your physical action is your response.
- If you disagree with a plan, you may use 'send_message' to propose an alternative.

Creating New Actions ('new_action'):
Use 'new_action' as your main bridge from intention to Minecraft behavior. Since almost no physical tools are predefined, create missing reusable actions for basic survival primitives and for richer tactics.
A successful 'new_action' immediately executes once, then becomes a reusable named tool available to all agents in the current run. If agents keep using it and it proves useful, it can be promoted into the inherited action set for later generations.
- If a listed generated action already does what you need, call it directly instead of creating a duplicate.
- If no listed action can do the needed physical behavior, create one with 'new_action' rather than merely talking or idling.
- Strong candidates include movement, attacking, ranged attacks, eating, equipping, item pickup, following/regrouping, inventory/resource use, terrain changes, gaining height, creating barriers, controlling spacing, retreating, and combined tactics.
- Prefer broadly reusable action names and arguments. For example, create 'move_to_coordinate' or 'attack_hostile_by_id' before creating a one-off action tied to one exact coordinate or mob.
- Do not create new actions for communication or for choosing to idle; use 'send_message' and 'do_nothing' for those.
- You must include JSON fields named "name", "description", and "args".
- Action names must use lowercase snake_case with underscores only.
- The "args" array can contain strings, numbers, booleans, null, arrays, and objects. Do not wrap arrays/objects inside quoted JSON strings; pass them as raw JSON values.

${USE_ACTION_EXAMPLES}

Knowledge Base: {KNOWLEDGEBASE_SECTION}

Memory: {MEMORY}

Environment Snapshot: {ENVIRONMENT_SNAPSHOT}`;

export const KNOWLEDGEBASE_UPDATE_PROMPT = `You are updating an inherited culture knowledgebase for Minecraft survival agents.
The knowledgebase is passed directly to the next agents, so write it as practical inherited norms they can act on.

Your goal is not only to maximize survival, but to preserve and refine useful culture: shared tactics, communication habits, division of labor, reusable custom-action ideas, and safe experiments that may reveal better strategies.

Use the current knowledgebase, generation comparison, full generation history, and the best/worst logs as evidence.
Keep lessons that are clearly useful, remove advice that caused harm or became too rigid, and add new lessons only when they are supported by the logs or are a small safe experiment suggested by the logs.

Balance exploitation and exploration:
- Preserve reliable survival basics, especially urgent combat, healing, equipment, and avoiding repeated mistakes.
- Include 1-2 exploration norms the agents should try when immediate danger is low, such as testing formations, spacing, baiting, kiting, regrouping points, role assignments, concise status messages, item-sharing, or useful new custom actions.
- If the generation history shows flat survival times, repeated similar deaths, or no clear upward trend, assume the current inherited strategy has plateaued. In that case, you MUST make the next knowledgebase more exploratory: remove or soften at least one overly rigid rule, keep only the survival basics that are clearly necessary, and add 2-3 concrete new experiments for the next agents to try.
- When survival is not improving, do not merely restate, polish, or optimize the same strategy. The final knowledgebase must visibly change what the next agents will try.
- Frame uncertain exploration as "Try ..." or "Test ..." rather than as absolute law.
- Do not let speculative experiments override immediate survival. Experiments should happen only when health, food, and nearby threats make them reasonable.
- Avoid overfitting to one strange event. Prefer patterns seen in both success and failure logs.

Culture requirements:
- Include at least one cooperative convention if the logs contain any player interaction or teammate awareness.
- Prefer short shared protocols that agents can repeat across situations.
- Encourage agents to communicate only when the message changes what others should do or know.
- Preserve successful custom-action ideas or propose a concrete new-action idea only if it would enable behavior not covered by existing tools.

Output rules:
- Keep the final knowledgebase short: 6-10 bullets maximum.
- Each bullet must be concrete, actionable, and understandable by a Minecraft agent.
- Use direct agent-facing language, not researcher-facing analysis.
- Do not mention generations, averages, comparisons, logs, prompts, or the knowledgebase update process in the final knowledgebase.
- Do not invent facts about the world, inventory, tools, or scenarios that are not present in the input.
- Return only the final knowledgebase text with no introduction or markdown fences.

Current knowledgebase:
{CURRENT_KNOWLEDGEBASE}

Generation comparison:
{GENERATION_COMPARISON}

Generation history:
{GENERATION_HISTORY}

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

const ACTION_GENERATION_EXAMPLES = `Use these examples as implementation patterns for generated actions. Basic physical actions may need to be generated because they are no longer guaranteed as predefined skills.

Example 1
Pattern: Instant physical primitive. Validate the current state, do one short action, then return after it completes.
Input args:
0: "stone_sword"
Output:
{
  "parameters": "z.object({ itemName: z.string().min(1).describe(\\"The inventory item to hold, for example stone_sword\\") })",
  "executionArgs": { "itemName": "stone_sword" },
  "code": "const normalizeItemName = function (value) {\\n  return value.trim().toLowerCase().replace(/^minecraft:/, '').replace(/\\\\s+/g, '_');\\n};\\nconst requestedName = normalizeItemName(args.itemName);\\nconst selectedItem = bot.inventory.items().find(function (item) {\\n  return normalizeItemName(item.name) === requestedName || (typeof item.displayName === 'string' && normalizeItemName(item.displayName) === requestedName);\\n});\\nif (!selectedItem) {\\n  return \\"<NO ITEM>: Could not find \\" + args.itemName + \\" in inventory.\\";\\n}\\nawait bot.equip(selectedItem, 'hand');\\nreturn \\"<EQUIPPED>: Now holding \\" + (selectedItem.displayName || selectedItem.name) + \\".\\";"
}

Example 2
Pattern: Long-running movement primitive. Start background work and return immediately so the agent can still receive danger events and messages.
Input args:
0: { "x": 10, "z": 4 }
Output:
{
  "parameters": "z.object({ position: z.object({ x: z.number().describe(\\"Target x coordinate\\"), z: z.number().describe(\\"Target z coordinate\\") }).describe(\\"The destination coordinates to move to\\") })",
  "executionArgs": { "position": { "x": 10, "z": 4 } },
  "code": "const targetPosition = new Vec3(Math.floor(args.position.x), 0, Math.floor(args.position.z));\\nconst radius = 1;\\nstartBackgroundSkill(bot, 'move_to_coordinate', async function (token) {\\n  const movements = new Movements(bot);\\n  bot.pathfinder.setMovements(movements);\\n  try {\\n    await bot.pathfinder.goto(new goals.GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, radius));\\n    if (!token.cancelled) {\\n      console.log('Finished moving toward (' + targetPosition.x + ', ' + targetPosition.y + ', ' + targetPosition.z + ').');\\n    }\\n  } catch (error) {\\n    if (!token.cancelled) {\\n      console.error('Failed moving toward (' + targetPosition.x + ', ' + targetPosition.y + ', ' + targetPosition.z + '):', error);\\n    }\\n  }\\n});\\nreturn \\"<MOVING>: Moving toward (\\" + targetPosition.x + \\", \\" + targetPosition.y + \\", \\" + targetPosition.z + \\") with radius \\" + radius + \\".\\";"
}

Example 3
Pattern: Long-running resource-use loop. Check current state first, run repeated work in startBackgroundSkill, honor cancellation, and return immediately.
Input args:
No args provided.
Output:
{
  "parameters": "z.object({})",
  "executionArgs": {},
  "code": "const maxFood = 20;\\nconst consumeMs = 1700;\\nconst freezePollMs = 50;\\nconst sleep = function (ms) {\\n  return new Promise(function (resolve) { setTimeout(resolve, ms); });\\n};\\nconst findBread = function () {\\n  return bot.inventory.items().find(function (item) { return item.name === 'bread'; });\\n};\\nif ((bot.food || 0) >= maxFood) {\\n  return \\"<ALREADY FULL>: Hunger is already full.\\";\\n}\\nif (!findBread()) {\\n  return \\"<NO BREAD>: Cannot eat because no bread is in inventory.\\";\\n}\\nstartBackgroundSkill(bot, 'eat_bread_until_full', async function (token) {\\n  const canContinue = function () { return !token.cancelled && bot.health > 0 && Boolean(bot.entity); };\\n  const waitUntilWorldActive = async function () {\\n    while (!bot.physicsEnabled) {\\n      if (!canContinue()) { return false; }\\n      await sleep(freezePollMs);\\n    }\\n    return canContinue();\\n  };\\n  while (canContinue() && (bot.food || 0) < maxFood) {\\n    const bread = findBread();\\n    if (!bread) { return; }\\n    await bot.equip(bread, 'hand');\\n    if (!await waitUntilWorldActive()) { return; }\\n    bot.activateItem();\\n    await sleep(consumeMs);\\n    bot.deactivateItem();\\n  }\\n});\\nreturn \\"<EATING>: Eating bread until hunger is full.\\";"
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
- code: raw JavaScript body for an async function with runtime signature async (bot, args, Movements, goals, Vec3, startBackgroundSkill) => { ... }

Available helpers:
- bot: a mineflayer bot with bot.pathfinder already loaded
- args: the validated named argument object created from your z.object schema
- Movements: the movement class from mineflayer-pathfinder
- goals: goal constructors from mineflayer-pathfinder
- Vec3: Vec3 constructor for block positions
- startBackgroundSkill: helper for long-running work. Call startBackgroundSkill(bot, actionName, async function (token) { ... }) and return immediately when the action should continue over time. The token has token.cancelled; check it inside loops and after waits.
- z: the Zod namespace used inside the parameters string
Rules:
- Output valid JSON only, with no markdown fences or explanations
- The parameters string must compile as valid JavaScript and valid Zod
- The parameters string must start with z.object(...)
- It is acceptable to generate fundamental physical primitives such as moving, attacking, eating, equipping, digging, or item pickup; these may not exist as built-in tools.
- Prefer double-quoted .describe("...") text in the parameters string, especially when the text contains apostrophes
- Treat suggested args as the preferred starting point; change them only when they seem incomplete, mismatched, or less useful for the task
- Design parameters so future agents can call this saved tool correctly
- executionArgs must validate against parameters
- Use descriptive top-level property names like position, playerName, options, radius
- Add .describe(...) to meaningful fields and nested objects when helpful
- Do not include imports, TypeScript, or an outer function
- Use only bot, args, Movements, goals, Vec3, and startBackgroundSkill in code
- Do not block the agent on long-running tasks. For movement, repeated eating, waiting, guarding, following, building over multiple blocks, or any loop that may take more than a moment, use startBackgroundSkill with the exact task name and return a short status string immediately so new events and messages can interrupt or redirect the agent.
- Background work must stop cleanly when token.cancelled is true, and loops should check bot.health > 0 and Boolean(bot.entity). If waiting while the world may be frozen, pause progress while !bot.physicsEnabled.
- Read inputs from named properties on args, never from args[index]
- Return a short string describing what happened
- Use valid JavaScript, not TypeScript
- If you need callbacks in code, prefer function expressions over arrow functions

${ACTION_GENERATION_EXAMPLES}

Return only JSON in this shape:
{
  "parameters": "z.object({ ... })",
  "executionArgs": { ... },
  "code": "..."
}`;

const ACTION_GENERATION_REPAIR_PROMPT = `Previous generation failed validation before it could be saved or executed.
Fix the exact problem below and return the full JSON object again.
Do not repeat the same invalid output.

Validation feedback:
{VALIDATION_FEEDBACK}`;

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

export const getActionGenerationPrompt = (
    name: string,
    description: string,
    args: JsonValue[],
    environmentSnapshot: string = '',
    validationFeedback: string = ''
) => {
    const argsText = args.length > 0
        ? args
            .map((arg, index) => `${index}: ${stringifyJson(arg, 2)}`)
            .join('\n')
        : 'No args provided.';
    const environmentText = environmentSnapshot || 'No snapshot provided.';

    const basePrompt = ACTION_GENERATION_PROMPT
        .replace('{ACTION_NAME}', name)
        .replace('{ACTION_DESCRIPTION}', description)
        .replace('{ACTION_ARGS}', argsText)
        .replace('{ENVIRONMENT_SNAPSHOT}', environmentText);

    const feedbackText = validationFeedback.trim();
    if (!feedbackText) {
        return basePrompt;
    }

    return [
        basePrompt,
        ACTION_GENERATION_REPAIR_PROMPT.replace('{VALIDATION_FEEDBACK}', feedbackText)
    ].join('\n\n');
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
    generationHistory: string,
    longestSurvivalMs: number,
    longestLog: string,
    shortestSurvivalMs: number,
    shortestLog: string
) => {
    return KNOWLEDGEBASE_UPDATE_PROMPT
        .replace('{CURRENT_KNOWLEDGEBASE}', currentKnowledgebase || 'No existing knowledgebase yet.')
        .replace('{GENERATION_COMPARISON}', generationComparison)
        .replace('{GENERATION_HISTORY}', generationHistory)
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
