import type { Bot } from "mineflayer";
import type { Movements as PathfinderMovements, goals as PathfinderGoals } from "mineflayer-pathfinder";
import type { Vec3 as Vec3Constructor } from "vec3";
import type { z } from "zod";
import type { GeneratedSkillDefinition, JsonValue, Skill } from "../types";
import {
    canContinueBotAction,
    waitForActiveMs,
    waitUntilWorldActive
} from "../utils/util";
import { startBackgroundSkill } from "./backgroundSkillRunner";

export interface StoredAction {
    name: string;
    description: string;
    parameters: string;
    code: string;
    count: number;
}

export interface UseActionInput {
    name: string;
    description: string;
    args: JsonValue[];
}

export type StartBackgroundSkill = typeof startBackgroundSkill;
export type WaitUntilWorldActive = typeof waitUntilWorldActive;
export type WaitForActiveMs = typeof waitForActiveMs;
export type CanContinueBotAction = typeof canContinueBotAction;

export type ActionExecutor = (
    bot: Bot,
    args: unknown,
    Movements: typeof PathfinderMovements,
    goals: typeof PathfinderGoals,
    Vec3: typeof Vec3Constructor,
    startBackgroundSkill: StartBackgroundSkill,
    waitUntilWorldActive: WaitUntilWorldActive,
    waitForActiveMs: WaitForActiveMs,
    canContinueBotAction: CanContinueBotAction
) => Promise<string>;

export interface PreparedAction {
    generatedDefinition: GeneratedSkillDefinition;
    compiledAction: ActionExecutor;
    compiledParameters: z.ZodObject<any>;
    parsedExecutionArgs: unknown;
}

export type RegisterGeneratedSkill = (
    skill: Skill
) => { success: boolean; error?: string };

export type RunWhileWorldFrozen = <T>(work: () => Promise<T>) => Promise<T>;
