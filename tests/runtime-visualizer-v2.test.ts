import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { generateRuntimeDashboard } from '../runtime/runtimeVisualizer';

function writeRuntimeFixture(root: string) {
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });
    const runtimeMapPath = path.join(triadDir, 'runtime-map.json');
    fs.writeFileSync(
        runtimeMapPath,
        JSON.stringify(
            {
                schemaVersion: '1.0',
                project: 'runtime-v2-test',
                generatedAt: new Date().toISOString(),
                view: 'full',
                nodes: [
                    {
                        id: 'FrontendEntry.frontend/src/pages/items.tsx',
                        type: 'FrontendEntry',
                        label: 'items page',
                        sourcePath: 'frontend/src/pages/items.tsx'
                    },
                    {
                        id: 'ApiRoute.POST./items/{id}/run',
                        type: 'ApiRoute',
                        label: 'POST /items/{id}/run',
                        sourcePath: 'backend/api/items.py'
                    },
                    {
                        id: 'Service.ItemService.run',
                        type: 'Service',
                        label: 'ItemService.run',
                        sourcePath: 'backend/services/item_service.py'
                    }
                ],
                edges: [
                    {
                        from: 'FrontendEntry.frontend/src/pages/items.tsx',
                        to: 'ApiRoute.POST./items/{id}/run',
                        type: 'calls',
                        confidence: 0.6,
                        evidence: [{ sourcePath: 'frontend/src/pages/items.tsx', line: 3, kind: 'call', text: 'fetch(...)' }]
                    },
                    {
                        from: 'ApiRoute.POST./items/{id}/run',
                        to: 'Service.ItemService.run',
                        type: 'invokes',
                        confidence: 0.9,
                        evidence: [{ sourcePath: 'backend/api/items.py', line: 5, kind: 'call', text: 'service.run_item(id)' }]
                    }
                ]
            },
            null,
            2
        ),
        'utf-8'
    );
    return {
        triadDir,
        runtimeMapPath,
        runtimeVisualizerPath: path.join(triadDir, 'runtime-visualizer.html')
    };
}

function readRuntimePayloadFromHtml(html: string) {
    const match = html.match(/const runtimePayload = (\{[\s\S]*?\});\s*const dashboardOptions = /);
    assert.ok(match, 'runtimePayload bootstrap not found in generated html');
    return JSON.parse(match[1]);
}

test('runtime visualizer v2 html contains interactive graph bootstrap', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-runtime-v2-'));
    const fixture = writeRuntimeFixture(root);

    generateRuntimeDashboard(fixture.runtimeMapPath, fixture.runtimeVisualizerPath, {
        layout: 'leaf-force',
        traceDepth: 3,
        hideIsolated: true,
        interactive: true,
        theme: 'runtime-dark'
    });

    const html = fs.readFileSync(fixture.runtimeVisualizerPath, 'utf-8');
    assert.match(html, /data-runtime-visualizer-version="3"/);
    assert.match(html, /vis-network\/standalone\/umd\/vis-network\.min\.js/);
    assert.match(html, /id="graph"/);
    assert.match(html, /id="runtime-toolbar"/);
    assert.match(html, /id="cluster-controls"/);
    assert.match(html, /id="view-leaf"/);
    assert.match(html, /id="view-flow"/);
    assert.match(html, /id="toggle-clusters"/);
    assert.match(html, /id="status-legend"/);
    assert.match(html, /id="filters-panel"/);
    assert.match(html, /id="info-panel"/);
    assert.match(html, /id="search-results"/);
    assert.match(html, /id="edge-label-toggle"/);
    assert.match(html, /runtime-flow-card/);
    assert.match(html, /Edge Bundling: on/);
    assert.match(html, /Runtime first render/);
    assert.match(html, /TriadMind Runtime Graph/);
    assert.match(html, /trace-upstream/);
    assert.match(html, /const runtimeMap = /);
    assert.match(html, /layout":"leaf-force"/);
    assert.match(html, /"traceDepth":3/);
    assert.match(html, /"hideIsolated":true/);
    assert.match(html, /"theme":"runtime-dark"/);
});

test('runtime visualizer renders all runtime-map edges by default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-runtime-v2-edge-default-'));
    const fixture = writeRuntimeFixture(root);
    const map = JSON.parse(fs.readFileSync(fixture.runtimeMapPath, 'utf-8'));
    map.edges.push({
        from: 'Service.ItemService.run',
        to: 'UnknownRuntime.MissingNode',
        type: 'depends_on',
        confidence: 0.4
    });
    fs.writeFileSync(fixture.runtimeMapPath, JSON.stringify(map, null, 2), 'utf-8');

    generateRuntimeDashboard(fixture.runtimeMapPath, fixture.runtimeVisualizerPath, {
        layout: 'leaf-force'
    });

    const html = fs.readFileSync(fixture.runtimeVisualizerPath, 'utf-8');
    const payload = readRuntimePayloadFromHtml(html);
    assert.equal(payload.edges.length, map.edges.length);
});

test('runtime visualizer applies explicit maxRenderEdges cap only when provided', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-runtime-v2-edge-cap-'));
    const fixture = writeRuntimeFixture(root);
    const map = JSON.parse(fs.readFileSync(fixture.runtimeMapPath, 'utf-8'));
    map.edges.push({
        from: 'Service.ItemService.run',
        to: 'ApiRoute.POST./items/{id}/run',
        type: 'depends_on',
        confidence: 0.2
    });
    fs.writeFileSync(fixture.runtimeMapPath, JSON.stringify(map, null, 2), 'utf-8');

    generateRuntimeDashboard(fixture.runtimeMapPath, fixture.runtimeVisualizerPath, {
        layout: 'leaf-force',
        maxRenderEdges: 1
    });

    const html = fs.readFileSync(fixture.runtimeVisualizerPath, 'utf-8');
    const payload = readRuntimePayloadFromHtml(html);
    assert.equal(payload.edges.length, 1);
});

test('cli runtime --visualize smoke test writes interactive visualizer html', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-runtime-cli-'));
    fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'backend', 'app.py'),
        `
from fastapi import APIRouter
router = APIRouter()

@router.post("/items/{id}/run")
async def run_item(id: str):
    service.run_item(id)
`,
        'utf-8'
    );

    const repoRoot = path.resolve(__dirname, '..');
    const cliPath = path.join(repoRoot, 'cli.ts');
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    const result = spawnSync(
        process.execPath,
        [
            '--import',
            tsxLoader,
            cliPath,
            'runtime',
            '--visualize',
            '--layout',
            'dagre',
            '--trace-depth',
            '2',
            '--max-render-edges',
            '1000',
            '--hide-isolated',
            '--theme',
            'runtime-dark'
        ],
        {
            cwd: root,
            encoding: 'utf-8'
        }
    );

    assert.equal(result.status, 0, `runtime cli failed: ${result.stderr || result.stdout}`);
    const outputPath = path.join(root, '.triadmind', 'runtime-visualizer.html');
    assert.equal(fs.existsSync(outputPath), true);
    const html = fs.readFileSync(outputPath, 'utf-8');
    assert.match(html, /data-runtime-visualizer-version="3"/);
    assert.match(html, /vis-network\/standalone\/umd\/vis-network\.min\.js/);
    assert.match(html, /id="runtime-toolbar"/);
    assert.match(html, /id="cluster-controls"/);
    assert.match(html, /id="graph"/);
    assert.match(html, /id="status-legend"/);
    assert.match(html, /id="search-results"/);
    assert.match(html, /id="edge-label-toggle"/);
    assert.match(html, /"theme":"runtime-dark"/);
});

test('cli runtime accepts legacy force layout alias and normalizes to leaf-force', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-runtime-cli-force-'));
    fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'backend', 'app.py'),
        `
from fastapi import APIRouter
router = APIRouter()

@router.get("/health")
async def health():
    return {"ok": True}
`,
        'utf-8'
    );

    const repoRoot = path.resolve(__dirname, '..');
    const cliPath = path.join(repoRoot, 'cli.ts');
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    const result = spawnSync(
        process.execPath,
        [
            '--import',
            tsxLoader,
            cliPath,
            'runtime',
            '--visualize',
            '--layout',
            'force',
            '--theme',
            'leaf-like'
        ],
        {
            cwd: root,
            encoding: 'utf-8'
        }
    );

    assert.equal(result.status, 0, `runtime cli failed: ${result.stderr || result.stdout}`);
    const outputPath = path.join(root, '.triadmind', 'runtime-visualizer.html');
    assert.equal(fs.existsSync(outputPath), true);
    const html = fs.readFileSync(outputPath, 'utf-8');
    assert.match(html, /"layout":"leaf-force"/);
});
