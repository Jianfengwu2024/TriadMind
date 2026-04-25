import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function createDreamFixture(options?: {
    executeSourcePath?: string;
    paymentSourcePath?: string;
    executeCategory?: string;
    paymentCategory?: string;
}) {
    const executeSourcePath = options?.executeSourcePath ?? 'src/backend/order_service.py';
    const paymentSourcePath = options?.paymentSourcePath ?? 'src/backend/payment_service.py';
    const executeCategory = options?.executeCategory ?? 'backend';
    const paymentCategory = options?.paymentCategory ?? 'backend';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-dream-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });

    fs.writeFileSync(
        path.join(triadDir, 'triad-map.json'),
        JSON.stringify(
            [
                {
                    nodeId: 'OrderService.execute',
                    category: executeCategory,
                    sourcePath: executeSourcePath,
                    fission: {
                        problem: 'Execute order orchestration',
                        demand: ['OrderCommand (command)', '[Ghost:Read] Cache (orderCache)'],
                        answer: ['OrderResult']
                    }
                },
                {
                    nodeId: 'PaymentService.process',
                    category: paymentCategory,
                    sourcePath: paymentSourcePath,
                    fission: {
                        problem: 'Process payment',
                        demand: ['OrderResult'],
                        answer: ['PaymentResult']
                    }
                },
                {
                    nodeId: 'NotificationService.handle',
                    category: 'backend',
                    sourcePath: 'src/backend/notification_service.py',
                    fission: {
                        problem: 'Handle notification',
                        demand: ['OrderResult'],
                        answer: ['void']
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
                project: 'dream-test',
                generatedAt: new Date().toISOString(),
                view: 'full',
                nodes: [
                    { id: 'ApiRoute.POST./orders/run', type: 'ApiRoute', label: 'POST /orders/run' },
                    { id: 'Service.OrderService.execute', type: 'Service', label: 'OrderService.execute' }
                ],
                edges: [
                    {
                        from: 'ApiRoute.POST./orders/run',
                        to: 'Service.OrderService.execute',
                        type: 'invokes',
                        confidence: 0.92
                    }
                ]
            },
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(
        path.join(triadDir, 'runtime-diagnostics.json'),
        JSON.stringify(
            [
                {
                    level: 'warning',
                    code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                    extractor: 'FrontendApiCallExtractor',
                    message: 'Could not match frontend API call /api/orders/123/run to a known ApiRoute',
                    sourcePath: 'frontend/src/api/orders.ts'
                }
            ],
            null,
            2
        ),
        'utf-8'
    );

    return root;
}

function resolveCategoryFromConfigRoot(root: string, sourcePath: string | undefined) {
    const configPath = path.join(root, '.triadmind', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const categories = config?.categories ?? {};
    const normalizedSourcePath = String(sourcePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalizedSourcePath) {
        return 'unknown';
    }

    let best: { category: string; length: number } | undefined;
    for (const [category, patterns] of Object.entries(categories)) {
        for (const rawPattern of Array.isArray(patterns) ? patterns : []) {
            const normalizedPattern = String(rawPattern ?? '')
                .replace(/\\/g, '/')
                .replace(/^\.\//, '')
                .replace(/\/+$/, '');
            if (!normalizedPattern) {
                continue;
            }
            if (normalizedSourcePath === normalizedPattern || normalizedSourcePath.startsWith(`${normalizedPattern}/`)) {
                if (!best || normalizedPattern.length > best.length) {
                    best = {
                        category: String(category),
                        length: normalizedPattern.length
                    };
                }
            }
        }
    }
    return best?.category ?? 'unknown';
}

function collectProtocolDraftNodeCategoryMismatches(
    root: string,
    report: { proposals?: Array<{ id?: string; protocolDraft?: { actions?: Array<{ node?: { nodeId?: string; sourcePath?: string; category?: string } }> } }> }
) {
    const mismatch: Array<{
        proposalId: string;
        nodeId: string;
        category: string;
        resolved: string;
        sourcePath: string;
    }> = [];
    for (const proposal of Array.isArray(report.proposals) ? report.proposals : []) {
        for (const action of Array.isArray(proposal.protocolDraft?.actions) ? proposal.protocolDraft?.actions : []) {
            const node = action?.node;
            if (!node?.sourcePath) {
                continue;
            }
            const resolved = resolveCategoryFromConfigRoot(root, node.sourcePath);
            const category = String(node.category ?? 'unknown');
            if (category !== resolved) {
                mismatch.push({
                    proposalId: String(proposal.id ?? 'unknown'),
                    nodeId: String(node.nodeId ?? 'unknown'),
                    category,
                    resolved,
                    sourcePath: String(node.sourcePath)
                });
            }
        }
    }
    return mismatch;
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

test('dream run --json writes dream artifacts and proposals', () => {
    const root = createDreamFixture();
    const result = runCli(root, ['dream', 'run', '--json']);
    assert.equal(result.status, 0, `dream run failed: ${result.stderr || result.stdout}`);

    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'dream run --json did not emit JSON payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));

    assert.equal(report.schemaVersion, '1.0');
    assert.equal(report.skipped, false);
    assert.equal(Array.isArray(report.findings), true);
    assert.equal(Array.isArray(report.proposals), true);
    assert.equal(report.proposals.length > 0, true);

    const triadDir = path.join(root, '.triadmind');
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-report.json')), true);
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-diagnostics.json')), true);
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-proposals.json')), true);
    assert.equal(fs.existsSync(path.join(triadDir, 'dream-state.json')), true);
});

test('dream (no subcommand) defaults to dream run and accepts --json', () => {
    const root = createDreamFixture();
    const result = runCli(root, ['dream', '--json']);
    assert.equal(result.status, 0, `dream --json failed: ${result.stderr || result.stdout}`);

    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'dream --json did not emit JSON payload');
    const report = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(report.schemaVersion, '1.0');
    assert.equal(report.skipped, false);
    assert.equal(Array.isArray(report.proposals), true);
});

test('dream --json and dream run --json are both supported', () => {
    const root1 = createDreamFixture();
    const direct = runCli(root1, ['dream', '--json']);
    assert.equal(direct.status, 0, `dream --json failed: ${direct.stderr || direct.stdout}`);
    const directPayload = JSON.parse(direct.stdout.slice(direct.stdout.indexOf('{')));

    const root2 = createDreamFixture();
    const explicit = runCli(root2, ['dream', 'run', '--json']);
    assert.equal(explicit.status, 0, `dream run --json failed: ${explicit.stderr || explicit.stdout}`);
    const explicitPayload = JSON.parse(explicit.stdout.slice(explicit.stdout.indexOf('{')));

    assert.equal(Array.isArray(directPayload.proposals), true);
    assert.equal(Array.isArray(explicitPayload.proposals), true);
    assert.equal(directPayload.proposals.length > 0, true);
    assert.equal(explicitPayload.proposals.length > 0, true);
});

test('dream idle mode respects minHoursBetweenRuns gate', () => {
    const root = createDreamFixture();

    const firstRun = runCli(root, ['dream', 'run', '--mode', 'idle', '--json']);
    assert.equal(firstRun.status, 0, `first idle dream run failed: ${firstRun.stderr || firstRun.stdout}`);
    const firstPayload = JSON.parse(firstRun.stdout.slice(firstRun.stdout.indexOf('{')));
    assert.equal(firstPayload.skipped, false);

    const secondRun = runCli(root, ['dream', 'run', '--mode', 'idle', '--json']);
    assert.equal(secondRun.status, 0, `second idle dream run failed: ${secondRun.stderr || secondRun.stdout}`);
    const secondPayload = JSON.parse(secondRun.stdout.slice(secondRun.stdout.indexOf('{')));
    assert.equal(secondPayload.skipped, true);
    assert.match(String(secondPayload.skipReason ?? ''), /Idle gate active/i);
});

test('dream review --json returns latest report', () => {
    const root = createDreamFixture();
    const runResult = runCli(root, ['dream', 'run', '--json']);
    assert.equal(runResult.status, 0, `dream run failed: ${runResult.stderr || runResult.stdout}`);

    const reviewResult = runCli(root, ['dream', 'review', '--json']);
    assert.equal(reviewResult.status, 0, `dream review failed: ${reviewResult.stderr || reviewResult.stdout}`);
    const report = JSON.parse(reviewResult.stdout.slice(reviewResult.stdout.indexOf('{')));
    assert.equal(report.schemaVersion, '1.0');
    assert.equal(Array.isArray(report.summary), true);
});

test('dream proposal category and protocolDraft node.category are canonicalized by sourcePath', () => {
    const root = createDreamFixture({
        executeSourcePath: 'src/backend/orders/execution.py',
        paymentSourcePath: 'src/backend/payments/processor.py',
        executeCategory: 'frontend'
    });
    const runResult = runCli(root, ['dream', '--json']);
    assert.equal(runResult.status, 0, `dream run failed: ${runResult.stderr || runResult.stdout}`);

    const report = JSON.parse(runResult.stdout.slice(runResult.stdout.indexOf('{')));
    const proposals = Array.isArray(report.proposals) ? report.proposals : [];
    const backendProposal = proposals.find(
        (proposal: { sourcePath?: string; category?: string }) =>
            typeof proposal?.sourcePath === 'string' && proposal.sourcePath.includes('src/backend/')
    );
    assert.ok(backendProposal, 'expected at least one proposal with backend sourcePath');
    assert.equal(
        backendProposal.category,
        resolveCategoryFromConfigRoot(root, backendProposal.sourcePath),
        'outer proposal category should align with sourcePath'
    );

    const actions = Array.isArray(backendProposal.protocolDraft?.actions) ? backendProposal.protocolDraft.actions : [];
    const createChildAction = actions.find(
        (action: { op?: string; node?: { sourcePath?: string; category?: string } }) => action?.op === 'create_child'
    );
    assert.ok(createChildAction, 'expected create_child action in protocol draft');
    assert.equal(
        createChildAction.node.category,
        resolveCategoryFromConfigRoot(root, createChildAction.node.sourcePath),
        'protocolDraft node.category should align with node.sourcePath'
    );

    const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
    assert.equal(
        diagnostics.some((item: { code?: string }) => item.code === 'DREAM_PROPOSAL_CATEGORY_MISMATCH_AUTO_FIXED'),
        true
    );
});

test('dream canonicalize removes all protocolDraft node category/sourcePath mismatches', () => {
    const root = createDreamFixture({
        executeSourcePath: 'src/backend/orders/execution.py',
        paymentSourcePath: 'src/backend/payments/processor.py',
        executeCategory: 'frontend',
        paymentCategory: 'frontend'
    });
    const runResult = runCli(root, ['dream', '--json']);
    assert.equal(runResult.status, 0, `dream run failed: ${runResult.stderr || runResult.stdout}`);

    const report = JSON.parse(runResult.stdout.slice(runResult.stdout.indexOf('{')));
    const mismatch = collectProtocolDraftNodeCategoryMismatches(root, report);
    assert.equal(mismatch.length, 0, `expected protocolDraft mismatch=0, got ${JSON.stringify(mismatch, null, 2)}`);
});

test('dream proposal category falls back to unknown when sourcePath cannot map', () => {
    const root = createDreamFixture({
        executeSourcePath: 'services/order_service.py',
        paymentSourcePath: 'domain/payment_service.py'
    });
    const runResult = runCli(root, ['dream', '--json']);
    assert.equal(runResult.status, 0, `dream run failed: ${runResult.stderr || runResult.stdout}`);

    const report = JSON.parse(runResult.stdout.slice(runResult.stdout.indexOf('{')));
    const proposals = Array.isArray(report.proposals) ? report.proposals : [];
    const unknownCategoryProposal = proposals.find(
        (proposal: { sourcePath?: string; category?: string }) =>
            typeof proposal?.sourcePath === 'string' &&
            proposal.sourcePath.includes('services/order_service.py') &&
            proposal.category === 'unknown'
    );
    assert.ok(unknownCategoryProposal, 'expected unmapped proposal category to downgrade to unknown');

    const actions = Array.isArray(unknownCategoryProposal.protocolDraft?.actions)
        ? unknownCategoryProposal.protocolDraft.actions
        : [];
    const createChildAction = actions.find(
        (action: { op?: string; node?: { sourcePath?: string; category?: string } }) =>
            action?.op === 'create_child' && action?.node?.sourcePath?.includes('services/order_service.py')
    );
    assert.ok(createChildAction, 'expected create_child action using unmapped sourcePath');
    assert.equal(createChildAction.node.category, 'unknown');

    const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
    assert.equal(
        diagnostics.some((item: { code?: string }) => item.code === 'DREAM_PROPOSAL_CATEGORY_UNRESOLVED'),
        true
    );
});

test('dream auto --json emits auto tick result payload', () => {
    const root = createDreamFixture();
    const result = runCli(root, ['dream', 'auto', '--trigger', 'sync', '--force', '--json']);
    assert.equal(result.status, 0, `dream auto failed: ${result.stderr || result.stdout}`);

    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, 'dream auto --json did not emit JSON payload');
    const payload = JSON.parse(result.stdout.slice(jsonStart));
    assert.equal(typeof payload.status, 'string');
    assert.equal(typeof payload.pendingEvents, 'number');
});
