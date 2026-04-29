import { Skill } from "../types";
import { Bot } from "mineflayer";
import { z } from "zod";
import { BowAttackSkill, createNewActionSkill, DoNothingSkill, EatBreadUntilFullSkill, EquipGearSkill, EquipItemInHandSkill, MeleeAttackSkill, MoveToCoordinateSkill, SendMessageSkill } from "./actions";
import { GeneratedActionService } from "./generatedActionService";

export class SkillRegistry {
    private static globalInstance: SkillRegistry | null = null;
    private skills: Map<string, Skill> = new Map();
    private normalizedNames: Map<string, string> = new Map();
    private builtInNames: Set<string> = new Set();
    private builtInsInitialized: boolean = false;

    private constructor() {}

    public static getInstance(): SkillRegistry {
        if (!SkillRegistry.globalInstance) {
            SkillRegistry.globalInstance = new SkillRegistry();
        }

        return SkillRegistry.globalInstance;
    }

    public initializeBuiltIns(actionService: GeneratedActionService) {
        if (this.builtInsInitialized) {
            return;
        }

        this.registerBuiltInSkill(SendMessageSkill);
        this.registerBuiltInSkill(DoNothingSkill);
        this.registerBuiltInSkill(MeleeAttackSkill);
        this.registerBuiltInSkill(BowAttackSkill);
        this.registerBuiltInSkill(MoveToCoordinateSkill);
        this.registerBuiltInSkill(EquipItemInHandSkill);
        this.registerBuiltInSkill(EquipGearSkill);
        this.registerBuiltInSkill(EatBreadUntilFullSkill);
        this.registerBuiltInSkill(createNewActionSkill(actionService));
        actionService.loadGenerationSkills();
        this.builtInsInitialized = true;
    }

    public registerGeneratedSkill(skill: Skill): { success: boolean; error?: string } {
        const normalizedName = this.normalizeName(skill.name);
        if (this.builtInNames.has(normalizedName)) {
            return {
                success: false,
                error: `Cannot overwrite built-in skill "${skill.name}".`
            };
        }

        const existingName = this.normalizedNames.get(normalizedName);
        if (existingName && existingName !== skill.name) {
            this.skills.delete(existingName);
        }

        this.skills.set(skill.name, skill);
        this.normalizedNames.set(normalizedName, skill.name);
        return { success: true };
    }

    public createGeneratedSkill(
        name: string,
        description: string,
        parameters: z.ZodTypeAny,
        executeAction: (bot: Bot, args: unknown) => Promise<string>
    ): Skill {
        return {
            name,
            description,
            parameters,
            execute: async (bot, args) => executeAction(bot, args)
        };
    }

    public getSkill(name: string): Skill | undefined {
        const exactMatch = this.skills.get(name);
        if (exactMatch) {
            return exactMatch;
        }

        const registeredName = this.normalizedNames.get(this.normalizeName(name));
        return registeredName ? this.skills.get(registeredName) : undefined;
    }

    public getTools() {
        const tools = Array.from(this.skills.values()).map((skill) => ({
            type: 'function',
            function: {
                name: skill.name,
                description: skill.description,
                parameters: skill.toolParameters ?? this.simplifySchema(z.toJSONSchema(skill.parameters)),
            },
        }));

        return tools;
    }

    private simplifySchema(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map(v => this.simplifySchema(v));
        }

        if (value && typeof value === 'object') {
            const obj = value as Record<string, unknown>;
            const out: Record<string, unknown> = {};

            for (const [key, v] of Object.entries(obj)) {
                if (key === '$schema') continue;
                if (key === 'additionalProperties') continue;
                out[key] = this.simplifySchema(v);
            }

            return out;
        }

        return value;
    }
    private registerBuiltInSkill(skill: Skill) {
        this.skills.set(skill.name, skill);
        const normalizedName = this.normalizeName(skill.name);
        this.normalizedNames.set(normalizedName, skill.name);
        this.builtInNames.add(normalizedName);
    }

    private normalizeName(value: string): string {
        return value.trim().toLowerCase();
    }
}
