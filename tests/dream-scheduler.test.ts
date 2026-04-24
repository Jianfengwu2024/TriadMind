import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tickDreamAutoRun } from '../dreamScheduler';
import { getWorkspacePaths } from '../workspace';

function createSchedulerFixture(overrides: {
    autoTriggerCommands?: string[];
    minEventsBetweenRuns?: number;
    minHoursBetweenRuns?: number;
    scanThrottleMinutes?: number;
    lockTimeoutMinutes?: number;
} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-dream-scheduler-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });

    fs.writeFileSync(
        path.join(triadDir, 'triad-map.json'),
        JSON.stringify(
            [
                {
                    nodeId: 'OrderService.execute',
                    category: 'backend',
                    sourcePath: 'src/backend/order_service.py',
                    fission: {
                        problem: 'Execute order orchestration',
                        demand: ['OrderCommand (command)', '[Ghost:Read] Cache (orderCache)'],
                        answer: ['OrderResult']
                    }
                },
                {
                    nodeId: 'PaymentService.process',
                    category: 'backend',
                    sourcePath: 'src/backend/payment_service.py',
                    fission: {
                        problem: 'Process payment',
                        demand: ['OrderResult'],
                        answer: ['PaymentResult']
                    }
                }
            ],
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(
        path.join(triadDir, 'runtime-map.json'),
        JSON.stringify(
            {
                schemaVersion: '1.0',
                project: 'dream-scheduler-test',
                generatedAt: new Date().toISOString(),
                view: 'full',
                nodes: [{ id: 'ApiRoute.POST./orders/run', type: 'ApiRoute', label: 'POST /orders/run' }],
                edges: []
            },
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(path.join(triadDir, 'runtime-diagnostics.json'), JSON.stringify([], null, 2), 'utf-8');

    fs.writeFileSync(
        path.join(triadDir, 'config.json'),
        JSON.stringify(
            {
                schemaVersion: '1.1',
                dream: {
                    enabled: true,
                    idleOnly: false,
                    minHoursBetweenRuns: overrides.minHoursBetweenRuns ?? 1,
                    minConfidence: 0.1,
                    maxProposals: 3,
                    autoTriggerEnabled: true,
                    autoTriggerCommands: overrides.autoTriggerCommands ?? ['sync'],
                    minEventsBetweenRuns: overrides.minEventsBetweenRuns ?? 2,
                    scanThrottleMinutes: overrides.scanThrottleMinutes ?? 1,
                    lockTimeoutMinutes: overrides.lockTimeoutMinutes ?? 5,
                    failOnDreamError: false
                }
            },
            null,
            2
        ),
        'utf-8'
    );

    return root;
}

test('auto dream waits until event gate passes then runs once', () => {
    const root = createSchedulerFixture({
        minEventsBetweenRuns: 2
    });
    const paths = getWorkspacePaths(root);

    const first = tickDreamAutoRun(paths, { trigger: 'sync' });
    assert.equal(first.status, 'skipped');
    assert.match(first.reason, /event gate blocked/i);
    assert.equal(first.pendingEvents, 1);

    const second = tickDreamAutoRun(paths, { trigger: 'sync' });
    assert.equal(second.status, 'run');
    assert.equal(second.ran, true);
    assert.equal(second.pendingEvents, 0);
    assert.equal(fs.existsSync(paths.dreamReportFile), true);
    assert.equal(fs.existsSync(paths.dreamAutoStateFile), true);
});

test('auto dream skips when lock is held by another process', () => {
    const root = createSchedulerFixture({
        minEventsBetweenRuns: 1,
        lockTimeoutMinutes: 30
    });
    const paths = getWorkspacePaths(root);

    fs.writeFileSync(
        paths.dreamLockFile,
        JSON.stringify(
            {
                schemaVersion: '1.0',
                pid: 999999,
                trigger: 'sync',
                acquiredAt: new Date().toISOString()
            },
            null,
            2
        ),
        'utf-8'
    );

    const result = tickDreamAutoRun(paths, { trigger: 'sync' });
    assert.equal(result.status, 'skipped');
    assert.equal(result.lock, 'busy');
    assert.match(result.reason, /lock is busy/i);
});

test('auto dream recovers stale lock and proceeds', () => {
    const root = createSchedulerFixture({
        minEventsBetweenRuns: 1,
        lockTimeoutMinutes: 1
    });
    const paths = getWorkspacePaths(root);
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    fs.writeFileSync(
        paths.dreamLockFile,
        JSON.stringify(
            {
                schemaVersion: '1.0',
                pid: 123456,
                trigger: 'sync',
                acquiredAt: staleTime
            },
            null,
            2
        ),
        'utf-8'
    );

    const result = tickDreamAutoRun(paths, { trigger: 'sync' });
    assert.equal(result.status, 'run');
    assert.equal(result.lock, 'stale_recovered');
    assert.equal(fs.existsSync(paths.dreamLockFile), false);
});
