import { spawn } from 'node:child_process';
const DEV_SERVER_URL = 'http://localhost:3000';
const DEV_SERVER_READY_TIMEOUT_MS = 30_000;
const DEV_SERVER_POLL_INTERVAL_MS = 500;
// Tracks the dev server spawned by startDevServer() so stopDevServer() can tear it down;
// otherwise it survives the workflow process and blocks port 3000/3001 on the next run.
let devServerProcess = null;
async function isServerReachable(url) {
    try {
        await fetch(url);
        return true;
    }
    catch {
        return false;
    }
}
async function waitForServerReady(url, timeoutMs, pollIntervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isServerReachable(url)) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
}
export async function startDevServer(cwd) {
    if (await isServerReachable(DEV_SERVER_URL)) {
        return { started: true, message: 'Dev server was already running.' };
    }
    const child = spawn('npm', ['run', 'start'], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    devServerProcess = child;
    const ready = await waitForServerReady(DEV_SERVER_URL, DEV_SERVER_READY_TIMEOUT_MS, DEV_SERVER_POLL_INTERVAL_MS);
    if (!ready) {
        return {
            started: false,
            message: `Dev server did not become ready at ${DEV_SERVER_URL} within ${DEV_SERVER_READY_TIMEOUT_MS / 1000}s.`,
        };
    }
    return { started: true, message: 'Dev server is running.' };
}
export function stopDevServer() {
    if (!devServerProcess || devServerProcess.pid === undefined) {
        return { stopped: false, message: 'No dev server was started; nothing to stop.' };
    }
    try {
        process.kill(-devServerProcess.pid, 'SIGTERM');
        return { stopped: true, message: 'Stopped the dev server.' };
    }
    catch (error) {
        return {
            stopped: false,
            message: `Failed to stop the dev server: ${error.message}`,
        };
    }
    finally {
        devServerProcess = null;
    }
}
