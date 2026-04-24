import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { loadTriadConfig } from './config';
import { tickDreamAutoRun } from './dreamScheduler';
import { WorkspacePaths } from './workspace';

export interface DreamDaemonStartOptions {
    intervalSeconds?: number;
    maxTicks?: number;
}

export interface DreamDaemonLoopOptions {
    intervalSeconds: number;
    maxTicks: number;
}

export interface DreamDaemonPidRecord {
    schemaVersion: '1.0';
    pid: number;
    startedAt: string;
    intervalSeconds: number;
    maxTicks: number;
}

export interface DreamDaemonState {
    schemaVersion: '1.0';
    updatedAt: string;
    running: boolean;
    pid?: number;
    startedAt?: string;
    heartbeatAt?: string;
    ticks: number;
    lastStatus?: 'run' | 'skipped' | 'error';
    lastReason?: string;
    lastError?: string;
}

export interface DreamDaemonControlResult {
    status: 'started' | 'already_running' | 'stopped' | 'not_running' | 'error';
    running: boolean;
    pid?: number;
    message: string;
    state?: DreamDaemonState;
}

const DEFAULT_DAEMON_STATE: DreamDaemonState = {
    schemaVersion: '1.0',
    updatedAt: new Date(0).toISOString(),
    running: false,
    ticks: 0
};

export function startDreamDaemon(paths: WorkspacePaths, options: DreamDaemonStartOptions = {}): DreamDaemonControlResult {
    const config = loadTriadConfig(paths).dream;
    if (!config.daemonEnabled) {
        return {
            status: 'error',
            running: false,
            message: 'dream daemon is disabled by config.dream.daemonEnabled=false'
        };
    }

    const currentStatus = getDreamDaemonStatus(paths);
    if (currentStatus.running && currentStatus.pid) {
        return {
            status: 'already_running',
            running: true,
            pid: currentStatus.pid,
            message: `dream daemon already running (pid=${currentStatus.pid})`,
            state: currentStatus.state
        };
    }

    const intervalSeconds = normalizePositiveInteger(options.intervalSeconds, config.daemonIntervalSeconds);
    const maxTicks = normalizeNonNegativeInteger(options.maxTicks, config.daemonMaxTicksPerRun);
    fs.mkdirSync(path.dirname(paths.dreamDaemonLogFile), { recursive: true });
    const logFd = fs.openSync(paths.dreamDaemonLogFile, 'a');

    const args = buildDaemonSpawnArgs(intervalSeconds, maxTicks);
    const child = spawn(process.execPath, args, {
        cwd: paths.projectRoot,
        detached: true,
        stdio: ['ignore', logFd, logFd]
    });
    child.unref();
    fs.closeSync(logFd);

    const nowIso = new Date().toISOString();
    const pidRecord: DreamDaemonPidRecord = {
        schemaVersion: '1.0',
        pid: child.pid ?? 0,
        startedAt: nowIso,
        intervalSeconds,
        maxTicks
    };
    writeDaemonPid(paths.dreamDaemonPidFile, pidRecord);

    const state = readDreamDaemonState(paths.dreamDaemonStateFile);
    const nextState: DreamDaemonState = {
        ...state,
        schemaVersion: '1.0',
        updatedAt: nowIso,
        running: true,
        pid: pidRecord.pid,
        startedAt: nowIso
    };
    writeDreamDaemonState(paths.dreamDaemonStateFile, nextState);

    return {
        status: 'started',
        running: true,
        pid: child.pid,
        message: `dream daemon started (pid=${child.pid}, interval=${intervalSeconds}s, maxTicks=${maxTicks})`,
        state: nextState
    };
}

export function stopDreamDaemon(paths: WorkspacePaths): DreamDaemonControlResult {
    const pidRecord = readDaemonPid(paths.dreamDaemonPidFile);
    if (!pidRecord || !pidRecord.pid) {
        const state = markDreamDaemonStopped(paths, undefined, 'dream daemon is not running');
        return {
            status: 'not_running',
            running: false,
            message: 'dream daemon is not running',
            state
        };
    }

    const running = isProcessRunning(pidRecord.pid);
    if (!running) {
        safeRemoveFile(paths.dreamDaemonPidFile);
        const state = markDreamDaemonStopped(paths, pidRecord.pid, 'dream daemon process already exited');
        return {
            status: 'not_running',
            running: false,
            pid: pidRecord.pid,
            message: 'dream daemon process already exited',
            state
        };
    }

    try {
        process.kill(pidRecord.pid, 'SIGTERM');
    } catch (error: any) {
        return {
            status: 'error',
            running: true,
            pid: pidRecord.pid,
            message: `failed to stop dream daemon: ${error?.message ? String(error.message) : String(error)}`
        };
    }

    const state = markDreamDaemonStopped(paths, pidRecord.pid, 'dream daemon stopped by command');
    safeRemoveFile(paths.dreamDaemonPidFile);
    return {
        status: 'stopped',
        running: false,
        pid: pidRecord.pid,
        message: `dream daemon stopped (pid=${pidRecord.pid})`,
        state
    };
}

export function getDreamDaemonStatus(paths: WorkspacePaths): {
    running: boolean;
    pid?: number;
    state: DreamDaemonState;
} {
    const pidRecord = readDaemonPid(paths.dreamDaemonPidFile);
    const state = readDreamDaemonState(paths.dreamDaemonStateFile);
    if (!pidRecord || !pidRecord.pid) {
        return {
            running: false,
            state: {
                ...state,
                running: false
            }
        };
    }

    const running = isProcessRunning(pidRecord.pid);
    if (!running) {
        safeRemoveFile(paths.dreamDaemonPidFile);
        const stoppedState = markDreamDaemonStopped(paths, pidRecord.pid, 'dream daemon process not found');
        return {
            running: false,
            pid: pidRecord.pid,
            state: stoppedState
        };
    }

    return {
        running: true,
        pid: pidRecord.pid,
        state: {
            ...state,
            running: true,
            pid: pidRecord.pid,
            startedAt: state.startedAt ?? pidRecord.startedAt
        }
    };
}

export async function runDreamDaemonLoop(paths: WorkspacePaths, options: DreamDaemonLoopOptions) {
    const intervalSeconds = normalizePositiveInteger(options.intervalSeconds, 180);
    const maxTicks = normalizeNonNegativeInteger(options.maxTicks, 0);
    const nowIso = new Date().toISOString();
    const pidRecord: DreamDaemonPidRecord = {
        schemaVersion: '1.0',
        pid: process.pid,
        startedAt: nowIso,
        intervalSeconds,
        maxTicks
    };
    writeDaemonPid(paths.dreamDaemonPidFile, pidRecord);

    let stopRequested = false;
    let ticks = 0;
    const requestStop = () => {
        stopRequested = true;
    };
    process.on('SIGINT', requestStop);
    process.on('SIGTERM', requestStop);

    try {
        while (!stopRequested) {
            ticks += 1;
            const tickResult = tickDreamAutoRun(paths, {
                trigger: 'daemon'
            });
            const state = readDreamDaemonState(paths.dreamDaemonStateFile);
            const heartbeat = new Date().toISOString();
            const nextState: DreamDaemonState = {
                ...state,
                schemaVersion: '1.0',
                updatedAt: heartbeat,
                running: true,
                pid: process.pid,
                startedAt: state.startedAt ?? nowIso,
                heartbeatAt: heartbeat,
                ticks,
                lastStatus: tickResult.status,
                lastReason: tickResult.reason,
                lastError: tickResult.error
            };
            writeDreamDaemonState(paths.dreamDaemonStateFile, nextState);

            if (maxTicks > 0 && ticks >= maxTicks) {
                break;
            }
            await sleep(intervalSeconds * 1000);
        }
    } finally {
        process.off('SIGINT', requestStop);
        process.off('SIGTERM', requestStop);
        safeRemoveFile(paths.dreamDaemonPidFile);
        markDreamDaemonStopped(paths, process.pid, 'dream daemon loop exited');
    }
}

function buildDaemonSpawnArgs(intervalSeconds: number, maxTicks: number) {
    const cliEntry = resolveCliEntry();
    if (cliEntry.endsWith('.ts')) {
        const tsxPath = require.resolve('tsx');
        return [
            '--import',
            pathToFileURL(tsxPath).href,
            cliEntry,
            'dream',
            'daemon-loop',
            '--interval-seconds',
            String(intervalSeconds),
            '--max-ticks',
            String(maxTicks)
        ];
    }

    return [
        cliEntry,
        'dream',
        'daemon-loop',
        '--interval-seconds',
        String(intervalSeconds),
        '--max-ticks',
        String(maxTicks)
    ];
}

function resolveCliEntry() {
    const argvEntry = String(process.argv[1] ?? '').trim();
    if (argvEntry) {
        return path.resolve(argvEntry);
    }
    return path.resolve(__dirname, 'cli.js');
}

function markDreamDaemonStopped(paths: WorkspacePaths, pid: number | undefined, reason: string) {
    const state = readDreamDaemonState(paths.dreamDaemonStateFile);
    const nextState: DreamDaemonState = {
        ...state,
        schemaVersion: '1.0',
        updatedAt: new Date().toISOString(),
        running: false,
        pid,
        heartbeatAt: new Date().toISOString(),
        lastReason: reason
    };
    writeDreamDaemonState(paths.dreamDaemonStateFile, nextState);
    return nextState;
}

function readDaemonPid(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as Partial<DreamDaemonPidRecord>;
        const pid = Number(parsed.pid ?? 0);
        if (!Number.isFinite(pid) || pid <= 0) {
            return undefined;
        }
        return {
            schemaVersion: '1.0' as const,
            pid,
            startedAt: String(parsed.startedAt ?? ''),
            intervalSeconds: normalizePositiveInteger(parsed.intervalSeconds, 180),
            maxTicks: normalizeNonNegativeInteger(parsed.maxTicks, 0)
        };
    } catch {
        return undefined;
    }
}

function writeDaemonPid(filePath: string, payload: DreamDaemonPidRecord) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function readDreamDaemonState(filePath: string): DreamDaemonState {
    if (!fs.existsSync(filePath)) {
        return {
            ...DEFAULT_DAEMON_STATE
        };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as Partial<DreamDaemonState>;
        return {
            schemaVersion: '1.0',
            updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
            running: Boolean(parsed.running),
            pid: Number.isFinite(parsed.pid as number) ? Number(parsed.pid) : undefined,
            startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
            heartbeatAt: typeof parsed.heartbeatAt === 'string' ? parsed.heartbeatAt : undefined,
            ticks: normalizeNonNegativeInteger(parsed.ticks, 0),
            lastStatus:
                parsed.lastStatus === 'run' || parsed.lastStatus === 'skipped' || parsed.lastStatus === 'error'
                    ? parsed.lastStatus
                    : undefined,
            lastReason: typeof parsed.lastReason === 'string' ? parsed.lastReason : undefined,
            lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined
        };
    } catch {
        return {
            ...DEFAULT_DAEMON_STATE
        };
    }
}

function writeDreamDaemonState(filePath: string, state: DreamDaemonState) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

function isProcessRunning(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRemoveFile(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return;
    }
    try {
        fs.unlinkSync(filePath);
    } catch {
        // best effort
    }
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return fallback;
}
