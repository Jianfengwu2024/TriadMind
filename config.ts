import * as fs from 'fs';
import { WorkspacePaths, normalizePath } from './workspace';
import { TriadCategory } from './protocol';

export type TriadLanguage = 'typescript' | 'python' | 'go' | 'rust';
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
        parserEngine: 'native',
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

export function ensureTriadConfig(paths: WorkspacePaths, force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });

    if (force || !fs.existsSync(paths.configFile)) {
        fs.writeFileSync(paths.configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
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
    return {
        schemaVersion: DEFAULT_CONFIG.schemaVersion,
        architecture: {
            language: value.architecture?.language ?? DEFAULT_CONFIG.architecture.language,
            parserEngine: value.architecture?.parserEngine ?? DEFAULT_CONFIG.architecture.parserEngine,
            adapter: value.architecture?.adapter ?? DEFAULT_CONFIG.architecture.adapter
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
