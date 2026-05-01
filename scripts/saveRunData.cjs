const fs = require('fs');
const path = require('path');

const rootDirectory = path.resolve(__dirname, '..');
const runDataDirectory = process.env.RUN_DATA_DIRECTORY
    ? path.resolve(rootDirectory, process.env.RUN_DATA_DIRECTORY)
    : path.join(rootDirectory, 'RunData');
const metadataPath = path.join(runDataDirectory, 'metadata.txt');

const artifacts = [
    { relativePath: path.join('evolution', 'logs'), destinationName: 'logs' },
    { relativePath: path.join('evolution', 'logsVerbose'), destinationName: 'logsVerbose' },
    { relativePath: path.join('evolution', 'condensedMetrics.txt'), destinationName: 'condensedMetrics.txt' },
    { relativePath: path.join('evolution', 'generations.txt'), destinationName: 'generations.txt' },
    { relativePath: path.join('evolution', 'knowledgebase.txt'), destinationName: 'knowledgebase.txt' },
    { relativePath: path.join('evolution', 'generationSkills.json'), destinationName: 'generationSkills.json' },
    { relativePath: path.join('skills', 'generatedSkills.json'), destinationName: 'generatedSkills.json' }
];

main();

function main() {
    fs.mkdirSync(runDataDirectory, { recursive: true });
    ensureMetadataFile();

    const runDirectory = createNextRunDirectory();
    const copiedArtifacts = [];
    const missingArtifacts = [];

    for (const artifact of artifacts) {
        const sourcePath = resolveArtifactSourcePath(artifact.relativePath);
        if (!sourcePath) {
            missingArtifacts.push(artifact.destinationName);
            continue;
        }

        const destinationPath = path.join(runDirectory, artifact.destinationName);
        copyArtifact(sourcePath, destinationPath);
        copiedArtifacts.push(artifact.destinationName);
    }

    console.log(`Created run archive: ${path.relative(rootDirectory, runDirectory)}`);

    if (copiedArtifacts.length > 0) {
        console.log(`Copied: ${copiedArtifacts.join(', ')}`);
    }

    if (missingArtifacts.length > 0) {
        console.log(`Missing: ${missingArtifacts.join(', ')}`);
    }
}

function ensureMetadataFile() {
    if (fs.existsSync(metadataPath)) {
        return;
    }

    const { config } = loadConfig();
    const content = [
        'Models used',
        formatModelLine('chatModel', config.llm.chat),
        formatModelLine('skillModel', config.llm.action),
        formatModelLine('summaryModel', config.llm.summary),
        formatModelLine('cultureModel', config.llm.culture),
        ''
    ].join('\n');

    fs.writeFileSync(metadataPath, content, 'utf8');
}

function loadConfig() {
    const sourceConfigPath = path.join(rootDirectory, 'src', 'config.ts');
    if (fs.existsSync(sourceConfigPath)) {
        require('ts-node').register({
            transpileOnly: true,
            compilerOptions: {
                module: 'commonjs',
                moduleResolution: 'node'
            }
        });

        return require(sourceConfigPath);
    }

    return require(path.join(rootDirectory, 'dist', 'config.js'));
}

function formatModelLine(name, modelConfig) {
    const reasoningEffort = modelConfig.reasoning?.effort ?? 'unspecified';
    return `${name}: provider=${modelConfig.provider}, model=${modelConfig.model}, reasoning=${reasoningEffort}`;
}

function createNextRunDirectory() {
    let runIndex = 1;
    let runDirectory = path.join(runDataDirectory, String(runIndex));

    while (fs.existsSync(runDirectory)) {
        runIndex += 1;
        runDirectory = path.join(runDataDirectory, String(runIndex));
    }

    fs.mkdirSync(runDirectory, { recursive: true });
    return runDirectory;
}

function resolveArtifactSourcePath(relativePath) {
    const candidateRoots = [
        path.join(rootDirectory, 'src'),
        path.join(rootDirectory, 'dist')
    ];

    for (const candidateRoot of candidateRoots) {
        const candidatePath = path.join(candidateRoot, relativePath);
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

function copyArtifact(sourcePath, destinationPath) {
    const sourceStats = fs.statSync(sourcePath);

    if (sourceStats.isDirectory()) {
        fs.cpSync(sourcePath, destinationPath, { recursive: true });
        return;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
}
