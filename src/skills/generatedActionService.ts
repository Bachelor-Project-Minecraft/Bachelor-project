import { Bot } from "mineflayer";
import { Movements as PathfinderMovements, goals as PathfinderGoals } from "mineflayer-pathfinder";
import * as fs from "fs/promises";
import * as fsSync from "fs";
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
    count: number;
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

type RunWhileWorldFrozen = <T>(work: () => Promise<T>) => Promise<T>;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
) => ActionExecutor;

const StoredActionSchema = z.object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    description: z.string().min(1),
    parameters: z.string().min(1),
    code: z.string().min(1),
    count: z.number().int().min(0)
});

const GeneratedSkillDefinitionSchema = z.object({
    parameters: z.string().min(1),
    code: z.string().min(1)
});

const GeneratedSkillDefinitionResponseFormat = z.toJSONSchema(GeneratedSkillDefinitionSchema);

interface PreparedAction {
    generatedDefinition: GeneratedSkillDefinition;
    compiledAction: ActionExecutor;
    compiledParameters: z.ZodObject<any>;
    parsedInitialArgs: unknown;
}

export class GeneratedActionService {
    private readonly skillsPath = getRuntimePath('skills', 'SKILLS.json');
    private readonly generationSkillsPath = getRuntimePath('evolution', 'generationSkills.json');

    constructor(
        private readonly llm: LLMClient,
        private readonly createGeneratedSkill: (
            name: string,
            description: string,
            parameters: z.ZodTypeAny,
            executeAction: (bot: Bot, args: unknown) => Promise<string>
        ) => Skill,
        private readonly registerGeneratedSkill: RegisterGeneratedSkill,
        private readonly runWhileWorldFrozen: RunWhileWorldFrozen,
        private readonly getEnvironmentSnapshot: () => string
    ) {}

    public loadGenerationSkills(): void {
        const actions = this.loadActionsSync(this.generationSkillsPath);

        for (const action of actions) {
            const compiledParameters = this.compileParameters(action.parameters);
            if (!compiledParameters) {
                console.warn(`Persisted action "${action.name}" could not be loaded because its parameters are invalid.`);
                continue;
            }

            const compiledAction = this.compileAction(action.code);
            if (!compiledAction) {
                console.warn(`Persisted action "${action.name}" could not be loaded because its code is invalid.`);
                continue;
            }

            const registrationResult = this.registerGeneratedSkill(
                this.createSkillFromStoredAction(action, compiledParameters, compiledAction, false)
            );
            if (!registrationResult.success) {
                console.warn(`Persisted action "${action.name}" could not be registered: ${registrationResult.error}`);
            }
        }
    }

    public async useAction(bot: Bot, input: UseActionInput): Promise<string> {
        const actionName = this.normalizeActionName(input.name);
        const normalizedInput = {
            ...input,
            name: actionName
        };

        for (let attempt = 1; attempt <= config.actions.generationRetries; attempt++) {
            const preparedAction = await this.runWhileWorldFrozen(async () =>
                this.prepareAction(normalizedInput, attempt)
            );

            if (!preparedAction) {
                continue;
            }

            try {
                console.log("Started action execution for:", actionName);
                const result = await this.runAction(
                    preparedAction.compiledAction,
                    bot,
                    preparedAction.parsedInitialArgs
                );
                console.log("Finished action execution for:", actionName);

                const storedAction = {
                    name: actionName,
                    description: normalizedInput.description,
                    parameters: preparedAction.generatedDefinition.parameters,
                    code: preparedAction.generatedDefinition.code,
                    count: 1
                };
                const generatedSkill = this.createSkillFromStoredAction(
                    storedAction,
                    preparedAction.compiledParameters,
                    preparedAction.compiledAction
                );
                const registrationResult = this.registerGeneratedSkill(generatedSkill);
                if (!registrationResult.success) {
                    console.warn(`Generated action "${actionName}" could not be registered: ${registrationResult.error}`);
                    continue;
                }

                try {
                    await this.saveAction(storedAction);
                    console.log("Saved action:", actionName);
                } catch (error) {
                    console.error(`Generated action "${actionName}" was registered but could not be written to SKILLS.json:`, error);
                }
                return result;
            } catch (error) {
                console.error(`Generated action "${actionName}" failed during execution:`, error);
            }
        }

        return `<NO ACTION>: Could not create ${actionName}.`;
    }

    private async prepareAction(input: UseActionInput, attempt: number): Promise<PreparedAction | null> {
        console.log("Started code generation for action:", input.name);
        const generatedDefinition = await this.generateActionDefinition(input);
        console.log("Finished code generation for action:", input.name);

        if (!generatedDefinition) {
            console.warn(`Generated action "${input.name}" returned invalid metadata on attempt ${attempt}.`);
            return null;
        }

        const compiledParameters = this.compileParameters(generatedDefinition.parameters);
        if (!compiledParameters) {
            console.warn(`Generated action "${input.name}" failed schema validation on attempt ${attempt}.`);
            return null;
        }

        const compiledAction = this.compileAction(generatedDefinition.code);
        if (!compiledAction) {
            console.warn(`Generated action "${input.name}" failed syntax validation on attempt ${attempt}.`);
            return null;
        }

        const initialArgs = this.mapOrderedArgsToNamedArgs(compiledParameters, input.args);
        if (!initialArgs) {
            console.warn(`Generated action "${input.name}" produced a schema that does not match the provided args on attempt ${attempt}.`);
            return null;
        }

        const parsedInitialArgs = compiledParameters.safeParse(initialArgs);
        if (!parsedInitialArgs.success) {
            console.warn(`Generated action "${input.name}" rejected the provided args on attempt ${attempt}: ${parsedInitialArgs.error.message}`);
            return null;
        }

        return {
            generatedDefinition,
            compiledAction,
            compiledParameters,
            parsedInitialArgs: parsedInitialArgs.data
        };
    }

    private async generateActionDefinition(input: UseActionInput): Promise<GeneratedSkillDefinition | null> {
        const prompt = [
            getActionGenerationPrompt(input.name, input.description, input.args, this.getEnvironmentSnapshot()),
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

    private createSkillFromStoredAction(
        action: StoredAction,
        compiledParameters: z.ZodObject<any>,
        compiledAction: ActionExecutor,
        shouldRecordUse = true
    ): Skill {
        return this.createGeneratedSkill(
            action.name,
            action.description,
            compiledParameters,
            async (runtimeBot, runtimeArgs) => {
                const result = await this.runAction(compiledAction, runtimeBot, runtimeArgs);
                if (shouldRecordUse) {
                    await this.recordActionUse(action);
                }
                return result;
            }
        );
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

    private async recordActionUse(action: StoredAction): Promise<void> {
        try {
            const existingActions = await this.loadActions();
            const existingAction = existingActions.find(
                (candidate) => this.normalizeText(candidate.name) === this.normalizeText(action.name)
            );
            const nextCount = existingAction ? existingAction.count + 1 : 1;
            await this.saveAction({
                ...action,
                count: nextCount
            });
        } catch (error) {
            console.error(`Could not update usage count for generated action "${action.name}":`, error);
        }
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

    private loadActionsSync(filePath: string): StoredAction[] {
        if (!fsSync.existsSync(filePath)) {
            return [];
        }

        try {
            const parsed = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter((entry): entry is StoredAction => {
                const result = StoredActionSchema.safeParse(entry);
                return result.success;
            });
        } catch (error) {
            console.warn(`Could not load generated actions from ${filePath}.`, error);
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

    private normalizeActionName(value: string): string {
        return value
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .replace(/_+/g, '_')
            .toLowerCase();
    }
}
