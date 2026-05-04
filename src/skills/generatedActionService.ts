import { Bot } from "mineflayer";
import { Movements as PathfinderMovements, goals as PathfinderGoals } from "mineflayer-pathfinder";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { Vec3 as Vec3Constructor } from "vec3";
import { z } from "zod";
import { config } from "../config";
import { LLMClient } from "../llmClient";
import { GeneratedSkillDefinition, Skill } from "../types";
import { getActionGenerationPrompt } from "../utils/prompts";
import {
    formatValidationIssues,
    getRuntimePath,
    isStoredAction,
    normalizeActionName,
    normalizeText,
    stringifyError,
    stringifyJson
} from "../utils/util";
import { startBackgroundSkill } from "./backgroundSkillRunner";
import type { ActionExecutor, PreparedAction, RegisterGeneratedSkill, RunWhileWorldFrozen, StoredAction, UseActionInput } from "./types";
import {
    compileAction,
    compileParameters,
    failValidation,
    GeneratedSkillDefinitionResponseFormat,
    parseGeneratedSkillDefinition,
} from "./util";

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
                compiledParameters = compileParameters(action.parameters);
            } catch {
                console.warn(`Persisted action "${action.name}" could not be loaded because its parameters are invalid.`);
                continue;
            }

            let compiledAction: ActionExecutor;
            try {
                compiledAction = compileAction(action.code);
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
        const actionName = normalizeActionName(input.name);
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
            return `<NEW ACTION>: Created ${actionName} and executed it with ${stringifyJson(preparedAction.parsedExecutionArgs)}. ${result}`;
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
                validationFeedback = stringifyError(error);
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
            compiledParameters = compileParameters(generatedDefinition.parameters);
        } catch (error) {
            console.warn(`Generated action "${input.name}" failed schema validation on attempt ${attempt}: ${stringifyError(error)}`);
            failValidation('parameters', stringifyError(error), generatedDefinition);
        }

        let compiledAction: ActionExecutor;
        try {
            compiledAction = compileAction(generatedDefinition.code);
        } catch (error) {
            console.warn(`Generated action "${input.name}" failed syntax validation on attempt ${attempt}: ${stringifyError(error)}`);
            failValidation('code', stringifyError(error), generatedDefinition);
        }

        const parsedExecutionArgs = compiledParameters.safeParse(generatedDefinition.executionArgs);
        if (!parsedExecutionArgs.success) {
            const error = formatValidationIssues(parsedExecutionArgs.error.issues);
            console.warn(`Generated action "${input.name}" rejected its executionArgs on attempt ${attempt}: ${error}`);
            failValidation('executionArgs', error, generatedDefinition);
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
            failValidation('llm request', stringifyError(error), '');
        }

        return parseGeneratedSkillDefinition(response.content);
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
            (action) => normalizeText(action.name) !== normalizeText(newAction.name)
        );
        nextActions.push(newAction);

        await fs.writeFile(this.skillsPath, `${JSON.stringify(nextActions, null, 2)}\n`, 'utf8');
    }

    private async recordActionUse(action: StoredAction): Promise<void> {
        try {
            const existingActions = await this.loadActions();
            const existingAction = existingActions.find(
                (candidate) => normalizeText(candidate.name) === normalizeText(action.name)
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

            return parsed.filter(isStoredAction);
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

            return parsed.filter(isStoredAction);
        } catch (error) {
            console.warn(`Could not load generated actions from ${filePath}.`, error);
            return [];
        }
    }
}
