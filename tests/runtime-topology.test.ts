import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeFs from 'node:fs';
import { extractRuntimeTopology } from '../runtime/extractRuntimeTopology';
import { RuntimeTopologyExtractor } from '../runtime/types';

function writeFixture(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-runtime-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
    }
    return root;
}

test('FastAPI route extraction links API route to service', async () => {
    const root = writeFixture({
        'backend/app/api/items.py': `
from fastapi import APIRouter
router = APIRouter()

@router.post("/items/{id}/run")
async def run_item(id: str):
    service.run_item(id)
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { frameworkHint: 'fastapi' });
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'ApiRoute.POST./items/{id}/run'));
    assert.ok(runtimeMap.nodes.some((node) => node.id.includes('Service.') && node.id.includes('run_item')));
    assert.ok(
        runtimeMap.edges.some(
            (edge) => edge.from === 'ApiRoute.POST./items/{id}/run' && edge.type === 'invokes' && edge.to.includes('run_item')
        )
    );
});

test('frontend fetch extraction creates frontend entry and calls edge', async () => {
    const root = writeFixture({
        'frontend/src/pages/items.tsx': `
export async function runItem() {
  return fetch("/api/items/123/run", { method: "POST" });
}
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { includeFrontend: true });
    assert.ok(runtimeMap.nodes.some((node) => node.type === 'FrontendEntry'));
    assert.ok(runtimeMap.edges.some((edge) => edge.type === 'calls' && /ApiRoute\.(POST|UNKNOWN)\./.test(edge.to)));
});

test('unmatched frontend api diagnostic includes raw and normalized path', async () => {
    const root = writeFixture({
        'frontend/src/pages/items.tsx': `
const id = "123";
fetch(\`\${window.location.origin}/api/unknown/\${id}?x=1\`, { method: "POST" });
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { includeFrontend: true });
    const diagnostic = (runtimeMap.diagnostics ?? []).find(
        (item) => item.code === 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED'
    );
    assert.ok(diagnostic);
    assert.match(diagnostic?.message ?? '', /raw=/);
    assert.match(diagnostic?.message ?? '', /normalized=/);
});

test('frontend api call matcher resolves template/query/prefix variants without warning', async () => {
    const root = writeFixture({
        'backend/api/items.py': `
from fastapi import APIRouter
router = APIRouter(prefix="/api/v1")

@router.post("/items/{id}/run")
async def run_item(id: str):
    return {"ok": True}
`,
        'frontend/src/pages/items.tsx': `
const id = "123";
fetch(\`/api/v1/items/\${id}/run?x=1\`, { method: "POST" });
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { includeFrontend: true, frameworkHint: 'fastapi' });
    assert.ok(runtimeMap.edges.some((edge) => edge.type === 'calls' && edge.to === 'ApiRoute.POST./api/v1/items/{id}/run'));
    assert.equal(
        runtimeMap.diagnostics?.some((diagnostic) => diagnostic.code === 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED'),
        false
    );
});

test('frontend api call matcher resolves baseUrl template prefixes before route matching', async () => {
    const root = writeFixture({
        'backend/api/items.py': `
from fastapi import APIRouter
router = APIRouter(prefix="/api/v1")

@router.post("/items/{id}/run")
async def run_item(id: str):
    return {"ok": True}
`,
        'frontend/src/pages/items.tsx': `
const id = "123";
const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
axios.post(\`\${baseUrl}/api/v1/items/\${id}/run?x=1\`);
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { includeFrontend: true, frameworkHint: 'fastapi' });
    assert.ok(runtimeMap.edges.some((edge) => edge.type === 'calls' && edge.to === 'ApiRoute.POST./api/v1/items/{id}/run'));
    assert.equal(
        runtimeMap.diagnostics?.some((diagnostic) => diagnostic.code === 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED'),
        false
    );
});

test('Celery task extraction creates task worker queue and executes edge', async () => {
    const root = writeFixture({
        'backend/tasks.py': `
from celery import Celery
app = Celery(__name__)

@app.task
def run_workflow_task(id: str):
    workflow_service.run(id)
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { frameworkHint: 'celery' });
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'Task.run_workflow_task'));
    assert.ok(runtimeMap.nodes.some((node) => node.type === 'Worker'));
    assert.ok(runtimeMap.nodes.some((node) => node.type === 'Queue'));
    assert.ok(runtimeMap.edges.some((edge) => edge.from === 'Task.run_workflow_task' && edge.type === 'executes'));
});

test('resource access extraction captures MinIO and Redis dependencies', async () => {
    const root = writeFixture({
        'backend/services/storage.py': `
from minio import Minio
import redis

def sync_asset(bucket: str, key: str):
    client = Minio("localhost:9000")
    client.get_object(bucket, key)
    redis.set(key, "ok")
`
    });

    const runtimeMap = await extractRuntimeTopology(root);
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'ObjectStore.MinIO'));
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'Cache.Redis'));
    assert.ok(runtimeMap.edges.some((edge) => edge.to === 'ObjectStore.MinIO' && edge.type === 'reads'));
    assert.ok(runtimeMap.edges.some((edge) => edge.to === 'Cache.Redis' && ['writes', 'caches'].includes(edge.type)));
});

test('docker compose extraction captures infra runtime nodes', async () => {
    const root = writeFixture({
        'docker-compose.yml': `
services:
  redis:
    image: redis
  postgres:
    image: postgres
  minio:
    image: minio/minio
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { includeInfra: true });
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'Cache.Redis'));
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'DataStore.Postgres'));
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'ObjectStore.MinIO'));
});

test('workflow registry extraction builds workflow nodes and connects edges', async () => {
    const root = writeFixture({
        'backend/workflows/graph.py': `
workflow.add_node("A")
workflow.add_node("B")
workflow.add_edge("A", "B")
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { view: 'workflow' });
    assert.ok(runtimeMap.nodes.some((node) => node.type === 'Workflow'));
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'WorkflowNode.A'));
    assert.ok(runtimeMap.nodes.some((node) => node.id === 'WorkflowNode.B'));
    assert.ok(runtimeMap.nodes.some((node) => node.type === 'WorkflowEdge'));
    assert.ok(runtimeMap.edges.some((edge) => edge.type === 'contains'));
    assert.ok(runtimeMap.edges.some((edge) => edge.from === 'WorkflowNode.A' && edge.to === 'WorkflowNode.B' && edge.type === 'connects'));
});

test('extractor failure becomes diagnostic without crashing runtime extraction', async () => {
    const root = writeFixture({
        'backend/app.py': `
def ok():
    return 1
`
    });

    const brokenExtractor: RuntimeTopologyExtractor = {
        name: 'BrokenExtractor',
        detect() {
            return true;
        },
        extract() {
            throw new Error('boom');
        }
    };

    const runtimeMap = await extractRuntimeTopology(root, { extractors: [brokenExtractor] });
    assert.equal(runtimeMap.schemaVersion, '1.0');
    assert.ok(
        runtimeMap.diagnostics?.some(
            (diagnostic) =>
                diagnostic.extractor === 'BrokenExtractor' &&
                diagnostic.level === 'error' &&
                diagnostic.code === 'RUNTIME_EXTRACTOR_FAILED'
        )
    );
});

test('runtime diagnostics are normalized with required code/extractor/message fields', async () => {
    const root = writeFixture({
        'frontend/src/app.tsx': `
fetch("/api/unknown/path", { method: "POST" });
`
    });

    const runtimeMap = await extractRuntimeTopology(root, { includeFrontend: true });
    const diagnostics = runtimeMap.diagnostics ?? [];
    assert.ok(diagnostics.length > 0);
    diagnostics.forEach((diagnostic) => {
        assert.ok(diagnostic.level === 'info' || diagnostic.level === 'warning' || diagnostic.level === 'error');
        assert.ok(typeof diagnostic.code === 'string' && diagnostic.code.length > 0);
        assert.ok(typeof diagnostic.extractor === 'string' && diagnostic.extractor.length > 0);
        assert.ok(typeof diagnostic.message === 'string' && diagnostic.message.length > 0);
    });
});

test('runtime source collection tolerates recoverable fs permission errors', async () => {
    const root = writeFixture({
        'backend/app.py': `
def ok():
    return 1
`,
        'backend/locked/secret.py': `
def hidden():
    return 2
`
    });

    const originalStatSync = nodeFs.statSync;
    const originalReaddirSync = nodeFs.readdirSync;
    const classicFs = require('fs') as typeof nodeFs;
    const originalClassicReaddirSync = classicFs.readdirSync;

    const mockedReaddirSync = ((targetPath: any, options?: any) => {
        const normalized = String(targetPath).replace(/\\/g, '/');
        if (normalized.includes('/backend/locked')) {
            const error = new Error('permission denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
        }
        return originalReaddirSync(targetPath as any, options);
    }) as typeof nodeFs.readdirSync;

    nodeFs.readdirSync = mockedReaddirSync;
    classicFs.readdirSync = mockedReaddirSync;

    try {
        const runtimeMap = await extractRuntimeTopology(root);
        assert.equal(runtimeMap.schemaVersion, '1.0');
        assert.ok(runtimeMap.diagnostics?.some((diagnostic) => diagnostic.code === 'RUNTIME_PERMISSION_SKIPPED'));
    } finally {
        nodeFs.statSync = originalStatSync;
        nodeFs.readdirSync = originalReaddirSync;
        classicFs.readdirSync = originalClassicReaddirSync;
    }
});
