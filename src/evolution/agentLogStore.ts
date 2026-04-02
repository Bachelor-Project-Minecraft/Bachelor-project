import * as fs from 'fs';
import * as path from 'path';
import { LlmMessage } from '../types';
import { getRuntimePath } from '../utils/util';

export interface AgentLogRecord {
    agentName: string;
    startedAt: string;
    lastUpdatedAt: string;
    survivedMs: number;
    messages: LlmMessage[];
}

export class AgentLogStore {
    private static stores: Set<AgentLogStore> = new Set();
    private static hooksRegistered = false;

    private readonly startedAtMs: number;
    private readonly filePath: string;
    private readonly isAgentAlive: () => boolean;
    private readonly record: AgentLogRecord;

    constructor(agentName: string, isAgentAlive: () => boolean) {
        this.startedAtMs = Date.now();
        this.isAgentAlive = isAgentAlive;
        this.filePath = path.join(AgentLogStore.getLogsDirectory(), `${agentName}.json`);

        const startedAt = new Date(this.startedAtMs).toISOString();
        this.record = {
            agentName,
            startedAt,
            lastUpdatedAt: startedAt,
            survivedMs: 0,
            messages: []
        };

        this.ensureLogDirectory();
        this.writeRecord();

        AgentLogStore.stores.add(this);
        AgentLogStore.registerShutdownHooks();
    }

    public static resetLogsDirectory(): void {
        const logsDirectory = AgentLogStore.getLogsDirectory();
        fs.rmSync(logsDirectory, { recursive: true, force: true });
        fs.mkdirSync(logsDirectory, { recursive: true });
    }

    public appendMessage(message: LlmMessage): void {
        if (message.role === 'system') {
            return;
        }

        this.record.messages.push(this.cloneMessage(message));
        this.writeRecord();
    }

    public flushSurvivalTimeOnShutdown(): void {
        if (!this.isAgentAlive()) {
            return;
        }

        this.writeRecord();
    }

    private ensureLogDirectory(): void {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }

    private static getLogsDirectory(): string {
        return getRuntimePath('evolution', 'logs');
    }

    private static getGenerationsFilePath(): string {
        return getRuntimePath('evolution', 'generations.txt');
    }

    private writeRecord(): void {
        const now = Date.now();
        this.record.lastUpdatedAt = new Date(now).toISOString();
        this.record.survivedMs = now - this.startedAtMs;
        fs.writeFileSync(this.filePath, JSON.stringify(this.record, null, 2), 'utf8');
    }

    private cloneMessage(message: LlmMessage): LlmMessage {
        return JSON.parse(JSON.stringify(message)) as LlmMessage;
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
            .map((store) => `${store.record.agentName}: ${store.record.survivedMs}`)
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
