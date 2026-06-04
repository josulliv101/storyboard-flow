const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

const isWin = os.platform() === 'win32';
const venvPath = isWin ? 'venv\\Scripts' : 'venv/bin';
const uvicornCmd = path.join(venvPath, 'uvicorn');

console.log('Starting FastAPI backend server...');
execSync(`${uvicornCmd} main:app --host 127.0.0.1 --port 8000 --reload`, { stdio: 'inherit' });
