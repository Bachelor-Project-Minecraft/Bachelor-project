import { Bot } from "mineflayer";
import { Ollama } from "ollama";
import * as fs from "fs/promises";
import * as path from "path";
import { config } from "../config";
import { getActionGenerationPrompt } from "../utils/prompts";

interface StoredAction {
    name: string;
    description: string;
    code: string;
    argsDescription?: string[];
}

interface UseActionInput {
    name: string;
    description: string;
    args: string[];
}

type ActionExecutor = (bot: Bot, args: string[]) => Promise<string>;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
) => ActionExecutor;

export class GeneratedActionService {
    private readonly skillsPath = path.resolve(process.cwd(), 'src', 'skills', 'SKILLS.json');

    constructor(private readonly ollama: Ollama) {}

    public async useAction(bot: Bot, input: UseActionInput): Promise<string> {
        const storedActions = await this.loadActions();
        const matchedAction = this.findMatchingAction(storedActions, input.name, input.description);

        if (matchedAction) {
            return this.executeAction(bot, matchedAction.code, input.args);
        }

        for (let attempt = 1; attempt <= config.actions.generationRetries; attempt++) {
            const code = await this.generateActionCode(input);
            const compiledAction = this.compileAction(code);

            if (!compiledAction) {
                console.warn(`Generated action "${input.name}" failed syntax validation on attempt ${attempt}.`);
                continue;
            }

            try {
                const result = await this.runAction(compiledAction, bot, input.args);
                await this.saveAction(storedActions, {
                    name: input.name,
                    description: input.description,
                    code,
                    argsDescription: input.args.length > 0
                        ? input.args.map((_, index) => `arg${index + 1}`)
                        : undefined
                });
                return result;
            } catch (error) {
                console.error(`Generated action "${input.name}" failed during execution:`, error);
                return `<ACTION FAILED>: ${input.name}`;
            }
        }

        return `<NO ACTION>: Could not create ${input.name}.`;
    }

    private async loadActions(): Promise<StoredAction[]> {
        const content = await fs.readFile(this.skillsPath, 'utf8');
        return JSON.parse(content) as StoredAction[];
    }

    private findMatchingAction(actions: StoredAction[], name: string, description: string): StoredAction | undefined {
        const normalizedName = this.normalizeText(name);
        const exactMatch = actions.find((action) => this.normalizeText(action.name) === normalizedName);

        if (exactMatch) {
            return exactMatch;
        }

        const queryTokens = this.getTokens(`${name} ${description}`);
        let bestMatch: StoredAction | undefined;
        let bestScore = 0;
        let isTie = false;

        for (const action of actions) {
            const actionTokens = new Set(this.getTokens(action.name));
            const score = queryTokens.reduce((total, token) => total + (actionTokens.has(token) ? 1 : 0), 0);

            if (score > bestScore) {
                bestMatch = action;
                bestScore = score;
                isTie = false;
            } else if (score > 0 && score === bestScore) {
                isTie = true;
            }
        }

        if (isTie || bestScore === 0) {
            return undefined;
        }

        return bestMatch;
    }

    private async generateActionCode(input: UseActionInput): Promise<string> {
        const response = await this.ollama.generate({
            model: config.ollama.actionModel,
            prompt: getActionGenerationPrompt(input.name, input.description, input.args)
        });

        return response.response.trim();
    }

    private compileAction(code: string): ActionExecutor | null {
        try {
            return new AsyncFunction('bot', 'args', code);
        } catch {
            return null;
        }
    }

    private async executeAction(bot: Bot, code: string, args: string[]): Promise<string> {
        const compiledAction = this.compileAction(code);

        if (!compiledAction) {
            console.error('Stored action has invalid syntax and could not be executed.');
            return `<ACTION FAILED>: Stored action is invalid.`;
        }

        try {
            return await this.runAction(compiledAction, bot, args);
        } catch (error) {
            console.error('Stored action execution failed:', error);
            return `<ACTION FAILED>: Stored action threw an error.`;
        }
    }

    private async runAction(action: ActionExecutor, bot: Bot, args: string[]): Promise<string> {
        const result = await action(bot, args);
        return typeof result === 'string' ? result : String(result);
    }

    private async saveAction(existingActions: StoredAction[], newAction: StoredAction): Promise<void> {
        const nextActions = existingActions.filter(
            (action) => this.normalizeText(action.name) !== this.normalizeText(newAction.name)
        );
        nextActions.push(newAction);

        await fs.writeFile(this.skillsPath, `${JSON.stringify(nextActions, null, 2)}\n`, 'utf8');
    }

    private normalizeText(value: string): string {
        return value.trim().toLowerCase();
    }

    private getTokens(value: string): string[] {
        return Array.from(
            new Set(
                this.normalizeText(value)
                    .split(/[^a-z0-9]+/)
                    .filter((token) => token.length > 1)
            )
        );
    }
}
