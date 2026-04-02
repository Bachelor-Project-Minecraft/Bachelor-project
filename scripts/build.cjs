const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDirectory = path.resolve(__dirname, '..');
const distDirectory = path.join(rootDirectory, 'dist');

fs.rmSync(distDirectory, { recursive: true, force: true });

execFileSync(process.execPath, [require.resolve('typescript/bin/tsc')], {
    cwd: rootDirectory,
    stdio: 'inherit'
});

copy(path.join(rootDirectory, 'src', 'server'), path.join(distDirectory, 'server'));

function copy(sourcePath, destinationPath) {
    if (!fs.existsSync(sourcePath)) {
        return;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
}
