import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePaths, normalizePath } from './workspace';
import { TriadCategory } from './protocol';

export type TriadLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'cpp' | 'java';
export type TriadParserEngine = 'native' | 'tree-sitter';
export type TriadScanMode = 'leaf' | 'capability' | 'module' | 'domain';

export interface TriadConfig {
    schemaVersion: string;
    architecture: {
        language: TriadLanguage;
        parserEngine: TriadParserEngine;
        adapter: string;
    };
    categories: Record<TriadCategory, string[]>;
    parser: {
        excludePatterns: string[];
        excludePathPatterns: string[];
        scanCategories: TriadCategory[];
        scanMode: TriadScanMode;
        capabilityThreshold: number;
        entryMethodNames: string[];
        excludeNodeNamePatterns: string[];
        ignoreGenericContracts: boolean;
        genericContractIgnoreList: string[];
        includeUntaggedExports: boolean;
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
        fastMayaThreshold: number;
        fastFingerprintThreshold: number;
        maxRenderNodes: number;
    };
    protocol: {
        minConfidence: number;
        requireConfidence: boolean;
    };
    runtimeHealing: {
        enabled: boolean;
        maxAutoRetries: number;
        requireHumanApprovalForContractChanges: boolean;
        snapshotStrategy: 'manual' | 'git_commit';
    };
}

const DEFAULT_CONFIG: TriadConfig = {
    schemaVersion: '1.1',
    architecture: {
        language: 'typescript',
        parserEngine: 'tree-sitter',
        adapter: '@triadmind/plugin-ts'
    },
    categories: {
        frontend: ['src/frontend', 'frontend', 'src/client', 'client', 'src/web', 'web', 'src/app', 'app', 'apps/frontend', 'packages/frontend'],
        backend: ['src/backend', 'backend', 'src/server', 'server', 'src/api', 'api', 'apps/backend', 'packages/backend'],
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
        scanCategories: ['frontend', 'backend'],
        scanMode: 'capability',
        capabilityThreshold: 4,
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
            '^(get|set|build|parse|format|normalize|sanitize|validate|ensure|create|load|save|list|collect|resolve|prepare|read|write|convert|sync|merge|filter|check|infer|guess)_.+$',
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
        fastMayaThreshold: 10,
        fastFingerprintThreshold: 8,
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
    'dist',
    'build',
    'target'
]);

const HARD_EXCLUDE_BASENAME_PATTERNS = [/^\.env(\..+)?$/i, /^diagnostic\.data$/i];

export function ensureTriadConfig(paths: WorkspacePaths, force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });

    if (force || !fs.existsSync(paths.configFile)) {
        const detectedLanguage = detectProjectLanguage(paths.projectRoot);
        fs.writeFileSync(paths.configFile, JSON.stringify(buildDefaultConfig(detectedLanguage), null, 2), 'utf-8');
    }
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
        return merged;
    } catch {
        return DEFAULT_CONFIG;
    }
}

export function resolveCategoryFromConfig(sourcePath: string, config: TriadConfig): TriadCategory {
    const normalizedPath = normalizePath(sourcePath).toLowerCase();

    const categories: TriadCategory[] = ['frontend', 'backend', 'core'];
    for (const category of categories) {
        const patterns = config.categories[category] ?? [];
        if (patterns.some((pattern) => normalizedPath.includes(normalizePath(pattern).toLowerCase()))) {
            return category;
        }
    }

    return 'core';
}

export function shouldExcludeSourcePath(sourcePath: string, config: TriadConfig) {
    const normalizedPath = normalizePath(sourcePath).toLowerCase();
    if (isHardExcludedSourcePath(normalizedPath)) {
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

    return {
        schemaVersion: DEFAULT_CONFIG.schemaVersion,
        architecture: {
            language,
            parserEngine: normalizeParserEngine(value.architecture?.parserEngine, language),
            adapter: value.architecture?.adapter ?? LANGUAGE_ADAPTER_PACKAGE[language]
        },
        categories: {
            frontend: mergeCategoryPatterns(value.categories?.frontend, DEFAULT_CONFIG.categories.frontend),
            backend: mergeCategoryPatterns(value.categories?.backend, DEFAULT_CONFIG.categories.backend),
            core: mergeCategoryPatterns(value.categories?.core, DEFAULT_CONFIG.categories.core)
        },
        parser: {
            excludePatterns: value.parser?.excludePatterns ?? DEFAULT_CONFIG.parser.excludePatterns,
            excludePathPatterns: mergeStringList(
                value.parser?.excludePathPatterns,
                DEFAULT_CONFIG.parser.excludePathPatterns
            ),
            scanCategories: normalizeScanCategories(value.parser?.scanCategories),
            scanMode: normalizeScanMode(value.parser?.scanMode),
            capabilityThreshold: normalizePositiveInteger(
                value.parser?.capabilityThreshold,
                DEFAULT_CONFIG.parser.capabilityThreshold
            ),
            entryMethodNames: mergeStringList(value.parser?.entryMethodNames, DEFAULT_CONFIG.parser.entryMethodNames),
            excludeNodeNamePatterns: mergeStringList(
                value.parser?.excludeNodeNamePatterns,
                DEFAULT_CONFIG.parser.excludeNodeNamePatterns
            ),
            ignoreGenericContracts: value.parser?.ignoreGenericContracts ?? DEFAULT_CONFIG.parser.ignoreGenericContracts,
            genericContractIgnoreList: mergeGenericContractIgnoreList(value.parser?.genericContractIgnoreList),
            includeUntaggedExports:
                value.parser?.includeUntaggedExports ?? DEFAULT_CONFIG.parser.includeUntaggedExports,
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
            fastMayaThreshold: normalizePositiveInteger(
                value.visualizer?.fastMayaThreshold ?? value.visualizer?.fastFingerprintThreshold,
                DEFAULT_CONFIG.visualizer.fastMayaThreshold
            ),
            fastFingerprintThreshold: normalizePositiveInteger(
                value.visualizer?.fastFingerprintThreshold ?? value.visualizer?.fastMayaThreshold,
                DEFAULT_CONFIG.visualizer.fastFingerprintThreshold
            ),
            maxRenderNodes: normalizePositiveInteger(
                value.visualizer?.maxRenderNodes,
                DEFAULT_CONFIG.visualizer.maxRenderNodes
            )
        },
        protocol: {
            minConfidence: value.protocol?.minConfidence ?? DEFAULT_CONFIG.protocol.minConfidence,
            requireConfidence: value.protocol?.requireConfidence ?? DEFAULT_CONFIG.protocol.requireConfidence
        },
        runtimeHealing: {
            enabled: value.runtimeHealing?.enabled ?? DEFAULT_CONFIG.runtimeHealing.enabled,
            maxAutoRetries: value.runtimeHealing?.maxAutoRetries ?? DEFAULT_CONFIG.runtimeHealing.maxAutoRetries,
            requireHumanApprovalForContractChanges:
                value.runtimeHealing?.requireHumanApprovalForContractChanges ??
                DEFAULT_CONFIG.runtimeHealing.requireHumanApprovalForContractChanges,
            snapshotStrategy: value.runtimeHealing?.snapshotStrategy ?? DEFAULT_CONFIG.runtimeHealing.snapshotStrategy
        }
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

function normalizeScanCategories(value: TriadCategory[] | undefined) {
    if (!Array.isArray(value) || value.length === 0) {
        return [...DEFAULT_CONFIG.parser.scanCategories];
    }

    const allowed = new Set<TriadCategory>(['frontend', 'backend', 'core']);
    const normalized = value.filter((entry): entry is TriadCategory => allowed.has(entry));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : [...DEFAULT_CONFIG.parser.scanCategories];
}

function normalizeScanMode(value: TriadScanMode | undefined) {
    if (value === 'capability' || value === 'module' || value === 'domain' || value === 'leaf') {
        return value;
    }

    return DEFAULT_CONFIG.parser.scanMode;
}

function mergeGenericContractIgnoreList(value: string[] | undefined) {
    return mergeStringList(value, DEFAULT_CONFIG.parser.genericContractIgnoreList);
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

function mergeCategoryPatterns(value: string[] | undefined, fallback: string[]) {
    const items = Array.isArray(value) ? value : [];
    return Array.from(new Set([...items, ...fallback].filter((item) => typeof item === 'string' && item.trim())));
}

function resolveActiveScanPatterns(projectRoot: string, config: TriadConfig) {
    const scanCategories = normalizeScanCategories(config.parser.scanCategories);
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
        if (shouldSkipWalkPath(normalized)) {
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
        HARD_EXCLUDE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))
    );
}

export function isIgnorableFsError(error: any) {
    const code = String(error?.code ?? '').toUpperCase();
    return code === 'EACCES' || code === 'EPERM' || code === 'ENOENT';
}
