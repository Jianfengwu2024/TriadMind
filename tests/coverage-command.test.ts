import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createCoverageFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-coverage-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });

    const sourceFiles: Record<string, string> = {
        'backend/service.py': 'def execute():\n    return True\n',
        'frontend/dashboard.tsx': 'export const Dashboard = () => null;\n',
        'agent/chat.py': 'def orchestrate():\n    return True\n',
        'rheo_cli/main.py': 'def main():\n    return 0\n'
    };

    for (const [relativePath, content] of Object.entries(sourceFiles)) {
        const targetPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf-8');
    }

    fs.writeFileSync(
        path.join(triadDir, 'triad-map.json'),
        JSON.stringify(
            [
                {
                    nodeId: 'BackendService.execute',
                    category: 'backend',
                    sourcePath: 'backend/service.py',
                    fission: {
                        problem: 'backend',
                        demand: ['None'],
                        answer: ['bool']
                    }
                },
                {
                    nodeId: 'AgentChat.orchestrate',
                    category: 'agent',
                    sourcePath: 'agent/chat.py',
                    fission: {
                        problem: 'agent',
                        demand: ['None'],
                        answer: ['bool']
                    }
                }
            ],
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(
        path.join(triadDir, 'runtime-map.json'),
        JSON.stringify(
            {
                schemaVersion: '1.0',
                project: 'coverage-test',
                generatedAt: new Date().toISOString(),
                view: 'full',
                nodes: [
                    {
                        id: 'FrontendEntry.dashboard',
                        type: 'FrontendEntry',
                        label: 'Dashboard',
                        sourcePath: 'frontend/dashboard.tsx',
                        category: 'frontend'
                    },
                    {
                        id: 'CliCommand.main',
                        type: 'CliCommand',
                        label: 'main',
                        sourcePath: 'rheo_cli/main.py',
                        category: 'rheo_cli'
                    }
                ],
                edges: [
                    {
                        from: 'FrontendEntry.dashboard',
                        to: 'CliCommand.main',
                        type: 'calls',
                        confidence: 0.7,
                        evidence: [
                            {
                                sourcePath: 'frontend/dashboard.tsx',
                                kind: 'call',
                                text: 'fetch()'
                            },
                            {
                                sourcePath: 'rheo_cli/main.py',
                                kind: 'call',
                                text: 'main()'
                            }
                        ]
                    }
                ]
            },
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(path.join(triadDir, 'runtime-diagnostics.json'), '[]', 'utf-8');
    return root;
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

test('coverage --json writes coverage-report.json and reports category/root coverage', () => {
    const root = createCoverageFixture();
    const result = runCli(root, ['coverage', '--json']);
    assert.equal(result.status, 0, `coverage command failed: ${result.stderr || result.stdout}`);

    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'coverage --json did not emit json payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));

    assert.equal(report.summary.totalSourceFiles, 4);
    assert.equal(report.summary.combinedCoverage, 1);
    assert.equal(report.byCategory.backend.combinedCoverage, 1);
    assert.equal(report.byCategory.frontend.runtimeCoverage, 1);
    assert.equal(report.byCategory.agent.triadCoverage, 1);
    assert.equal(report.byCategory.rheo_cli.runtimeCoverage, 1);
    assert.equal(report.byRoot.backend.totalSourceFiles, 1);
    assert.equal(report.byRoot.rheo_cli.combinedCoverage, 1);
    assert.equal(fs.existsSync(path.join(root, '.triadmind', 'coverage-report.json')), true);
});
