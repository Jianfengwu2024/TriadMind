import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { resolveAdapter } from './adapter';
import { createSourcePathFilter, isIgnorableFsError, loadTriadConfig, shouldSkipWalkPath, TriadLanguage, TriadScanMode } from './config';
import { collectTreeSitterParseResult, TreeSitterTriadNode } from './treeSitterParser';
import { normalizePath, WorkspacePaths } from './workspace';

interface SourceFileDigest {
    path: string;
    sha256: string;
}

interface SyncManifest {
    schemaVersion: '1.0';
    generatedAt: string;
    parserEngine: string;
    configHash: string;
    files: SourceFileDigest[];
}

export function syncTriadMap(paths: WorkspacePaths, force = false) {
    return syncTriadMapWithOptions(paths, { force });
}

export function syncTriadMapWithOptions(
    paths: WorkspacePaths,
    options: { force?: boolean; scanMode?: TriadScanMode } = {}
) {
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    const config = loadTriadConfig(paths);
    const effectiveConfig = options.scanMode
        ? {
              ...config,
              parser: {
                  ...config.parser,
                  scanMode: options.scanMode
              }
          }
        : config;
    const currentManifest = buildManifest(paths, effectiveConfig);
    const previousManifest = readManifest(paths);
    const changed = Boolean(options.force) || !previousManifest || !isSameManifest(previousManifest, currentManifest);

    if (!changed) {
        console.log(chalk.gray('   - [Sync] triad-map is up to date; no source changes detected.'));
        return {
            changed: false,
            fileCount: currentManifest.files.length
        };
    }

    console.log(chalk.gray('   - [Sync] source changes detected; rebuilding triad-map...'));
    if (effectiveConfig.architecture.parserEngine === 'tree-sitter') {
        syncPolyglotTreeSitterTopology(paths, effectiveConfig);
    } else {
        resolveAdapter(paths).parseTopology(paths.projectRoot, paths.mapFile, effectiveConfig);
    }
    const nextManifest: SyncManifest = {
        ...currentManifest,
        parserEngine: effectiveConfig.architecture.parserEngine,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(paths.syncCacheFile, JSON.stringify(nextManifest, null, 2), 'utf-8');

    return {
        changed: true,
        fileCount: currentManifest.files.length
    };
}

export function watchTriadMap(paths: WorkspacePaths) {
    console.log(chalk.cyan(`[TriadMind] Watching ${paths.projectRoot}`));
    syncTriadMap(paths, true);

    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            try {
                syncTriadMap(paths);
            } catch (error: any) {
                console.log(chalk.red(`[TriadMind] watch sync failed: ${error.message}`));
            }
        }, 250);
    };

    const watcher = fs.watch(paths.projectRoot, { recursive: true }, (_event, filename) => {
        if (!filename) {
            return;
        }

        const relativePath = normalizePath(String(filename));
        const config = loadTriadConfig(paths);
        const includeSourcePath = createSourcePathFilter(paths.projectRoot, config);
        if (!includeSourcePath(relativePath)) {
            return;
        }

        if (!isSourceFile(relativePath)) {
            return;
        }

        schedule();
    });

    process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
    });
}

function buildManifest(paths: WorkspacePaths, config = loadTriadConfig(paths)): SyncManifest {
    const files = collectSourceFiles(paths)
        .map((filePath) => ({
            path: filePath,
            sha256: hashFile(path.join(paths.projectRoot, filePath))
        }))
        .filter((file): file is SourceFileDigest => Boolean(file.sha256));

    return {
        schemaVersion: '1.0',
        generatedAt: new Date().toISOString(),
        parserEngine: config.architecture.parserEngine,
        configHash: hashContent(JSON.stringify(config)),
        files
    };
}

function collectSourceFiles(paths: WorkspacePaths) {
    const config = loadTriadConfig(paths);
    const includeSourcePath = createSourcePathFilter(paths.projectRoot, config);
    const files: string[] = [];
    walk(paths.projectRoot, (filePath) => {
        const relativePath = normalizePath(path.relative(paths.projectRoot, filePath));
        if (!includeSourcePath(relativePath)) {
            return;
        }

        if (isSourceFile(relativePath)) {
            files.push(relativePath);
        }
    });
    return files.sort();
}

function walk(currentPath: string, visit: (filePath: string) => void) {
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

    if (shouldSkipWalkPath(normalizePath(currentPath)) || shouldSkipWalkPath(path.basename(currentPath))) {
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
        walk(path.join(currentPath, entry), visit);
    }
}

function readManifest(paths: WorkspacePaths) {
    if (!fs.existsSync(paths.syncCacheFile)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(paths.syncCacheFile, 'utf-8').replace(/^\uFEFF/, '');
        return JSON.parse(raw) as SyncManifest;
    } catch {
        return null;
    }
}

function isSameManifest(left: SyncManifest, right: SyncManifest) {
    if (left.parserEngine !== right.parserEngine) {
        return false;
    }

    if ((left.configHash ?? '') !== (right.configHash ?? '')) {
        return false;
    }

    if (left.files.length !== right.files.length) {
        return false;
    }

    return left.files.every((file, index) => file.path === right.files[index].path && file.sha256 === right.files[index].sha256);
}

function hashFile(filePath: string) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch (error: any) {
        if (isIgnorableFsError(error)) {
            return '';
        }
        throw error;
    }
}

function hashContent(content: string) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function isSourceFile(filePath: string) {
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|cpp|cc|cxx|hpp|hh|h|java)$/i.test(filePath) && !filePath.endsWith('.d.ts');
}

function syncPolyglotTreeSitterTopology(paths: WorkspacePaths, config: ReturnType<typeof loadTriadConfig>) {
    const languages = detectProjectLanguages(paths, config);
    const results = languages.map((language) => collectTreeSitterParseResult(language, paths.projectRoot, config));
    const rewritePlan = buildCollisionRewritePlan(
        results.flatMap((result) => [...result.leafNodes, ...result.projectedNodes])
    );
    const mergedLeafNodes = mergeMultiLanguageNodes(results.flatMap((result) => result.leafNodes), rewritePlan);
    const mergedCapabilityNodes = mergeMultiLanguageNodes(results.flatMap((result) => result.projectedNodes), rewritePlan);

    fs.mkdirSync(path.dirname(paths.leafMapFile), { recursive: true });
    fs.mkdirSync(path.dirname(paths.mapFile), { recursive: true });
    fs.writeFileSync(paths.leafMapFile, JSON.stringify(mergedLeafNodes, null, 2), 'utf-8');
    fs.writeFileSync(paths.mapFile, JSON.stringify(mergedCapabilityNodes, null, 2), 'utf-8');

    console.log(
        chalk.gray(
            `   - [Sync] polyglot tree-sitter merge complete: languages=${languages.join(', ')}, capability=${mergedCapabilityNodes.length}, leaf=${mergedLeafNodes.length}`
        )
    );
}

function detectProjectLanguages(paths: WorkspacePaths, config: ReturnType<typeof loadTriadConfig>) {
    const includeSourcePath = createSourcePathFilter(paths.projectRoot, config);
    const detected = new Set<TriadLanguage>();
    for (const relativePath of collectSourceFiles(paths)) {
        if (!includeSourcePath(relativePath)) {
            continue;
        }
        const language = inferLanguageFromPath(relativePath);
        if (language) {
            detected.add(language);
        }
    }

    if (detected.size === 0) {
        detected.add(config.architecture.language);
    }

    return LANGUAGE_PRIORITY.filter((language) => detected.has(language));
}

function inferLanguageFromPath(filePath: string): TriadLanguage | undefined {
    const normalized = normalizePath(filePath).toLowerCase();
    if (/\.(ts|tsx|mts|cts)$/.test(normalized)) return 'typescript';
    if (/\.(js|jsx|mjs|cjs)$/.test(normalized)) return 'javascript';
    if (/\.py$/.test(normalized)) return 'python';
    if (/\.go$/.test(normalized)) return 'go';
    if (/\.rs$/.test(normalized)) return 'rust';
    if (/\.(cc|cpp|cxx|hpp|hh|h)$/.test(normalized)) return 'cpp';
    if (/\.java$/.test(normalized)) return 'java';
    return undefined;
}

function mergeMultiLanguageNodes(nodes: TreeSitterTriadNode[], rewritePlan: Map<string, string>) {
    return nodes
        .map((node) => applyCollisionRewrite(node, rewritePlan))
        .sort((left, right) => left.nodeId.localeCompare(right.nodeId) || left.sourcePath.localeCompare(right.sourcePath));
}

function buildCollisionRewritePlan(nodes: TreeSitterTriadNode[]) {
    const grouped = new Map<string, TreeSitterTriadNode[]>();
    for (const node of nodes) {
        const list = grouped.get(node.nodeId) ?? [];
        list.push(node);
        grouped.set(node.nodeId, list);
    }

    const rewritePlan = new Map<string, string>();
    for (const [nodeId, group] of grouped.entries()) {
        const uniqueSourceKeys = new Set(group.map((node) => normalizePath(node.sourcePath).toLowerCase()));
        if (uniqueSourceKeys.size <= 1) {
            continue;
        }

        const sourceNamespaces = chooseUniqueSourceNamespaces(group);
        for (const node of group) {
            const identity = buildNodeIdentity(node);
            const namespace = sourceNamespaces.get(identity) ?? sanitizeNamespace(node.category);
            rewritePlan.set(identity, `${sanitizeNamespace(node.category)}.${namespace}.${nodeId}`);
        }
    }

    return rewritePlan;
}

function chooseUniqueSourceNamespaces(group: TreeSitterTriadNode[]) {
    const keyedSegments = group.map((node) => ({
        identity: buildNodeIdentity(node),
        segments: extractSourceNamespaceSegments(node.sourcePath)
    }));

    for (let width = 1; width <= Math.max(...keyedSegments.map((item) => item.segments.length), 1); width += 1) {
        const candidateMap = new Map<string, string>();
        let hasCollision = false;
        for (const item of keyedSegments) {
            const namespace = buildNamespaceFromSegments(item.segments, width);
            if (Array.from(candidateMap.values()).includes(namespace)) {
                hasCollision = true;
                break;
            }
            candidateMap.set(item.identity, namespace);
        }
        if (!hasCollision) {
            return candidateMap;
        }
    }

    return new Map(
        keyedSegments.map((item, index) => [item.identity, `${buildNamespaceFromSegments(item.segments, item.segments.length)}.${index + 1}`])
    );
}

function applyCollisionRewrite(node: TreeSitterTriadNode, rewritePlan: Map<string, string>): TreeSitterTriadNode {
    const identity = buildNodeIdentity(node);
    const rewrittenNodeId = rewritePlan.get(identity) ?? node.nodeId;
    const rewrittenFoldedLeaves = Array.isArray(node.topology?.foldedLeaves)
        ? node.topology?.foldedLeaves.map((leafId) => {
              const leafIdentity = buildNodeIdentity({
                  ...node,
                  nodeId: leafId
              } as TreeSitterTriadNode);
              return rewritePlan.get(leafIdentity) ?? leafId;
          })
        : undefined;

    return {
        ...node,
        nodeId: rewrittenNodeId,
        topology: rewrittenFoldedLeaves && rewrittenFoldedLeaves.length > 0 ? { foldedLeaves: rewrittenFoldedLeaves } : node.topology
    };
}

function buildNodeIdentity(node: Pick<TreeSitterTriadNode, 'nodeId' | 'sourcePath' | 'category'>) {
    return [node.nodeId, normalizePath(node.sourcePath).toLowerCase(), sanitizeNamespace(node.category)].join('::');
}

function extractSourceNamespaceSegments(sourcePath: string) {
    return normalizePath(sourcePath)
        .replace(/\.[^.\/]+$/, '')
        .split('/')
        .filter(Boolean)
        .map((segment) => sanitizeNamespace(segment))
        .filter((segment) => segment && !GENERIC_NAMESPACE_SEGMENTS.has(segment));
}

function buildNamespaceFromSegments(segments: string[], width: number) {
    const chosen = segments.slice(-Math.max(1, width));
    if (chosen.length === 0) {
        return 'source';
    }
    return chosen.join('.');
}

function sanitizeNamespace(value: string) {
    return String(value ?? '')
        .trim()
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9_]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .replace(/\.{2,}/g, '.')
        .toLowerCase() || 'source';
}

const LANGUAGE_PRIORITY: TriadLanguage[] = ['typescript', 'javascript', 'python', 'go', 'rust', 'cpp', 'java'];
const GENERIC_NAMESPACE_SEGMENTS = new Set(['src', 'app', 'apps', 'packages', 'package', 'lib', 'core', 'main', 'index']);
