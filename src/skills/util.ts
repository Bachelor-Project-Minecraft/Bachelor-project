import { z } from "zod";
import { GeneratedSkillDefinition, JsonValueSchema } from "../types";
import {
    formatValidationIssues,
    isStoredAction,
    normalizeActionName,
    normalizeText,
    stringifyError,
    stringifyJson
} from "../utils/util";
import type { ActionExecutor } from "./types";

export {
    isStoredAction,
    normalizeActionName,
    normalizeText,
    stringifyError,
    stringifyJson
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
) => ActionExecutor;

const GeneratedSkillDefinitionSchema = z.object({
    parameters: z.string().min(1),
    executionArgs: z.record(z.string(), JsonValueSchema),
    code: z.string().min(1)
});

export const GeneratedSkillDefinitionResponseFormat = {
    type: 'object',
    properties: {
        parameters: {
            type: 'string',
            description: 'JavaScript source for the generated action parameter schema. It must be a root z.object(...) expression.'
        },
        executionArgs: {
            type: 'object',
            description: 'Named argument values for the first immediate execution of the generated action. These must validate against parameters.',
            additionalProperties: true
        },
        code: {
            type: 'string',
            description: 'JavaScript source for the body of the async generated action function.'
        }
    },
    required: ['parameters', 'executionArgs', 'code'],
    additionalProperties: false
};

export function compileParameters(schemaSource: string): z.ZodObject<any> {
    if (!/^z\.object\s*\(/.test(schemaSource.trim())) {
        throw new Error('parameters must start with z.object(...)');
    }

    const compiled = new Function('z', `"use strict"; return (${schemaSource});`)(z);
    if (!(compiled instanceof z.ZodObject)) {
        throw new Error('parameters compiled but did not return a Zod object');
    }

    return compiled;
}

export function compileAction(code: string): ActionExecutor {
    return new AsyncFunction(
        'bot',
        'args',
        'Movements',
        'goals',
        'Vec3',
        'startBackgroundSkill',
        'waitUntilWorldActive',
        'waitForActiveMs',
        'canContinueBotAction',
        code
    );
}

export function parseGeneratedSkillDefinition(rawResponse: string): GeneratedSkillDefinition {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawResponse);
    } catch (error) {
        failValidation('metadata', `Response was not valid JSON: ${stringifyError(error)}`, rawResponse);
    }

    const result = GeneratedSkillDefinitionSchema.safeParse(parsed);
    if (result.success) {
        return result.data;
    }

    failValidation(
        'metadata',
        formatValidationIssues(result.error.issues),
        parsed
    );
}

export function failValidation(stage: string, error: string, generatedOutput: unknown): never {
    throw new Error(formatValidationFeedback(stage, error, generatedOutput));
}

function formatValidationFeedback(stage: string, error: string, generatedOutput: unknown): string {
    const output = stringifyJson(generatedOutput);
    const maxOutputLength = 12000;
    const clippedOutput = output.length > maxOutputLength
        ? `${output.slice(0, maxOutputLength)}... <truncated>`
        : output;

    return [
        `Stage: ${stage}`,
        `Error: ${error}`,
        'Previous output:',
        clippedOutput,
        'Return a complete corrected JSON object with parameters, executionArgs, and code.',
        'The parameters field must be JavaScript that compiles when evaluated as return (<parameters>).',
        'The code field must be valid JavaScript for the body of an async function; avoid malformed tokens such as =;, <;, or <;=.'
    ].join('\n');
}
