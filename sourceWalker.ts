import * as fs from 'fs';
import * as path from 'path';
import { isIgnorableFsError, shouldIncludeRuntimePath, shouldSkipWalkPath, TriadConfig } from './config';
import { normalizePath } from './workspace';

export type SourceWalkMode = 'parser' | 'runtime' | 'visualizer';

export interface SourceWalkDiagnostic {
    level: 'info' | 'warning' | 'error';
    message: string;
    sourcePath?: string;
    code?: string;
}

interface SafeWalkProjectOptions {
    projectRoot: string;
    mode: SourceWalkMode;
    config: TriadConfig;
    maxFiles?: number;
    onFile: (absolutePath: string, relativePath: string) => void;
    onDiagnostic?: (diagnostic: SourceWalkDiagnostic) => void;
}

export interface SafeWalkSummary {
    scannedFiles: number;
    skippedPermissionPaths: string[];
    skippedExcludedPaths: string[];
    skippedMissingPaths: string[];
    maxFilesReached: boolean;
}

const RUNTIME_SKIP_SEGMENTS = new Set([
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
    'logs',
    'uploads',
    'fastgpt_data',
    '.run_state',
    'tmp'
]);

const GENERATED_OR_LOCK_FILE_PATTERNS = [
    /\.lock$/i,
    /^package-lock\.json$/i,
    /^pnpm-lock\.ya?ml$/i,
    /^yarn\.lock$/i,
    /\.min\.(js|css)$/i,
    /\.map$/i,
    /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|tar|bz2|7z|exe|dll|so|dylib|bin|class|jar)$/i
];

export function safeWalkProject(options: SafeWalkProjectOptions): SafeWalkSummary {
    const summary: SafeWalkSummary = {
        scannedFiles: 0,
        skippedPermissionPaths: [],
        skippedExcludedPaths: [],
        skippedMissingPaths: [],
        maxFilesReached: false
    };

    walk(options.projectRoot);
    return summary;

    function walk(currentPath: string) {
        if (summary.maxFilesReached) {
            return;
        }

        let stat: fs.Stats;
        try {
            stat = fs.statSync(currentPath);
        } catch (error: any) {
            recordRecoverablePath(error, currentPath);
            return;
        }

        const relativePath = normalizeRelativePath(options.projectRoot, currentPath);
        if (stat.isFile()) {
            if (shouldSkipFile(relativePath, options.config, options.mode)) {
                recordExcludedPath(relativePath);
                return;
            }

            summary.scannedFiles += 1;
            options.onFile(currentPath, relativePath);
            if (options.maxFiles && summary.scannedFiles >= options.maxFiles) {
                summary.maxFilesReached = true;
                options.onDiagnostic?.({
                    level: 'warning',
                    code: 'RUNTIME_MAX_FILES_REACHED',
                    message: `Stopped runtime source scan after reaching runtime.maxScannedFiles=${options.maxFiles}`
                });
            }
            return;
        }

        if (relativePath && shouldSkipDirectory(relativePath, options.config, options.mode)) {
            recordExcludedPath(relativePath);
            return;
        }

        let entries: string[];
        try {
            entries = fs.readdirSync(currentPath);
        } catch (error: any) {
            recordRecoverablePath(error, currentPath);
            return;
        }

        for (const entry of entries) {
            walk(path.join(currentPath, entry));
            if (summary.maxFilesReached) {
                return;
            }
        }
    }

    function recordExcludedPath(relativePath: string) {
        if (!relativePath || summary.skippedExcludedPaths.includes(relativePath)) {
            return;
        }
        summary.skippedExcludedPaths.push(relativePath);
    }

    function recordRecoverablePath(error: any, targetPath: string) {
        if (!isIgnorableFsError(error)) {
            throw error;
        }

        const relativePath = normalizeRelativePath(options.projectRoot, targetPath);
        const code = String(error?.code ?? '').toUpperCase();
        if (code === 'ENOENT') {
            summary.skippedMissingPaths.push(relativePath);
        } else {
            summary.skippedPermissionPaths.push(relativePath);
        }
        options.onDiagnostic?.({
            level: code === 'ENOENT' ? 'info' : 'warning',
            code: code === 'ENOENT' ? 'RUNTIME_PATH_MISSING' : 'RUNTIME_PERMISSION_SKIPPED',
            sourcePath: relativePath,
            message: `Skipped ${relativePath || '.'} due to ${code || 'recoverable FS error'}`
        });
    }
}

export function shouldSkipDirectory(relativePath: string, config: TriadConfig, mode: SourceWalkMode) {
    const normalized = normalizePath(relativePath).toLowerCase();
    const segments = normalized.split('/').filter(Boolean);
    const basename = segments[segments.length - 1] ?? normalized;

    if (shouldSkipWalkPath(normalized) || shouldSkipWalkPath(basename)) {
        return true;
    }

    if (mode === 'runtime') {
        return segments.some((segment) => RUNTIME_SKIP_SEGMENTS.has(segment));
    }

    return false;
}

export function shouldSkipFile(relativePath: string, config: TriadConfig, mode: SourceWalkMode) {
    const normalized = normalizePath(relativePath).toLowerCase();
    const basename = normalized.split('/').filter(Boolean).pop() ?? normalized;

    if (shouldSkipWalkPath(normalized) || shouldSkipWalkPath(basename)) {
        return true;
    }

    if (mode === 'runtime' && !shouldIncludeRuntimePath(relativePath, config)) {
        return true;
    }

    return GENERATED_OR_LOCK_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}

function normalizeRelativePath(projectRoot: string, currentPath: string) {
    const relative = normalizePath(path.relative(projectRoot, currentPath));
    return relative === '' ? '' : relative;
}
