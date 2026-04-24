import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

interface FixtureOptions {
    triadNodes?: unknown[];
    runtimeDiagnostics?: unknown[];
    policyOverride?: Record<string, unknown>;
}

function createGovernFixture(options: FixtureOptions = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-govern-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });

    const triadNodes =
        options.triadNodes ??
        [
            {
                nodeId: 'WorkflowService.dispatch',
                category: 'backend',
                sourcePath: 'src/backend/workflow_service.ts',
                fission: {
                    problem: 'Dispatch workflow',
                    demand: ['RunCommand (command)'],
                    answer: ['RunResult']
                }
            },
            {
                nodeId: 'ApiService.invoke',
                category: 'backend',
                sourcePath: 'src/backend/api_service.ts',
                fission: {
                    problem: 'Invoke api service',
                    demand: ['InvokeInput (input)'],
                    answer: ['InvokeOutput']
                }
            }
        ];

    const runtimeDiagnostics =
        options.runtimeDiagnostics ??
        [
            {
                level: 'info',
                code: 'RUNTIME_EXTRACTOR_SUMMARY',
                extractor: 'RuntimeOrchestrator',
                message: 'runtime extraction complete'
            }
        ];

    const governPolicy = {
        version: '1.0',
        mode: 'hard',
        must_pass: {
            diagnostics_no_code: { op: 'eq', value: 0 },
            execute_like_ratio: { op: 'lt', value: 0.1 },
            ghost_ratio: { op: 'lt', value: 0.4 },
            rendered_edges_consistency: { op: 'eq', value: true },
            runtime_unmatched_route_count: { op: 'lte_baseline_factor', value: 1.1 }
        },
        language_ghost_policy: {
            python: { include_in_demand: false, top_k: 0, min_confidence: 'high' },
            javascript: { include_in_demand: false, top_k: 0, min_confidence: 'high' },
            typescript: { include_in_demand: true, top_k: 5, min_confidence: 'high' },
            java: { include_in_demand: true, top_k: 5, min_confidence: 'high' },
            go: { include_in_demand: true, top_k: 5, min_confidence: 'high' },
            rust: { include_in_demand: true, top_k: 8, min_confidence: 'high' }
        },
        forbidden_in_run: ['modify_policy', 'modify_baseline'],
        ...(options.policyOverride ?? {})
    };

    fs.writeFileSync(path.join(triadDir, 'triad-map.json'), JSON.stringify(triadNodes, null, 2), 'utf-8');
    fs.writeFileSync(
        path.join(triadDir, 'runtime-map.json'),
        JSON.stringify(
            {
                schemaVersion: '1.0',
                project: 'govern-test',
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
    fs.writeFileSync(
        path.join(triadDir, 'verify-baseline.json'),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                runtime_unmatched_route_count: 2
            },
            null,
            2
        ),
        'utf-8'
    );
    fs.writeFileSync(path.join(triadDir, 'govern-policy.json'), JSON.stringify(governPolicy, null, 2), 'utf-8');
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

function parseJsonStdout(stdout: string) {
    const jsonStart = stdout.indexOf('{');
    assert.ok(jsonStart >= 0, `stdout does not contain json payload: ${stdout}`);
    return JSON.parse(stdout.slice(jsonStart));
}

test('govern check passes and writes govern artifacts', () => {
    const root = createGovernFixture();
    const result = runCli(root, ['govern', 'check', '--json']);
    assert.equal(result.status, 0, `govern check failed unexpectedly: ${result.stderr || result.stdout}`);
    const report = parseJsonStdout(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.exitCode, 0);
    assert.equal(fs.existsSync(path.join(root, '.triadmind', 'govern-report.json')), true);
    assert.equal(fs.existsSync(path.join(root, '.triadmind', 'govern-audit.log')), true);
});

test('govern ci returns gate_fail exit code when must_pass fails', () => {
    const root = createGovernFixture({
        triadNodes: [
            {
                nodeId: 'Executor.execute',
                category: 'backend',
                sourcePath: 'src/backend/executor.ts',
                fission: {
                    problem: 'execute path',
                    demand: ['Payload (payload)'],
                    answer: ['Result']
                }
            }
        ]
    });
    const result = runCli(root, ['govern', 'ci', '--json']);
    assert.equal(result.status, 2, `expected gate_fail(2), got ${result.status}: ${result.stderr || result.stdout}`);
    const report = parseJsonStdout(result.stdout);
    assert.equal(report.exitCode, 2);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'execute_like_ratio' && check.status === 'fail'),
        true
    );
});

test('govern check returns policy_invalid when policy is malformed', () => {
    const root = createGovernFixture({
        policyOverride: {
            must_pass: {}
        }
    });
    const result = runCli(root, ['govern', 'check', '--json']);
    assert.equal(result.status, 3, `expected policy_invalid(3), got ${result.status}: ${result.stderr || result.stdout}`);
    const report = parseJsonStdout(result.stdout);
    assert.equal(report.exitCode, 3);
});

test('govern check returns artifact_missing when runtime artifact is absent', () => {
    const root = createGovernFixture();
    fs.rmSync(path.join(root, '.triadmind', 'runtime-map.json'));
    const result = runCli(root, ['govern', 'check', '--json']);
    assert.equal(result.status, 4, `expected artifact_missing(4), got ${result.status}: ${result.stderr || result.stdout}`);
    const report = parseJsonStdout(result.stdout);
    assert.equal(report.exitCode, 4);
});

test('govern check returns metric_unavailable when baseline cannot be resolved', () => {
    const root = createGovernFixture();
    fs.rmSync(path.join(root, '.triadmind', 'verify-baseline.json'));
    const result = runCli(root, ['govern', 'check', '--json']);
    assert.equal(result.status, 5, `expected metric_unavailable(5), got ${result.status}: ${result.stderr || result.stdout}`);
    const report = parseJsonStdout(result.stdout);
    assert.equal(report.exitCode, 5);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'runtime_unmatched_route_count' && check.status === 'error'),
        true
    );
});

test('govern fix dry-run emits patch and returns fix_failed exit code', () => {
    const root = createGovernFixture({
        triadNodes: [
            {
                nodeId: 'Executor.execute',
                category: 'backend',
                sourcePath: 'src/backend/executor.ts',
                fission: {
                    problem: 'execute path',
                    demand: ['Payload (payload)'],
                    answer: ['Result']
                }
            }
        ]
    });
    const result = runCli(root, ['govern', 'fix', '--dry-run', '--json']);
    assert.equal(result.status, 7, `expected fix_failed(7), got ${result.status}: ${result.stderr || result.stdout}`);
    const report = parseJsonStdout(result.stdout);
    assert.equal(report.exitCode, 7);
    assert.equal(fs.existsSync(path.join(root, '.triadmind', 'govern-fixes.patch')), true);
});

