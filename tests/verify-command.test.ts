import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createVerifyFixture(
    runtimeDiagnostics: unknown[],
    options?: {
        triadMap?: unknown[];
        draftProtocol?: unknown;
        microSplit?: unknown;
    }
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-verify-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });
    const triadMap =
        options?.triadMap ??
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
        ];
    fs.writeFileSync(
        path.join(triadDir, 'triad-map.json'),
        JSON.stringify(triadMap, null, 2),
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
    if (options?.draftProtocol !== undefined) {
        fs.writeFileSync(path.join(triadDir, 'draft-protocol.json'), JSON.stringify(options.draftProtocol, null, 2), 'utf-8');
    }
    if (options?.microSplit !== undefined) {
        fs.writeFileSync(path.join(triadDir, 'micro-split.json'), JSON.stringify(options.microSplit, null, 2), 'utf-8');
    }
    return root;
}

function createFocusedMicroSplit(
    overrides: Partial<{
        focus: string;
        operation: 'aggregate' | 'split' | 'renormalize';
        className: string;
        methodName: string;
        staticRightBranch: unknown[];
        dynamicLeftBranch: unknown[];
    }> = {}
) {
    const focus = overrides.focus ?? 'Workflow.execute';
    const operation = overrides.operation ?? 'split';
    const className = overrides.className ?? 'Workflow';
    const methodName = overrides.methodName ?? 'execute';

    return {
        triadizationFocus: focus,
        recommendedOperation: operation,
        classes: [
            {
                className,
                staticRightBranch:
                    overrides.staticRightBranch ??
                    [{ name: 'config', type: 'WorkflowConfig', role: 'workflow constraints' }],
                dynamicLeftBranch:
                    overrides.dynamicLeftBranch ??
                    [
                        {
                            name: methodName,
                            demand: ['RunCommand'],
                            answer: ['RunResult'],
                            responsibility: 'Execute workflow'
                        }
                    ]
            }
        ]
    };
}

function createFocusedDraftProtocol(
    overrides: Partial<{
        macroFocus: string;
        macroOperation: 'aggregate' | 'split' | 'renormalize';
        mesoFocus: string;
        mesoOperation: 'aggregate' | 'split' | 'renormalize';
        microFocus: string;
        microOperation: 'aggregate' | 'split' | 'renormalize';
        microClassName: string;
        microStaticRightBranch: unknown[];
        microDynamicLeftBranch: unknown[];
    }> = {}
) {
    const macroFocus = overrides.macroFocus ?? 'Workflow.execute';
    const macroOperation = overrides.macroOperation ?? 'split';
    const mesoFocus = overrides.mesoFocus ?? macroFocus;
    const mesoOperation = overrides.mesoOperation ?? macroOperation;
    const microFocus = overrides.microFocus ?? macroFocus;
    const microOperation = overrides.microOperation ?? macroOperation;
    const microClassName = overrides.microClassName ?? 'Workflow';

    return {
        protocolVersion: '1.0',
        project: 'verify-test',
        mapSource: '.triadmind/triad-map.json',
        userDemand: 'Refine workflow triadization',
        macroSplit: {
            triadizationFocus: macroFocus,
            recommendedOperation: macroOperation,
            anchorNodeId: 'Workflow.execute',
            vertexGoal: 'Split workflow orchestration into explicit branches.',
            leftBranch: ['Workflow.execute'],
            rightBranch: ['WorkflowConfig']
        },
        mesoSplit: {
            triadizationFocus: mesoFocus,
            recommendedOperation: mesoOperation,
            classes: [
                {
                    className: microClassName,
                    category: 'backend',
                    responsibility: 'Coordinate workflow execution',
                    upstreams: ['RunCommand'],
                    downstreams: ['RunResult']
                }
            ],
            pipelines: [
                {
                    pipelineId: 'Workflow.Main',
                    purpose: 'Run workflow orchestration',
                    steps: ['Workflow.execute']
                }
            ]
        },
        microSplit: {
            triadizationFocus: microFocus,
            recommendedOperation: microOperation,
            classes: [
                {
                    className: microClassName,
                    staticRightBranch:
                        overrides.microStaticRightBranch ??
                        [{ name: 'config', type: 'WorkflowConfig', role: 'workflow constraints' }],
                    dynamicLeftBranch:
                        overrides.microDynamicLeftBranch ??
                        [
                            {
                                name: 'execute',
                                demand: ['RunCommand'],
                                answer: ['RunResult'],
                                responsibility: 'Execute workflow'
                            }
                        ]
                }
            ]
        },
        actions: [
            {
                op: 'reuse',
                nodeId: 'Workflow.execute',
                reason: 'Keep the current orchestration anchor.'
            }
        ]
    };
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
    assert.equal(report.metrics.triad_vertices, 2);
    assert.equal(report.metrics.runtime_edges, 1);
    assert.equal(report.metrics.rendered_runtime_edges, 1);
    assert.equal(report.metrics.rendered_edges_consistency, true);
    assert.equal(report.metrics.runtime_unmatched_route_count, 1);
    assert.equal(report.metrics.left_only_vertices, 0);
    assert.equal(report.metrics.right_only_vertices, 0);
    assert.equal(report.metrics.empty_vertices, 0);
    assert.equal(report.metrics.scale_mixing_vertices, 0);
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

test('verify --strict fails on explicit triad completeness violations in micro-split', () => {
    const root = createVerifyFixture(
        [
            {
                level: 'info',
                code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                extractor: 'FrontendApiCallExtractor',
                message: 'baseline warning'
            }
        ],
        {
            microSplit: {
                classes: [
                    {
                        className: 'OnlyLeftClass',
                        staticRightBranch: [],
                        dynamicLeftBranch: [
                            {
                                name: 'execute',
                                demand: ['RunCommand'],
                                answer: ['RunResult'],
                                responsibility: 'Execute workflow'
                            }
                        ]
                    },
                    {
                        className: 'OnlyRightClass',
                        staticRightBranch: [{ name: 'state', type: 'State', role: 'stable state' }],
                        dynamicLeftBranch: []
                    },
                    {
                        className: 'EmptyClass',
                        staticRightBranch: [],
                        dynamicLeftBranch: []
                    }
                ]
            }
        }
    );

    const result = runCli(root, ['verify', '--strict', '--json']);
    assert.equal(result.status, 1, `verify --strict should fail on triad completeness violations`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --strict --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.metrics.left_only_vertices, 1);
    assert.equal(report.metrics.right_only_vertices, 1);
    assert.equal(report.metrics.empty_vertices, 1);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'triad_completeness' && check.status === 'fail'),
        true
    );
});

test('verify reports scale-mixing vertices when helper and orchestration methods share one vertex', () => {
    const root = createVerifyFixture(
        [
            {
                level: 'info',
                code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                extractor: 'FrontendApiCallExtractor',
                message: 'baseline warning'
            }
        ],
        {
            triadMap: [
                {
                    nodeId: 'Planner.execute',
                    category: 'backend',
                    sourcePath: 'src/backend/planner.py',
                    fission: {
                        problem: 'Execute workflow plan',
                        demand: ['PlanInput'],
                        answer: ['PlanState']
                    }
                },
                {
                    nodeId: 'Planner.build',
                    category: 'backend',
                    sourcePath: 'src/backend/planner.py',
                    fission: {
                        problem: 'Build plan draft',
                        demand: ['PlanState'],
                        answer: ['BuildResult']
                    }
                },
                {
                    nodeId: 'Planner.normalize',
                    category: 'backend',
                    sourcePath: 'src/backend/planner.py',
                    fission: {
                        problem: 'Normalize plan output',
                        demand: ['BuildResult'],
                        answer: ['NormalizedPlan']
                    }
                }
            ]
        }
    );

    const result = runCli(root, ['verify', '--json']);
    assert.equal(result.status, 0, `verify --json failed: ${result.stderr || result.stdout}`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.metrics.scale_mixing_vertices > 0, true);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'scale_mixing_vertices' && check.status === 'fail'),
        true
    );
});

test('verify reports aligned protocol focus and focused-class closure when draft protocol and micro split stay on the same vertex', () => {
    const root = createVerifyFixture(
        [
            {
                level: 'info',
                code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                extractor: 'FrontendApiCallExtractor',
                message: 'baseline warning'
            }
        ],
        {
            draftProtocol: createFocusedDraftProtocol(),
            microSplit: createFocusedMicroSplit()
        }
    );

    const result = runCli(root, ['verify', '--json']);
    assert.equal(result.status, 0, `verify --json failed: ${result.stderr || result.stdout}`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.metrics.protocol_focus_alignment_violations, 0);
    assert.equal(report.metrics.focus_closure_violations, 0);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'protocol_focus_alignment' && check.status === 'pass'),
        true
    );
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'triad_focus_closure' && check.status === 'pass'),
        true
    );
});

test('verify --strict fails when draft protocol focus drifts away from the confirmed micro split focus', () => {
    const root = createVerifyFixture(
        [
            {
                level: 'info',
                code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                extractor: 'FrontendApiCallExtractor',
                message: 'baseline warning'
            }
        ],
        {
            draftProtocol: createFocusedDraftProtocol({
                macroFocus: 'Planner.aggregate',
                macroOperation: 'aggregate',
                mesoFocus: 'Planner.aggregate',
                mesoOperation: 'aggregate',
                microFocus: 'Workflow.execute',
                microOperation: 'split'
            }),
            microSplit: createFocusedMicroSplit()
        }
    );

    const result = runCli(root, ['verify', '--strict', '--json']);
    assert.equal(result.status, 1, `verify --strict should fail on focus drift`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --strict --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.metrics.protocol_focus_alignment_violations > 0, true);
    assert.equal(report.metrics.focus_closure_violations, 0);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'protocol_focus_alignment' && check.status === 'fail'),
        true
    );
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'triad_focus_closure' && check.status === 'pass'),
        true
    );
});

test('verify --strict fails when the focused method is missing from the focused class left branch', () => {
    const dynamicLeftBranch = [
        {
            name: 'run',
            demand: ['RunCommand'],
            answer: ['RunResult'],
            responsibility: 'Run workflow execution'
        }
    ];
    const root = createVerifyFixture(
        [
            {
                level: 'info',
                code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                extractor: 'FrontendApiCallExtractor',
                message: 'baseline warning'
            }
        ],
        {
            draftProtocol: createFocusedDraftProtocol({
                microDynamicLeftBranch: dynamicLeftBranch
            }),
            microSplit: createFocusedMicroSplit({
                dynamicLeftBranch
            })
        }
    );

    const result = runCli(root, ['verify', '--strict', '--json']);
    assert.equal(result.status, 1, `verify --strict should fail on focus closure drift`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'verify --strict --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.metrics.protocol_focus_alignment_violations, 0);
    assert.equal(report.metrics.focus_closure_violations > 0, true);
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'protocol_focus_alignment' && check.status === 'pass'),
        true
    );
    assert.equal(
        report.checks.some((check: { key?: string; status?: string }) => check.key === 'triad_focus_closure' && check.status === 'fail'),
        true
    );
});
