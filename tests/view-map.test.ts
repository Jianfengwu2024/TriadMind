import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getWorkspacePaths } from '../workspace';
import { generateViewMap, writeViewMapArtifacts } from '../viewMap';

function writeFixture(root: string, relativePath: string, payload: unknown) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf-8');
}

test('view-map links runtime capability and leaf nodes bidirectionally', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-view-map-'));
    const paths = getWorkspacePaths(root);

    writeFixture(root, '.triadmind/triad-map.json', [
        {
            nodeId: 'WorkflowService.dispatch',
            sourcePath: 'backend/services/workflow_service.py',
            topology: {
                foldedLeaves: ['WorkflowService._build_request']
            },
            fission: {
                problem: 'Dispatch workflow',
                demand: ['RunRequest (request)'],
                answer: ['RunResult']
            }
        },
        {
            nodeId: 'ApiController.run_item',
            sourcePath: 'backend/api/items.py',
            fission: {
                problem: 'Run item',
                demand: ['RunRequest (request)'],
                answer: ['RunResult']
            }
        }
    ]);

    writeFixture(root, '.triadmind/leaf-map.json', [
        {
            nodeId: 'WorkflowService.dispatch',
            sourcePath: 'backend/services/workflow_service.py',
            fission: {
                problem: 'Dispatch workflow',
                demand: ['RunRequest (request)'],
                answer: ['RunResult']
            }
        },
        {
            nodeId: 'WorkflowService._build_request',
            sourcePath: 'backend/services/workflow_service.py',
            fission: {
                problem: 'Build request',
                demand: ['RunRequest (request)'],
                answer: ['RunRequest']
            }
        },
        {
            nodeId: 'ApiController.run_item',
            sourcePath: 'backend/api/items.py',
            fission: {
                problem: 'Run item',
                demand: ['RunRequest (request)'],
                answer: ['RunResult']
            }
        }
    ]);

    writeFixture(root, '.triadmind/runtime-map.json', {
        schemaVersion: '1.0',
        project: 'view-map-test',
        generatedAt: new Date().toISOString(),
        nodes: [
            {
                id: 'Service.WorkflowService.dispatch',
                type: 'Service',
                label: 'WorkflowService.dispatch',
                sourcePath: 'backend/services/workflow_service.py'
            },
            {
                id: 'ApiRoute.POST./items/{id}/run',
                type: 'ApiRoute',
                label: 'POST /items/{id}/run',
                sourcePath: 'backend/api/items.py',
                metadata: {
                    handler: 'run_item'
                }
            }
        ],
        edges: []
    });

    const viewMap = generateViewMap(paths);
    assert.equal(viewMap.schemaVersion, '1.0');
    assert.ok(viewMap.stats.linkCount > 0);
    assert.equal(viewMap.diagnostics.some((item) => item.level === 'error'), false);
    assert.ok(
        viewMap.links.some(
            (link) =>
                link.fromView === 'capability' &&
                link.fromId === 'WorkflowService.dispatch' &&
                link.toView === 'leaf' &&
                link.toId === 'WorkflowService._build_request' &&
                link.relation === 'folded_leaf'
        )
    );
    assert.ok(
        viewMap.links.some(
            (link) =>
                link.fromView === 'runtime' &&
                link.fromId === 'Service.WorkflowService.dispatch' &&
                link.toView === 'capability' &&
                link.toId === 'WorkflowService.dispatch' &&
                link.relation === 'runtime_capability'
        )
    );
    assert.ok(
        viewMap.links.some(
            (link) =>
                link.fromView === 'runtime' &&
                link.toView === 'leaf' &&
                link.toId === 'WorkflowService._build_request' &&
                link.relation === 'runtime_leaf_derived'
        )
    );
});

test('writeViewMapArtifacts emits diagnostics for missing runtime map', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-view-map-missing-'));
    const paths = getWorkspacePaths(root);
    writeFixture(root, '.triadmind/triad-map.json', []);
    writeFixture(root, '.triadmind/leaf-map.json', []);

    const viewMap = writeViewMapArtifacts(paths);
    assert.equal(fs.existsSync(paths.viewMapFile), true);
    assert.equal(fs.existsSync(paths.viewMapDiagnosticsFile), true);
    assert.equal(
        viewMap.diagnostics.some((item) => item.code === 'VIEW_MAP_MISSING_RUNTIME_MAP'),
        true
    );
});

test('view-map uses runtime evidence sourcePath and category alignment for runtime-capability links', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-view-map-evidence-'));
    const paths = getWorkspacePaths(root);

    writeFixture(root, '.triadmind/config.json', {
        schemaVersion: '1.1',
        architecture: {
            language: 'typescript',
            parserEngine: 'tree-sitter',
            adapter: '@triadmind/plugin-ts'
        },
        categories: {
            frontend: ['frontend'],
            backend: ['backend'],
            agent: ['agent'],
            rheo_cli: ['rheo_cli'],
            core: ['core']
        },
        parser: {
            scanCategories: ['frontend', 'backend', 'agent', 'rheo_cli'],
            scanMode: 'capability'
        }
    });

    writeFixture(root, '.triadmind/triad-map.json', [
        {
            nodeId: 'DashboardPage.render',
            category: 'frontend',
            sourcePath: 'frontend/dashboard/page.tsx',
            fission: {
                problem: 'Render dashboard',
                demand: ['None'],
                answer: ['JSX.Element']
            }
        },
        {
            nodeId: 'DashboardService.render',
            category: 'backend',
            sourcePath: 'backend/dashboard/page.py',
            fission: {
                problem: 'Render backend dashboard',
                demand: ['None'],
                answer: ['dict']
            }
        }
    ]);

    writeFixture(root, '.triadmind/leaf-map.json', [
        {
            nodeId: 'DashboardPage.render',
            category: 'frontend',
            sourcePath: 'frontend/dashboard/page.tsx',
            fission: {
                problem: 'Render dashboard',
                demand: ['None'],
                answer: ['JSX.Element']
            }
        }
    ]);

    writeFixture(root, '.triadmind/runtime-map.json', {
        schemaVersion: '1.0',
        project: 'view-map-evidence-test',
        generatedAt: new Date().toISOString(),
        nodes: [
            {
                id: 'FrontendEntry.page',
                type: 'FrontendEntry',
                label: 'page entry',
                category: 'frontend',
                evidence: [
                    {
                        sourcePath: 'frontend/dashboard/page.tsx',
                        kind: 'call',
                        text: 'render dashboard'
                    }
                ]
            }
        ],
        edges: []
    });

    const viewMap = generateViewMap(paths);
    assert.equal(viewMap.stats.runtimeMatchedNodes, 1);
    assert.equal(viewMap.stats.runtimeMatchRate, 1);
    assert.equal(
        viewMap.links.some(
            (link) =>
                link.fromView === 'runtime' &&
                link.fromId === 'FrontendEntry.page' &&
                link.toView === 'capability' &&
                link.toId === 'DashboardPage.render'
        ),
        true
    );
});

test('view-map canonicalizes custom categories and reports end-to-end completeness for mixed-language fixtures', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-view-map-generic-'));
    const paths = getWorkspacePaths(root);

    writeFixture(root, '.triadmind/config.json', {
        schemaVersion: '1.1',
        architecture: {
            language: 'typescript',
            parserEngine: 'tree-sitter',
            adapter: '@triadmind/plugin-ts'
        },
        categories: {
            dialogue_core: ['flows/dialogue'],
            surface_web: ['surface/http'],
            terminal_lane: ['ops/cli'],
            core: ['shared']
        },
        parser: {
            scanCategories: ['dialogue_core', 'surface_web', 'terminal_lane'],
            scanMode: 'capability'
        }
    });

    writeFixture(root, '.triadmind/profile.json', {
        schemaVersion: '1.0',
        scanScopes: [
            { name: 'dialogue', kind: 'agent', match: { pathPrefixes: ['flows/dialogue'] } },
            { name: 'surface', kind: 'api', match: { pathPrefixes: ['surface/http'] } },
            { name: 'terminal', kind: 'cli', match: { pathPrefixes: ['ops/cli'] } }
        ]
    });

    writeFixture(root, '.triadmind/triad-map.json', [
        {
            nodeId: 'ReplyController.post_reply',
            category: 'dialogue_core',
            sourcePath: 'surface/http/reply.ts',
            fission: {
                problem: 'Post reply',
                demand: ['ReplyCommand (command)'],
                answer: ['ReplyResult']
            }
        },
        {
            nodeId: 'ReplyOrchestrator.dispatch_turn',
            category: 'surface_web',
            sourcePath: 'flows/dialogue/orchestrator.py',
            topology: {
                foldedLeaves: ['ReplyOrchestrator._prepare_context']
            },
            fission: {
                problem: 'Dispatch turn',
                demand: ['TurnRequest (request)'],
                answer: ['TurnReply']
            }
        }
    ]);

    writeFixture(root, '.triadmind/leaf-map.json', [
        {
            nodeId: 'ReplyController.post_reply',
            category: 'dialogue_core',
            sourcePath: 'surface/http/reply.ts',
            fission: {
                problem: 'Post reply',
                demand: ['ReplyCommand (command)'],
                answer: ['ReplyResult']
            }
        },
        {
            nodeId: 'ReplyOrchestrator.dispatch_turn',
            category: 'surface_web',
            sourcePath: 'flows/dialogue/orchestrator.py',
            fission: {
                problem: 'Dispatch turn',
                demand: ['TurnRequest (request)'],
                answer: ['TurnReply']
            }
        },
        {
            nodeId: 'ReplyOrchestrator._prepare_context',
            category: 'surface_web',
            sourcePath: 'flows/dialogue/orchestrator.py',
            fission: {
                problem: 'Prepare context',
                demand: ['TurnRequest (request)'],
                answer: ['TurnContext']
            }
        }
    ]);

    writeFixture(root, '.triadmind/runtime-map.json', {
        schemaVersion: '1.0',
        project: 'view-map-generic-test',
        generatedAt: new Date().toISOString(),
        nodes: [
            {
                id: 'ApiRoute.POST./reply',
                type: 'ApiRoute',
                label: 'POST /reply',
                category: 'dialogue_core',
                sourcePath: 'surface/http/reply.ts',
                metadata: {
                    handler: 'post_reply'
                }
            },
            {
                id: 'Workflow.ReplyOrchestrator.dispatch_turn',
                type: 'Workflow',
                label: 'dispatch turn',
                category: 'surface_web',
                evidence: [
                    {
                        sourcePath: 'flows/dialogue/orchestrator.py',
                        kind: 'call',
                        text: 'dispatch turn'
                    }
                ]
            }
        ],
        edges: []
    });

    const viewMap = generateViewMap(paths);
    assert.equal(viewMap.stats.runtimeMatchRate, 1);
    assert.equal(viewMap.stats.capabilityLeafMatchRate, 1);
    assert.equal(viewMap.stats.endToEndTraceabilityRate, 1);
    assert.equal(viewMap.stats.runtimeToCapabilityLinkCount >= 2, true);
    assert.equal(viewMap.stats.capabilityToLeafLinkCount >= 3, true);
    assert.equal(viewMap.stats.runtimeToLeafLinkCount >= 3, true);
    assert.equal(
        viewMap.diagnostics.some((item) => item.code === 'VIEW_MAP_CAPABILITY_CATEGORY_MISMATCH_AUTO_FIXED'),
        true
    );
    assert.equal(
        viewMap.diagnostics.some((item) => item.code === 'VIEW_MAP_RUNTIME_CATEGORY_MISMATCH_AUTO_FIXED'),
        true
    );
    assert.equal(
        viewMap.links.some(
            (link) =>
                link.fromView === 'runtime' &&
                link.fromId === 'ApiRoute.POST./reply' &&
                link.toView === 'capability' &&
                link.toId === 'ReplyController.post_reply'
        ),
        true
    );
    assert.equal(
        viewMap.links.some(
            (link) =>
                link.fromView === 'runtime' &&
                link.fromId === 'Workflow.ReplyOrchestrator.dispatch_turn' &&
                link.toView === 'leaf' &&
                link.toId === 'ReplyOrchestrator._prepare_context'
        ),
        true
    );
});
