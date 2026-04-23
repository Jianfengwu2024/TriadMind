import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTreeSitterParser } from '../treeSitterParser';
import { shouldExcludeSourcePath, TriadConfig } from '../config';

type ParsedTriadNode = {
    nodeId: string;
    sourcePath: string;
    fission: {
        problem: string;
        demand: string[];
        answer: string[];
    };
    topology?: {
        foldedLeaves?: string[];
    };
};

function createTestConfig(): TriadConfig {
    return {
        schemaVersion: '1.1',
        architecture: {
            language: 'python',
            parserEngine: 'tree-sitter',
            adapter: '@triadmind/plugin-python'
        },
        categories: {
            frontend: ['src/frontend', 'frontend'],
            backend: ['src/backend', 'backend', 'src/api', 'api'],
            core: ['src/core', 'core', 'src/shared', 'shared', 'src/lib', 'lib']
        },
        parser: {
            excludePatterns: ['node_modules', '.triadmind'],
            excludePathPatterns: [
                'tests',
                'test',
                'schema',
                'schemas',
                'model',
                'models',
                'entity',
                'entities',
                'dto',
                'vo',
                'types',
                'types.py',
                'migrations',
                'alembic/versions',
                '__pycache__',
                'node_modules',
                'venv',
                '.venv',
                '.next',
                'dist',
                'build'
            ],
            scanCategories: ['frontend', 'backend', 'core'],
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
                'none',
                'dict[str,any]',
                'optional[str]',
                'optional[int]',
                'list[str]',
                'list[any]'
            ],
            includeUntaggedExports: true,
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
            maxFingerprintOwners: 100,
            fingerprintTimeoutMs: 50,
            maxRenderNodes: 400
        },
        protocol: {
            minConfidence: 0.6,
            requireConfidence: false
        },
        runtimeHealing: {
            enabled: true,
            maxAutoRetries: 3,
            requireHumanApprovalForContractChanges: true,
            snapshotStrategy: 'manual'
        }
    };
}

function writeProjectFixture(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-filtering-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
    }
    return root;
}

function parseFixture(files: Record<string, string>) {
    const projectRoot = writeProjectFixture(files);
    const outputPath = path.join(projectRoot, '.triadmind', 'triad-map.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    runTreeSitterParser('python', projectRoot, outputPath, createTestConfig());
    return JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as ParsedTriadNode[];
}

function parseFixtureMaps(files: Record<string, string>) {
    const projectRoot = writeProjectFixture(files);
    const outputPath = path.join(projectRoot, '.triadmind', 'triad-map.json');
    const leafOutputPath = path.join(projectRoot, '.triadmind', 'leaf-map.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    runTreeSitterParser('python', projectRoot, outputPath, createTestConfig());
    return {
        triadMap: JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as ParsedTriadNode[],
        leafMap: JSON.parse(fs.readFileSync(leafOutputPath, 'utf-8')) as ParsedTriadNode[]
    };
}

test('file-level exclusion blocks test and spec files before parsing', () => {
    const config = createTestConfig();
    assert.equal(shouldExcludeSourcePath('tests/test_users.py', config), true);
    assert.equal(shouldExcludeSourcePath('src/backend/test_users.py', config), true);
    assert.equal(shouldExcludeSourcePath('src/backend/users_test.py', config), true);
    assert.equal(shouldExcludeSourcePath('src/frontend/users.test.ts', config), true);
    assert.equal(shouldExcludeSourcePath('src/frontend/users.spec.ts', config), true);
    assert.equal(shouldExcludeSourcePath('src/backend/api/users.py', config), false);
});

test('test fixtures do not enter the architecture graph', () => {
    const nodes = parseFixture({
        'src/backend/services/user_service.py': `
class UserService:
    def execute(self, query: UserQuery) -> UserResult:
        return query
`,
        'tests/test_user_service.py': `
class TestUserService:
    def execute(self, query: UserQuery) -> UserResult:
        return query
`
    });

    assert.deepEqual(nodes.map((node) => node.nodeId), ['UserService.execute']);
    assert.equal(nodes.some((node) => node.sourcePath.includes('tests/')), false);
});

test('magic, private, and helper methods fold into execute instead of becoming capability nodes', () => {
    const nodes = parseFixture({
        'src/backend/nodes/geo_recon_node.py': `
class GeoReconNode:
    def execute(self, job: ReconJob) -> ReconResult:
        manifest = self._load_manifest(job)
        key = self.build_cache_key(manifest)
        return manifest

    def _load_manifest(self, job: ReconJob) -> Manifest:
        return job

    def build_cache_key(self, manifest: Manifest) -> str:
        return "cache"

    def __repr__(self) -> str:
        return "GeoReconNode"
`
    });

    assert.deepEqual(nodes.map((node) => node.nodeId), ['GeoReconNode.execute']);
    assert.deepEqual(nodes[0].topology?.foldedLeaves?.sort(), ['GeoReconNode._load_manifest', 'GeoReconNode.build_cache_key', 'GeoReconNode.execute']);
});

test('api conditional helpers are retained only when exposed as route handlers', () => {
    const nodes = parseFixture({
        'src/backend/api/users.py': `
@router.get("/users")
def list_users(filters: UserQuery) -> UserList:
    return filters

def list_cache_keys() -> list[str]:
    return []
`
    });

    assert.deepEqual(nodes.map((node) => node.nodeId), ['Users.list_users']);
});

test('types and schemas paths never enter the architecture graph', () => {
    const nodes = parseFixture({
        'src/backend/types.py': `
class UserRecord:
    pass
`,
        'src/backend/schemas/user_schema.py': `
class UserSchema:
    pass
`,
        'src/backend/services/user_service.py': `
class UserService:
    def execute(self, command: UserCommand) -> UserResult:
        return command
`
    });

    assert.deepEqual(nodes.map((node) => node.nodeId), ['UserService.execute']);
    assert.equal(nodes.some((node) => /types|schemas/.test(node.sourcePath)), false);
});

test('utils default to no promotion except explicit execution-style actions', () => {
    const nodes = parseFixture({
        'src/backend/utils/cache_tools.py': `
def get_cache_key(entry: CacheEntry) -> str:
    return "cache-key"

def run_cache_gc(command: CacheCommand) -> CacheResult:
    return command
`
    });

    assert.deepEqual(nodes.map((node) => node.nodeId), ['CacheTools.run_cache_gc']);
});

test('leaf-map stores implementation detail while triad-map stores promoted capabilities', () => {
    const { triadMap, leafMap } = parseFixtureMaps({
        'src/backend/nodes/geo_recon_node.py': `
class GeoReconNode:
    def execute(self, job: ReconJob) -> ReconResult:
        return self._load_manifest(job)

    def _load_manifest(self, job: ReconJob) -> Manifest:
        return job

    def build_cache_key(self, manifest: Manifest) -> str:
        return "cache"
`
    });

    assert.deepEqual(triadMap.map((node) => node.nodeId), ['GeoReconNode.execute']);
    assert.deepEqual(leafMap.map((node) => node.nodeId).sort(), [
        'GeoReconNode._load_manifest',
        'GeoReconNode.build_cache_key',
        'GeoReconNode.execute'
    ]);
});
