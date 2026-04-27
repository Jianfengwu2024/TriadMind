import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertProtocolShape } from '../protocol';
import { ensureTriadSpec, getWorkspacePaths } from '../workflow';
import { writeTriadizationArtifacts, writeTriadizationConfirmation } from '../triadization';

function createExistingNodes() {
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
        {
            nodeId: 'Consumer1.handle',
            category: 'core',
            sourcePath: 'src/consumer_1.ts',
            fission: {
                problem: 'Consumer 1',
                demand: ['WorkflowResult'],
                answer: ['Consumer1Result']
            }
        }
    ];
}

function createDraftProtocol(
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
        protocolVersion: '1.0',
        project: 'focus-test',
        mapSource: '.triadmind/triad-map.json',
        userDemand: 'Refine workflow triadization',
        macroSplit: {
            triadizationFocus: macroFocus,
            recommendedOperation: macroOperation,
            anchorNodeId: 'Workflow.execute',
            vertexGoal: 'Split orchestration vertex into explicit branches.',
            leftBranch: ['Consumer1.handle'],
            rightBranch: ['Workflow configuration']
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
                    downstreams: ['Consumer1.handle']
                }
            ],
            pipelines: [
                {
                    pipelineId: 'Workflow.Main',
                    purpose: 'Split orchestration stages',
                    steps: ['Workflow.execute', 'Consumer1.handle']
                }
            ]
        },
        microSplit: {
            triadizationFocus: microFocus,
            recommendedOperation: microOperation,
            classes: [
                {
                    className: 'Workflow',
                    staticRightBranch: [{ name: 'config', type: 'WorkflowConfig', role: 'orchestration constraints' }],
                    dynamicLeftBranch: [
                        {
                            name: 'execute',
                            demand: ['RunCommand'],
                            answer: ['WorkflowResult'],
                            responsibility: 'Run workflow execution'
                        }
                    ]
                }
            ]
        },
        actions: [
            {
                op: 'reuse' as const,
                nodeId: 'Workflow.execute',
                reason: 'Keep the existing orchestration anchor.'
            }
        ]
    };
}

function createMicroSplit(
    overrides: Partial<{
        focus: string;
        operation: 'aggregate' | 'split' | 'renormalize';
        className: string;
        staticRightBranch: unknown[];
        dynamicLeftBranch: unknown[];
    }> = {}
) {
    const focus = overrides.focus ?? 'Workflow.execute';
    const operation = overrides.operation ?? 'split';
    const className = overrides.className ?? 'Workflow';

    return {
        triadizationFocus: focus,
        recommendedOperation: operation,
        classes: [
            {
                className,
                staticRightBranch:
                    overrides.staticRightBranch ??
                    [{ name: 'config', type: 'WorkflowConfig', role: 'orchestration constraints' }],
                dynamicLeftBranch:
                    overrides.dynamicLeftBranch ??
                    [
                        {
                            name: 'execute',
                            demand: ['RunCommand'],
                            answer: ['WorkflowResult'],
                            responsibility: 'Run workflow execution'
                        }
                    ]
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

test('assertProtocolShape accepts protocol when macro meso micro share the same triadization focus', () => {
    const existingNodes = createExistingNodes();
    const protocol = createDraftProtocol();

    const parsed = assertProtocolShape(protocol, {
        existingNodes,
        expectedTriadizationFocus: {
            triadizationFocus: 'Workflow.execute',
            recommendedOperation: 'split'
        }
    });

    assert.equal(parsed.macroSplit?.triadizationFocus, 'Workflow.execute');
    assert.equal(parsed.mesoSplit?.recommendedOperation, 'split');
    assert.equal(parsed.microSplit?.triadizationFocus, 'Workflow.execute');
});

test('assertProtocolShape rejects protocol when split stages drift away from the same triadization focus', () => {
    const existingNodes = createExistingNodes();
    const protocol = createDraftProtocol({
        mesoFocus: 'Planner.aggregate',
        mesoOperation: 'aggregate'
    });

    assert.throws(
        () =>
            assertProtocolShape(protocol, {
                existingNodes
            }),
        /mesoSplit.*triadization focus.*漂移/i
    );
});

test('plan rejects draft protocol when final protocol focus drifts from current triadization proposal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-protocol-focus-'));
    const paths = getWorkspacePaths(root);
    ensureTriadSpec(paths, true);
    fs.mkdirSync(paths.triadDir, { recursive: true });

    const map = [
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
    ];

    fs.writeFileSync(paths.mapFile, JSON.stringify(map, null, 2), 'utf-8');
    const report = writeTriadizationArtifacts(paths);
    writeTriadizationConfirmation(paths, report, 'triadize');

    fs.writeFileSync(
        paths.draftFile,
        JSON.stringify(
            createDraftProtocol({
                macroFocus: 'Planner.aggregate',
                macroOperation: 'aggregate',
                mesoFocus: 'Planner.aggregate',
                mesoOperation: 'aggregate',
                microFocus: 'Planner.aggregate',
                microOperation: 'aggregate'
            }),
            null,
            2
        ),
        'utf-8'
    );

    const result = runCli(root, ['plan', '--no-open']);
    assert.equal(result.status, 1, `plan should fail on triadization focus drift: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /Draft protocol validation failed/i);
    assert.match(result.stdout, /triadization focus/i);
    assert.match(result.stdout, /Workflow\.execute -> split/i);
});

test('plan rejects draft protocol when micro-split drifts away from the draft protocol focus', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-plan-focus-gate-'));
    const paths = getWorkspacePaths(root);
    ensureTriadSpec(paths, true);
    fs.mkdirSync(paths.triadDir, { recursive: true });

    const map = [
        {
            nodeId: 'Workflow.execute',
            category: 'core',
            sourcePath: 'src/workflow.ts',
            fission: {
                problem: 'Workflow orchestration',
                demand: ['RunCommand'],
                answer: ['WorkflowResult']
            }
        }
    ];

    fs.writeFileSync(paths.mapFile, JSON.stringify(map, null, 2), 'utf-8');
    const report = writeTriadizationArtifacts(paths);
    writeTriadizationConfirmation(paths, report, 'triadize');
    fs.writeFileSync(paths.draftFile, JSON.stringify(createDraftProtocol(), null, 2), 'utf-8');
    fs.writeFileSync(
        paths.microSplitFile,
        JSON.stringify(
            createMicroSplit({
                focus: 'Planner.aggregate',
                operation: 'aggregate',
                className: 'Planner',
                dynamicLeftBranch: [
                    {
                        name: 'aggregate',
                        demand: ['PlanFragment'],
                        answer: ['PlanAggregate'],
                        responsibility: 'Aggregate fragmented plan vertices'
                    }
                ]
            }),
            null,
            2
        ),
        'utf-8'
    );

    const result = runCli(root, ['plan', '--no-open']);
    assert.equal(result.status, 1, `plan should fail on micro-split focus drift: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /Draft protocol validation failed/i);
    assert.match(result.stdout, /Triadization focus gate failed/i);
    assert.match(result.stdout, /protocol_focus_alignment/i);
});

test('apply rejects draft protocol when focused method does not close around the draft protocol focus', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-apply-focus-gate-'));
    const paths = getWorkspacePaths(root);
    ensureTriadSpec(paths, true);
    fs.mkdirSync(paths.triadDir, { recursive: true });

    const map = [
        {
            nodeId: 'Workflow.execute',
            category: 'core',
            sourcePath: 'src/workflow.ts',
            fission: {
                problem: 'Workflow orchestration',
                demand: ['RunCommand'],
                answer: ['WorkflowResult']
            }
        }
    ];

    fs.writeFileSync(paths.mapFile, JSON.stringify(map, null, 2), 'utf-8');
    const report = writeTriadizationArtifacts(paths);
    writeTriadizationConfirmation(paths, report, 'triadize');
    fs.writeFileSync(paths.draftFile, JSON.stringify(createDraftProtocol(), null, 2), 'utf-8');
    fs.writeFileSync(
        paths.microSplitFile,
        JSON.stringify(
            createMicroSplit({
                dynamicLeftBranch: [
                    {
                        name: 'run',
                        demand: ['RunCommand'],
                        answer: ['WorkflowResult'],
                        responsibility: 'Run workflow execution'
                    }
                ]
            }),
            null,
            2
        ),
        'utf-8'
    );

    const result = runCli(root, ['apply']);
    assert.equal(result.status, 1, `apply should fail on focused method closure drift: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /Apply/i);
    assert.match(result.stdout, /Triadization focus gate failed/i);
    assert.match(result.stdout, /triad_focus_closure/i);
});
