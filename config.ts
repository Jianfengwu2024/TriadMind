import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePaths, normalizePath } from './workspace';
import { TriadCategory } from './protocol';

export type TriadLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'cpp' | 'java';
export type TriadParserEngine = 'native' | 'tree-sitter';

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
        includeUntaggedExports: boolean;
        jsDocTags: {
            triadNode: string;
            leftBranch: string;
            rightBranch: string;
        };
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
        frontend: ['src/frontend', 'frontend'],
        backend: ['src/backend', 'backend'],
        core: ['src/core', 'core']
    },
    parser: {
        excludePatterns: ['node_modules', '.triadmind'],
        includeUntaggedExports: true,
        jsDocTags: {
            triadNode: 'TriadNode',
            leftBranch: 'LeftBranch',
            rightBranch: 'RightBranch'
        }
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
    return (config.parser.excludePatterns ?? []).some((pattern) =>
        normalizedPath.includes(normalizePath(pattern).toLowerCase())
    );
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
            frontend: value.categories?.frontend ?? DEFAULT_CONFIG.categories.frontend,
            backend: value.categories?.backend ?? DEFAULT_CONFIG.categories.backend,
            core: value.categories?.core ?? DEFAULT_CONFIG.categories.core
        },
        parser: {
            excludePatterns: value.parser?.excludePatterns ?? DEFAULT_CONFIG.parser.excludePatterns,
            includeUntaggedExports:
                value.parser?.includeUntaggedExports ?? DEFAULT_CONFIG.parser.includeUntaggedExports,
            jsDocTags: {
                triadNode: value.parser?.jsDocTags?.triadNode ?? DEFAULT_CONFIG.parser.jsDocTags.triadNode,
                leftBranch: value.parser?.jsDocTags?.leftBranch ?? DEFAULT_CONFIG.parser.jsDocTags.leftBranch,
                rightBranch: value.parser?.jsDocTags?.rightBranch ?? DEFAULT_CONFIG.parser.jsDocTags.rightBranch
            }
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
        if (normalized.includes('node_modules') || normalized.includes('.triadmind') || normalized.includes('.git')) {
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

    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
        visit(currentPath);
        return;
    }

    for (const entry of fs.readdirSync(currentPath)) {
        walkProject(path.join(currentPath, entry), visit);
    }
}
