import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function runCli(cwd: string, args: string[]) {
    const repoRoot = path.resolve(__dirname, '..');
    const cliPath = path.join(repoRoot, 'cli.ts');
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    return spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], {
        cwd,
        encoding: 'utf-8'
    });
}

test('sync --force generates view-map artifacts by default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-view-map-cli-'));
    fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'backend', 'service.ts'),
        `
export class WorkflowService {
  dispatch(input: { id: string }): { ok: boolean } {
    return { ok: Boolean(input.id) };
  }
}
`,
        'utf-8'
    );

    const result = runCli(root, ['sync', '--force']);
    assert.equal(result.status, 0, `sync command failed: ${result.stderr || result.stdout}`);

    const viewMapFile = path.join(root, '.triadmind', 'view-map.json');
    const viewMapDiagnosticsFile = path.join(root, '.triadmind', 'view-map-diagnostics.json');
    assert.equal(fs.existsSync(viewMapFile), true);
    assert.equal(fs.existsSync(viewMapDiagnosticsFile), true);

    const payload = JSON.parse(fs.readFileSync(viewMapFile, 'utf-8'));
    assert.equal(payload.schemaVersion, '1.0');
    assert.ok(typeof payload.stats?.linkCount === 'number');
    assert.ok(Array.isArray(payload.diagnostics));
});
