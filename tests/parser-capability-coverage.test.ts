import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTreeSitterParser } from '../treeSitterParser';
import { TriadConfig } from '../config';

type ParsedTriadNode = {
    nodeId: string;
    category: string;
    sourcePath: string;
};

function createTestConfig(language: 'typescript' | 'javascript' | 'python'): TriadConfig {
    return {
        schemaVersion: '1.1',
        architecture: {
            language,
            parserEngine: 'tree-sitter',
            adapter:
                language === 'typescript'
                    ? '@triadmind/plugin-ts'
                    : language === 'javascript'
                      ? '@triadmind/plugin-js'
                      : '@triadmind/plugin-python'
        },
        categories: {
            frontend: ['frontend', 'src/frontend', 'src/app', 'app'],
            backend: ['backend', 'src/backend', 'server', 'api'],
            agent: ['agent', 'src/agent'],
            rheo_cli: ['rheo_cli', 'src/rheo_cli', 'cli', 'src/cli'],
            core: ['core', 'src/core', 'shared', 'src/shared', 'lib', 'src/lib']
        },
        parser: {
            excludePatterns: ['node_modules', '.triadmind'],
            excludePathPatterns: ['tests', 'test', 'dist', 'build', '.next'],
            scanCategories: ['frontend', 'agent', 'rheo_cli'],
            scanMode: 'capability',
            leafOutputFile: '.triadmind/leaf-map.json',
            capabilityOutputFile: '.triadmind/triad-map.json',
            capabilityThreshold: 4,
            excludeTestFiles: true,
            excludeMagicMethods: true,
            excludePrivateMethods: true,
            helperVerbPolicy: 'suppress',
            foldHelpersIntoOwner: true,
            entryMethodNames: ['execute', 'run', 'handle', 'process', 'dispatch', 'apply', 'invoke', 'plan', 'schedule', 'orchestrate'],
            excludeNodeNamePatterns: ['^(__.*__|_(?!_).*)$', '^(test_.+)$', '^__.*__$', '^(upgrade|downgrade)$'],
            ignoreGenericContracts: true,
            genericContractIgnoreList: [
                'str',
                'string',
                'int',
                'number',
                'bool',
                'boolean',
                'float',
                'dict',
                'object',
                'list',
                'array',
                'any',
                'unknown',
                'json',
                'request',
                'response',
                'path',
                'void',
                'none'
            ],
            includeUntaggedExports: true,
            ghostPolicyByLanguage: {
                default: { includeInDemand: true, topK: 5, minConfidence: 4 },
                typescript: { includeInDemand: true, topK: 4, minConfidence: 4 },
                javascript: { includeInDemand: false, topK: 0, minConfidence: 5 },
                python: { includeInDemand: false, topK: 0, minConfidence: 5 }
            },
            jsDocTags: {
                triadNode: 'TriadNode',
                leftBranch: 'LeftBranch',
                rightBranch: 'RightBranch'
            }
        },
        visualizer: {
            defaultView: 'architecture',
            showIsolatedCapabilities: false,
            showFoldedLeaves: false,
            maxContractEdges: 1200,
            maxPrimaryEdges: 1500,
            fastMode: true,
            strictFingerprint: false,
            fastMayaThreshold: 0,
            fastFingerprintThreshold: 0,
            maxFingerprintNodes: 8,
            maxFingerprintOwners: 50,
            fingerprintTimeoutMs: 50,
            maxRenderNodes: 400
        },
        protocol: {
            minConfidence: 0.6,
            requireConfidence: false
        },
        runtime: {
            enabled: true,
            defaultView: 'full',
            includeFrontend: true,
            includeInfra: true,
            frameworkHints: [],
            excludePathPatterns: ['node_modules', '.triadmind', 'dist', 'build', 'tests', 'test'],
            maxSourceFileBytes: 500000,
            maxScannedFiles: 5000,
            failOnExtractorError: false,
            minConfidence: 0.4
        },
        runtimeHealing: {
            enabled: true,
            maxAutoRetries: 3,
            requireHumanApprovalForContractChanges: true,
            snapshotStrategy: 'manual'
        },
        profile: {
            schemaVersion: '1.0',
            categories: {},
            scanScopes: [
                { name: 'ui', kind: 'ui', match: { pathSegments: ['frontend', 'app', 'pages', 'page', 'dashboard', 'settings'] } },
                { name: 'agent', kind: 'agent', match: { pathSegments: ['agent', 'chat', 'session'] } },
                { name: 'cli', kind: 'cli', match: { pathSegments: ['rheo_cli', 'commands', 'cli'] } }
            ],
            languageAdapters: {},
            extractors: {
                parser: [],
                runtime: []
            }
        }
    };
}

function writeFixture(root: string, relativePath: string, content: string) {
    const targetPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
}

function parseFixture(language: 'typescript' | 'javascript' | 'python', files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `triadmind-capability-${language}-`));
    for (const [relativePath, content] of Object.entries(files)) {
        writeFixture(root, relativePath, content);
    }

    const triadPath = path.join(root, '.triadmind', 'triad-map.json');
    runTreeSitterParser(language, root, triadPath, createTestConfig(language));

    return {
        triadMap: JSON.parse(fs.readFileSync(triadPath, 'utf-8')) as ParsedTriadNode[],
        leafMap: JSON.parse(fs.readFileSync(path.join(root, '.triadmind', 'leaf-map.json'), 'utf-8')) as ParsedTriadNode[]
    };
}

test('typescript frontend page and hook exports are promoted into triad and leaf maps', () => {
    const { triadMap, leafMap } = parseFixture('typescript', {
        'frontend/src/app/dashboard/page.tsx': `
type DashboardQuery = { teamId: string };
type DashboardViewModel = { summary: string };
type DashboardMetrics = { total: number };
type MetricsGateway = { loadMetrics(): DashboardMetrics };

export default function DashboardPage(query: DashboardQuery): DashboardViewModel {
    return { summary: query.teamId };
}

const useDashboardMetrics = (gateway: MetricsGateway): DashboardMetrics => gateway.loadMetrics();
export { useDashboardMetrics };
`
    });

    const triadIds = triadMap.filter((node) => node.sourcePath === 'frontend/src/app/dashboard/page.tsx').map((node) => node.nodeId).sort();
    const leafIds = leafMap.filter((node) => node.sourcePath === 'frontend/src/app/dashboard/page.tsx').map((node) => node.nodeId).sort();

    assert.deepEqual(triadIds, ['Page.DashboardPage', 'Page.useDashboardMetrics']);
    assert.deepEqual(leafIds, ['Page.DashboardPage', 'Page.useDashboardMetrics']);
    assert.equal(triadMap.some((node) => node.nodeId === 'Page.module_pipeline'), false);
});

test('typescript agent orchestration and cli entrypoints promote via path-aware semantics', () => {
    const { triadMap } = parseFixture('typescript', {
        'agent/chat/session_orchestrator.ts': `
type AgentSession = { sessionId: string };
type ToolPlanner = { plan(session: AgentSession): AgentReply };
type AgentReply = { message: string };

export class SessionOrchestrator {
    orchestrateTurn(session: AgentSession, toolPlanner: ToolPlanner): AgentReply {
        return toolPlanner.plan(session);
    }
}
`,
        'rheo_cli/main.ts': `
type CliArgs = { command: string };
type Command = { name(value: string): Command };
type CliRuntime = { attach(program: Command): Command };

export async function main(argv: CliArgs, program: Command): Promise<number> {
    return argv.command.length + (program ? 0 : 1);
}

const createDeployCommand = (program: Command, runtime: CliRuntime): Command => runtime.attach(program);
export { createDeployCommand };
`
    });

    const idsByPath = new Map<string, string[]>();
    triadMap.forEach((node) => {
        const entries = idsByPath.get(node.sourcePath) ?? [];
        entries.push(node.nodeId);
        idsByPath.set(node.sourcePath, entries);
    });

    assert.deepEqual((idsByPath.get('agent/chat/session_orchestrator.ts') ?? []).sort(), ['SessionOrchestrator.orchestrateTurn']);
    assert.deepEqual((idsByPath.get('rheo_cli/main.ts') ?? []).sort(), ['Main.createDeployCommand', 'Main.main']);
});

test('typescript cli command descriptor objects with satisfies/export default become executable nodes', () => {
    const { triadMap, leafMap } = parseFixture('typescript', {
        'rheo_cli/commands/agents/index.ts': `
type Command = { load(): Promise<unknown> };

const agents = {
    type: 'local-jsx',
    name: 'agents',
    description: 'Manage agent configurations',
    load: () => import('./agents.js')
} satisfies Command;

export default agents;
`
    });

    const triadIds = triadMap.filter((node) => node.sourcePath === 'rheo_cli/commands/agents/index.ts').map((node) => node.nodeId);
    const leafIds = leafMap.filter((node) => node.sourcePath === 'rheo_cli/commands/agents/index.ts').map((node) => node.nodeId);

    assert.deepEqual(triadIds, ['Agents.load']);
    assert.deepEqual(leafIds, ['Agents.load']);
});

test('typescript cli registration chains create synthetic command coverage nodes', () => {
    const { triadMap, leafMap } = parseFixture('typescript', {
        'rheo_cli/commands/registry.ts': `
const cli = createCli();
cli.command('deploy', 'Deploy release', buildDeploy, runDeploy);
program.command('agents').description('Manage agents').action(loadAgents);
`
    });

    const triadIds = triadMap.filter((node) => node.sourcePath === 'rheo_cli/commands/registry.ts').map((node) => node.nodeId).sort();
    const leafIds = leafMap.filter((node) => node.sourcePath === 'rheo_cli/commands/registry.ts').map((node) => node.nodeId).sort();

    assert.deepEqual(triadIds, ['Agents.loadAgents', 'Deploy.runDeploy']);
    assert.deepEqual(leafIds, ['Agents.loadAgents', 'Deploy.runDeploy']);
});

test('javascript frontend default-export identifier resolves back to executable capability', () => {
    const { triadMap } = parseFixture('javascript', {
        'frontend/src/app/settings/page.jsx': `
const SettingsPage = ({ apiClient }) => apiClient;
export default SettingsPage;
`
    });

    const ids = triadMap.filter((node) => node.sourcePath === 'frontend/src/app/settings/page.jsx').map((node) => node.nodeId);
    assert.deepEqual(ids, ['Page.SettingsPage']);
});

test('javascript direct default-export object exposes executable members for cli-like modules', () => {
    const { triadMap } = parseFixture('javascript', {
        'rheo_cli/commands/deploy/index.js': `
export default {
    load: () => import('./deploy.js')
};
`
    });

    const ids = triadMap.filter((node) => node.sourcePath === 'rheo_cli/commands/deploy/index.js').map((node) => node.nodeId);
    assert.deepEqual(ids, ['Index.load']);
});

test('python argparse registration modules create synthetic cli capability nodes', () => {
    const { triadMap, leafMap } = parseFixture('python', {
        'rheo_cli/commands/deploy.py': `
deploy = subparsers.add_parser("deploy")
deploy.set_defaults(func=deploy_handler)
`
    });

    const triadIds = triadMap.filter((node) => node.sourcePath === 'rheo_cli/commands/deploy.py').map((node) => node.nodeId).sort();
    const leafIds = leafMap.filter((node) => node.sourcePath === 'rheo_cli/commands/deploy.py').map((node) => node.nodeId).sort();

    assert.deepEqual(triadIds, ['Deploy.command', 'Deploy.deploy_handler']);
    assert.deepEqual(leafIds, ['Deploy.command', 'Deploy.deploy_handler']);
});
