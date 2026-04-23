import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig } from '../config';
import { getWorkspacePaths, normalizePath } from '../workspace';
import { filterRuntimeMapByView } from './filterRuntimeMapByView';
import {
    RuntimeDiagnostic,
    RuntimeExtractContext,
    RuntimeExtractOptions,
    RuntimeMap,
    RuntimeSourceFile,
    RuntimeSourceLanguage,
    RuntimeTopologyExtractor
} from './types';
import { mergeRuntimeEdges, mergeRuntimeNodes } from './runtimeUtils';
import { httpRouteExtractor } from './extractors/httpRouteExtractor';
import { frontendApiCallExtractor } from './extractors/frontendApiCallExtractor';
import { taskQueueExtractor } from './extractors/taskQueueExtractor';
import { workflowRegistryExtractor } from './extractors/workflowRegistryExtractor';
import { resourceAccessExtractor } from './extractors/resourceAccessExtractor';
import { configInfraExtractor } from './extractors/configInfraExtractor';

export async function extractRuntimeTopology(
    projectRoot: string,
    options: RuntimeExtractOptions = {}
): Promise<RuntimeMap> {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const paths = getWorkspacePaths(resolvedProjectRoot);
    const config = loadTriadConfig(paths);
    const view = options.view ?? config.runtime.defaultView;
    const frameworkHint = options.frameworkHint ?? config.runtime.frameworkHints[0];
    const includeFrontend = options.includeFrontend ?? config.runtime.includeFrontend;
    const includeInfra = options.includeInfra ?? config.runtime.includeInfra;
    const diagnostics: RuntimeDiagnostic[] = [];

    const context: RuntimeExtractContext = {
        projectRoot: resolvedProjectRoot,
        config,
        view,
        includeFrontend,
        includeInfra,
        frameworkHint,
        files: collectRuntimeSourceFiles(resolvedProjectRoot, config.runtime.excludePathPatterns, config.runtime.maxSourceFileBytes, diagnostics)
    };

    const extractors = options.extractors ?? getBuiltInRuntimeExtractors();
    const nodes = [];
    const edges = [];

    for (const extractor of extractors) {
        try {
            const detected = await extractor.detect(context);
            if (!detected) {
                continue;
            }

            const patch = await extractor.extract(context);
            nodes.push(...(patch.nodes ?? []));
            edges.push(...(patch.edges ?? []));
            diagnostics.push(...(patch.diagnostics ?? []));
        } catch (error: any) {
            diagnostics.push({
                level: 'error',
                extractor: extractor.name,
                message: error?.message ? String(error.message) : String(error)
            });
        }
    }

    const fullMap: RuntimeMap = {
        schemaVersion: '1.0',
        project: path.basename(resolvedProjectRoot),
        generatedAt: new Date().toISOString(),
        view,
        nodes: mergeRuntimeNodes(nodes),
        edges: mergeRuntimeEdges(edges),
        diagnostics
    };

    return filterRuntimeMapByView(fullMap, view);
}

export function getBuiltInRuntimeExtractors(): RuntimeTopologyExtractor[] {
    return [
        httpRouteExtractor,
        frontendApiCallExtractor,
        taskQueueExtractor,
        workflowRegistryExtractor,
        resourceAccessExtractor,
        configInfraExtractor
    ];
}

function collectRuntimeSourceFiles(
    projectRoot: string,
    excludePathPatterns: string[],
    maxSourceFileBytes: number,
    diagnostics: RuntimeDiagnostic[]
) {
    const files: RuntimeSourceFile[] = [];
    walk(projectRoot, (absolutePath) => {
        const relativePath = normalizePath(path.relative(projectRoot, absolutePath));
        if (shouldSkipRuntimePath(relativePath, excludePathPatterns)) {
            return;
        }

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
                message: `Could not stat source file: ${error?.message ?? String(error)}`,
                sourcePath: relativePath,
                extractor: 'RuntimeSourceCollector'
            });
            return;
        }

        if (stat.size > maxSourceFileBytes) {
            diagnostics.push({
                level: 'info',
                message: `Skipped source file above runtime.maxSourceFileBytes (${stat.size} bytes)`,
                sourcePath: relativePath,
                extractor: 'RuntimeSourceCollector'
            });
            return;
        }

        try {
            const content = fs.readFileSync(absolutePath, 'utf-8').replace(/^\uFEFF/, '');
            if (content.includes('\0')) {
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
                message: `Could not read source file: ${error?.message ?? String(error)}`,
                sourcePath: relativePath,
                extractor: 'RuntimeSourceCollector'
            });
        }
    });

    return files;
}

function walk(currentPath: string, visit: (filePath: string) => void) {
    if (!fs.existsSync(currentPath)) {
        return;
    }

    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
        visit(currentPath);
        return;
    }

    for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry), visit);
    }
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
    const basename = relativePath.split('/').pop()?.toLowerCase() ?? '';
    return /^\.env(\..+)?$/.test(basename);
}

function shouldSkipRuntimePath(relativePath: string, excludePathPatterns: string[]) {
    const normalizedPath = normalizePath(relativePath).toLowerCase();
    const segments = normalizedPath.split('/').filter(Boolean);
    const basename = segments[segments.length - 1] ?? normalizedPath;

    if (basename === '.git') {
        return true;
    }

    return excludePathPatterns.some((pattern) => {
        const normalizedPattern = normalizePath(pattern).replace(/^\.?\//, '').toLowerCase();
        return (
            normalizedPath === normalizedPattern ||
            normalizedPath.startsWith(`${normalizedPattern}/`) ||
            normalizedPath.endsWith(`/${normalizedPattern}`) ||
            normalizedPath.includes(`/${normalizedPattern}/`) ||
            segments.includes(normalizedPattern)
        );
    });
}
