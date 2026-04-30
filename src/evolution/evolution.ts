import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { LLMClient } from '../llmClient';
import { getKnowledgebaseUpdatePrompt } from '../utils/prompts';
import { getRuntimePath } from '../utils/util';
import { AgentLogRecord } from './agentLogStore';

interface StoredAction {
    name: string;
    description: string;
    parameters: string;
    code: string;
    count: number;
}

export class Evolution {
    public static getKnowledgebase(): string {
        const filePath = Evolution.getKnowledgebaseFilePath();
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
    }

    public static async updateKnowledgebase(): Promise<void> {
        try {
            const logs = Evolution.getStoredLogs();
            if (logs.length === 0) {
                return;
            }

            const sortedLogs = [...logs].sort((left, right) => left.survivedMs - right.survivedMs);
            const shortestLog = sortedLogs[0];
            const longestLog = sortedLogs[sortedLogs.length - 1];

            const llm = new LLMClient();
            console.log("Started knowledgebase update");
            const nextKnowledgebase = await llm.generate({
                prompt: getKnowledgebaseUpdatePrompt(
                    Evolution.getKnowledgebase(),
                    Evolution.getGenerationComparison(),
                    longestLog.survivedMs,
                    JSON.stringify(longestLog.messages, null, 2),
                    shortestLog.survivedMs,
                    JSON.stringify(shortestLog.messages, null, 2)
                ),
                useCultureModel: true
            });
            console.log("Finished knowledgebase update");
            const content = nextKnowledgebase.content.trim();

            if (!content) {
                return;
            }

            const filePath = Evolution.getKnowledgebaseFilePath();
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
        } catch (error) {
            console.error('Failed to update knowledgebase:', error);
        }
    }

    public static updateGenerationSkills(): void {
        try {
            const filePath = Evolution.getGenerationSkillsFilePath();
            const existingSkills = Evolution.getStoredActions(filePath);
            const existingSkillNames = new Set(existingSkills.map((skill) => Evolution.normalizeText(skill.name)));
            const newSkills = Evolution.getStoredActions(getRuntimePath('skills', 'SKILLS.json'))
                .filter((skill) => skill.count >= config.actions.persistSkillMinUseCount)
                .filter((skill) => !existingSkillNames.has(Evolution.normalizeText(skill.name)))
                .sort((left, right) => right.count - left.count)
                .slice(0, 2);
            const skills = [...existingSkills, ...newSkills];

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, `${JSON.stringify(skills, null, 2)}\n`, 'utf8');
        } catch (error) {
            console.error('Failed to update generation skills:', error);
        }
    }

    public static hasExistingGenerationLine(): boolean {
        return Evolution.getGenerationLineFilePaths().some((filePath) => fs.existsSync(filePath));
    }

    public static resetGenerationLine(): void {
        for (const filePath of Evolution.getGenerationLineFilePaths()) {
            fs.rmSync(filePath, { force: true });
        }
    }

    private static getLogsDirectory(): string {
        return getRuntimePath('evolution', 'logs');
    }

    private static getGenerationsFilePath(): string {
        return getRuntimePath('evolution', 'generations.txt');
    }

    private static getKnowledgebaseFilePath(): string {
        return getRuntimePath('evolution', 'knowledgebase.txt');
    }

    private static getGenerationSkillsFilePath(): string {
        return getRuntimePath('evolution', 'generationSkills.json');
    }

    private static getCondensedMetricsFilePath(): string {
        return getRuntimePath('evolution', 'condensedMetrics.txt');
    }

    private static getGenerationLineFilePaths(): string[] {
        return [
            Evolution.getGenerationsFilePath(),
            Evolution.getKnowledgebaseFilePath(),
            Evolution.getGenerationSkillsFilePath(),
            Evolution.getCondensedMetricsFilePath()
        ];
    }

    private static getStoredActions(filePath: string): StoredAction[] {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter(Evolution.isStoredAction);
        } catch {
            return [];
        }
    }

    private static normalizeText(value: string): string {
        return value.trim().toLowerCase();
    }

    private static isStoredAction(value: unknown): value is StoredAction {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const action = value as Partial<StoredAction>;
        const count = action.count;
        return typeof action.name === 'string'
            && /^[A-Za-z][A-Za-z0-9_]*$/.test(action.name)
            && typeof action.description === 'string'
            && action.description.length > 0
            && typeof action.parameters === 'string'
            && action.parameters.length > 0
            && typeof action.code === 'string'
            && action.code.length > 0
            && typeof count === 'number'
            && Number.isInteger(count)
            && count >= 0;
    }

    private static getStoredLogs(): AgentLogRecord[] {
        const logsDirectory = Evolution.getLogsDirectory();
        if (!fs.existsSync(logsDirectory)) {
            return [];
        }

        return fs.readdirSync(logsDirectory)
            .filter((fileName) => fileName.endsWith('.json'))
            .map((fileName) => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(logsDirectory, fileName), 'utf8')) as AgentLogRecord;
                } catch {
                    return null;
                }
            })
            .filter((record): record is AgentLogRecord => record !== null);
    }

    private static getGenerationComparison(): string {
        const filePath = Evolution.getGenerationsFilePath();
        if (!fs.existsSync(filePath)) {
            return 'No generation comparison is available yet.';
        }

        const lines = fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            return 'No generation comparison is available yet.';
        }

        const previousAverage = Evolution.getAverageSurvival(lines[lines.length - 2]);
        const currentAverage = Evolution.getAverageSurvival(lines[lines.length - 1]);

        if (currentAverage > previousAverage) {
            return 'The most recent generation survived longer on average than the previous generation.';
        }

        if (currentAverage < previousAverage) {
            return 'The most recent generation survived less time on average than the previous generation.';
        }

        return 'The most recent generation survived the same average time as the previous generation.';
    }

    private static getAverageSurvival(generationLine: string): number {
        const survivalTimes = generationLine
            .split(', ')
            .map((entry) => Number(entry.split(': ')[1]))
            .filter((value) => Number.isFinite(value));

        if (survivalTimes.length === 0) {
            return 0;
        }

        return survivalTimes.reduce((sum, value) => sum + value, 0) / survivalTimes.length;
    }
}
