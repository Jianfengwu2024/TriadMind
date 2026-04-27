import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { analyzeWorkspaceStage } from '../stage';
import { analyzeTriadizationOpportunities, buildTriadizationTaskMarkdown } from '../triadization';

function runCli(cwd: string, args: string[]) {
    const repoRoot = path.resolve(__dirname, '..');
    const cliPath = path.join(repoRoot, 'cli.ts');
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    return spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], {
        cwd,
        encoding: 'utf-8'
    });
}

function createTriadizeFixture(map: unknown[]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-triadize-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });
    fs.writeFileSync(path.join(triadDir, 'triad-map.json'), JSON.stringify(map, null, 2), 'utf-8');
    return root;
}

function createWorkflowMap() {
    return [
        {
            nodeId: 'Workflow.execute',
            category: 'core',
            sourcePath: 'src/workflow.ts',
            fission: {
                problem: 'Workflow orchestration',
                demand: ['RunCommand'],
                answer: ['WorkflowResult']
            }
        },
        ...Array.from({ length: 6 }, (_, index) => ({
            nodeId: `Downstream${index + 1}.handle`,
            category: 'core',
            sourcePath: `src/downstream_${index + 1}.ts`,
            fission: {
                problem: `Downstream ${index + 1}`,
                demand: ['WorkflowResult'],
                answer: [`Out${index + 1}`]
            }
        }))
    ];
}

function createFocusedDraftProtocol(
    overrides: Partial<{
        macroFocus: string;
        macroOperation: 'aggregate' | 'split' | 'renormalize';
        mesoFocus: string;
        mesoOperation: 'aggregate' | 'split' | 'renormalize';
        microFocus: string;
        microOperation: 'aggregate' | 'split' | 'renormalize';
    }> = {}
) {
    const macroFocus = overrides.macroFocus ?? 'Workflow.execute';
    const macroOperation = overrides.macroOperation ?? 'split';
    const mesoFocus = overrides.mesoFocus ?? macroFocus;
    const mesoOperation = overrides.mesoOperation ?? macroOperation;
    const microFocus = overrides.microFocus ?? macroFocus;
    const microOperation = overrides.microOperation ?? macroOperation;

    return {
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
                    className: 'Workflow',
                    category: 'core',
                    responsibility: 'Coordinate workflow execution',
                    upstreams: ['RunCommand'],
                    downstreams: ['WorkflowResult']
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
                    className: 'Workflow',
                    staticRightBranch: [{ name: 'config', type: 'WorkflowConfig', role: 'workflow constraints' }],
                    dynamicLeftBranch: [
                        {
                            name: 'execute',
                            demand: ['RunCommand'],
                            answer: ['WorkflowResult'],
                            responsibility: 'Execute workflow'
                        }
                    ]
                }
            ]
        },
        actions: [{ op: 'reuse', nodeId: 'Workflow.execute' }]
    };
}

function createFocusedMicroSplit(
    overrides: Partial<{
        focus: string;
        operation: 'aggregate' | 'split' | 'renormalize';
        className: string;
        dynamicLeftBranch: unknown[];
    }> = {}
) {
    return {
        triadizationFocus: overrides.focus ?? 'Workflow.execute',
        recommendedOperation: overrides.operation ?? 'split',
        classes: [
            {
                className: overrides.className ?? 'Workflow',
                staticRightBranch: [{ name: 'config', type: 'WorkflowConfig', role: 'workflow constraints' }],
                dynamicLeftBranch:
                    overrides.dynamicLeftBranch ??
                    [
                        {
                            name: 'execute',
                            demand: ['RunCommand'],
                            answer: ['WorkflowResult'],
                            responsibility: 'Execute workflow'
                        }
                    ]
            }
        ]
    };
}

test('triadization analysis prioritizes renormalize for cyclic clusters', () => {
    const map = [
        {
            nodeId: 'Alpha.execute',
            category: 'core',
            sourcePath: 'src/alpha.ts',
            fission: {
                problem: 'Alpha stage',
                demand: ['GammaResult'],
                answer: ['AlphaResult']
            }
        },
        {
            nodeId: 'Beta.execute',
            category: 'core',
            sourcePath: 'src/beta.ts',
            fission: {
                problem: 'Beta stage',
                demand: ['AlphaResult'],
                answer: ['BetaResult']
            }
        },
        {
            nodeId: 'Gamma.execute',
            category: 'core',
            sourcePath: 'src/gamma.ts',
            fission: {
                problem: 'Gamma stage',
                demand: ['BetaResult'],
                answer: ['GammaResult']
            }
        }
    ];

    const report = analyzeTriadizationOpportunities('cycle-project', map);
    assert.equal(report.primaryProposal?.recommendedOperation, 'renormalize');
    assert.deepEqual(report.primaryProposal?.targetNodeIds, ['Alpha.execute', 'Beta.execute', 'Gamma.execute']);
    assert.match(buildTriadizationTaskMarkdown(report), /提升环簇为宏顶点/);
});

test('triadization analysis prioritizes split for overloaded orchestrators', () => {
    const report = analyzeTriadizationOpportunities('split-project', [
        {
            nodeId: 'Workflow.execute',
            category: 'core',
            sourcePath: 'src/workflow.ts',
            fission: {
                problem: 'Workflow orchestration',
                demand: ['RunCommand'],
                answer: ['WorkflowResult']
            }
        },
        ...Array.from({ length: 6 }, (_, index) => ({
            nodeId: `Consumer${index + 1}.handle`,
            category: 'core',
            sourcePath: `src/consumer_${index + 1}.ts`,
            fission: {
                problem: `Consumer ${index + 1}`,
                demand: ['WorkflowResult'],
                answer: [`Consumer${index + 1}Result`]
            }
        }))
    ]);

    assert.equal(report.primaryProposal?.recommendedOperation, 'split');
    assert.equal(report.primaryProposal?.targetNodeId, 'Workflow.execute');
    assert.equal(report.primaryProposal?.diagnosis.includes('left_right_mixing'), true);
});

test('triadization analysis prioritizes aggregate for fragmented capability leaves', () => {
    const map = [
        {
            nodeId: 'Planner.build',
            category: 'core',
            sourcePath: 'src/planner.ts',
            fission: {
                problem: 'Build plan draft',
                demand: ['PlanInput'],
                answer: ['BuildResult']
            }
        },
        {
            nodeId: 'Planner.resolve',
            category: 'core',
            sourcePath: 'src/planner.ts',
            fission: {
                problem: 'Resolve plan route',
                demand: ['BuildResult'],
                answer: ['ResolveResult']
            }
        },
        {
            nodeId: 'Planner.collect',
            category: 'core',
            sourcePath: 'src/planner.ts',
            fission: {
                problem: 'Collect plan diagnostics',
                demand: ['ResolveResult'],
                answer: ['CollectResult']
            }
        }
    ];

    const report = analyzeTriadizationOpportunities('aggregate-project', map);
    assert.equal(report.primaryProposal?.recommendedOperation, 'aggregate');
    assert.equal(report.primaryProposal?.targetNodeId, 'Planner@src/planner.ts');
    assert.equal(report.primaryProposal?.diagnosis.includes('capability_fragmented'), true);
});

test('stage analysis surfaces triadization focus before protocol approval', () => {
    const triadizationReport = analyzeTriadizationOpportunities('stage-project', createWorkflowMap());

    const stage = analyzeWorkspaceStage({
        latestDemand: 'Refine workflow triadization',
        draftProtocol: '',
        macroSplit: '',
        mesoSplit: '',
        microSplit: '',
        approvedProtocol: '',
        triadizationReport: JSON.stringify(triadizationReport)
    });

    assert.equal(stage.hasTriadizationReport, true);
    assert.equal(stage.triadizationFocus, 'Workflow.execute -> split');
    assert.match(stage.currentStage, /阶段零-顶点三元化诊断/);
});

test('stage analysis reports protocol focus drift with repair target before visualizer approval', () => {
    const triadizationReport = analyzeTriadizationOpportunities('stage-focus-drift', createWorkflowMap());

    const stage = analyzeWorkspaceStage({
        latestDemand: 'Refine workflow triadization',
        draftProtocol: JSON.stringify(createFocusedDraftProtocol()),
        macroSplit: '',
        mesoSplit: '',
        microSplit: JSON.stringify(
            createFocusedMicroSplit({
                focus: 'Planner.aggregate',
                operation: 'aggregate'
            })
        ),
        approvedProtocol: '',
        triadizationReport: JSON.stringify(triadizationReport)
    });

    assert.equal(stage.hasBlockingTriadizationFocusGate, true);
    assert.equal(stage.triadizationFocusGateKind, 'protocol_focus_alignment');
    assert.match(stage.currentStage, /protocol_focus_alignment/);
    assert.match(stage.currentStage, /Workflow\.execute -> split/);
});

test('stage analysis reports class-level focus closure gap with repair target before apply', () => {
    const triadizationReport = analyzeTriadizationOpportunities('stage-focus-closure', createWorkflowMap());

    const stage = analyzeWorkspaceStage({
        latestDemand: 'Refine workflow triadization',
        draftProtocol: JSON.stringify(createFocusedDraftProtocol()),
        macroSplit: '',
        mesoSplit: '',
        microSplit: JSON.stringify(
            createFocusedMicroSplit({
                dynamicLeftBranch: [
                    {
                        name: 'run',
                        demand: ['RunCommand'],
                        answer: ['WorkflowResult'],
                        responsibility: 'Run workflow execution'
                    }
                ]
            })
        ),
        approvedProtocol: '',
        triadizationReport: JSON.stringify(triadizationReport)
    });

    assert.equal(stage.hasBlockingTriadizationFocusGate, true);
    assert.equal(stage.triadizationFocusGateKind, 'triad_focus_closure');
    assert.match(stage.currentStage, /triad_focus_closure/);
    assert.match(stage.currentStage, /Workflow\.execute/);
});

test('triadize command emits report and task artifacts', () => {
    const root = createTriadizeFixture([
        {
            nodeId: 'Workflow.execute',
            category: 'core',
            sourcePath: 'src/workflow.ts',
            fission: {
                problem: 'Workflow orchestration',
                demand: ['RunCommand'],
                answer: ['WorkflowResult']
            }
        },
        ...Array.from({ length: 6 }, (_, index) => ({
            nodeId: `Consumer${index + 1}.handle`,
            category: 'core',
            sourcePath: `src/consumer_${index + 1}.ts`,
            fission: {
                problem: `Consumer ${index + 1}`,
                demand: ['WorkflowResult'],
                answer: [`Consumer${index + 1}Result`]
            }
        }))
    ]);

    const result = runCli(root, ['triadize', '--json']);
    assert.equal(result.status, 0, `triadize failed: ${result.stderr || result.stdout}`);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'triadize --json did not emit JSON payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.primaryProposal.recommendedOperation, 'split');
    assert.equal(fs.existsSync(path.join(root, '.triadmind', 'triadization-report.json')), true);
    assert.equal(fs.existsSync(path.join(root, '.triadmind', 'triadization-task.md')), true);
});
