import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePaths, normalizePath } from './workspace';
import { TriadCategory } from './protocol';
import { RuntimeConfig, RuntimeView } from './runtime/types';

export type TriadLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'cpp' | 'java';
export type TriadParserEngine = 'native' | 'tree-sitter';
export type TriadScanMode = 'leaf' | 'capability' | 'module' | 'domain';
export type HelperVerbPolicy = 'suppress' | 'allow';
export type GhostPolicyLanguageKey = TriadLanguage | 'default';
export type TriadSourcePolicy =
    | 'api'
    | 'ui'
    | 'cli'
    | 'agent'
    | 'types'
    | 'tests'
    | 'migrations'
    | 'nodes'
    | 'tasks'
    | 'services'
    | 'utils'
    | 'other';

export interface GhostLanguagePolicy {
    includeInDemand: boolean;
    topK: number;
    minConfidence: number;
}

export type GhostPolicyByLanguage = Partial<Record<GhostPolicyLanguageKey, GhostLanguagePolicy>>;
export type TriadCategoryMap = Record<string, string[]>;

export interface TriadScanScopeRule {
    pathPrefixes?: string[];
    pathSegments?: string[];
    filePatterns?: string[];
    includePatterns?: string[];
    excludePatterns?: string[];
}

export interface TriadScanScope {
    name: string;
    kind: TriadSourcePolicy;
    priority?: number;
    category?: string;
    match?: TriadScanScopeRule;
}

export interface TriadProfile {
    schemaVersion: string;
    categories?: TriadCategoryMap;
    scanScopes?: TriadScanScope[];
    languageAdapters?: Partial<Record<TriadLanguage, string>>;
    extractors?: {
        parser?: string[];
        runtime?: string[];
    };
}

export interface TriadConfig {
    schemaVersion: string;
    architecture: {
        language: TriadLanguage;
        parserEngine: TriadParserEngine;
        adapter: string;
    };
    categories: TriadCategoryMap;
    parser: {
        excludePatterns: string[];
        excludePathPatterns: string[];
        scanCategories: string[];
        scanMode: TriadScanMode;
        leafOutputFile: string;
        capabilityOutputFile: string;
        capabilityThreshold: number;
        excludeTestFiles: boolean;
        excludeMagicMethods: boolean;
        excludePrivateMethods: boolean;
        helperVerbPolicy: HelperVerbPolicy;
        foldHelpersIntoOwner: boolean;
        entryMethodNames: string[];
        excludeNodeNamePatterns: string[];
        ignoreGenericContracts: boolean;
        genericContractIgnoreList: string[];
        includeUntaggedExports: boolean;
        ghostPolicyByLanguage: GhostPolicyByLanguage;
        jsDocTags: {
            triadNode: string;
            leftBranch: string;
            rightBranch: string;
        };
    };
    visualizer: {
        defaultView: 'architecture' | 'leaf';
        showIsolatedCapabilities: boolean;
        maxContractEdges: number;
        maxPrimaryEdges: number;
        fastMode: boolean;
        strictFingerprint: boolean;
        fastMayaThreshold: number;
        fastFingerprintThreshold: number;
        maxFingerprintNodes: number;
        maxFingerprintOwners: number;
        fingerprintTimeoutMs: number;
        maxRenderNodes: number;
        showFoldedLeaves: boolean;
    };
    protocol: {
        minConfidence: number;
        requireConfidence: boolean;
    };
    runtime: RuntimeConfig;
    dream: {
        enabled: boolean;
        idleOnly: boolean;
        minHoursBetweenRuns: number;
        minConfidence: number;
        maxProposals: number;
        autoTriggerEnabled: boolean;
        autoTriggerCommands: string[];
        minEventsBetweenRuns: number;
        scanThrottleMinutes: number;
        lockTimeoutMinutes: number;
        daemonEnabled: boolean;
        daemonIntervalSeconds: number;
        daemonMaxTicksPerRun: number;
        failOnDreamError: boolean;
    };
    runtimeHealing: {
        enabled: boolean;
        maxAutoRetries: number;
        requireHumanApprovalForContractChanges: boolean;
        snapshotStrategy: 'manual' | 'git_commit';
    };
    profile?: TriadProfile;
}

const DEFAULT_CONFIG: TriadConfig = {
    schemaVersion: '1.1',
    architecture: {
        language: 'typescript',
        parserEngine: 'tree-sitter',
        adapter: '@triadmind/plugin-ts'
    },
    categories: {
        core: []
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
        scanCategories: ['core'],
        scanMode: 'capability',
        leafOutputFile: '.triadmind/leaf-map.json',
        capabilityOutputFile: '.triadmind/triad-map.json',
        capabilityThreshold: 4,
        excludeTestFiles: true,
        excludeMagicMethods: true,
        excludePrivateMethods: true,
        helperVerbPolicy: 'suppress',
        foldHelpersIntoOwner: true,
        entryMethodNames: [
            'execute',
            'run',
            'handle',
            'process',
            'dispatch',
            'apply',
            'invoke',
            'plan',
            'schedule',
            'orchestrate'
        ],
        excludeNodeNamePatterns: [
            '^(__.*__|_(?!_).*)$',
            '^(test_.+)$',
            '^__.*__$',
            '^(upgrade|downgrade)$'
        ],
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
        ghostPolicyByLanguage: {
            default: {
                includeInDemand: true,
                topK: 5,
                minConfidence: 4
            },
            python: {
                includeInDemand: false,
                topK: 0,
                minConfidence: 5
            },
            javascript: {
                includeInDemand: false,
                topK: 0,
                minConfidence: 5
            },
            typescript: {
                includeInDemand: true,
                topK: 4,
                minConfidence: 4
            },
            java: {
                includeInDemand: true,
                topK: 4,
                minConfidence: 4
            },
            go: {
                includeInDemand: true,
                topK: 4,
                minConfidence: 4
            },
            rust: {
                includeInDemand: true,
                topK: 4,
                minConfidence: 5
            },
            cpp: {
                includeInDemand: true,
                topK: 3,
                minConfidence: 4
            }
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
        maxContractEdges: 1200,
        maxPrimaryEdges: 1500,
        fastMode: true,
        strictFingerprint: false,
        fastMayaThreshold: 0,
        fastFingerprintThreshold: 0,
        maxFingerprintNodes: 8,
        maxFingerprintOwners: 50,
        fingerprintTimeoutMs: 50,
        maxRenderNodes: 400,
        showFoldedLeaves: false
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
        excludePathPatterns: [
            'node_modules',
            '.git',
            '.triadmind',
            'venv',
            '.venv',
            '__pycache__',
            '.pytest_cache',
            '.next',
            'dist',
            'build',
            'tests',
            'test',
            'logs',
            'uploads',
            'fastgpt_data',
            '.run_state',
            'tmp'
        ],
        maxSourceFileBytes: 500000,
        maxScannedFiles: 5000,
        failOnExtractorError: false,
        minConfidence: 0.4
    },
    dream: {
        enabled: true,
        idleOnly: false,
        minHoursBetweenRuns: 24,
        minConfidence: 0.55,
        maxProposals: 5,
        autoTriggerEnabled: true,
        autoTriggerCommands: ['init', 'sync', 'runtime', 'plan', 'apply', 'verify', 'govern', 'trend'],
        minEventsBetweenRuns: 5,
        scanThrottleMinutes: 10,
        lockTimeoutMinutes: 30,
        daemonEnabled: true,
        daemonIntervalSeconds: 180,
        daemonMaxTicksPerRun: 0,
        failOnDreamError: false
    },
    runtimeHealing: {
        enabled: true,
        maxAutoRetries: 3,
        requireHumanApprovalForContractChanges: true,
        snapshotStrategy: 'manual'
    },
    profile: undefined
};

const LANGUAGE_ADAPTER_PACKAGE: Record<TriadLanguage, string> = {
    typescript: '@triadmind/plugin-ts',
    javascript: '@triadmind/plugin-js',
    python: '@triadmind/plugin-python',
    go: '@triadmind/plugin-go',
    rust: '@triadmind/plugin-rust',
    cpp: '@triadmind/plugin-cpp',
    java: '@triadmind/plugin-java'
};

const LANGUAGE_PARSER_ENGINE: Record<TriadLanguage, TriadParserEngine> = {
    typescript: 'tree-sitter',
    javascript: 'tree-sitter',
    python: 'tree-sitter',
    go: 'tree-sitter',
    rust: 'tree-sitter',
    cpp: 'tree-sitter',
    java: 'tree-sitter'
};

const DEFAULT_PROFILE: TriadProfile = {
    schemaVersion: '1.0',
    categories: {},
    scanScopes: [
        {
            name: 'tests',
            kind: 'tests',
            priority: 100,
            match: {
                pathSegments: ['test', 'tests', '__tests__'],
                filePatterns: ['test_*.py', '*_test.py', '*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx', '*.test.js', '*.spec.js']
            }
        },
        {
            name: 'migrations',
            kind: 'migrations',
            priority: 95,
            match: {
                pathSegments: ['migration', 'migrations', 'alembic']
            }
        },
        {
            name: 'types',
            kind: 'types',
            priority: 90,
            match: {
                pathSegments: ['types', 'schemas', 'schema', 'models', 'model', 'entities', 'entity', 'dto', 'vo']
            }
        },
        {
            name: 'api',
            kind: 'api',
            priority: 80,
            match: {
                pathSegments: ['api', 'apis', 'routes', 'route', 'endpoint', 'endpoints', 'transport', 'http']
            }
        },
        {
            name: 'ui',
            kind: 'ui',
            priority: 70,
            match: {
                pathSegments: ['ui', 'app', 'pages', 'page', 'layouts', 'layout', 'components', 'hooks', 'screens', 'views']
            }
        },
        {
            name: 'cli',
            kind: 'cli',
            priority: 70,
            match: {
                pathSegments: ['cli', 'command', 'commands', 'subcommands', 'handlers', 'parsers']
            }
        },
        {
            name: 'agentic',
            kind: 'agent',
            priority: 65,
            match: {
                pathSegments: ['chat', 'conversation', 'assistant', 'memory', 'planner', 'reasoning', 'tools', 'tooling', 'function_calling', 'session']
            }
        },
        {
            name: 'tasks',
            kind: 'tasks',
            priority: 60,
            match: {
                pathSegments: ['workflow', 'workflows', 'tasks', 'task', 'jobs', 'job', 'orchestration', 'pipelines', 'pipeline', 'stages', 'stage']
            }
        },
        {
            name: 'nodes',
            kind: 'nodes',
            priority: 55,
            match: {
                pathSegments: ['nodes', 'node']
            }
        },
        {
            name: 'services',
            kind: 'services',
            priority: 50,
            match: {
                pathSegments: ['services', 'service', 'integrations', 'integration', 'adapters', 'adapter', 'gateways', 'gateway']
            }
        },
        {
            name: 'utils',
            kind: 'utils',
            priority: 40,
            match: {
                pathSegments: ['utils', 'util', 'helpers', 'helper']
            }
        }
    ],
    languageAdapters: LANGUAGE_ADAPTER_PACKAGE,
    extractors: {
        parser: [],
        runtime: []
    }
};

const HARD_EXCLUDE_SEGMENTS = new Set([
    'db',
    'database',
    'databases',
    'prisma',
    'migration',
    'migrations',
    'test',
    'tests',
    '__tests__',
    'spec',
    'specs',
    '.next',
    'venv',
    '.venv',
    '__pycache__',
    '.pytest_cache',
    'script',
    'scripts',
    'env',
    'vendor',
    'logs',
    'uploads',
    'fastgpt_data',
    '.run_state',
    'tmp',
    'dist',
    'build',
    'target'
]);

const HARD_EXCLUDE_BASENAME_PATTERNS = [/^\.env(\..+)?$/i, /^diagnostic\.data$/i];
const HARD_EXCLUDE_SOURCE_FILE_PATTERNS = [
    /^test_.*\.py$/i,
    /^.*_test\.py$/i,
    /^.*\.(spec|test)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i,
    /^.*_test\.go$/i
];

export function ensureTriadConfig(paths: WorkspacePaths, force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });

    if (force || !fs.existsSync(paths.configFile)) {
        const detectedLanguage = detectProjectLanguage(paths.projectRoot);
        fs.writeFileSync(paths.configFile, JSON.stringify(buildDefaultConfig(detectedLanguage), null, 2), 'utf-8');
    }

    ensureTriadProfile(paths, force);
}

export function loadTriadConfig(paths: WorkspacePaths): TriadConfig {
    ensureTriadConfig(paths);

    try {
        const raw = fs.readFileSync(paths.configFile, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw) as Partial<TriadConfig>;
        const merged = mergeWithDefault(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
            fs.writeFileSync(paths.configFile, JSON.stringify(merged, null, 2), 'utf-8');
        }
        return applyProfileToConfig(merged, loadTriadProfile(paths));
    } catch {
        return applyProfileToConfig(DEFAULT_CONFIG, loadTriadProfile(paths));
    }
}

export function ensureTriadProfile(paths: WorkspacePaths, force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });
    if (force || !fs.existsSync(paths.profileFile)) {
        fs.writeFileSync(paths.profileFile, JSON.stringify(buildDefaultProfile(), null, 2), 'utf-8');
    }
}

export function loadTriadProfile(paths: WorkspacePaths): TriadProfile {
    ensureTriadProfile(paths);
    try {
        const raw = fs.readFileSync(paths.profileFile, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw) as Partial<TriadProfile>;
        const merged = mergeProfileWithDefault(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
            fs.writeFileSync(paths.profileFile, JSON.stringify(merged, null, 2), 'utf-8');
        }
        return merged;
    } catch {
        return buildDefaultProfile();
    }
}

export function resolveCategoryFromConfig(sourcePath: string, config: TriadConfig): TriadCategory {
    const resolved = resolveCategoryBySourcePath(sourcePath, config.categories);
    return resolved === 'unknown' ? 'core' : resolved;
}

export function resolveCategoryBySourcePath(
    sourcePath: string | undefined,
    categories: TriadCategoryMap
): TriadCategory | 'unknown' {
    const normalizedPath = normalizePath(String(sourcePath ?? '')).toLowerCase().replace(/^\/+/, '');
    if (!normalizedPath) {
        return 'unknown';
    }

    const categoryOrder = (Object.keys(categories) as TriadCategory[]).filter(Boolean);
    let bestMatch: { category: TriadCategory; score: number } | undefined;

    for (const category of categoryOrder) {
        const patterns = Array.isArray(categories[category]) ? categories[category] : [];
        for (const rawPattern of patterns) {
            const pattern = normalizePath(String(rawPattern ?? '')).toLowerCase().replace(/^\/+|\/+$/g, '');
            if (!pattern) {
                continue;
            }

            const isExactPrefix = normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
            if (!isExactPrefix) {
                continue;
            }

            const score = pattern.length;
            if (!bestMatch || score > bestMatch.score) {
                bestMatch = {
                    category,
                    score
                };
            }
        }
    }

    return bestMatch?.category ?? 'unknown';
}

export function resolveSourceScanScope(sourcePath: string | undefined, config: TriadConfig) {
    const normalizedPath = normalizeScopePath(String(sourcePath ?? ''));
    if (!normalizedPath) {
        return undefined;
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    const scopes = config.profile?.scanScopes ?? [];
    let bestMatch: { scope: TriadScanScope; score: number } | undefined;

    for (const scope of scopes) {
        const score = scoreScanScopeMatch(normalizedPath, segments, scope);
        if (score <= 0) {
            continue;
        }

        if (!bestMatch || score > bestMatch.score) {
            bestMatch = {
                scope,
                score
            };
        }
    }

    return bestMatch?.scope;
}

export function shouldExcludeSourcePath(sourcePath: string, config: TriadConfig) {
    const normalizedPath = normalizePath(sourcePath).toLowerCase();
    if (isHardExcludedSourcePath(normalizedPath)) {
        return true;
    }

    if (config.parser.excludeTestFiles && isHardExcludedSourceFile(normalizedPath)) {
        return true;
    }

    const configuredPatterns = [...(config.parser.excludePatterns ?? []), ...(config.parser.excludePathPatterns ?? [])];
    return configuredPatterns.some((pattern) => matchesSourcePathPattern(normalizedPath, pattern));
}

export function createSourcePathFilter(projectRoot: string, config: TriadConfig) {
    const activePatterns = resolveActiveScanPatterns(projectRoot, config);

    return (sourcePath: string) => {
        if (shouldExcludeSourcePath(sourcePath, config)) {
            return false;
        }

        if (activePatterns.length === 0) {
            return true;
        }

        const normalizedPath = normalizeScopePath(sourcePath);
        return activePatterns.some(
            (pattern) => normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`)
        );
    };
}

export function shouldIncludeRuntimePath(sourcePath: string, config: TriadConfig) {
    const normalizedPath = normalizePath(sourcePath).toLowerCase();
    if (isHardExcludedSourcePath(normalizedPath) || isHardExcludedSourceFile(normalizedPath)) {
        return false;
    }

    const configuredPatterns = [
        ...(config.parser.excludePatterns ?? []),
        ...(config.parser.excludePathPatterns ?? []),
        ...(config.runtime.excludePathPatterns ?? [])
    ];
    return !configuredPatterns.some((pattern) => matchesSourcePathPattern(normalizedPath, pattern));
}

export function describeSourceScanScope(projectRoot: string, config: TriadConfig) {
    const activePatterns = resolveActiveScanPatterns(projectRoot, config);
    return {
        mode: activePatterns.length > 0 ? 'scoped' : 'fallback_all',
        patterns: activePatterns
    };
}

function mergeWithDefault(value: Partial<TriadConfig>): TriadConfig {
    const language = normalizeLanguage(
        value.architecture?.language,
        value.architecture?.adapter,
        DEFAULT_CONFIG.architecture.language
    );
    const mergedCategories = mergeCategoryRecord(value.categories, DEFAULT_CONFIG.categories);

    return {
        schemaVersion: DEFAULT_CONFIG.schemaVersion,
        architecture: {
            language,
            parserEngine: normalizeParserEngine(value.architecture?.parserEngine, language),
            adapter: value.architecture?.adapter ?? LANGUAGE_ADAPTER_PACKAGE[language]
        },
        categories: mergedCategories,
        parser: {
            excludePatterns: value.parser?.excludePatterns ?? DEFAULT_CONFIG.parser.excludePatterns,
            excludePathPatterns: mergeStringList(
                value.parser?.excludePathPatterns,
                DEFAULT_CONFIG.parser.excludePathPatterns
            ),
            scanCategories: normalizeScanCategories(value.parser?.scanCategories, mergedCategories),
            scanMode: normalizeScanMode(value.parser?.scanMode),
            leafOutputFile: normalizeRelativeOutputFile(
                value.parser?.leafOutputFile,
                DEFAULT_CONFIG.parser.leafOutputFile
            ),
            capabilityOutputFile: normalizeRelativeOutputFile(
                value.parser?.capabilityOutputFile,
                DEFAULT_CONFIG.parser.capabilityOutputFile
            ),
            capabilityThreshold: normalizePositiveInteger(
                value.parser?.capabilityThreshold,
                DEFAULT_CONFIG.parser.capabilityThreshold
            ),
            excludeTestFiles: value.parser?.excludeTestFiles ?? DEFAULT_CONFIG.parser.excludeTestFiles,
            excludeMagicMethods: value.parser?.excludeMagicMethods ?? DEFAULT_CONFIG.parser.excludeMagicMethods,
            excludePrivateMethods: value.parser?.excludePrivateMethods ?? DEFAULT_CONFIG.parser.excludePrivateMethods,
            helperVerbPolicy: normalizeHelperVerbPolicy(value.parser?.helperVerbPolicy),
            foldHelpersIntoOwner: value.parser?.foldHelpersIntoOwner ?? DEFAULT_CONFIG.parser.foldHelpersIntoOwner,
            entryMethodNames: mergeStringList(value.parser?.entryMethodNames, DEFAULT_CONFIG.parser.entryMethodNames),
            excludeNodeNamePatterns: mergeStringList(
                value.parser?.excludeNodeNamePatterns,
                DEFAULT_CONFIG.parser.excludeNodeNamePatterns
            ),
            ignoreGenericContracts: value.parser?.ignoreGenericContracts ?? DEFAULT_CONFIG.parser.ignoreGenericContracts,
            genericContractIgnoreList: mergeGenericContractIgnoreList(value.parser?.genericContractIgnoreList),
            includeUntaggedExports:
                value.parser?.includeUntaggedExports ?? DEFAULT_CONFIG.parser.includeUntaggedExports,
            ghostPolicyByLanguage: normalizeGhostPolicyByLanguage(value.parser?.ghostPolicyByLanguage),
            jsDocTags: {
                triadNode: value.parser?.jsDocTags?.triadNode ?? DEFAULT_CONFIG.parser.jsDocTags.triadNode,
                leftBranch: value.parser?.jsDocTags?.leftBranch ?? DEFAULT_CONFIG.parser.jsDocTags.leftBranch,
                rightBranch: value.parser?.jsDocTags?.rightBranch ?? DEFAULT_CONFIG.parser.jsDocTags.rightBranch
            }
        },
        visualizer: {
            defaultView:
                value.visualizer?.defaultView === 'leaf' || value.visualizer?.defaultView === 'architecture'
                    ? value.visualizer.defaultView
                    : DEFAULT_CONFIG.visualizer.defaultView,
            showIsolatedCapabilities:
                value.visualizer?.showIsolatedCapabilities ?? DEFAULT_CONFIG.visualizer.showIsolatedCapabilities,
            maxContractEdges: normalizePositiveInteger(
                value.visualizer?.maxContractEdges ?? value.visualizer?.maxPrimaryEdges,
                DEFAULT_CONFIG.visualizer.maxContractEdges
            ),
            maxPrimaryEdges: normalizePositiveInteger(
                value.visualizer?.maxPrimaryEdges ?? value.visualizer?.maxContractEdges,
                DEFAULT_CONFIG.visualizer.maxPrimaryEdges
            ),
            fastMode: value.visualizer?.fastMode ?? DEFAULT_CONFIG.visualizer.fastMode,
            strictFingerprint: value.visualizer?.strictFingerprint ?? DEFAULT_CONFIG.visualizer.strictFingerprint,
            fastMayaThreshold: normalizeNonNegativeInteger(
                value.visualizer?.fastMayaThreshold ?? value.visualizer?.fastFingerprintThreshold,
                DEFAULT_CONFIG.visualizer.fastMayaThreshold
            ),
            fastFingerprintThreshold: normalizeNonNegativeInteger(
                value.visualizer?.fastFingerprintThreshold ?? value.visualizer?.fastMayaThreshold,
                DEFAULT_CONFIG.visualizer.fastFingerprintThreshold
            ),
            maxFingerprintNodes: normalizePositiveInteger(
                value.visualizer?.maxFingerprintNodes,
                DEFAULT_CONFIG.visualizer.maxFingerprintNodes
            ),
            maxFingerprintOwners: normalizePositiveInteger(
                value.visualizer?.maxFingerprintOwners,
                DEFAULT_CONFIG.visualizer.maxFingerprintOwners
            ),
            fingerprintTimeoutMs: normalizePositiveInteger(
                value.visualizer?.fingerprintTimeoutMs,
                DEFAULT_CONFIG.visualizer.fingerprintTimeoutMs
            ),
            maxRenderNodes: normalizePositiveInteger(
                value.visualizer?.maxRenderNodes,
                DEFAULT_CONFIG.visualizer.maxRenderNodes
            ),
            showFoldedLeaves: value.visualizer?.showFoldedLeaves ?? DEFAULT_CONFIG.visualizer.showFoldedLeaves
        },
        protocol: {
            minConfidence: value.protocol?.minConfidence ?? DEFAULT_CONFIG.protocol.minConfidence,
            requireConfidence: value.protocol?.requireConfidence ?? DEFAULT_CONFIG.protocol.requireConfidence
        },
        runtime: {
            enabled: value.runtime?.enabled ?? DEFAULT_CONFIG.runtime.enabled,
            defaultView: normalizeRuntimeView(value.runtime?.defaultView),
            includeFrontend: value.runtime?.includeFrontend ?? DEFAULT_CONFIG.runtime.includeFrontend,
            includeInfra: value.runtime?.includeInfra ?? DEFAULT_CONFIG.runtime.includeInfra,
            frameworkHints: mergeStringList(value.runtime?.frameworkHints, DEFAULT_CONFIG.runtime.frameworkHints),
            excludePathPatterns: mergeStringList(
                value.runtime?.excludePathPatterns,
                DEFAULT_CONFIG.runtime.excludePathPatterns
            ),
            maxSourceFileBytes: normalizePositiveInteger(
                value.runtime?.maxSourceFileBytes,
                DEFAULT_CONFIG.runtime.maxSourceFileBytes
            ),
            maxScannedFiles: normalizePositiveInteger(
                value.runtime?.maxScannedFiles,
                DEFAULT_CONFIG.runtime.maxScannedFiles
            ),
            failOnExtractorError: value.runtime?.failOnExtractorError ?? DEFAULT_CONFIG.runtime.failOnExtractorError,
            minConfidence: normalizeConfidence(value.runtime?.minConfidence, DEFAULT_CONFIG.runtime.minConfidence)
        },
        dream: {
            enabled: value.dream?.enabled ?? DEFAULT_CONFIG.dream.enabled,
            idleOnly: value.dream?.idleOnly ?? DEFAULT_CONFIG.dream.idleOnly,
            minHoursBetweenRuns: normalizePositiveInteger(
                value.dream?.minHoursBetweenRuns,
                DEFAULT_CONFIG.dream.minHoursBetweenRuns
            ),
            minConfidence: normalizeConfidence(value.dream?.minConfidence, DEFAULT_CONFIG.dream.minConfidence),
            maxProposals: normalizePositiveInteger(value.dream?.maxProposals, DEFAULT_CONFIG.dream.maxProposals),
            autoTriggerEnabled: value.dream?.autoTriggerEnabled ?? DEFAULT_CONFIG.dream.autoTriggerEnabled,
            autoTriggerCommands: mergeStringList(
                value.dream?.autoTriggerCommands,
                DEFAULT_CONFIG.dream.autoTriggerCommands
            ),
            minEventsBetweenRuns: normalizePositiveInteger(
                value.dream?.minEventsBetweenRuns,
                DEFAULT_CONFIG.dream.minEventsBetweenRuns
            ),
            scanThrottleMinutes: normalizePositiveInteger(
                value.dream?.scanThrottleMinutes,
                DEFAULT_CONFIG.dream.scanThrottleMinutes
            ),
            lockTimeoutMinutes: normalizePositiveInteger(
                value.dream?.lockTimeoutMinutes,
                DEFAULT_CONFIG.dream.lockTimeoutMinutes
            ),
            daemonEnabled: value.dream?.daemonEnabled ?? DEFAULT_CONFIG.dream.daemonEnabled,
            daemonIntervalSeconds: normalizePositiveInteger(
                value.dream?.daemonIntervalSeconds,
                DEFAULT_CONFIG.dream.daemonIntervalSeconds
            ),
            daemonMaxTicksPerRun: normalizeNonNegativeInteger(
                value.dream?.daemonMaxTicksPerRun,
                DEFAULT_CONFIG.dream.daemonMaxTicksPerRun
            ),
            failOnDreamError: value.dream?.failOnDreamError ?? DEFAULT_CONFIG.dream.failOnDreamError
        },
        runtimeHealing: {
            enabled: value.runtimeHealing?.enabled ?? DEFAULT_CONFIG.runtimeHealing.enabled,
            maxAutoRetries: value.runtimeHealing?.maxAutoRetries ?? DEFAULT_CONFIG.runtimeHealing.maxAutoRetries,
            requireHumanApprovalForContractChanges:
                value.runtimeHealing?.requireHumanApprovalForContractChanges ??
                DEFAULT_CONFIG.runtimeHealing.requireHumanApprovalForContractChanges,
            snapshotStrategy: value.runtimeHealing?.snapshotStrategy ?? DEFAULT_CONFIG.runtimeHealing.snapshotStrategy
        },
        profile: undefined
    };
}

function buildDefaultConfig(language: TriadLanguage): TriadConfig {
    return {
        ...DEFAULT_CONFIG,
        architecture: {
            language,
            parserEngine: LANGUAGE_PARSER_ENGINE[language],
            adapter: LANGUAGE_ADAPTER_PACKAGE[language]
        }
    };
}

function normalizeScanCategories(value: string[] | undefined, categories: TriadCategoryMap = DEFAULT_CONFIG.categories) {
    if (!Array.isArray(value) || value.length === 0) {
        return [...DEFAULT_CONFIG.parser.scanCategories];
    }

    const allowed = new Set(Object.keys(categories).filter(Boolean));
    const normalized = value
        .map((entry) => String(entry ?? '').trim())
        .filter((entry) => allowed.has(entry));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : [...DEFAULT_CONFIG.parser.scanCategories];
}

function normalizeScanMode(value: TriadScanMode | undefined) {
    if (value === 'capability' || value === 'module' || value === 'domain' || value === 'leaf') {
        return value;
    }

    return DEFAULT_CONFIG.parser.scanMode;
}

function normalizeRuntimeView(value: RuntimeView | undefined): RuntimeView {
    if (
        value === 'workflow' ||
        value === 'request-flow' ||
        value === 'resources' ||
        value === 'events' ||
        value === 'infra' ||
        value === 'full'
    ) {
        return value;
    }

    return DEFAULT_CONFIG.runtime.defaultView;
}

function normalizeHelperVerbPolicy(value: HelperVerbPolicy | undefined) {
    return value === 'allow' || value === 'suppress' ? value : DEFAULT_CONFIG.parser.helperVerbPolicy;
}

function normalizeRelativeOutputFile(value: string | undefined, fallback: string) {
    const normalized = normalizePath(String(value ?? '').trim());
    if (!normalized || path.isAbsolute(normalized) || normalized.includes('..')) {
        return fallback;
    }
    return normalized;
}

function mergeGenericContractIgnoreList(value: string[] | undefined) {
    return mergeStringList(value, DEFAULT_CONFIG.parser.genericContractIgnoreList);
}

function normalizeGhostPolicyByLanguage(value: GhostPolicyByLanguage | undefined): GhostPolicyByLanguage {
    const merged: GhostPolicyByLanguage = {
        ...DEFAULT_CONFIG.parser.ghostPolicyByLanguage,
        ...(value ?? {})
    };

    const normalized: GhostPolicyByLanguage = {};
    const keys: GhostPolicyLanguageKey[] = ['default', 'typescript', 'javascript', 'python', 'go', 'rust', 'cpp', 'java'];
    for (const key of keys) {
        const policy = merged[key];
        const fallback = DEFAULT_CONFIG.parser.ghostPolicyByLanguage[key] ?? DEFAULT_CONFIG.parser.ghostPolicyByLanguage.default!;
        normalized[key] = {
            includeInDemand: policy?.includeInDemand ?? fallback.includeInDemand,
            topK: normalizeNonNegativeInteger(policy?.topK, fallback.topK),
            minConfidence: normalizeNonNegativeInteger(policy?.minConfidence, fallback.minConfidence)
        };
    }

    return normalized;
}

function matchesSourcePathPattern(normalizedPath: string, pattern: string) {
    const normalizedPattern = normalizePath(String(pattern ?? '').trim()).toLowerCase();
    if (!normalizedPattern) {
        return false;
    }

    if (isRegexLikePattern(normalizedPattern)) {
        try {
            return new RegExp(normalizedPattern, 'i').test(normalizedPath);
        } catch {
            return false;
        }
    }

    if (normalizedPath === normalizedPattern) {
        return true;
    }

    return (
        normalizedPath.startsWith(`${normalizedPattern}/`) ||
        normalizedPath.endsWith(`/${normalizedPattern}`) ||
        normalizedPath.includes(`/${normalizedPattern}/`)
    );
}

function isRegexLikePattern(value: string) {
    return /[\\^$|()[\]{}+?]/.test(value);
}

function isHardExcludedSourceFile(sourcePath: string) {
    const normalizedPath = normalizeScopePath(sourcePath);
    const basename = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
    return HARD_EXCLUDE_SOURCE_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}

function mergeStringList(value: string[] | undefined, fallback: string[]) {
    const items = Array.isArray(value) ? value : [];
    return Array.from(new Set([...items, ...fallback].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())));
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    if (Number.isFinite(value) && (value as number) > 0) {
        return Math.floor(value as number);
    }

    return fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
    if (Number.isFinite(value) && (value as number) >= 0) {
        return Math.floor(value as number);
    }

    return fallback;
}

function normalizeConfidence(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
        return value;
    }

    return fallback;
}

function mergeCategoryPatterns(value: string[] | undefined, fallback: string[]) {
    const items = Array.isArray(value) ? value : [];
    return Array.from(new Set([...items, ...fallback].filter((item) => typeof item === 'string' && item.trim())));
}

function mergeCategoryRecord(value: TriadCategoryMap | undefined, fallback: TriadCategoryMap) {
    const keys = new Set<string>([
        ...Object.keys(fallback ?? {}).filter(Boolean),
        ...Object.keys(value ?? {}).filter(Boolean)
    ]);
    const merged: TriadCategoryMap = {};
    for (const key of keys) {
        merged[key] = mergeCategoryPatterns(value?.[key], fallback?.[key] ?? []);
    }
    if (!merged.core) {
        merged.core = [];
    }
    return merged;
}

function buildDefaultProfile(): TriadProfile {
    return {
        schemaVersion: DEFAULT_PROFILE.schemaVersion,
        categories: { ...(DEFAULT_PROFILE.categories ?? {}) },
        scanScopes: (DEFAULT_PROFILE.scanScopes ?? []).map((scope) => ({
            ...scope,
            match: {
                ...(scope.match ?? {})
            }
        })),
        languageAdapters: {
            ...(DEFAULT_PROFILE.languageAdapters ?? {})
        },
        extractors: {
            parser: [...(DEFAULT_PROFILE.extractors?.parser ?? [])],
            runtime: [...(DEFAULT_PROFILE.extractors?.runtime ?? [])]
        }
    };
}

function mergeProfileWithDefault(value: Partial<TriadProfile> | undefined): TriadProfile {
    const defaults = buildDefaultProfile();
    return {
        schemaVersion: defaults.schemaVersion,
        categories: mergeCategoryRecord(value?.categories, defaults.categories ?? {}),
        scanScopes: normalizeScanScopes(value?.scanScopes, defaults.scanScopes ?? []),
        languageAdapters: {
            ...(defaults.languageAdapters ?? {}),
            ...(value?.languageAdapters ?? {})
        },
        extractors: {
            parser: mergeStringList(value?.extractors?.parser, defaults.extractors?.parser ?? []),
            runtime: mergeStringList(value?.extractors?.runtime, defaults.extractors?.runtime ?? [])
        }
    };
}

function applyProfileToConfig(config: TriadConfig, profile: TriadProfile): TriadConfig {
    const mergedCategories = mergeCategoryRecord(profile.categories, config.categories);
    return {
        ...config,
        categories: mergedCategories,
        parser: {
            ...config.parser,
            scanCategories: normalizeScanCategories(config.parser.scanCategories, mergedCategories)
        },
        architecture: {
            ...config.architecture,
            adapter: profile.languageAdapters?.[config.architecture.language] ?? config.architecture.adapter
        },
        profile
    };
}

function normalizeScanScopes(value: TriadScanScope[] | undefined, fallback: TriadScanScope[]) {
    const scopes = Array.isArray(value) && value.length > 0 ? value : fallback;
    return scopes
        .map((scope) => ({
            name: String(scope?.name ?? '').trim(),
            kind: normalizeSourcePolicy(scope?.kind),
            priority: Number.isFinite(scope?.priority) ? Number(scope?.priority) : 0,
            category: String(scope?.category ?? '').trim() || undefined,
            match: {
                pathPrefixes: normalizeStringArray(scope?.match?.pathPrefixes),
                pathSegments: normalizeStringArray(scope?.match?.pathSegments).map((entry) => normalizeScopePath(entry)),
                filePatterns: normalizeStringArray(scope?.match?.filePatterns),
                includePatterns: normalizeStringArray(scope?.match?.includePatterns),
                excludePatterns: normalizeStringArray(scope?.match?.excludePatterns)
            }
        }))
        .filter((scope) => scope.name && scope.kind);
}

function normalizeSourcePolicy(value: TriadSourcePolicy | undefined): TriadSourcePolicy {
    switch (value) {
        case 'api':
        case 'ui':
        case 'cli':
        case 'agent':
        case 'types':
        case 'tests':
        case 'migrations':
        case 'nodes':
        case 'tasks':
        case 'services':
        case 'utils':
        case 'other':
            return value;
        default:
            return 'other';
    }
}

function normalizeStringArray(value: string[] | undefined) {
    return Array.isArray(value)
        ? Array.from(
              new Set(
                  value
                      .map((entry) => String(entry ?? '').trim())
                      .filter(Boolean)
              )
          )
        : [];
}

function resolveActiveScanPatterns(projectRoot: string, config: TriadConfig) {
    const scanCategories = normalizeScanCategories(config.parser.scanCategories, config.categories);
    const patterns = scanCategories.flatMap((category) => config.categories[category] ?? []);

    return Array.from(
        new Set(
            patterns
                .map((pattern) => normalizeScopePath(pattern))
                .filter(Boolean)
                .filter((pattern) => fs.existsSync(path.join(projectRoot, pattern)))
        )
    );
}

function scoreScanScopeMatch(normalizedPath: string, segments: string[], scope: TriadScanScope) {
    const match = scope.match ?? {};
    const normalizedSegments = new Set(segments.map((entry) => normalizeScopePath(entry)));
    let score = 0;

    for (const prefix of match.pathPrefixes ?? []) {
        const normalizedPrefix = normalizeScopePath(prefix);
        if (!normalizedPrefix) {
            continue;
        }
        if (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)) {
            score = Math.max(score, 1000 + normalizedPrefix.length);
        }
    }

    const segmentHits = (match.pathSegments ?? []).filter((segment) => normalizedSegments.has(segment)).length;
    if (segmentHits > 0) {
        score = Math.max(score, 500 + segmentHits * 10);
    }

    const filePatternHits = (match.filePatterns ?? []).filter((pattern) => matchesFileGlob(normalizedPath, pattern)).length;
    if (filePatternHits > 0) {
        score = Math.max(score, 300 + filePatternHits * 10);
    }

    const includeHits = (match.includePatterns ?? []).filter((pattern) => matchesSourcePathPattern(normalizedPath, pattern)).length;
    if (includeHits > 0) {
        score = Math.max(score, 200 + includeHits * 10);
    }

    if ((match.excludePatterns ?? []).some((pattern) => matchesSourcePathPattern(normalizedPath, pattern))) {
        return 0;
    }

    return score > 0 ? score + (scope.priority ?? 0) : 0;
}

function matchesFileGlob(normalizedPath: string, pattern: string) {
    const normalizedPattern = String(pattern ?? '').trim();
    if (!normalizedPattern) {
        return false;
    }

    const escaped = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    try {
        return new RegExp(`^${escaped}$`, 'i').test(normalizedPath.split('/').pop() ?? normalizedPath);
    } catch {
        return false;
    }
}

function normalizeScopePath(value: string) {
    return normalizePath(value)
        .replace(/^\.?\//, '')
        .replace(/\/+$/, '')
        .toLowerCase();
}

function isHardExcludedSourcePath(sourcePath: string) {
    const normalizedPath = normalizeScopePath(sourcePath);
    const segments = normalizedPath.split('/').filter(Boolean);

    if (segments.some((segment) => HARD_EXCLUDE_SEGMENTS.has(segment))) {
        return true;
    }

    const basename = segments[segments.length - 1] ?? '';
    return HARD_EXCLUDE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

function normalizeLanguage(
    value?: string,
    adapterValue?: string,
    fallback: TriadLanguage = 'typescript'
): TriadLanguage {
    const normalized = (value ?? '').trim().toLowerCase();

    if (normalized === 'typescript' || normalized === 'ts') {
        return 'typescript';
    }
    if (normalized === 'javascript' || normalized === 'js' || normalized === 'node' || normalized === 'nodejs') {
        return 'javascript';
    }
    if (normalized === 'python' || normalized === 'py') {
        return 'python';
    }
    if (normalized === 'go' || normalized === 'golang') {
        return 'go';
    }
    if (normalized === 'rust' || normalized === 'rs') {
        return 'rust';
    }
    if (normalized === 'cpp' || normalized === 'c++' || normalized === 'cxx' || normalized === 'cc') {
        return 'cpp';
    }
    if (normalized === 'java' || normalized === 'jdk') {
        return 'java';
    }

    const adapter = (adapterValue ?? '').trim().toLowerCase();
    if (adapter.includes('javascript') || adapter.includes('plugin-js')) {
        return 'javascript';
    }
    if (adapter.includes('python')) {
        return 'python';
    }
    if (adapter.includes('go')) {
        return 'go';
    }
    if (adapter.includes('rust')) {
        return 'rust';
    }
    if (adapter.includes('cpp') || adapter.includes('cxx') || adapter.includes('c++')) {
        return 'cpp';
    }
    if (adapter.includes('java')) {
        return 'java';
    }

    return fallback;
}

function normalizeParserEngine(value: string | undefined, language: TriadLanguage): TriadParserEngine {
    if (value === 'tree-sitter') {
        return 'tree-sitter';
    }
    if (value === 'native') {
        return 'native';
    }

    return LANGUAGE_PARSER_ENGINE[language];
}

function detectProjectLanguage(projectRoot: string): TriadLanguage {
    if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        return 'typescript';
    }

    const extensionScore = new Map<TriadLanguage, number>([
        ['javascript', 0],
        ['python', 0],
        ['go', 0],
        ['rust', 0],
        ['cpp', 0],
        ['java', 0],
        ['typescript', 0]
    ]);

    walkProject(projectRoot, (filePath) => {
        const normalized = normalizePath(path.relative(projectRoot, filePath)).toLowerCase();
        if (shouldSkipWalkPath(normalized) || isHardExcludedSourceFile(normalized)) {
            return;
        }

        if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
            extensionScore.set('typescript', (extensionScore.get('typescript') ?? 0) + 1);
        } else if (/\.(js|jsx|mjs|cjs)$/.test(filePath)) {
            extensionScore.set('javascript', (extensionScore.get('javascript') ?? 0) + 1);
        } else if (/\.py$/.test(filePath)) {
            extensionScore.set('python', (extensionScore.get('python') ?? 0) + 1);
        } else if (/\.go$/.test(filePath)) {
            extensionScore.set('go', (extensionScore.get('go') ?? 0) + 1);
        } else if (/\.rs$/.test(filePath)) {
            extensionScore.set('rust', (extensionScore.get('rust') ?? 0) + 1);
        } else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(filePath)) {
            extensionScore.set('cpp', (extensionScore.get('cpp') ?? 0) + 1);
        } else if (/\.java$/.test(filePath)) {
            extensionScore.set('java', (extensionScore.get('java') ?? 0) + 1);
        }
    });

    let detected: TriadLanguage = 'typescript';
    let bestScore = 0;
    for (const [language, score] of extensionScore.entries()) {
        if (score > bestScore) {
            detected = language;
            bestScore = score;
        }
    }

    return detected;
}

function walkProject(currentPath: string, visit: (filePath: string) => void) {
    if (!fs.existsSync(currentPath)) {
        return;
    }

    let stat: fs.Stats;
    try {
        stat = fs.statSync(currentPath);
    } catch (error: any) {
        if (isIgnorableFsError(error)) {
            return;
        }
        throw error;
    }
    if (stat.isFile()) {
        try {
            visit(currentPath);
        } catch (error: any) {
            if (isIgnorableFsError(error)) {
                return;
            }
            throw error;
        }
        return;
    }

    if (shouldSkipWalkPath(path.basename(currentPath))) {
        return;
    }

    let entries: string[];
    try {
        entries = fs.readdirSync(currentPath);
    } catch (error: any) {
        if (isIgnorableFsError(error)) {
            return;
        }
        throw error;
    }

    for (const entry of entries) {
        walkProject(path.join(currentPath, entry), visit);
    }
}

export function shouldSkipWalkPath(value: string) {
    const normalized = normalizeScopePath(value);
    const segments = normalized.split('/').filter(Boolean);
    const basename = segments[segments.length - 1] ?? normalized;
    return (
        segments.some((segment) => HARD_EXCLUDE_SEGMENTS.has(segment)) ||
        basename === '.git' ||
        basename === '.triadmind' ||
        isHardExcludedSourceFile(normalized) ||
        HARD_EXCLUDE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))
    );
}

export function isIgnorableFsError(error: any) {
    const code = String(error?.code ?? '').toUpperCase();
    return code === 'EACCES' || code === 'EPERM' || code === 'ENOENT';
}
