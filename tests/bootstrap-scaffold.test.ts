import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BootstrapScaffoldService } from '../bootstrapScaffoldService';
import { getWorkspacePaths } from '../workspace';

function createTempProject() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-bootstrap-'));
    const paths = getWorkspacePaths(projectRoot);
    fs.mkdirSync(paths.triadDir, { recursive: true });
    return { projectRoot, paths };
}

function countManagedBlocks(content: string) {
    const startCount = (content.match(/TRIADMIND_RULES_START/g) ?? []).length;
    const endCount = (content.match(/TRIADMIND_RULES_END/g) ?? []).length;
    return {
        startCount,
        endCount
    };
}

test('bootstrap init creates all scaffold files in an empty project', () => {
    const service = new BootstrapScaffoldService();
    const { paths } = createTempProject();

    const result = service.init(paths, { nonInteractive: true });
    const created = result.files.filter((item) => item.action === 'created').map((item) => item.key);
    assert.deepEqual(
        [...created].sort(),
        ['AGENTS.md', 'session-bootstrap.cmd', 'session-bootstrap.ps1', 'session-bootstrap.sh', 'skills.md'].sort()
    );

    assert.equal(fs.existsSync(paths.agentsFile), true);
    assert.equal(fs.existsSync(paths.skillsFile), true);
    assert.equal(fs.existsSync(paths.sessionBootstrapShellFile), true);
    assert.equal(fs.existsSync(paths.sessionBootstrapPs1File), true);
    assert.equal(fs.existsSync(paths.sessionBootstrapCmdFile), true);
});

test('bootstrap init is idempotent and does not duplicate managed block', () => {
    const service = new BootstrapScaffoldService();
    const { paths } = createTempProject();
    service.init(paths, { nonInteractive: true });

    const firstAgents = fs.readFileSync(paths.agentsFile, 'utf-8');
    const second = service.init(paths, { nonInteractive: true });
    const secondAgents = fs.readFileSync(paths.agentsFile, 'utf-8');

    assert.equal(firstAgents, secondAgents);
    assert.equal(second.files.every((item) => item.action === 'skipped'), true);
    const count = countManagedBlocks(secondAgents);
    assert.equal(count.startCount, 1);
    assert.equal(count.endCount, 1);
});

test('existing AGENTS.md keeps user content and updates only managed block', () => {
    const service = new BootstrapScaffoldService();
    const { paths } = createTempProject();
    fs.writeFileSync(
        paths.agentsFile,
        ['# Team Notes', '', 'Keep this custom section.', '', '<!-- TRIADMIND_RULES_START -->', 'old rules', '<!-- TRIADMIND_RULES_END -->', '']
            .join('\n'),
        'utf-8'
    );

    service.init(paths, { nonInteractive: true });
    const agents = fs.readFileSync(paths.agentsFile, 'utf-8');
    const count = countManagedBlocks(agents);

    assert.match(agents, /# Team Notes/);
    assert.match(agents, /Keep this custom section\./);
    assert.equal(agents.includes('old rules'), false);
    assert.match(agents, /# TriadMind Session Rules/);
    assert.equal(count.startCount, 1);
    assert.equal(count.endCount, 1);
});

test('--force overwrites scaffold templates while default init preserves existing files', () => {
    const service = new BootstrapScaffoldService();
    const { paths } = createTempProject();
    service.init(paths, { nonInteractive: true });

    fs.writeFileSync(paths.skillsFile, '# custom skills file\n', 'utf-8');
    const noForce = service.init(paths, { nonInteractive: true });
    assert.equal(noForce.files.find((item) => item.key === 'skills.md')?.action, 'skipped');
    assert.equal(fs.readFileSync(paths.skillsFile, 'utf-8'), '# custom skills file\n');

    const force = service.init(paths, { nonInteractive: true, force: true });
    assert.equal(force.files.find((item) => item.key === 'skills.md')?.action, 'updated');
    assert.match(fs.readFileSync(paths.skillsFile, 'utf-8'), /TriadMind Session SOP/);
});

test('windows bootstrap scripts are generated with expected command chain', () => {
    const service = new BootstrapScaffoldService();
    const { paths } = createTempProject();
    service.init(paths, { nonInteractive: true });

    const ps1 = fs.readFileSync(paths.sessionBootstrapPs1File, 'utf-8');
    const cmd = fs.readFileSync(paths.sessionBootstrapCmdFile, 'utf-8');
    const sh = fs.readFileSync(paths.sessionBootstrapShellFile, 'utf-8');

    assert.match(ps1, /Invoke-TriadMind "sync --force"/);
    assert.match(ps1, /Invoke-TriadMind "runtime --visualize --view full"/);
    assert.match(ps1, /plan --no-open --view architecture/);
    assert.match(ps1, /verify --strict --json/);
    assert.match(ps1, /bootstrap-verify\.json/);
    assert.match(ps1, /Set-Location \$ProjectRoot/);
    assert.match(sh, /cd "\$\{PROJECT_ROOT\}"/);

    assert.match(cmd, /powershell/i);
    assert.match(cmd, /session-bootstrap\.ps1/i);
    assert.match(cmd, /pushd "%SCRIPT_DIR%\.\."/i);
});

test('session bootstrap script generates .triadmind/bootstrap-verify.json', () => {
    const service = new BootstrapScaffoldService();
    const { projectRoot, paths } = createTempProject();

    const fakeCliPath = path.join(projectRoot, 'fake-triadmind.js');
    fs.writeFileSync(
        fakeCliPath,
        [
            '#!/usr/bin/env node',
            "const cmd = process.argv[2] || '';",
            "if (cmd === 'verify') {",
            "  process.stdout.write(JSON.stringify({ ok: true, strict: true }));",
            '}',
            'process.exit(0);'
        ].join('\n'),
        'utf-8'
    );
    fs.chmodSync(fakeCliPath, 0o755);

    service.init(paths, {
        nonInteractive: true,
        force: true,
        triadmindCommand: 'node ./fake-triadmind.js'
    });

    const run =
        process.platform === 'win32'
            ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.sessionBootstrapPs1File], {
                  cwd: projectRoot,
                  encoding: 'utf-8'
              })
            : spawnSync('bash', [paths.sessionBootstrapShellFile], {
                  cwd: projectRoot,
                  encoding: 'utf-8'
              });
    assert.equal(run.status, 0, `bootstrap shell failed: ${run.stderr || run.stdout}`);
    assert.equal(fs.existsSync(paths.bootstrapVerifyFile), true);

    const verifyRaw = fs.readFileSync(paths.bootstrapVerifyFile, 'utf-8').replace(/^\uFEFF/, '');
    const verify = JSON.parse(verifyRaw);
    assert.equal(verify.ok, true);
    assert.equal(verify.strict, true);
});
