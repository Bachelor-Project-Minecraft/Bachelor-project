import { JsonValue, JsonValueSchema, Skill, GeneratedSkillDefinition } from "../types";
import { Bot } from "mineflayer";
import { z } from "zod";
import { AttackSkill, ChatSkill, createUseActionSkill } from "./actions";
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

        this.registerBuiltInSkill(ChatSkill);
        this.registerBuiltInSkill(AttackSkill);
        this.registerBuiltInSkill(createUseActionSkill(actionService));
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
        definition: GeneratedSkillDefinition,
        executeAction: (bot: Bot, args: JsonValue[]) => Promise<string>
    ): Skill {
        const shape = definition.parameters.reduce<Record<string, z.ZodType<JsonValue>>>((result, parameter) => {
            result[parameter.name] = JsonValueSchema.describe(parameter.description);
            return result;
        }, {});

        return {
            name: definition.name,
            description: definition.description,
            parameters: z.object(shape),
            execute: async (bot, args) => {
                const parsedArgs =
                    args && typeof args === 'object' && !Array.isArray(args)
                        ? args as Record<string, JsonValue>
                        : {};
                const orderedArgs = definition.parameters.map((parameter) => parsedArgs[parameter.name]);
                return executeAction(bot, orderedArgs);
            }
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
        return Array.from(this.skills.values()).map(skill => ({
            type: 'function',
            function: {
                name: skill.name,
                description: skill.description,
                parameters: skill.parameters
            }
        }));
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
