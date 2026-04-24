import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createVerifyFixture(runtimeDiagnostics: unknown[]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-verify-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });
    fs.writeFileSync(
        path.join(triadDir, 'triad-map.json'),
        JSON.stringify(
            [
                {
                    nodeId: 'GenericService.execute',
                    category: 'backend',
                    sourcePath: 'src/backend/services/generic_service.py',
                    fission: {
                        problem: 'Execute generic service',
                        demand: ['dict (payload)', '[Ghost:Read] unknown (self.cache)'],
                        answer: ['dict']
                    }
                },
                {
                    nodeId: 'WorkflowService.dispatch',
                    category: 'backend',
                    sourcePath: 'src/backend/workflows/dispatch_service.py',
                    fission: {
                        problem: 'Dispatch workflow',
                        demand: ['RunCommand (command)'],
                        answer: ['RunResult']
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
                project: 'verify-test',
                generatedAt: new Date().toISOString(),
                view: 'full',
                nodes: [
                    { id: 'ApiRoute.POST./items/{id}/run', type: 'ApiRoute', label: 'POST /items/{id}/run' },
                    { id: 'Service.WorkflowService.dispatch', type: 'Service', label: 'WorkflowService.dispatch' }
                ],
                edges: [
                    {
                        from: 'ApiRoute.POST./items/{id}/run',
                        to: 'Service.WorkflowService.dispatch',
                        type: 'invokes',
                        confidence: 0.91
                    }
                ]
            },
            null,
            2
        ),
        'utf-8'
    );
    fs.writeFileSync(path.join(triadDir, 'runtime-diagnostics.json'), JSON.stringify(runtimeDiagnostics, null, 2), 'utf-8');
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

test('verify --json reports runtime edge consistency and governance metrics', () => {
    const root = createVerifyFixture([
        {
            level: 'warning',
            code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
            extractor: 'FrontendApiCallExtractor',
            message: 'Could not match frontend API call /api/items/run'
        }
    ]);

    const result = runCli(root, ['verify', '--json']);
    assert.equal(result.status, 0, `verify --json failed: ${result.stderr || result.stdout}`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));

    assert.equal(report.metrics.triad_nodes, 2);
    assert.equal(report.metrics.runtime_edges, 1);
    assert.equal(report.metrics.rendered_runtime_edges, 1);
    assert.equal(report.metrics.rendered_edges_consistency, true);
    assert.equal(report.metrics.runtime_unmatched_route_count, 1);
    assert.ok(typeof report.metrics.ghost_ratio_by_language === 'object');
    assert.ok(typeof report.metrics.ghost_in_demand_count_by_language === 'object');
});

test('verify --strict fails when diagnostics contain missing code', () => {
    const root = createVerifyFixture([
        {
            level: 'warning',
            extractor: 'FrontendApiCallExtractor',
            message: 'missing code field on purpose'
        }
    ]);

    const result = runCli(root, ['verify', '--strict']);
    assert.equal(result.status, 1, `verify --strict should fail but returned ${result.status}`);
    assert.match(result.stdout, /diagnostics_no_code/i);
    assert.match(result.stdout, /\[FAIL\]/);
});

test('verify --strict fails when language ghost policy is violated', () => {
    const root = createVerifyFixture([
        {
            level: 'info',
            code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
            extractor: 'FrontendApiCallExtractor',
            message: 'baseline warning'
        }
    ]);

    const result = runCli(root, ['verify', '--strict', '--json']);
    assert.equal(result.status, 1, `verify --strict should fail on language ghost policy violations`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --strict --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.metrics.ghost_policy_violations > 0, true);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'ghost_policy_compliance' && check.status === 'fail'),
        true
    );
});
