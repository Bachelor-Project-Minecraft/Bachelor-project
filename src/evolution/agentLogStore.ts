import * as fs from 'fs';
import * as path from 'path';
import { LlmCallLog, LlmMessage } from '../types';
import { getRuntimePath } from '../utils/util';

export interface AgentLogRecord {
    agentName: string;
    startedAt: string;
    lastUpdatedAt: string;
    survivedMs: number;
    messages: LlmMessage[];
}

export interface AgentVerboseLogRecord extends AgentLogRecord {
    llmCalls: LlmCallLog[];
}

export class AgentLogStore {
    private static stores: Set<AgentLogStore> = new Set();
    private static hooksRegistered = false;

    private readonly startedAtMs: number;
    private readonly conciseFilePath: string;
    private readonly verboseFilePath: string;
    private readonly isAgentAlive: () => boolean;
    private readonly conciseRecord: AgentLogRecord;
    private readonly verboseRecord: AgentVerboseLogRecord;

    constructor(agentName: string, isAgentAlive: () => boolean) {
        this.startedAtMs = Date.now();
        this.isAgentAlive = isAgentAlive;
        this.conciseFilePath = path.join(AgentLogStore.getLogsDirectory(), `${agentName}.json`);
        this.verboseFilePath = path.join(AgentLogStore.getVerboseLogsDirectory(), `${agentName}.json`);

        const startedAt = new Date(this.startedAtMs).toISOString();
        this.conciseRecord = {
            agentName,
            startedAt,
            lastUpdatedAt: startedAt,
            survivedMs: 0,
            messages: []
        };
        this.verboseRecord = {
            ...this.conciseRecord,
            messages: [],
            llmCalls: []
        };

        this.ensureLogDirectory();
        this.writeRecords();

        AgentLogStore.stores.add(this);
        AgentLogStore.registerShutdownHooks();
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
        this.verboseRecord.messages.push(this.cloneForLog(message));
        this.writeRecords();
    }

    public appendLlmCall(call: LlmCallLog): void {
        this.verboseRecord.llmCalls.push(this.cloneForLog(call));
        this.writeVerboseRecord();
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
        record.lastUpdatedAt = new Date(now).toISOString();
        record.survivedMs = now - this.startedAtMs;
    }

    private cloneForLog<T>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
    }

    private toConciseMessage(message: LlmMessage): LlmMessage {
        const clonedMessage = this.cloneForLog(message);
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

    private static handleSignal = (signal: NodeJS.Signals): void => {
        for (const store of AgentLogStore.stores) {
            store.flushSurvivalTimeOnShutdown();
        }

        AgentLogStore.appendGenerationSummary();

        process.removeListener(signal, AgentLogStore.handleSignal);
        process.kill(process.pid, signal);
    };
}
