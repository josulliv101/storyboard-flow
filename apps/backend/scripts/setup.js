const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

const isWin = os.platform() === 'win32';
const venvPath = isWin ? 'venv\\Scripts' : 'venv/bin';
const pipCmd = path.join(venvPath, 'pip');

console.log('Creating virtual environment in apps/backend/venv...');
execSync('python -m venv venv', { stdio: 'inherit' });

console.log('Installing dependencies from requirements.txt...');
execSync(`${pipCmd} install -r requirements.txt`, { stdio: 'inherit' });
console.log('Backend setup complete!');
