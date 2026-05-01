const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDirectory = path.resolve(__dirname, '..');
const generationCount = Number(process.argv[2]);
const scenarioName = process.argv.slice(3).join(' ').trim();

if (!Number.isInteger(generationCount) || generationCount < 1 || !scenarioName) {
    console.error('Usage: node scripts/runGenerations.cjs <generation-count> <scenario-name>');
    console.error('Example: node scripts/runGenerations.cjs 5 ZombieOnSpawnScenario');
    process.exit(1);
}

const selectedScenarioName = resolveScenarioName(scenarioName);
if (!selectedScenarioName) {
    console.error(`Unknown scenario "${scenarioName}".`);
    console.error(`Available scenarios: ${getAvailableScenarioNames().join(', ')}`);
    process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

async function main() {
    for (let index = 1; index <= generationCount; index += 1) {
        console.log(`\n[AutoRun] Starting generation ${index}/${generationCount} with ${selectedScenarioName}`);
        const completionMarkerPath = path.join(rootDirectory, 'scripts', `.generation-${process.pid}-${index}.complete`);
        removeFileIfExists(completionMarkerPath);

        try {
            await runCommand(process.execPath, [
                path.join(rootDirectory, 'node_modules', 'ts-node', 'dist', 'bin.js'),
                path.join(rootDirectory, 'src', 'index.ts')
            ], {
                AUTO_SCENARIO: selectedScenarioName,
                AUTO_CONTINUE_GENERATION_LINE: index === 1 ? 'false' : 'true',
                AUTO_STOP_WHEN_AGENTS_DEAD: 'true',
                AUTO_RUN_COMPLETE_MARKER: completionMarkerPath
            }, completionMarkerPath);
        } finally {
            removeFileIfExists(completionMarkerPath);
        }

        console.log(`[AutoRun] Saving generation ${index}/${generationCount}`);
        await runCommand(process.execPath, [
            path.join(rootDirectory, 'scripts', 'saveRunData.cjs')
        ], {
            RUN_SCENARIO: selectedScenarioName
        });
    }

    console.log(`\n[AutoRun] Finished ${generationCount} generation(s).`);
}

function removeFileIfExists(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch {}
}

function resolveScenarioName(name) {
    return getAvailableScenarioNames().find(
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

function runCommand(command, args, extraEnv = {}, completionMarkerPath = null) {
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
            const completedExpectedAutoRun = completionMarkerPath && fs.existsSync(completionMarkerPath);
            if (code === 0 || completedExpectedAutoRun) {
                resolve();
                return;
            }

            reject(new Error(`${path.basename(command)} exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`));
        });
    });
}
