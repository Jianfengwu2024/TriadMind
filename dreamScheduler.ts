import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig } from './config';
import { runDreamAnalysis } from './dream';
import { WorkspacePaths } from './workspace';

type DreamAutoStatus = 'run' | 'skipped' | 'error';

export interface DreamAutoTickOptions {
    trigger: string;
    force?: boolean;
    now?: Date;
}

export interface DreamAutoTickResult {
    status: DreamAutoStatus;
    trigger: string;
    reason: string;
    ran: boolean;
    pendingEvents: number;
    lock: 'acquired' | 'busy' | 'stale_recovered' | 'none';
    reportFile?: string;
    diagnosticsFile?: string;
    error?: string;
}

interface DreamAutoState {
    schemaVersion: '1.0';
    updatedAt: string;
    pendingEvents: number;
    totalEvents: number;
    lastRunAt?: string;
    lastAutoScanAt?: string;
    lastTrigger?: string;
    lastResult?: DreamAutoStatus;
    lastReason?: string;
    lastError?: string;
}

interface DreamLockPayload {
    schemaVersion: '1.0';
    pid: number;
    trigger: string;
    acquiredAt: string;
}

interface DreamLockResult {
    acquired: boolean;
    staleRecovered: boolean;
}

export function tickDreamAutoRun(paths: WorkspacePaths, options: DreamAutoTickOptions): DreamAutoTickResult {
    const trigger = String(options.trigger ?? '').trim() || 'unknown';
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const config = loadTriadConfig(paths);
    const dreamConfig = config.dream;
    const state = readDreamAutoState(paths.dreamAutoStateFile);

    state.totalEvents += 1;
    state.pendingEvents += 1;
    state.lastTrigger = trigger;
    state.updatedAt = nowIso;
    writeDreamAutoState(paths.dreamAutoStateFile, state);

    const finalizeSkip = (reason: string, lock: DreamAutoTickResult['lock'] = 'none'): DreamAutoTickResult => {
        state.updatedAt = nowIso;
        state.lastResult = 'skipped';
        state.lastReason = reason;
        writeDreamAutoState(paths.dreamAutoStateFile, state);
        return {
            status: 'skipped',
            trigger,
            reason,
            ran: false,
            pendingEvents: state.pendingEvents,
            lock
        };
    };

    if (!dreamConfig.enabled && !options.force) {
        return finalizeSkip('dream disabled by config');
    }

    if (!dreamConfig.autoTriggerEnabled && !options.force) {
        return finalizeSkip('dream auto-trigger disabled by config');
    }

    const triggerSet = new Set(
        (dreamConfig.autoTriggerCommands ?? [])
            .map((item) => String(item ?? '').trim().toLowerCase())
            .filter(Boolean)
    );
    if (!options.force && triggerSet.size > 0 && !triggerSet.has(trigger.toLowerCase())) {
        return finalizeSkip(`trigger "${trigger}" not in autoTriggerCommands`);
    }

    if (!options.force && state.pendingEvents < dreamConfig.minEventsBetweenRuns) {
        return finalizeSkip(
            `event gate blocked: pendingEvents=${state.pendingEvents}, minEventsBetweenRuns=${dreamConfig.minEventsBetweenRuns}`
        );
    }

    if (!options.force && isWithinHours(state.lastRunAt, now, dreamConfig.minHoursBetweenRuns)) {
        return finalizeSkip(
            `time gate blocked: minHoursBetweenRuns=${dreamConfig.minHoursBetweenRuns}, lastRunAt=${state.lastRunAt ?? 'n/a'}`
        );
    }

    if (!options.force && isWithinMinutes(state.lastAutoScanAt, now, dreamConfig.scanThrottleMinutes)) {
        return finalizeSkip(
            `scan throttle blocked: scanThrottleMinutes=${dreamConfig.scanThrottleMinutes}, lastAutoScanAt=${state.lastAutoScanAt ?? 'n/a'}`
        );
    }

    const lockResult = tryAcquireDreamLock(paths.dreamLockFile, nowIso, trigger, dreamConfig.lockTimeoutMinutes);
    if (!lockResult.acquired) {
        return finalizeSkip('dream lock is busy', 'busy');
    }

    try {
        const result = runDreamAnalysis(paths, {
            mode: 'idle',
            force: true
        });
        state.pendingEvents = 0;
        state.lastRunAt = result.report.generatedAt;
        state.lastAutoScanAt = nowIso;
        state.updatedAt = nowIso;
        state.lastResult = 'run';
        state.lastReason = 'auto dream run completed';
        delete state.lastError;
        writeDreamAutoState(paths.dreamAutoStateFile, state);

        return {
            status: 'run',
            trigger,
            reason: 'auto dream run completed',
            ran: true,
            pendingEvents: state.pendingEvents,
            lock: lockResult.staleRecovered ? 'stale_recovered' : 'acquired',
            reportFile: result.artifacts.reportFile,
            diagnosticsFile: result.artifacts.diagnosticsFile
        };
    } catch (error: any) {
        const message = error?.message ? String(error.message) : String(error);
        state.lastAutoScanAt = nowIso;
        state.updatedAt = nowIso;
        state.lastResult = 'error';
        state.lastReason = 'auto dream run failed';
        state.lastError = message;
        writeDreamAutoState(paths.dreamAutoStateFile, state);

        if (dreamConfig.failOnDreamError) {
            throw error;
        }

        return {
            status: 'error',
            trigger,
            reason: 'auto dream run failed',
            ran: false,
            pendingEvents: state.pendingEvents,
            lock: lockResult.staleRecovered ? 'stale_recovered' : 'acquired',
            error: message
        };
    } finally {
        releaseDreamLock(paths.dreamLockFile);
    }
}

function readDreamAutoState(filePath: string): DreamAutoState {
    if (!fs.existsSync(filePath)) {
        return {
            schemaVersion: '1.0',
            updatedAt: new Date(0).toISOString(),
            pendingEvents: 0,
            totalEvents: 0
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as Partial<DreamAutoState>;
        return {
            schemaVersion: '1.0',
            updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
            pendingEvents: normalizeNonNegativeInteger(parsed.pendingEvents, 0),
            totalEvents: normalizeNonNegativeInteger(parsed.totalEvents, 0),
            lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : undefined,
            lastAutoScanAt: typeof parsed.lastAutoScanAt === 'string' ? parsed.lastAutoScanAt : undefined,
            lastTrigger: typeof parsed.lastTrigger === 'string' ? parsed.lastTrigger : undefined,
            lastResult:
                parsed.lastResult === 'run' || parsed.lastResult === 'skipped' || parsed.lastResult === 'error'
                    ? parsed.lastResult
                    : undefined,
            lastReason: typeof parsed.lastReason === 'string' ? parsed.lastReason : undefined,
            lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined
        };
    } catch {
        return {
            schemaVersion: '1.0',
            updatedAt: new Date(0).toISOString(),
            pendingEvents: 0,
            totalEvents: 0
        };
    }
}

function writeDreamAutoState(filePath: string, state: DreamAutoState) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

function tryAcquireDreamLock(
    lockFilePath: string,
    nowIso: string,
    trigger: string,
    lockTimeoutMinutes: number
): DreamLockResult {
    const timeoutMs = lockTimeoutMinutes * 60 * 1000;
    let staleRecovered = false;

    if (fs.existsSync(lockFilePath)) {
        const existing = readDreamLock(lockFilePath);
        const acquiredAt = Date.parse(existing?.acquiredAt ?? '');
        const isStale = Number.isFinite(acquiredAt) ? Date.now() - acquiredAt > timeoutMs : true;
        if (!isStale) {
            return {
                acquired: false,
                staleRecovered: false
            };
        }

        try {
            fs.unlinkSync(lockFilePath);
            staleRecovered = true;
        } catch {
            return {
                acquired: false,
                staleRecovered: false
            };
        }
    }

    const payload: DreamLockPayload = {
        schemaVersion: '1.0',
        pid: process.pid,
        trigger,
        acquiredAt: nowIso
    };

    try {
        fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
        fs.writeFileSync(lockFilePath, JSON.stringify(payload, null, 2), {
            encoding: 'utf-8',
            flag: 'wx'
        });
        return {
            acquired: true,
            staleRecovered
        };
    } catch (error: any) {
        if (String(error?.code ?? '').toUpperCase() === 'EEXIST') {
            return {
                acquired: false,
                staleRecovered: false
            };
        }
        throw error;
    }
}

function readDreamLock(lockFilePath: string) {
    try {
        const parsed = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8').replace(/^\uFEFF/, '')) as Partial<DreamLockPayload>;
        return {
            schemaVersion: '1.0',
            pid: Number(parsed.pid ?? 0),
            trigger: String(parsed.trigger ?? ''),
            acquiredAt: String(parsed.acquiredAt ?? '')
        };
    } catch {
        return undefined;
    }
}

function releaseDreamLock(lockFilePath: string) {
    if (!fs.existsSync(lockFilePath)) {
        return;
    }

    try {
        fs.unlinkSync(lockFilePath);
    } catch {
        // best effort
    }
}

function isWithinHours(iso: string | undefined, now: Date, thresholdHours: number) {
    if (!iso) {
        return false;
    }
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) {
        return false;
    }
    const elapsedHours = (now.getTime() - parsed) / 3_600_000;
    return elapsedHours < thresholdHours;
}

function isWithinMinutes(iso: string | undefined, now: Date, thresholdMinutes: number) {
    if (!iso) {
        return false;
    }
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) {
        return false;
    }
    const elapsedMinutes = (now.getTime() - parsed) / 60_000;
    return elapsedMinutes < thresholdMinutes;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return fallback;
}
