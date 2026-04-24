import * as fs from 'fs';
import * as path from 'path';
import { TriadConfig } from '../config';
import { safeWalkProject } from '../sourceWalker';
import { normalizePath } from '../workspace';
import { RuntimeDiagnostic, RuntimeSourceFile, RuntimeSourceLanguage } from './types';

export function collectRuntimeSourceFiles(
    projectRoot: string,
    config: TriadConfig,
    diagnostics: RuntimeDiagnostic[]
) {
    const files: RuntimeSourceFile[] = [];

    const summary = safeWalkProject({
        projectRoot,
        mode: 'runtime',
        config,
        maxFiles: config.runtime.maxScannedFiles,
        onDiagnostic(diagnostic) {
            diagnostics.push({
                level: diagnostic.level,
                code: diagnostic.code ?? `RUNTIME_SOURCE_WALK_${diagnostic.level.toUpperCase()}`,
                sourcePath: diagnostic.sourcePath,
                extractor: 'RuntimeSourceCollector',
                message: diagnostic.message
            });
        },
        onFile(absolutePath, relativePath) {
            const language = detectRuntimeLanguage(absolutePath);
            if (language === 'unknown' && !isRuntimeUnknownConfigFile(relativePath)) {
                return;
            }

            let stat: fs.Stats;
            try {
                stat = fs.statSync(absolutePath);
            } catch (error: any) {
                diagnostics.push({
                    level: 'warning',
                    code: String(error?.code ?? '').toUpperCase() || 'RUNTIME_STAT_FAILED',
                    message: `Could not stat runtime source file: ${error?.message ?? String(error)}`,
                    sourcePath: relativePath,
                    extractor: 'RuntimeSourceCollector'
                });
                return;
            }

            if (stat.size > config.runtime.maxSourceFileBytes) {
                diagnostics.push({
                    level: 'info',
                    code: 'RUNTIME_FILE_TOO_LARGE',
                    message: `Skipped source file above runtime.maxSourceFileBytes (${stat.size} bytes)`,
                    sourcePath: relativePath,
                    extractor: 'RuntimeSourceCollector'
                });
                return;
            }

            try {
                const content = fs.readFileSync(absolutePath, 'utf-8').replace(/^\uFEFF/, '');
                if (content.includes('\0')) {
                    diagnostics.push({
                        level: 'info',
                        code: 'RUNTIME_BINARY_SKIPPED',
                        message: 'Skipped binary-like source file during runtime extraction',
                        sourcePath: relativePath,
                        extractor: 'RuntimeSourceCollector'
                    });
                    return;
                }

                files.push({
                    absolutePath,
                    relativePath,
                    language,
                    content
                });
            } catch (error: any) {
                diagnostics.push({
                    level: 'warning',
                    code: String(error?.code ?? '').toUpperCase() || 'RUNTIME_READ_FAILED',
                    message: `Could not read runtime source file: ${error?.message ?? String(error)}`,
                    sourcePath: relativePath,
                    extractor: 'RuntimeSourceCollector'
                });
            }
        }
    });

    pushSummaryDiagnostics(summary, diagnostics);
    return files;
}

function pushSummaryDiagnostics(
    summary: {
        scannedFiles: number;
        skippedPermissionPaths: string[];
        skippedExcludedPaths: string[];
        skippedMissingPaths: string[];
        maxFilesReached: boolean;
    },
    diagnostics: RuntimeDiagnostic[]
) {
    if (summary.skippedPermissionPaths.length > 0) {
        diagnostics.push({
            level: 'warning',
            code: 'RUNTIME_PERMISSION_SKIPPED_SUMMARY',
            extractor: 'RuntimeSourceCollector',
            message: buildSummaryMessage(
                'Skipped runtime paths due to permission restrictions',
                summary.skippedPermissionPaths
            )
        });
    }

    if (summary.skippedExcludedPaths.length > 0) {
        diagnostics.push({
            level: 'info',
            code: 'RUNTIME_EXCLUDED_PATHS_SUMMARY',
            extractor: 'RuntimeSourceCollector',
            message: buildSummaryMessage('Skipped runtime paths by exclude rules', summary.skippedExcludedPaths)
        });
    }

    if (summary.skippedMissingPaths.length > 0) {
        diagnostics.push({
            level: 'info',
            code: 'RUNTIME_PATH_MISSING_SUMMARY',
            extractor: 'RuntimeSourceCollector',
            message: buildSummaryMessage('Skipped missing runtime paths during traversal', summary.skippedMissingPaths)
        });
    }

    if (summary.maxFilesReached) {
        diagnostics.push({
            level: 'warning',
            code: 'RUNTIME_MAX_FILES_REACHED',
            extractor: 'RuntimeSourceCollector',
            message: `Runtime source scan reached maxScannedFiles limit at ${summary.scannedFiles} files`
        });
    }
}

function buildSummaryMessage(prefix: string, paths: string[]) {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    const samples = uniquePaths.slice(0, 5).join(', ');
    const suffix = uniquePaths.length > 5 ? ` (+${uniquePaths.length - 5} more)` : '';
    return `${prefix}: ${uniquePaths.length}${samples ? ` [${samples}${suffix}]` : ''}`;
}

function detectRuntimeLanguage(filePath: string): RuntimeSourceLanguage {
    const basename = path.basename(filePath).toLowerCase();
    const extension = path.extname(filePath).toLowerCase();

    if (basename === 'dockerfile' || basename.endsWith('.dockerfile')) {
        return 'dockerfile';
    }
    if (extension === '.py') {
        return 'python';
    }
    if (extension === '.ts' || extension === '.tsx' || extension === '.mts' || extension === '.cts') {
        return 'typescript';
    }
    if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
        return 'javascript';
    }
    if (extension === '.json') {
        return 'json';
    }
    if (extension === '.yaml' || extension === '.yml') {
        return 'yaml';
    }
    if (extension === '.toml') {
        return 'toml';
    }

    return 'unknown';
}

function isRuntimeUnknownConfigFile(relativePath: string) {
    const basename = normalizePath(relativePath).split('/').pop()?.toLowerCase() ?? '';
    return /^\.env(\..+)?$/.test(basename);
}
