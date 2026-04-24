import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createDreamFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-dream-'));
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
                },
                {
                    nodeId: 'NotificationService.handle',
                    category: 'backend',
                    sourcePath: 'src/backend/notification_service.py',
                    fission: {
                        problem: 'Handle notification',
                        demand: ['OrderResult'],
                        answer: ['void']
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
                project: 'dream-test',
                generatedAt: new Date().toISOString(),
                view: 'full',
                nodes: [
                    { id: 'ApiRoute.POST./orders/run', type: 'ApiRoute', label: 'POST /orders/run' },
                    { id: 'Service.OrderService.execute', type: 'Service', label: 'OrderService.execute' }
                ],
                edges: [
                    {
                        from: 'ApiRoute.POST./orders/run',
                        to: 'Service.OrderService.execute',
                        type: 'invokes',
                        confidence: 0.92
                    }
                ]
            },
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(
        path.join(triadDir, 'runtime-diagnostics.json'),
        JSON.stringify(
            [
                {
                    level: 'warning',
                    code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                    extractor: 'FrontendApiCallExtractor',
                    message: 'Could not match frontend API call /api/orders/123/run to a known ApiRoute',
                    sourcePath: 'frontend/src/api/orders.ts'
                }
            ],
            null,
            2
        ),
        'utf-8'
    );

    return root;
}

function runCli(cwd: string, args: string[]) {
    const repoRoot = path.resolve(__dirname, '..');
    const cliPath = path.join(repoRoot, 'cli.ts');
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    return spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], {
        cwd,
        encoding: 'utf-8'
    });
}

test('dream run --json writes dream artifacts and proposals', () => {
    const root = createDreamFixture();
    const result = runCli(root, ['dream', 'run', '--json']);
    assert.equal(result.status, 0, `dream run failed: ${result.stderr || result.stdout}`);

    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'dream run --json did not emit JSON payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));

    assert.equal(report.schemaVersion, '1.0');
    assert.equal(report.skipped, false);
    assert.equal(Array.isArray(report.findings), true);
    assert.equal(Array.isArray(report.proposals), true);
    assert.equal(report.proposals.length > 0, true);

    const triadDir = path.join(root, '.triadmind');
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-report.json')), true);
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-diagnostics.json')), true);
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-proposals.json')), true);
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-state.json')), true);
});

test('dream idle mode respects minHoursBetweenRuns gate', () => {
    const root = createDreamFixture();

    const firstRun = runCli(root, ['dream', 'run', '--mode', 'idle', '--json']);
    assert.equal(firstRun.status, 0, `first idle dream run failed: ${firstRun.stderr || firstRun.stdout}`);
    const firstPayload = JSON.parse(firstRun.stdout.slice(firstRun.stdout.indexOf('{')));
    assert.equal(firstPayload.skipped, false);

    const secondRun = runCli(root, ['dream', 'run', '--mode', 'idle', '--json']);
    assert.equal(secondRun.status, 0, `second idle dream run failed: ${secondRun.stderr || secondRun.stdout}`);
    const secondPayload = JSON.parse(secondRun.stdout.slice(secondRun.stdout.indexOf('{')));
    assert.equal(secondPayload.skipped, true);
    assert.match(String(secondPayload.skipReason ?? ''), /Idle gate active/i);
});

test('dream review --json returns latest report', () => {
    const root = createDreamFixture();
    const runResult = runCli(root, ['dream', 'run', '--json']);
    assert.equal(runResult.status, 0, `dream run failed: ${runResult.stderr || runResult.stdout}`);

    const reviewResult = runCli(root, ['dream', 'review', '--json']);
    assert.equal(reviewResult.status, 0, `dream review failed: ${reviewResult.stderr || reviewResult.stdout}`);
    const report = JSON.parse(reviewResult.stdout.slice(reviewResult.stdout.indexOf('{')));
    assert.equal(report.schemaVersion, '1.0');
    assert.equal(Array.isArray(report.summary), true);
});
