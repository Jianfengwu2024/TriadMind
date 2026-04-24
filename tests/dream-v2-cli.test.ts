import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createDreamV2Fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-dream-v2-'));
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
                project: 'dream-v2-test',
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

function parseJsonFromStdout(stdout: string) {
    const jsonStart = stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'json payload missing');
    return JSON.parse(stdout.slice(jsonStart));
}

test('dream run --visualize writes dream-visualizer html', () => {
    const root = createDreamV2Fixture();
    const result = runCli(root, ['dream', 'run', '--visualize']);
    assert.equal(result.status, 0, `dream run --visualize failed: ${result.stderr || result.stdout}`);

    const visualizerFile = path.join(root, '.triadmind', 'dream-visualizer.html');
    assert.equal(fs.existsSync(visualizerFile), true);
    const html = fs.readFileSync(visualizerFile, 'utf-8');
    assert.match(html, /Dream Governance/);
    assert.match(html, /const report =/);
});

test('dream daemon start/status/stop lifecycle is callable', async () => {
    const root = createDreamV2Fixture();

    const start = runCli(root, [
        'dream',
        'daemon',
        'start',
        '--interval-seconds',
        '1',
        '--max-ticks',
        '1',
        '--json'
    ]);
    assert.equal(start.status, 0, `dream daemon start failed: ${start.stderr || start.stdout}`);
    const startPayload = parseJsonFromStdout(start.stdout);
    assert.equal(typeof startPayload.status, 'string');

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const status = runCli(root, ['dream', 'daemon', 'status', '--json']);
    assert.equal(status.status, 0, `dream daemon status failed: ${status.stderr || status.stdout}`);
    const statusPayload = parseJsonFromStdout(status.stdout);
    assert.equal(typeof statusPayload.running, 'boolean');
    assert.equal(typeof statusPayload.state, 'object');

    const stop = runCli(root, ['dream', 'daemon', 'stop', '--json']);
    assert.equal(stop.status, 0, `dream daemon stop failed: ${stop.stderr || stop.stdout}`);
    const stopPayload = parseJsonFromStdout(stop.stdout);
    assert.equal(typeof stopPayload.status, 'string');
});
