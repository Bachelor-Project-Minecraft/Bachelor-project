import { Bot } from "mineflayer";
import { Movements as PathfinderMovements, goals as PathfinderGoals } from "mineflayer-pathfinder";
import { Ollama } from "ollama";
import * as fs from "fs/promises";
import * as path from "path";
import { Vec3 as Vec3Constructor } from "vec3";
import { z } from "zod";
import { config } from "../config";
import { GeneratedSkillDefinition, GeneratedSkillParameterDefinition, JsonValue, Skill } from "../types";
import { getActionGenerationPrompt } from "../utils/prompts";

interface StoredAction {
    name: string;
    description: string;
    parameters: GeneratedSkillParameterDefinition[];
    code: string;
}

interface UseActionInput {
    name: string;
    description: string;
    args: JsonValue[];
}

type ActionExecutor = (
    bot: Bot,
    args: JsonValue[],
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

const GeneratedSkillParameterSchema = z.object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    description: z.string().min(1)
});

const GeneratedSkillDefinitionSchema = z.object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    description: z.string().min(1),
    parameters: z.array(GeneratedSkillParameterSchema)
        .refine(
            (parameters) => new Set(parameters.map((parameter) => parameter.name.toLowerCase())).size === parameters.length,
            'Parameter names must be unique.'
        ),
    code: z.string().min(1)
});

const GeneratedSkillDefinitionResponseFormat = z.toJSONSchema(GeneratedSkillDefinitionSchema);

export class GeneratedActionService {
    private readonly skillsPath = path.resolve(process.cwd(), 'src', 'skills', 'SKILLS.json');

    constructor(
        private readonly ollama: Ollama,
        private readonly createGeneratedSkill: (
            definition: GeneratedSkillDefinition,
            executeAction: (bot: Bot, args: JsonValue[]) => Promise<string>
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

            const compiledAction = this.compileAction(generatedDefinition.code);

            if (!compiledAction) {
                console.warn(`Generated action "${input.name}" failed syntax validation on attempt ${attempt}.`);
                continue;
            }

            try {
                console.log("Started action execution for:", generatedDefinition.name);
                const result = await this.runAction(compiledAction, bot, input.args);
                console.log("Finished action execution for:", generatedDefinition.name);

                const generatedSkill = this.createGeneratedSkill(
                    generatedDefinition,
                    (runtimeBot, runtimeArgs) => this.runAction(compiledAction, runtimeBot, runtimeArgs)
                );
                const registrationResult = this.registerGeneratedSkill(generatedSkill);
                if (!registrationResult.success) {
                    console.warn(`Generated action "${generatedDefinition.name}" could not be registered: ${registrationResult.error}`);
                    continue;
                }

                try {
                    await this.saveAction({
                        name: generatedDefinition.name,
                        description: generatedDefinition.description,
                        parameters: generatedDefinition.parameters,
                        code: generatedDefinition.code
                    });
                    console.log("Saved action:", generatedDefinition.name);
                } catch (error) {
                    console.error(`Generated action "${generatedDefinition.name}" was registered but could not be written to SKILLS.json:`, error);
                }
                return result;
            } catch (error) {
                console.error(`Generated action "${generatedDefinition.name}" failed during execution:`, error);
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

        const response = await this.ollama.generate({
            model: config.ollama.actionModel,
            prompt,
            format: GeneratedSkillDefinitionResponseFormat,
            think: false
        });

        return this.parseGeneratedSkillDefinition(response.response);
    }

    private compileAction(code: string): ActionExecutor | null {
        try {
            return new AsyncFunction('bot', 'args', 'Movements', 'goals', 'Vec3', code);
        } catch {
            return null;
        }
    }

    private async runAction(action: ActionExecutor, bot: Bot, args: JsonValue[]): Promise<string> {
        const result = await action(bot, args, PathfinderMovements, PathfinderGoals, Vec3Constructor);
        return typeof result === 'string' ? result : String(result);
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
            return Array.isArray(parsed) ? parsed as StoredAction[] : [];
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
