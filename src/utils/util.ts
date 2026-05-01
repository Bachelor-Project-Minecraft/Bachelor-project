import * as path from 'path';
import { AutoLlmModels } from '../types';

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
