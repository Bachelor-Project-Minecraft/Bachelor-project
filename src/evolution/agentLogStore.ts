import * as fs from 'fs';
import * as path from 'path';
import { LlmCallLog, LlmMessage } from '../utils/types';
import { cloneJson, getRuntimePath } from '../utils/util';

export interface AgentLogRecord {
    agentName: string;
    startedAt: string;
    lastUpdatedAt: string;
    survivedMs: number;
    causeOfDeath: string | null;
    messages: LlmMessage[];
}

export interface AgentVerboseLogRecord extends AgentLogRecord {
    llmCalls: LlmCallLog[];
}

interface AgentCondensedMetrics {
    actionInvocations: Record<string, number>;
    hallucinations: number;
}

interface GenerationRunMetrics {
    runStartedAt: string;
    lastUpdatedAt: string;
    agents: Record<string, AgentCondensedMetrics>;
}

interface CondensedMetricsFile {
    generationLineStartedAt: string;
    runs: GenerationRunMetrics[];
}

export class AgentLogStore {
    private static stores: Set<AgentLogStore> = new Set();
    private static hooksRegistered = false;
    private static condensedMetrics: CondensedMetricsFile | null = null;
    private static condensedRunIndex = -1;
    private static condensedMetricsDirty = false;
    private static generationFinalized = false;

    private readonly startedAtMs: number;
    private readonly startedFrozenMs: number;
    private readonly conciseFilePath: string;
    private readonly verboseFilePath: string;
    private readonly agentName: string;
    private readonly isAgentAlive: () => boolean;
    private readonly getFrozenMs: () => number;
    private readonly conciseRecord: AgentLogRecord;
    private readonly verboseRecord: AgentVerboseLogRecord;

    constructor(
        agentName: string,
        isAgentAlive: () => boolean,
        getFrozenMs: () => number = () => 0
    ) {
        this.agentName = agentName;
        this.startedAtMs = Date.now();
        this.getFrozenMs = getFrozenMs;
        this.startedFrozenMs = this.getFrozenMs();
        this.isAgentAlive = isAgentAlive;
        this.conciseFilePath = path.join(AgentLogStore.getLogsDirectory(), `${agentName}.json`);
        this.verboseFilePath = path.join(AgentLogStore.getVerboseLogsDirectory(), `${agentName}.json`);

        const startedAt = new Date(this.startedAtMs).toISOString();
        this.conciseRecord = {
            agentName,
            startedAt,
            lastUpdatedAt: startedAt,
            survivedMs: 0,
            causeOfDeath: null,
            messages: []
        };
        this.verboseRecord = {
            ...this.conciseRecord,
            messages: [],
            llmCalls: []
        };

        this.ensureLogDirectory();
        this.writeRecords();
        AgentLogStore.ensureAgentMetrics(agentName);

        AgentLogStore.stores.add(this);
        AgentLogStore.registerShutdownHooks();
    }

    public static initializeCondensedMetrics(shouldContinueGenerationLine: boolean): void {
        const filePath = AgentLogStore.getCondensedMetricsFilePath();
        const nowIso = new Date().toISOString();
        let base: CondensedMetricsFile;

        if (!shouldContinueGenerationLine && fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
        }

        if (shouldContinueGenerationLine && fs.existsSync(filePath)) {
            const parsed = AgentLogStore.readCondensedMetrics(filePath);
            base = parsed ?? {
                generationLineStartedAt: nowIso,
                runs: []
            };
        } else {
            base = {
                generationLineStartedAt: nowIso,
                runs: []
            };
        }

        const nextRun: GenerationRunMetrics = {
            runStartedAt: nowIso,
            lastUpdatedAt: nowIso,
            agents: {}
        };

        base.runs.push(nextRun);
        AgentLogStore.condensedMetrics = base;
        AgentLogStore.condensedRunIndex = base.runs.length - 1;
        AgentLogStore.condensedMetricsDirty = false;
    }

    public static resetLogsDirectory(): void {
        for (const directory of [
            AgentLogStore.getLogsDirectory(),
            AgentLogStore.getVerboseLogsDirectory()
        ]) {
            fs.rmSync(directory, { recursive: true, force: true });
            fs.mkdirSync(directory, { recursive: true });
        }
    }

    public appendMessage(message: LlmMessage): void {
        if (message.role === 'system') {
            return;
        }

        this.conciseRecord.messages.push(this.toConciseMessage(message));
        this.verboseRecord.messages.push(cloneJson(message));
        this.writeRecords();
    }

    public appendLlmCall(call: LlmCallLog): void {
        this.verboseRecord.llmCalls.push(cloneJson(call));
        this.writeVerboseRecord();
    }

    public recordCauseOfDeath(causeOfDeath: string): void {
        const normalizedCauseOfDeath = causeOfDeath.trim();
        this.conciseRecord.causeOfDeath = normalizedCauseOfDeath || null;
        this.verboseRecord.causeOfDeath = normalizedCauseOfDeath || null;
        this.writeRecords();
    }

    public recordActionInvocation(actionName: string): void {
        const metrics = AgentLogStore.ensureAgentMetrics(this.agentName);
        const key = actionName.trim() || '<empty_action_name>';
        metrics.actionInvocations[key] = (metrics.actionInvocations[key] ?? 0) + 1;
        AgentLogStore.touchCurrentRun();
        AgentLogStore.condensedMetricsDirty = true;
        AgentLogStore.writeCondensedMetrics();
    }

    public recordHallucination(): void {
        const metrics = AgentLogStore.ensureAgentMetrics(this.agentName);
        metrics.hallucinations += 1;
        AgentLogStore.touchCurrentRun();
        AgentLogStore.condensedMetricsDirty = true;
        AgentLogStore.writeCondensedMetrics();
    }

    public flushSurvivalTimeOnShutdown(): void {
        if (!this.isAgentAlive()) {
            return;
        }

        this.writeRecords();
    }

    private ensureLogDirectory(): void {
        fs.mkdirSync(path.dirname(this.conciseFilePath), { recursive: true });
        fs.mkdirSync(path.dirname(this.verboseFilePath), { recursive: true });
    }

    private static getLogsDirectory(): string {
        return getRuntimePath('evolution', 'logs');
    }

    private static getVerboseLogsDirectory(): string {
        return getRuntimePath('evolution', 'logsVerbose');
    }

    private static getGenerationsFilePath(): string {
        return getRuntimePath('evolution', 'generations.txt');
    }

    private static getCondensedMetricsFilePath(): string {
        return getRuntimePath('evolution', 'condensedMetrics.txt');
    }

    private writeRecords(): void {
        this.writeConciseRecord();
        this.writeVerboseRecord();
    }

    private writeConciseRecord(): void {
        const now = Date.now();
        this.updateLifecycle(this.conciseRecord, now);
        fs.writeFileSync(this.conciseFilePath, JSON.stringify(this.conciseRecord, null, 2), 'utf8');
    }

    private writeVerboseRecord(): void {
        const now = Date.now();
        this.updateLifecycle(this.verboseRecord, now);
        fs.writeFileSync(this.verboseFilePath, JSON.stringify(this.verboseRecord, null, 2), 'utf8');
    }

    private updateLifecycle(record: AgentLogRecord, now: number): void {
        const elapsedMs = now - this.startedAtMs;
        const frozenSinceStartMs = Math.max(0, this.getFrozenMs() - this.startedFrozenMs);

        record.lastUpdatedAt = new Date(now).toISOString();
        record.survivedMs = Math.max(0, elapsedMs - frozenSinceStartMs);
    }

    private toConciseMessage(message: LlmMessage): LlmMessage {
        const clonedMessage = cloneJson(message);
        delete clonedMessage.thinking;
        return clonedMessage;
    }

    private static registerShutdownHooks(): void {
        if (AgentLogStore.hooksRegistered) {
            return;
        }

        AgentLogStore.hooksRegistered = true;

        process.on('SIGINT', AgentLogStore.handleSignal);
        process.on('SIGTERM', AgentLogStore.handleSignal);
    }

    public static finalizeGeneration(): void {
        if (AgentLogStore.generationFinalized) {
            return;
        }

        AgentLogStore.generationFinalized = true;

        for (const store of AgentLogStore.stores) {
            store.flushSurvivalTimeOnShutdown();
        }

        AgentLogStore.touchCurrentRun();
        if (AgentLogStore.condensedMetricsDirty) {
            AgentLogStore.writeCondensedMetrics();
        }
        AgentLogStore.appendGenerationSummary();
    }

    private static appendGenerationSummary(): void {
        const filePath = AgentLogStore.getGenerationsFilePath();
        const line = Array.from(AgentLogStore.stores)
            .map((store) => `${store.conciseRecord.agentName}: ${store.conciseRecord.survivedMs}`)
            .join(', ');

        if (!line) {
            return;
        }

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
        const nextContent = existingContent ? `${existingContent}\n${line}` : line;
        fs.writeFileSync(filePath, nextContent, 'utf8');
    }

    private static readCondensedMetrics(filePath: string): CondensedMetricsFile | null {
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<CondensedMetricsFile>;
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            if (typeof parsed.generationLineStartedAt !== 'string' || !Array.isArray(parsed.runs)) {
                return null;
            }

            const sanitizedRuns: GenerationRunMetrics[] = parsed.runs
                .map((run) => {
                    if (!run || typeof run !== 'object') {
                        return null;
                    }

                    const candidate = run as Partial<GenerationRunMetrics>;
                    if (typeof candidate.runStartedAt !== 'string' || typeof candidate.lastUpdatedAt !== 'string') {
                        return null;
                    }

                    const rawAgents = candidate.agents;
                    if (!rawAgents || typeof rawAgents !== 'object') {
                        return null;
                    }

                    const agents: Record<string, AgentCondensedMetrics> = {};
                    for (const [agentName, value] of Object.entries(rawAgents as Record<string, unknown>)) {
                        if (!value || typeof value !== 'object') {
                            continue;
                        }

                        const metricsValue = value as Partial<AgentCondensedMetrics>;
                        const actionInvocations = metricsValue.actionInvocations;
                        const hallucinations = metricsValue.hallucinations;

                        if (!actionInvocations || typeof actionInvocations !== 'object' || typeof hallucinations !== 'number') {
                            continue;
                        }

                        const normalizedActionInvocations: Record<string, number> = {};
                        for (const [actionName, count] of Object.entries(actionInvocations as Record<string, unknown>)) {
                            if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
                                normalizedActionInvocations[actionName] = Math.floor(count);
                            }
                        }

                        agents[agentName] = {
                            actionInvocations: normalizedActionInvocations,
                            hallucinations: Math.max(0, Math.floor(hallucinations))
                        };
                    }

                    return {
                        runStartedAt: candidate.runStartedAt,
                        lastUpdatedAt: candidate.lastUpdatedAt,
                        agents
                    };
                })
                .filter((run): run is GenerationRunMetrics => run !== null);

            return {
                generationLineStartedAt: parsed.generationLineStartedAt,
                runs: sanitizedRuns
            };
        } catch {
            return null;
        }
    }

    private static getCurrentRun(): GenerationRunMetrics {
        if (!AgentLogStore.condensedMetrics || AgentLogStore.condensedRunIndex < 0) {
            AgentLogStore.initializeCondensedMetrics(true);
        }

        const metrics = AgentLogStore.condensedMetrics as CondensedMetricsFile;
        return metrics.runs[AgentLogStore.condensedRunIndex];
    }

    private static ensureAgentMetrics(agentName: string): AgentCondensedMetrics {
        const currentRun = AgentLogStore.getCurrentRun();
        if (!currentRun.agents[agentName]) {
            currentRun.agents[agentName] = {
                actionInvocations: {},
                hallucinations: 0
            };
            AgentLogStore.touchCurrentRun();
        }

        return currentRun.agents[agentName];
    }

    private static touchCurrentRun(): void {
        const currentRun = AgentLogStore.getCurrentRun();
        currentRun.lastUpdatedAt = new Date().toISOString();
    }

    private static writeCondensedMetrics(): void {
        const metrics = AgentLogStore.condensedMetrics;
        if (!metrics || !AgentLogStore.condensedMetricsDirty) {
            return;
        }

        const filePath = AgentLogStore.getCondensedMetricsFilePath();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
    }

    private static handleSignal = (signal: NodeJS.Signals): void => {
        AgentLogStore.finalizeGeneration();

        process.removeListener(signal, AgentLogStore.handleSignal);
        process.kill(process.pid, signal);
    };
}
