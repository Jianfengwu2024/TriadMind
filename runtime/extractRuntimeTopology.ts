import * as path from 'path';
import { loadTriadConfig } from '../config';
import { getWorkspacePaths } from '../workspace';
import { filterRuntimeMapByView } from './filterRuntimeMapByView';
import {
    RuntimeDiagnostic,
    RuntimeExtractContext,
    RuntimeExtractOptions,
    RuntimeMap,
    RuntimeTopologyExtractor
} from './types';
import { mergeRuntimeEdges, mergeRuntimeNodes } from './runtimeUtils';
import { httpRouteExtractor } from './extractors/httpRouteExtractor';
import { frontendApiCallExtractor } from './extractors/frontendApiCallExtractor';
import { taskQueueExtractor } from './extractors/taskQueueExtractor';
import { workflowRegistryExtractor } from './extractors/workflowRegistryExtractor';
import { resourceAccessExtractor } from './extractors/resourceAccessExtractor';
import { configInfraExtractor } from './extractors/configInfraExtractor';
import { collectRuntimeSourceFiles } from './collectRuntimeSourceFiles';
import { normalizeRuntimeDiagnostics } from './runtimeDiagnostics';

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
        files: collectRuntimeSourceFiles(resolvedProjectRoot, config, diagnostics)
    };

    const extractors = options.extractors ?? getBuiltInRuntimeExtractors();
    const nodes = [];
    const edges = [];
    let detectedExtractorCount = 0;

    for (const extractor of extractors) {
        try {
            const detected = await extractor.detect(context);
            if (!detected) {
                continue;
            }
            detectedExtractorCount += 1;

            const patch = await extractor.extract(context);
            nodes.push(...(patch.nodes ?? []));
            edges.push(...(patch.edges ?? []));
            diagnostics.push(...normalizeRuntimeDiagnostics(patch.diagnostics ?? [], extractor.name));
        } catch (error: any) {
            const diagnostic: RuntimeDiagnostic = {
                level: 'error',
                code: 'RUNTIME_EXTRACTOR_FAILED',
                extractor: extractor.name,
                message: error?.message ? String(error.message) : String(error)
            };
            diagnostics.push(diagnostic);
            if (config.runtime.failOnExtractorError) {
                throw new Error(`${extractor.name}: ${diagnostic.message}`);
            }
        }
    }

    if (frameworkHint && detectedExtractorCount === 0) {
        diagnostics.push({
            level: 'info',
            code: 'RUNTIME_FRAMEWORK_HINT_UNUSED',
            extractor: 'RuntimeOrchestrator',
            message: `Framework hint "${frameworkHint}" did not activate any runtime extractor`
        });
    }

    const fullMap: RuntimeMap = {
        schemaVersion: '1.0',
        project: path.basename(resolvedProjectRoot),
        generatedAt: new Date().toISOString(),
        view,
        nodes: mergeRuntimeNodes(nodes),
        edges: mergeRuntimeEdges(edges),
        diagnostics: normalizeRuntimeDiagnostics(diagnostics, 'RuntimeOrchestrator')
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
