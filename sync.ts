import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { resolveAdapter } from './adapter';
import { createSourcePathFilter, isIgnorableFsError, loadTriadConfig, shouldSkipWalkPath, TriadScanMode } from './config';
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
    resolveAdapter(paths).parseTopology(paths.projectRoot, paths.mapFile, effectiveConfig);
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
