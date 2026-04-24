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
