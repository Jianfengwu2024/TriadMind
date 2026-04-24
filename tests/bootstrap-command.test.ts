import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createTempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-bootstrap-cli-'));
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

test('bootstrap doctor --json emits machine-readable report', () => {
    const root = createTempProject();
    const result = runCli(root, ['bootstrap', 'doctor', '--json']);

    assert.equal(result.status, 1, 'doctor should fail before scaffold init');
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'doctor json payload missing');
    const report = JSON.parse(result.stdout.slice(jsonStart));

    assert.equal(report.schemaVersion, '1.0');
    assert.equal(report.passed, false);
    assert.equal(Array.isArray(report.files), true);
    assert.equal(report.files.length, 5);
    assert.equal(report.files.every((item: { key?: string; status?: string }) => typeof item.key === 'string' && typeof item.status === 'string'), true);
});

test('triadmind init triggers bootstrap scaffold by default and supports --skip-bootstrap', () => {
    const withBootstrap = createTempProject();
    const initDefault = runCli(withBootstrap, ['init']);
    assert.equal(initDefault.status, 0, `init failed: ${initDefault.stderr || initDefault.stdout}`);
    assert.equal(fs.existsSync(path.join(withBootstrap, 'skills.md')), true);
    assert.equal(fs.existsSync(path.join(withBootstrap, '.triadmind', 'session-bootstrap.sh')), true);
    assert.equal(fs.existsSync(path.join(withBootstrap, '.triadmind', 'session-bootstrap.ps1')), true);
    assert.equal(fs.existsSync(path.join(withBootstrap, '.triadmind', 'session-bootstrap.cmd')), true);

    const skipBootstrap = createTempProject();
    const initSkip = runCli(skipBootstrap, ['init', '--skip-bootstrap']);
    assert.equal(initSkip.status, 0, `init --skip-bootstrap failed: ${initSkip.stderr || initSkip.stdout}`);
    assert.equal(fs.existsSync(path.join(skipBootstrap, 'skills.md')), false);
    assert.equal(fs.existsSync(path.join(skipBootstrap, '.triadmind', 'session-bootstrap.sh')), false);
    assert.equal(fs.existsSync(path.join(skipBootstrap, '.triadmind', 'session-bootstrap.ps1')), false);
    assert.equal(fs.existsSync(path.join(skipBootstrap, '.triadmind', 'session-bootstrap.cmd')), false);
});
