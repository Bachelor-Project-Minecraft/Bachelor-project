import * as path from 'path';
import type { Bot } from 'mineflayer';
import { AutoLlmModels } from '../types';

export interface CancellableToken {
	cancelled: boolean;
}

export interface NamedInventoryItem {
	name: string;
	displayName?: string | null;
}

export interface StoredActionRecord {
	name: string;
	description: string;
	parameters: string;
	code: string;
	count: number;
}

export function roundNum(value: number): number {
	return Math.round(value * 10) / 10
}

export function getRuntimePath(...segments: string[]): string {
	return path.join(__dirname, '..', ...segments);
}

export function loadAutoLlmModels(): AutoLlmModels {
	const value = process.env.AUTO_LLM_MODELS_JSON;
	if (!value) {
		return {};
	}

	try {
		return JSON.parse(value) as AutoLlmModels;
	} catch (error) {
		throw new Error(`Invalid AUTO_LLM_MODELS_JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function normalizeText(value: string): string {
	return value.trim().toLowerCase();
}

export function normalizeActionName(value: string): string {
	return value
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.replace(/_+/g, '_')
		.toLowerCase();
}

export function normalizeMinecraftItemName(value: string): string {
	return normalizeText(value)
		.replace(/^minecraft:/, '')
		.replace(/\s+/g, '_');
}

export function findInventoryItemByName<T extends NamedInventoryItem>(
	items: T[],
	itemName: string
): T | undefined {
	const requestedName = normalizeMinecraftItemName(itemName);

	return items.find((item) => {
		const byName = normalizeMinecraftItemName(item.name) === requestedName;
		const byDisplayName = typeof item.displayName === 'string'
			&& normalizeMinecraftItemName(item.displayName) === requestedName;
		return byName || byDisplayName;
	});
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isBotAlive(bot: Bot): boolean {
	return bot.health > 0 && Boolean(bot.entity);
}

export function canContinueBotAction(bot: Bot, token: CancellableToken): boolean {
	return !token.cancelled && isBotAlive(bot);
}

export async function waitUntilWorldActive(
	bot: Bot,
	token: CancellableToken,
	pollMs = 50
): Promise<boolean> {
	while (!bot.physicsEnabled) {
		if (!canContinueBotAction(bot, token)) {
			return false;
		}

		await sleep(pollMs);
	}

	return canContinueBotAction(bot, token);
}

export async function waitForActiveMs(
	bot: Bot,
	token: CancellableToken,
	activeMs: number,
	pollMs = 50
): Promise<boolean> {
	let remaining = activeMs;

	while (remaining > 0) {
		if (!await waitUntilWorldActive(bot, token, pollMs)) {
			return false;
		}

		const chunk = Math.min(remaining, pollMs);
		const chunkStart = Date.now();
		await sleep(chunk);

		if (!canContinueBotAction(bot, token)) {
			return false;
		}

		if (!bot.physicsEnabled) {
			continue;
		}

		const chunkElapsed = Math.max(0, Date.now() - chunkStart);
		remaining -= Math.min(chunkElapsed, chunk);
	}

	return true;
}

export function stringifyJson(value: unknown, space?: number): string {
	try {
		return JSON.stringify(value, null, space) ?? String(value);
	} catch {
		return String(value);
	}
}

export function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return stringifyJson(error);
}

export function parseJsonOrOriginal(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

export function cloneJson<T>(value: T): T {
	if (value === undefined) {
		return value;
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

export function formatValidationIssues(
	issues: Array<{ path: PropertyKey[]; message: string }>
): string {
	return issues
		.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join(' | ');
}

export function isStoredAction(value: unknown): value is StoredActionRecord {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const action = value as Partial<StoredActionRecord>;
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
