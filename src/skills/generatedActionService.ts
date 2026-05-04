import { Bot } from "mineflayer";
import { Movements as PathfinderMovements, goals as PathfinderGoals } from "mineflayer-pathfinder";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { Vec3 as Vec3Constructor } from "vec3";
import { z } from "zod";
import { config } from "../config";
import { LLMClient } from "../llmClient";
import { GeneratedSkillDefinition, JsonValue, JsonValueSchema, Skill } from "../types";
import { getActionGenerationPrompt } from "../utils/prompts";
import { getRuntimePath } from "../utils/util";
import { startBackgroundSkill } from "./backgroundSkillRunner";

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
    Vec3: typeof Vec3Constructor,
    startBackgroundSkill: StartBackgroundSkill
) => Promise<string>;

type StartBackgroundSkill = typeof startBackgroundSkill;

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
    executionArgs: z.record(z.string(), JsonValueSchema),
    code: z.string().min(1)
});

const GeneratedSkillDefinitionResponseFormat = {
    type: 'object',
    properties: {
        parameters: {
            type: 'string',
            description: 'JavaScript source for the generated action parameter schema. It must be a root z.object(...) expression.'
        },
        executionArgs: {
            type: 'object',
            description: 'Named argument values for the first immediate execution of the generated action. These must validate against parameters.',
            additionalProperties: true
        },
        code: {
            type: 'string',
            description: 'JavaScript source for the body of the async generated action function.'
        }
    },
    required: ['parameters', 'executionArgs', 'code'],
    additionalProperties: false
};

interface PreparedAction {
    generatedDefinition: GeneratedSkillDefinition;
    compiledAction: ActionExecutor;
    compiledParameters: z.ZodObject<any>;
    parsedExecutionArgs: unknown;
}

export class GeneratedActionService {
    private readonly skillsPath = getRuntimePath('skills', 'generatedSkills.json');
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
            let compiledParameters: z.ZodObject<any>;
            try {
                compiledParameters = this.compileParameters(action.parameters);
            } catch {
                console.warn(`Persisted action "${action.name}" could not be loaded because its parameters are invalid.`);
                continue;
            }

            let compiledAction: ActionExecutor;
            try {
                compiledAction = this.compileAction(action.code);
            } catch {
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
        const preparedAction = await this.runWhileWorldFrozen(async () =>
            this.prepareActionWithRetries(normalizedInput)
        );

        if (!preparedAction) {
            return `<NO ACTION>: Could not create ${actionName}.`;
        }

        try {
            console.log("Started action execution for:", actionName);
            const result = await this.runAction(
                preparedAction.compiledAction,
                bot,
                preparedAction.parsedExecutionArgs
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
                return `<NO ACTION>: Could not register ${actionName}.`;
            }

            try {
                await this.saveAction(storedAction);
                console.log("Saved action:", actionName);
            } catch (error) {
                console.error(`Generated action "${actionName}" was registered but could not be written to generatedSkills.json:`, error);
            }
            return `<NEW ACTION>: Created ${actionName} and executed it with ${this.stringifyJson(preparedAction.parsedExecutionArgs)}. ${result}`;
        } catch (error) {
            console.error(`Generated action "${actionName}" failed during execution:`, error);
            return `<NO ACTION>: ${actionName} failed during execution.`;
        }
    }

    private async prepareActionWithRetries(input: UseActionInput): Promise<PreparedAction | null> {
        let validationFeedback = '';

        for (let attempt = 1; attempt <= config.actions.generationRetries; attempt++) {
            try {
                return await this.prepareAction(input, attempt, validationFeedback);
            } catch (error) {
                validationFeedback = this.stringifyError(error);
                console.warn(`Generated action "${input.name}" failed validation on attempt ${attempt}.`);
                console.error(`Validation feedback for "${input.name}":`, validationFeedback);
            }
        }

        return null;
    }

    private async prepareAction(input: UseActionInput, attempt: number, validationFeedback: string): Promise<PreparedAction> {
        console.log("Started code generation for action:", input.name);
        const generatedDefinition = await this.generateActionDefinition(input, validationFeedback);
        console.log("Finished code generation for action:", input.name);
        return this.prepareGeneratedDefinition(input, attempt, generatedDefinition);
    }

    private prepareGeneratedDefinition(
        input: UseActionInput,
        attempt: number,
        generatedDefinition: GeneratedSkillDefinition
    ): PreparedAction {
        let compiledParameters: z.ZodObject<any>;
        try {
            compiledParameters = this.compileParameters(generatedDefinition.parameters);
        } catch (error) {
            console.warn(`Generated action "${input.name}" failed schema validation on attempt ${attempt}: ${this.stringifyError(error)}`);
            this.failValidation('parameters', this.stringifyError(error), generatedDefinition);
        }

        let compiledAction: ActionExecutor;
        try {
            compiledAction = this.compileAction(generatedDefinition.code);
        } catch (error) {
            console.warn(`Generated action "${input.name}" failed syntax validation on attempt ${attempt}: ${this.stringifyError(error)}`);
            this.failValidation('code', this.stringifyError(error), generatedDefinition);
        }

        const parsedExecutionArgs = compiledParameters.safeParse(generatedDefinition.executionArgs);
        if (!parsedExecutionArgs.success) {
            const error = parsedExecutionArgs.error.issues
                .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                .join(' | ');
            console.warn(`Generated action "${input.name}" rejected its executionArgs on attempt ${attempt}: ${error}`);
            this.failValidation('executionArgs', error, generatedDefinition);
        }

        return {
            generatedDefinition,
            compiledAction,
            compiledParameters,
            parsedExecutionArgs: parsedExecutionArgs.data
        };
    }

    private async generateActionDefinition(
        input: UseActionInput,
        validationFeedback: string
    ): Promise<GeneratedSkillDefinition> {
        const prompt = getActionGenerationPrompt(
            input.name,
            input.description,
            input.args,
            this.getEnvironmentSnapshot(),
            validationFeedback
        );

        let response;
        try {
            response = await this.llm.generate({
                prompt,
                jsonSchema: GeneratedSkillDefinitionResponseFormat,
                useActionModel: true
            });
        } catch (error) {
            this.failValidation('llm request', this.stringifyError(error), '');
        }

        return this.parseGeneratedSkillDefinition(response.content);
    }

    private compileParameters(schemaSource: string): z.ZodObject<any> {
        if (!/^z\.object\s*\(/.test(schemaSource.trim())) {
            throw new Error('parameters must start with z.object(...)');
        }

        const compiled = new Function('z', `"use strict"; return (${schemaSource});`)(z);
        if (!(compiled instanceof z.ZodObject)) {
            throw new Error('parameters compiled but did not return a Zod object');
        }

        return compiled;
    }

    private compileAction(code: string): ActionExecutor {
        return new AsyncFunction('bot', 'args', 'Movements', 'goals', 'Vec3', 'startBackgroundSkill', code);
    }

    private async runAction(action: ActionExecutor, bot: Bot, args: unknown): Promise<string> {
        const result = await action(bot, args, PathfinderMovements, PathfinderGoals, Vec3Constructor, startBackgroundSkill);
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
            console.warn('Could not load generatedSkills.json audit log, starting from an empty list.', error);
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

    private parseGeneratedSkillDefinition(rawResponse: string): GeneratedSkillDefinition {
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawResponse);
        } catch (error) {
            this.failValidation('metadata', `Response was not valid JSON: ${this.stringifyError(error)}`, rawResponse);
        }

        const result = GeneratedSkillDefinitionSchema.safeParse(parsed);
        if (result.success) {
            return result.data;
        }

        this.failValidation(
            'metadata',
            result.error.issues
                .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                .join(' | '),
            parsed
        );
    }

    private normalizeText(value: string): string {
        return value.trim().toLowerCase();
    }

    private stringifyJson(value: unknown): string {
        try {
            return JSON.stringify(value) ?? String(value);
        } catch {
            return String(value);
        }
    }

    private stringifyError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return this.stringifyJson(error);
    }

    private failValidation(stage: string, error: string, generatedOutput: unknown): never {
        throw new Error(this.formatValidationFeedback(stage, error, generatedOutput));
    }

    private formatValidationFeedback(stage: string, error: string, generatedOutput: unknown): string {
        const output = this.stringifyJson(generatedOutput);
        const maxOutputLength = 12000;
        const clippedOutput = output.length > maxOutputLength
            ? `${output.slice(0, maxOutputLength)}... <truncated>`
            : output;

        return [
            `Stage: ${stage}`,
            `Error: ${error}`,
            'Previous output:',
            clippedOutput,
            'Return a complete corrected JSON object with parameters, executionArgs, and code.',
            'The parameters field must be JavaScript that compiles when evaluated as return (<parameters>).',
            'The code field must be valid JavaScript for the body of an async function; avoid malformed tokens such as =;, <;, or <;=.'
        ].join('\n');
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
