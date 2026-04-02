import { Bot } from "mineflayer";
import { Movements as PathfinderMovements, goals as PathfinderGoals } from "mineflayer-pathfinder";
import * as fs from "fs/promises";
import { Vec3 as Vec3Constructor } from "vec3";
import { z } from "zod";
import { config } from "../config";
import { LLMClient } from "../llmClient";
import { GeneratedSkillDefinition, JsonValue, Skill } from "../types";
import { getActionGenerationPrompt } from "../utils/prompts";
import { getRuntimePath } from "../utils/util";

interface StoredAction {
    name: string;
    description: string;
    parameters: string;
    code: string;
}

interface UseActionInput {
    name: string;
    description: string;
    args: JsonValue[];
}

type ActionExecutor = (
    bot: Bot,
    args: unknown,
    Movements: typeof PathfinderMovements,
    goals: typeof PathfinderGoals,
    Vec3: typeof Vec3Constructor
) => Promise<string>;

type RegistrationResult = { success: boolean; error?: string };

type RegisterGeneratedSkill = (
    skill: Skill
) => RegistrationResult;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
) => ActionExecutor;

const StoredActionSchema = z.object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    description: z.string().min(1),
    parameters: z.string().min(1),
    code: z.string().min(1)
});

const GeneratedSkillDefinitionSchema = z.object({
    parameters: z.string().min(1),
    code: z.string().min(1)
});

const GeneratedSkillDefinitionResponseFormat = z.toJSONSchema(GeneratedSkillDefinitionSchema);

export class GeneratedActionService {
    private readonly skillsPath = getRuntimePath('skills', 'SKILLS.json');

    constructor(
        private readonly llm: LLMClient,
        private readonly createGeneratedSkill: (
            name: string,
            description: string,
            parameters: z.ZodTypeAny,
            executeAction: (bot: Bot, args: unknown) => Promise<string>
        ) => Skill,
        private readonly registerGeneratedSkill: RegisterGeneratedSkill
    ) {}

    public async useAction(bot: Bot, input: UseActionInput): Promise<string> {
        for (let attempt = 1; attempt <= config.actions.generationRetries; attempt++) {
            console.log("Started code generation for action:", input.name);
            const generatedDefinition = await this.generateActionDefinition(input);
            console.log("Finished code generation for action:", input.name);
            if (!generatedDefinition) {
                console.warn(`Generated action "${input.name}" returned invalid metadata on attempt ${attempt}.`);
                continue;
            }

            const compiledParameters = this.compileParameters(generatedDefinition.parameters);
            if (!compiledParameters) {
                console.warn(`Generated action "${input.name}" failed schema validation on attempt ${attempt}.`);
                continue;
            }

            const compiledAction = this.compileAction(generatedDefinition.code);

            if (!compiledAction) {
                console.warn(`Generated action "${input.name}" failed syntax validation on attempt ${attempt}.`);
                continue;
            }

            try {
                const initialArgs = this.mapOrderedArgsToNamedArgs(compiledParameters, input.args);
                if (!initialArgs) {
                    console.warn(`Generated action "${input.name}" produced a schema that does not match the provided args on attempt ${attempt}.`);
                    continue;
                }

                const parsedInitialArgs = compiledParameters.safeParse(initialArgs);
                if (!parsedInitialArgs.success) {
                    console.warn(`Generated action "${input.name}" rejected the provided args on attempt ${attempt}: ${parsedInitialArgs.error.message}`);
                    continue;
                }

                console.log("Started action execution for:", input.name);
                const result = await this.runAction(compiledAction, bot, parsedInitialArgs.data);
                console.log("Finished action execution for:", input.name);

                const generatedSkill = this.createGeneratedSkill(
                    input.name,
                    input.description,
                    compiledParameters,
                    (runtimeBot, runtimeArgs) => this.runAction(compiledAction, runtimeBot, runtimeArgs)
                );
                const registrationResult = this.registerGeneratedSkill(generatedSkill);
                if (!registrationResult.success) {
                    console.warn(`Generated action "${input.name}" could not be registered: ${registrationResult.error}`);
                    continue;
                }

                try {
                    await this.saveAction({
                        name: input.name,
                        description: input.description,
                        parameters: generatedDefinition.parameters,
                        code: generatedDefinition.code
                    });
                    console.log("Saved action:", input.name);
                } catch (error) {
                    console.error(`Generated action "${input.name}" was registered but could not be written to SKILLS.json:`, error);
                }
                return result;
            } catch (error) {
                console.error(`Generated action "${input.name}" failed during execution:`, error);
            }
        }

        return `<NO ACTION>: Could not create ${input.name}.`;
    }

    private async generateActionDefinition(input: UseActionInput): Promise<GeneratedSkillDefinition | null> {
        const prompt = [
            getActionGenerationPrompt(input.name, input.description, input.args),
            'Follow this JSON schema exactly:',
            JSON.stringify(GeneratedSkillDefinitionResponseFormat)
        ].join('\n\n');

        const response = await this.llm.generate({
            prompt,
            jsonSchema: GeneratedSkillDefinitionResponseFormat,
            useActionModel: true
        });

        return this.parseGeneratedSkillDefinition(response.content);
    }

    private compileParameters(schemaSource: string): z.ZodObject<any> | null {
        if (!/^z\.object\s*\(/.test(schemaSource.trim())) {
            return null;
        }

        try {
            const compiled = new Function('z', `"use strict"; return (${schemaSource});`)(z);
            return compiled instanceof z.ZodObject ? compiled : null;
        } catch {
            return null;
        }
    }

    private compileAction(code: string): ActionExecutor | null {
        try {
            return new AsyncFunction('bot', 'args', 'Movements', 'goals', 'Vec3', code);
        } catch {
            return null;
        }
    }

    private async runAction(action: ActionExecutor, bot: Bot, args: unknown): Promise<string> {
        const result = await action(bot, args, PathfinderMovements, PathfinderGoals, Vec3Constructor);
        return typeof result === 'string' ? result : String(result);
    }

    private mapOrderedArgsToNamedArgs(schema: z.ZodObject<any>, args: JsonValue[]): Record<string, JsonValue> | null {
        const shape = schema.shape;
        const parameterNames = Object.keys(shape);

        if (args.length > parameterNames.length) {
            return null;
        }

        return parameterNames.reduce<Record<string, JsonValue>>((result, parameterName, index) => {
            if (index < args.length) {
                result[parameterName] = args[index];
            }

            return result;
        }, {});
    }

    private async saveAction(newAction: StoredAction): Promise<void> {
        const existingActions = await this.loadActions();
        const nextActions = existingActions.filter(
            (action) => this.normalizeText(action.name) !== this.normalizeText(newAction.name)
        );
        nextActions.push(newAction);

        await fs.writeFile(this.skillsPath, `${JSON.stringify(nextActions, null, 2)}\n`, 'utf8');
    }

    private async loadActions(): Promise<StoredAction[]> {
        try {
            const content = await fs.readFile(this.skillsPath, 'utf8');
            const parsed = JSON.parse(content);

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter((entry): entry is StoredAction => {
                const result = StoredActionSchema.safeParse(entry);
                return result.success;
            });
        } catch (error) {
            console.warn('Could not load SKILLS.json audit log, starting from an empty list.', error);
            return [];
        }
    }

    private parseGeneratedSkillDefinition(rawResponse: string): GeneratedSkillDefinition | null {
        try {
            const parsed = JSON.parse(rawResponse);
            const result = GeneratedSkillDefinitionSchema.safeParse(parsed);
            if (result.success) {
                return result.data;
            }
        } catch {
            return null;
        }

        return null;
    }

    private normalizeText(value: string): string {
        return value.trim().toLowerCase();
    }
}
