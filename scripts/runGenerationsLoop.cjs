const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDirectory = path.resolve(__dirname, '..');
const runDataRootDirectory = path.join(rootDirectory, 'RunData');
const generationCount = Number(process.argv[2]);
const loopInfoPath = path.join(rootDirectory, 'genLoopInfo.json');

if (!Number.isInteger(generationCount) || generationCount < 1) {
    console.error('Usage: node scripts/runGenerationsLoop.cjs <generation-count>');
    console.error('Example: node scripts/runGenerationsLoop.cjs 3');
    process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

async function main() {
    const generationLines = loadGenerationLines();
    const availableScenarioNames = getAvailableScenarioNames();

    generationLines.forEach((generationLine, index) => {
        if (!resolveScenarioName(generationLine.scenario, availableScenarioNames)) {
            throw new Error(
                `Unknown scenario "${generationLine.scenario}" in genLoopInfo.json entry ${index + 1}. Available scenarios: ${availableScenarioNames.join(', ')}`
            );
        }
    });

    for (let index = 0; index < generationLines.length; index += 1) {
        const generationLine = generationLines[index];
        const scenarioName = resolveScenarioName(generationLine.scenario, availableScenarioNames);
        const lineDirectory = createNextGenerationLineDirectory();

        console.log(`\n[AutoRunLoop] Starting generation line ${index + 1}/${generationLines.length}: ${path.relative(rootDirectory, lineDirectory)}`);

        await runCommand(process.execPath, [
            path.join(rootDirectory, 'scripts', 'runGenerations.cjs'),
            String(generationCount),
            scenarioName
        ], {
            AUTO_LLM_MODELS_JSON: JSON.stringify(generationLine.models),
            RUN_DATA_DIRECTORY: lineDirectory
        });
    }

    console.log(`\n[AutoRunLoop] Finished ${generationLines.length} generation line(s).`);
}

function loadGenerationLines() {
    if (!fs.existsSync(loopInfoPath)) {
        throw new Error('Could not find genLoopInfo.json.');
    }

    const parsed = JSON.parse(fs.readFileSync(loopInfoPath, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('genLoopInfo.json must contain a non-empty array.');
    }

    parsed.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`genLoopInfo.json entry ${index + 1} must be an object.`);
        }

        if (typeof entry.scenario !== 'string' || !entry.scenario.trim()) {
            throw new Error(`genLoopInfo.json entry ${index + 1} must have a scenario string.`);
        }

        if (!entry.models || typeof entry.models !== 'object') {
            throw new Error(`genLoopInfo.json entry ${index + 1} must have a models object.`);
        }

        assertModelConfig(entry.models.chat, index, 'models.chat');
        assertModelConfig(entry.models.skill, index, 'models.skill');
        assertModelConfig(entry.models.culture, index, 'models.culture');
        assertModelConfig(entry.models.summary, index, 'models.summary');
    });

    return parsed;
}

function assertModelConfig(modelConfig, index, name) {
    if (!modelConfig || typeof modelConfig !== 'object') {
        throw new Error(`genLoopInfo.json entry ${index + 1} must have ${name}.`);
    }

    if (modelConfig.provider !== 'ollama' && modelConfig.provider !== 'openrouter') {
        throw new Error(`genLoopInfo.json entry ${index + 1} ${name}.provider must be "ollama" or "openrouter".`);
    }

    if (typeof modelConfig.model !== 'string' || !modelConfig.model.trim()) {
        throw new Error(`genLoopInfo.json entry ${index + 1} ${name}.model must be a non-empty string.`);
    }
}

function createNextGenerationLineDirectory() {
    fs.mkdirSync(runDataRootDirectory, { recursive: true });

    let lineIndex = 1;
    let lineDirectory = path.join(runDataRootDirectory, `generationLine${lineIndex}`);

    while (fs.existsSync(lineDirectory)) {
        lineIndex += 1;
        lineDirectory = path.join(runDataRootDirectory, `generationLine${lineIndex}`);
    }

    fs.mkdirSync(lineDirectory, { recursive: true });
    return lineDirectory;
}

function resolveScenarioName(name, availableScenarioNames) {
    return availableScenarioNames.find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase()
    );
}

function getAvailableScenarioNames() {
    require('ts-node').register({
        transpileOnly: true,
        compilerOptions: {
            module: 'commonjs',
            moduleResolution: 'node'
        }
    });

    return require(path.join(rootDirectory, 'src', 'scenarios')).availableScenarios
        .map((scenario) => scenario.name);
}

function runCommand(command, args, extraEnv = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: rootDirectory,
            env: {
                ...process.env,
                ...extraEnv
            },
            stdio: 'inherit'
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`${path.basename(command)} exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`));
        });
    });
}
