import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    buildImplementationPrompt,
    buildMacroPrompt,
    buildMasterPrompt,
    buildMesoPrompt,
    buildMicroPrompt,
    buildPipelinePrompt,
    buildProtocolPrompt,
    ensureTriadSpec,
    getWorkspacePaths,
    writePromptPacket
} from '../workflow';
import { writeTriadizationArtifacts, writeTriadizationConfirmation } from '../triadization';

function createWorkflowPromptFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-workflow-prompt-'));
    const paths = getWorkspacePaths(root);
    ensureTriadSpec(paths, true);

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

    fs.mkdirSync(paths.triadDir, { recursive: true });
    fs.writeFileSync(paths.mapFile, JSON.stringify(map, null, 2), 'utf-8');
    const report = writeTriadizationArtifacts(paths);
    writeTriadizationConfirmation(paths, report, 'triadize');

    return { root, paths };
}

function createFocusedDraftProtocol() {
    return {
        protocolVersion: '1.0',
        project: 'prompt-test',
        mapSource: '.triadmind/triad-map.json',
        userDemand: 'Refine workflow triadization',
        macroSplit: {
            triadizationFocus: 'Workflow.execute',
            recommendedOperation: 'split',
            anchorNodeId: 'Workflow.execute',
            vertexGoal: 'Split workflow orchestration into explicit branches.',
            leftBranch: ['Workflow.execute'],
            rightBranch: ['WorkflowConfig']
        },
        mesoSplit: {
            triadizationFocus: 'Workflow.execute',
            recommendedOperation: 'split',
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
            triadizationFocus: 'Workflow.execute',
            recommendedOperation: 'split',
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

function createDriftingMicroSplit() {
    return {
        triadizationFocus: 'Planner.aggregate',
        recommendedOperation: 'aggregate',
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
    };
}

test('protocol/pipeline/implementation prompts bind planning to confirmed triadization focus', () => {
    const { paths } = createWorkflowPromptFixture();
    const demand = 'Refine workflow triadization';

    const protocolPrompt = buildProtocolPrompt(paths, demand);
    const pipelinePrompt = buildPipelinePrompt(paths, demand);
    const implementationPrompt = buildImplementationPrompt(paths, demand);

    for (const prompt of [protocolPrompt, pipelinePrompt, implementationPrompt]) {
        assert.match(prompt, /状态：已确认/);
        assert.match(prompt, /焦点：Workflow\.execute -> split/);
        assert.match(prompt, /不得把焦点切换到其他节点/);
        assert.match(prompt, /\[Triadization Focus Gate\]/);
        assert.match(prompt, /status: skip/);
    }

    assert.match(protocolPrompt, /Triadization Focus JSON/);
    assert.match(pipelinePrompt, /输出必须显式填写 `triadizationFocus` 与 `recommendedOperation`/);
    assert.match(implementationPrompt, /三轮结果必须显式保留同一个 `triadizationFocus` 与 `recommendedOperation`/);
});

test('writePromptPacket seeds macro meso micro artifacts and prompts with triadization focus metadata', () => {
    const { paths } = createWorkflowPromptFixture();
    const demand = 'Refine workflow triadization';

    writePromptPacket(paths, demand);

    const macroSeed = JSON.parse(fs.readFileSync(paths.macroSplitFile, 'utf-8'));
    const mesoSeed = JSON.parse(fs.readFileSync(paths.mesoSplitFile, 'utf-8'));
    const microSeed = JSON.parse(fs.readFileSync(paths.microSplitFile, 'utf-8'));

    for (const seed of [macroSeed, mesoSeed, microSeed]) {
        assert.equal(seed.triadizationFocus, 'Workflow.execute');
        assert.equal(seed.recommendedOperation, 'split');
    }

    const macroPrompt = buildMacroPrompt(paths, demand);
    const mesoPrompt = buildMesoPrompt(paths, demand);
    const microPrompt = buildMicroPrompt(paths, demand);

    for (const prompt of [macroPrompt, mesoPrompt, microPrompt]) {
        assert.match(prompt, /焦点：Workflow\.execute -> split/);
        assert.match(prompt, /输出 JSON 必须显式包含 `triadizationFocus` 与 `recommendedOperation`/);
    }

    assert.match(macroPrompt, /"triadizationFocus":""/);
    assert.match(mesoPrompt, /"triadizationFocus":""/);
    assert.match(microPrompt, /"triadizationFocus":""/);
});

test('master prompt surfaces focus-gate diagnosis and repair target when protocol artifacts drift', () => {
    const { paths } = createWorkflowPromptFixture();
    const demand = 'Refine workflow triadization';

    fs.writeFileSync(paths.demandFile, demand, 'utf-8');
    fs.writeFileSync(paths.draftFile, JSON.stringify(createFocusedDraftProtocol(), null, 2), 'utf-8');
    fs.writeFileSync(paths.microSplitFile, JSON.stringify(createDriftingMicroSplit(), null, 2), 'utf-8');

    const masterPrompt = buildMasterPrompt(paths);

    assert.match(masterPrompt, /\[Current Stage\]/);
    assert.match(masterPrompt, /protocol_focus_alignment/);
    assert.match(masterPrompt, /\[Triadization Focus Gate\]/);
    assert.match(masterPrompt, /status: fail/);
    assert.match(masterPrompt, /failureKind: protocol_focus_alignment/);
    assert.match(masterPrompt, /repairTarget: Workflow\.execute -> split/);
});
