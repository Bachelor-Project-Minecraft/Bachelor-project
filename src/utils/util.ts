import * as path from 'path';

export function roundNum(value: number): number {
	return Math.round(value * 10) / 10
}

export function getRuntimePath(...segments: string[]): string {
	return path.join(__dirname, '..', ...segments);
}
