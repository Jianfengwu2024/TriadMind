import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig, resolveCategoryBySourcePath, shouldExcludeSourcePath } from './config';
import { TriadCategory } from './protocol';
import { RuntimeEdge, RuntimeEvidence, RuntimeMap, RuntimeNode } from './runtime/types';
import { safeWalkProject } from './sourceWalker';
import { WorkspacePaths, normalizePath } from './workspace';

export type CoverageMetricName = 'triad' | 'runtime' | 'combined';

export interface CoverageDiagnostic {
    level: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    sourcePath?: string;
}

export interface CoverageBucketReport {
    key: string;
    category?: TriadCategory | 'unknown';
    rootPath?: string;
    exists?: boolean;
    totalSourceFiles: number;
    triadCoveredFiles: number;
    runtimeCoveredFiles: number;
    combinedCoveredFiles: number;
    triadCoverage: number;
    runtimeCoverage: number;
    combinedCoverage: number;
    uncoveredSamples: string[];
}

export interface CoverageReport {
    schemaVersion: '1.0';
    generatedAt: string;
    projectRoot: string;
    artifacts: {
        triadMapFile: string;
        runtimeMapFile: string;
        coverageReportFile: string;
    };
    summary: CoverageBucketReport;
    byCategory: Record<string, CoverageBucketReport>;
    byRoot: Record<string, CoverageBucketReport>;
    diagnostics: CoverageDiagnostic[];
}

type TriadNodeLike = {
    sourcePath?: string;
};

const SUPPORTED_SOURCE_FILE_PATTERN = /\.(py|ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs|java|cc|cpp|cxx|hpp|hh|h)$/i;
const MAX_UNCOVERED_SAMPLES = 20;

export function runCoverage(paths: WorkspacePaths): CoverageReport {
    const config = loadTriadConfig(paths);
    const diagnostics: CoverageDiagnostic[] = [];
    const universeFiles = collectCoverageUniverse(paths, config, diagnostics);
    const universeLookup = new Map<string, string>(universeFiles.map((item) => [canonicalizeCoverageKey(item), item]));
    const triadCovered = resolveCoveredFiles(
        readTriadNodes(paths.mapFile),
        universeLookup,
        diagnostics,
        'triad',
        paths.projectRoot
    );
    const runtimeCovered = resolveCoveredFiles(
        collectRuntimeSourcePaths(paths.runtimeMapFile),
        universeLookup,
        diagnostics,
        'runtime',
        paths.projectRoot
    );
    const combinedCovered = new Set<string>([...triadCovered, ...runtimeCovered]);

    const byCategoryEntries = Object.keys(config.categories).map((rawCategory) => {
        const category = rawCategory as TriadCategory;
        const categoryFiles = universeFiles.filter(
            (relativePath) => resolveCategoryBySourcePath(relativePath, config.categories) === category
        );
        return [
            category,
            buildBucketReport({
                key: category,
                category,
                totalFiles: categoryFiles,
                triadCovered,
                runtimeCovered,
                combinedCovered
            })
        ] as const;
    });

    const byRootEntries = collectConfiguredRoots(paths.projectRoot, config.categories).map((root) => {
        const rootFiles = universeFiles.filter((relativePath) => matchesRoot(relativePath, root.rootPath));
        return [
            root.rootPath,
            buildBucketReport({
                key: root.rootPath,
                category: root.category,
                rootPath: root.rootPath,
                exists: root.exists,
                totalFiles: rootFiles,
                triadCovered,
                runtimeCovered,
                combinedCovered
            })
        ] as const;
    });

    const report: CoverageReport = {
        schemaVersion: '1.0',
        generatedAt: new Date().toISOString(),
        projectRoot: paths.projectRoot,
        artifacts: {
            triadMapFile: paths.mapFile,
            runtimeMapFile: paths.runtimeMapFile,
            coverageReportFile: paths.coverageReportFile
        },
        summary: buildBucketReport({
            key: 'summary',
            totalFiles: universeFiles,
            triadCovered,
            runtimeCovered,
            combinedCovered
        }),
        byCategory: Object.fromEntries(byCategoryEntries),
        byRoot: Object.fromEntries(byRootEntries),
        diagnostics
    };

    fs.mkdirSync(path.dirname(paths.coverageReportFile), { recursive: true });
    fs.writeFileSync(paths.coverageReportFile, JSON.stringify(report, null, 2), 'utf-8');
    return report;
}

export function formatCoverageReport(report: CoverageReport) {
    const lines = [
        'TriadMind Coverage',
        `generatedAt=${report.generatedAt}`,
        `summary triad=${report.summary.triadCoverage.toFixed(3)} runtime=${report.summary.runtimeCoverage.toFixed(3)} combined=${report.summary.combinedCoverage.toFixed(3)}`,
        `sourceFiles=${report.summary.totalSourceFiles}, triadCovered=${report.summary.triadCoveredFiles}, runtimeCovered=${report.summary.runtimeCoveredFiles}, combinedCovered=${report.summary.combinedCoveredFiles}`
    ];

    for (const bucket of Object.values(report.byCategory)) {
        lines.push(
            `category:${bucket.key} triad=${bucket.triadCoverage.toFixed(3)} runtime=${bucket.runtimeCoverage.toFixed(3)} combined=${bucket.combinedCoverage.toFixed(3)} files=${bucket.totalSourceFiles}`
        );
    }

    for (const bucket of Object.values(report.byRoot)) {
        lines.push(
            `root:${bucket.key} exists=${bucket.exists ? 'true' : 'false'} combined=${bucket.combinedCoverage.toFixed(3)} files=${bucket.totalSourceFiles}`
        );
    }

    if (report.diagnostics.length > 0) {
        lines.push(`diagnostics=${report.diagnostics.length}`);
    }

    return lines.join('\n');
}

function collectCoverageUniverse(
    paths: WorkspacePaths,
    config: ReturnType<typeof loadTriadConfig>,
    diagnostics: CoverageDiagnostic[]
) {
    const files = new Set<string>();
    safeWalkProject({
        projectRoot: paths.projectRoot,
        mode: 'runtime',
        config,
        maxFiles: config.runtime.maxScannedFiles,
        onFile: (_absolutePath, relativePath) => {
            const normalized = normalizeCoveragePath(paths.projectRoot, relativePath);
            if (!normalized || !isSupportedCoverageFile(normalized) || shouldExcludeSourcePath(normalized, config)) {
                return;
            }
            files.add(normalized);
        },
        onDiagnostic: (diagnostic) => {
            diagnostics.push({
                level: diagnostic.level,
                code: diagnostic.code ?? 'COVERAGE_SOURCE_WALK_NOTICE',
                message: diagnostic.message,
                sourcePath: diagnostic.sourcePath
            });
        }
    });

    return Array.from(files).sort();
}

function resolveCoveredFiles(
    rawSourcePaths: Iterable<string>,
    universeLookup: Map<string, string>,
    diagnostics: CoverageDiagnostic[],
    channel: 'triad' | 'runtime',
    projectRoot: string
) {
    const covered = new Set<string>();
    const missing = new Set<string>();

    for (const rawSourcePath of rawSourcePaths) {
        const normalized = normalizeCoveragePath(projectRoot, rawSourcePath);
        if (!normalized || !isSupportedCoverageFile(normalized)) {
            continue;
        }
        const resolved = universeLookup.get(canonicalizeCoverageKey(normalized));
        if (resolved) {
            covered.add(resolved);
        } else {
            missing.add(normalized);
        }
    }

    for (const sourcePath of Array.from(missing).sort().slice(0, MAX_UNCOVERED_SAMPLES)) {
        diagnostics.push({
            level: 'info',
            code: channel === 'triad' ? 'COVERAGE_TRIAD_SOURCE_OUTSIDE_UNIVERSE' : 'COVERAGE_RUNTIME_SOURCE_OUTSIDE_UNIVERSE',
            message: `${channel} sourcePath did not match coverage universe`,
            sourcePath
        });
    }

    return covered;
}

function buildBucketReport(input: {
    key: string;
    category?: TriadCategory | 'unknown';
    rootPath?: string;
    exists?: boolean;
    totalFiles: string[];
    triadCovered: Set<string>;
    runtimeCovered: Set<string>;
    combinedCovered: Set<string>;
}) {
    const triadCoveredFiles = input.totalFiles.filter((file) => input.triadCovered.has(file));
    const runtimeCoveredFiles = input.totalFiles.filter((file) => input.runtimeCovered.has(file));
    const combinedCoveredFiles = input.totalFiles.filter((file) => input.combinedCovered.has(file));
    const uncovered = input.totalFiles.filter((file) => !input.combinedCovered.has(file));

    return {
        key: input.key,
        category: input.category,
        rootPath: input.rootPath,
        exists: input.exists,
        totalSourceFiles: input.totalFiles.length,
        triadCoveredFiles: triadCoveredFiles.length,
        runtimeCoveredFiles: runtimeCoveredFiles.length,
        combinedCoveredFiles: combinedCoveredFiles.length,
        triadCoverage: safeRatio(triadCoveredFiles.length, input.totalFiles.length),
        runtimeCoverage: safeRatio(runtimeCoveredFiles.length, input.totalFiles.length),
        combinedCoverage: safeRatio(combinedCoveredFiles.length, input.totalFiles.length),
        uncoveredSamples: uncovered.slice(0, MAX_UNCOVERED_SAMPLES)
    } satisfies CoverageBucketReport;
}

function collectConfiguredRoots(projectRoot: string, categories: Record<TriadCategory, string[]>) {
    const descriptors = new Map<string, { category: TriadCategory; rootPath: string; exists: boolean }>();
    for (const [rawCategory, patterns] of Object.entries(categories) as Array<[TriadCategory, string[]]>) {
        for (const rawPattern of Array.isArray(patterns) ? patterns : []) {
            const rootPath = normalizeRootPattern(rawPattern);
            if (!rootPath || descriptors.has(rootPath)) {
                continue;
            }
            descriptors.set(rootPath, {
                category: rawCategory,
                rootPath,
                exists: pathExists(path.join(projectRoot, rootPath))
            });
        }
    }
    return Array.from(descriptors.values()).sort((left, right) => left.rootPath.localeCompare(right.rootPath));
}

function readTriadNodes(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return [] as string[];
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as TriadNodeLike[];
        return Array.isArray(parsed) ? parsed.map((node) => String(node?.sourcePath ?? '')).filter(Boolean) : [];
    } catch {
        return [] as string[];
    }
}

function collectRuntimeSourcePaths(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return [] as string[];
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as RuntimeMap;
        if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            return [] as string[];
        }

        const sourcePaths = new Set<string>();
        parsed.nodes.forEach((node) => collectRuntimeNodeSourcePaths(node, sourcePaths));
        parsed.edges.forEach((edge) => collectRuntimeEdgeSourcePaths(edge, sourcePaths));
        return Array.from(sourcePaths);
    } catch {
        return [] as string[];
    }
}

function collectRuntimeNodeSourcePaths(node: RuntimeNode, sink: Set<string>) {
    if (node.sourcePath) {
        sink.add(node.sourcePath);
    }
    collectEvidenceSourcePaths(node.evidence, sink);
}

function collectRuntimeEdgeSourcePaths(edge: RuntimeEdge, sink: Set<string>) {
    collectEvidenceSourcePaths(edge.evidence, sink);
}

function collectEvidenceSourcePaths(evidence: RuntimeEvidence[] | undefined, sink: Set<string>) {
    for (const item of Array.isArray(evidence) ? evidence : []) {
        if (item?.sourcePath) {
            sink.add(item.sourcePath);
        }
    }
}

function matchesRoot(relativePath: string, rootPath: string) {
    return relativePath === rootPath || relativePath.startsWith(`${rootPath}/`);
}

function normalizeRootPattern(value: string) {
    return normalizePath(String(value ?? '').trim())
        .replace(/^\.?\//, '')
        .replace(/\/+$/, '')
        .toLowerCase();
}

function normalizeCoveragePath(projectRoot: string, value: string | undefined) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '';
    }

    let normalized = normalizePath(raw);
    if (projectRoot && path.isAbsolute(raw)) {
        const relative = normalizePath(path.relative(projectRoot, raw));
        if (relative.startsWith('..')) {
            return '';
        }
        normalized = relative;
    }

    normalized = normalized.replace(/^\.?\//, '').replace(/^\/+/, '').replace(/\/+/g, '/');
    return normalized;
}

function canonicalizeCoverageKey(value: string) {
    return normalizeCoveragePath('', value).toLowerCase();
}

function isSupportedCoverageFile(relativePath: string) {
    return SUPPORTED_SOURCE_FILE_PATTERN.test(relativePath);
}

function pathExists(targetPath: string) {
    try {
        return fs.existsSync(targetPath);
    } catch {
        return false;
    }
}

function safeRatio(part: number, total: number) {
    if (!total) {
        return 0;
    }
    return Number((part / total).toFixed(6));
}
