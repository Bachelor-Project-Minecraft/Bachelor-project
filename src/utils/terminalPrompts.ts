import * as readline from 'readline';

type PromptOption<T> = {
    label: string;
    description?: string;
    value: T;
};

function getEnvValue(...names: string[]): string | undefined {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) {
            return value;
        }
    }

    return undefined;
}

async function promptToSelectOption<T>(
    title: string,
    subtitle: string,
    options: PromptOption<T>[],
    defaultValue: T
): Promise<T> {
    if (!process.stdin.isTTY || !process.stdout.isTTY || options.length === 0) {
        return defaultValue;
    }

    return new Promise((resolve) => {
        let selectedIndex = Math.max(
            options.findIndex((option) => Object.is(option.value, defaultValue)),
            0
        );
        let renderedLineCount = 0;

        const styles = {
            selected: '\x1b[1;95m',
            dim: '\x1b[2m',
            reset: '\x1b[0m',
        };

        const clearRenderedPrompt = () => {
            if (renderedLineCount === 0) {
                return;
            }

            process.stdout.write(`\r\x1b[${renderedLineCount - 1}A`);

            for (let index = 0; index < renderedLineCount; index += 1) {
                process.stdout.write('\x1b[2K');

                if (index < renderedLineCount - 1) {
                    process.stdout.write('\x1b[1B\r');
                }
            }

            process.stdout.write(`\r\x1b[${renderedLineCount - 1}A`);
        };

        const render = () => {
            clearRenderedPrompt();

            const optionLines = options.flatMap((option, index) => {
                const prefix = index === selectedIndex ? '>' : ' ';
                const line = `${prefix} ${index + 1}. ${option.label}`;
                const renderedOption = index === selectedIndex
                    ? `${styles.selected}${line}${styles.reset}`
                    : line;

                if (!option.description) {
                    return [renderedOption];
                }

                return [
                    renderedOption,
                    `${styles.dim}   ${option.description}${styles.reset}`,
                ];
            });

            const lines = [
                title,
                `${styles.dim}${subtitle}${styles.reset}`,
                '',
                ...optionLines,
                '',
                `${styles.dim}Use arrow keys and press Enter to confirm.${styles.reset}`,
            ];

            renderedLineCount = lines.length;
            process.stdout.write(`\x1b[?25l${lines.join('\n')}`);
        };

        const cleanup = () => {
            process.stdin.removeListener('keypress', handleKeypress);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            clearRenderedPrompt();
            process.stdout.write('\x1b[?25h');
        };

        const handleKeypress = (_: string, key: readline.Key) => {
            if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                resolve(options[selectedIndex].value);
                return;
            }

            if (key.name === 'down' || key.name === 'right') {
                selectedIndex = (selectedIndex + 1) % options.length;
                render();
                return;
            }

            if (key.name === 'up' || key.name === 'left') {
                selectedIndex = (selectedIndex - 1 + options.length) % options.length;
                render();
                return;
            }

            if (key.ctrl && key.name === 'c') {
                cleanup();
                process.kill(process.pid, 'SIGINT');
            }
        };

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('keypress', handleKeypress);
        render();
    });
}

export async function promptToContinueCurrentGenerationLine(): Promise<boolean> {
    const value = getEnvValue('AUTO_CONTINUE_GENERATION_LINE');
    if (value) {
        return ['1', 'true', 'yes', 'y', 'continue'].includes(value.toLowerCase());
    }

    return promptToSelectOption(
        'Continue generation line?',
        'Resume the current run or start a fresh generation line.',
        [
            {
                label: 'Yes, continue the current generation line',
                value: true,
            },
            {
                label: 'No, reset and start fresh',
                value: false,
            },
        ],
        true
    );
}

export async function promptToSelectScenario<T extends { name: string; description: string }>(
    scenarios: T[],
    defaultScenario: T = scenarios[0]
): Promise<T> {
    if (scenarios.length === 0) {
        throw new Error('No scenarios are available to select.');
    }

    const scenarioName = getEnvValue('AUTO_SCENARIO');
    if (scenarioName) {
        const selectedScenario = scenarios.find(
            (scenario) => scenario.name.toLowerCase() === scenarioName.toLowerCase()
        );

        if (!selectedScenario) {
            throw new Error(
                `Unknown scenario "${scenarioName}". Available scenarios: ${scenarios.map((scenario) => scenario.name).join(', ')}.`
            );
        }

        return selectedScenario;
    }

    return promptToSelectOption(
        'Select scenario',
        'Choose the scenario to run for this session.',
        scenarios.map((scenario) => ({
            label: scenario.name,
            description: scenario.description,
            value: scenario,
        })),
        defaultScenario
    );
}
