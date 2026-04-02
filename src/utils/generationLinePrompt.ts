import * as readline from 'readline';

export async function promptToContinueCurrentGenerationLine(): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return true;
    }

    return new Promise((resolve) => {
        let selectedIndex = 0;
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

            const options = [
                'Yes, continue the current generation line',
                'No, reset and start fresh',
            ].map((option, index) => {
                const prefix = index === selectedIndex ? '>' : ' ';
                const line = `${prefix} ${index + 1}. ${option}`;
                return index === selectedIndex
                    ? `${styles.selected}${line}${styles.reset}`
                    : line;
            });

            const lines = [
                'Continue generation line?',
                `${styles.dim}Resume the current run or start a fresh generation line.${styles.reset}`,
                '',
                ...options,
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
                resolve(selectedIndex === 0);
                return;
            }

            if (key.name === 'right' || key.name === 'down') {
                selectedIndex = 1;
                render();
                return;
            }

            if (key.name === 'left' || key.name === 'up') {
                selectedIndex = 0;
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
