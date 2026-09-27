// Cross-platform dev loop (replaces `nest start --watch`, which needs `taskkill` on Windows).
//  - TypeScript watch runs IN this process (compiler API) — no extra child to orphan.
//  - The API server is the only child; it is restarted after each clean build and exits by itself
//    if this process disappears (PAS_DEV_PARENT_PID heartbeat in main.ts) — Windows never kills orphans.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

let server = null;
let restartTimer = null;

function startServer() {
  server = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PAS_DEV_PARENT_PID: String(process.pid) },
  });
  server.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code) console.error(`[dev] API exited with code ${code} — waiting for the next change`);
  });
}

function restart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (server && server.exitCode === null) {
      server.once('exit', startServer);
      server.kill('SIGTERM');
    } else startServer();
  }, 150);
}

const host = ts.createWatchCompilerHost(
  resolve(root, 'tsconfig.build.json'),
  {},
  ts.sys,
  ts.createEmitAndSemanticDiagnosticsBuilderProgram,
  (d) => console.error('[tsc]', ts.flattenDiagnosticMessageText(d.messageText, '\n'), d.file ? `(${d.file.fileName})` : ''),
  (d, _nl, _opts, errorCount) => {
    console.log('[tsc]', ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    // 6194 = "Found N errors. Watching for file changes." — restart only on a clean build.
    if (d.code === 6194 && !errorCount) restart();
  },
);
ts.createWatchProgram(host);

const stop = () => {
  server?.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
