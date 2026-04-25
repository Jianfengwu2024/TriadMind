import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { syncTriadMapWithOptions } from '../sync';
import { getWorkspacePaths } from '../workspace';

function writeFile(root: string, relativePath: string, content: string) {
    const targetPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
}

test('sync --force aggregates capability and leaf maps across multiple languages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-sync-multilang-'));
    const paths = getWorkspacePaths(root);

    writeFile(
        root,
        '.triadmind/config.json',
        JSON.stringify(
            {
                schemaVersion: '1.1',
                architecture: {
                    language: 'python',
                    parserEngine: 'tree-sitter',
                    adapter: '@triadmind/plugin-python'
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
            },
            null,
            2
        )
    );

    writeFile(
        root,
        'backend/order_service.py',
        `class OrderService:\n    def handle(self, payload):\n        return payload\n`
    );
    writeFile(
        root,
        'frontend/dashboard.tsx',
        `export function renderDashboard(input: string) {\n  return input;\n}\n`
    );
    writeFile(root, 'agent/entry.py', `def run():\n    return True\n`);
    writeFile(root, 'rheo_cli/entry.py', `def run():\n    return 0\n`);

    const result = syncTriadMapWithOptions(paths, { force: true });
    assert.equal(result.changed, true);

    const triadMap = JSON.parse(fs.readFileSync(paths.mapFile, 'utf-8'));
    const leafMap = JSON.parse(fs.readFileSync(paths.leafMapFile, 'utf-8'));

    const triadCategories = new Set(triadMap.map((node: { category?: string }) => node.category));
    assert.equal(triadCategories.has('backend'), true);
    assert.equal(triadCategories.has('frontend'), true);
    assert.equal(triadCategories.has('agent'), true);
    assert.equal(triadCategories.has('rheo_cli'), true);

    const entryLeafNodes = leafMap.filter((node: { sourcePath?: string }) =>
        ['agent/entry.py', 'rheo_cli/entry.py'].includes(String(node.sourcePath))
    );
    assert.equal(entryLeafNodes.length >= 2, true);
    assert.equal(new Set(entryLeafNodes.map((node: { nodeId?: string }) => String(node.nodeId))).size, entryLeafNodes.length);
});
