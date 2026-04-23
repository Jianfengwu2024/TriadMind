import { RuntimeDiagnostic, RuntimeEdge, RuntimeNode, RuntimeTopologyExtractor } from '../types';
import { apiRouteId, labelFromPath, lineEvidence, normalizeApiPath, normalizeRuntimeId } from '../runtimeUtils';

export const frontendApiCallExtractor: RuntimeTopologyExtractor = {
    name: 'FrontendApiCallExtractor',
    detect(context) {
        return (
            context.includeFrontend &&
            context.files.some(
                (file) =>
                    (file.language === 'typescript' || file.language === 'javascript') &&
                    /fetch\(|axios\.(get|post|put|delete|patch)\(|apiClient\.(get|post|put|delete|patch)\(/.test(
                        file.content
                    )
            )
        );
    },
    extract(context) {
        const nodes: RuntimeNode[] = [];
        const edges: RuntimeEdge[] = [];
        const diagnostics: RuntimeDiagnostic[] = [];
        const knownRoutes = collectKnownRoutes(context.files);

        for (const file of context.files) {
            if (file.language !== 'typescript' && file.language !== 'javascript') {
                continue;
            }

            if (!context.includeFrontend && !looksFrontendPath(file.relativePath)) {
                continue;
            }

            const calls = collectFrontendCalls(file);
            if (calls.length === 0) {
                continue;
            }

            const frontendId = normalizeRuntimeId(`FrontendEntry.${file.relativePath}`);
            nodes.push({
                id: frontendId,
                type: 'FrontendEntry',
                label: `${labelFromPath(file.relativePath)} ${looksFrontendPath(file.relativePath) ? 'page' : 'entry'}`,
                sourcePath: file.relativePath,
                category: 'frontend',
                evidence: calls.map((call) => lineEvidence(file, 'call', call.text, call.index, 0.75))
            });

            for (const call of calls) {
                const targetId = matchRoute(call.method, call.path, knownRoutes) ?? apiRouteId('UNKNOWN', call.path);
                if (!knownRoutes.has(targetId)) {
                    nodes.push({
                        id: targetId,
                        type: 'ApiRoute',
                        label: `UNKNOWN ${normalizeApiPath(call.path)}`,
                        category: 'backend',
                        metadata: {
                            method: call.method,
                            path: normalizeApiPath(call.path),
                            unresolved: true
                        },
                        evidence: [lineEvidence(file, 'inferred', call.text, call.index, 0.45)]
                    });
                    diagnostics.push({
                        level: 'warning',
                        extractor: 'FrontendApiCallExtractor',
                        message: `Could not match frontend API call ${call.path} to a known ApiRoute`,
                        sourcePath: file.relativePath
                    });
                }

                edges.push({
                    from: frontendId,
                    to: targetId,
                    type: 'calls',
                    confidence: knownRoutes.has(targetId) ? 0.72 : 0.45,
                    metadata: {
                        method: call.method,
                        path: call.path
                    },
                    evidence: [lineEvidence(file, 'call', call.text, call.index, knownRoutes.has(targetId) ? 0.72 : 0.45)]
                });
            }
        }

        return { nodes, edges, diagnostics };
    }
};

function collectFrontendCalls(file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number]) {
    const calls: Array<{ method: string; path: string; text: string; index: number }> = [];

    const fetchRegex = /fetch\(\s*["'`]([^"'`]+)["'`]([\s\S]*?)\)/g;
    for (const match of file.content.matchAll(fetchRegex)) {
        const options = match[2] ?? '';
        const methodMatch = options.match(/method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/i);
        calls.push({
            method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
            path: normalizeApiPath(match[1]),
            text: match[0],
            index: match.index ?? 0
        });
    }

    const clientRegex = /\b(?:axios|apiClient)\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/gi;
    for (const match of file.content.matchAll(clientRegex)) {
        calls.push({
            method: match[1].toUpperCase(),
            path: normalizeApiPath(match[2]),
            text: match[0],
            index: match.index ?? 0
        });
    }

    return calls.filter((call) => call.path.startsWith('/'));
}

function collectKnownRoutes(files: Parameters<RuntimeTopologyExtractor['extract']>[0]['files']) {
    const routes = new Set<string>();
    for (const file of files) {
        const pythonRegex =
            /@(?:(?:\w+\.)?(get|post|put|delete|patch|options|head)|(?:app|router|blueprint)\.route)\(\s*["']([^"']+)["']([^)]*)\)/gi;
        for (const match of file.content.matchAll(pythonRegex)) {
            const methods =
                match[1] !== undefined
                    ? [match[1].toUpperCase()]
                    : Array.from((match[3] ?? '').matchAll(/["'](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)["']/gi)).map(
                          (methodMatch) => methodMatch[1].toUpperCase()
                      );
            for (const method of methods.length > 0 ? methods : ['GET']) {
                routes.add(apiRouteId(method, match[2]));
            }
        }

        const jsRegex =
            /\b(?:app|router)\.(get|post|put|delete|patch|options|head)\(\s*["'`]([^"'`]+)["'`]|@(Get|Post|Put|Delete|Patch)\(\s*["'`]([^"'`]*)["'`]\s*\)/gi;
        for (const match of file.content.matchAll(jsRegex)) {
            const method = (match[1] ?? match[3] ?? 'GET').toUpperCase();
            const routePath = match[2] ?? match[4] ?? '/';
            routes.add(apiRouteId(method, routePath));
        }
    }
    return routes;
}

function matchRoute(method: string, callPath: string, knownRoutes: Set<string>) {
    const exact = apiRouteId(method, callPath);
    if (knownRoutes.has(exact)) {
        return exact;
    }

    const normalizedCall = normalizeApiPath(callPath);
    for (const candidate of knownRoutes) {
        const [, candidateMethod, ...pathParts] = candidate.split('.');
        if (candidateMethod !== method) {
            continue;
        }
        const routePath = pathParts.join('.');
        const routePattern = `^${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+')}$`;
        if (new RegExp(routePattern).test(normalizedCall)) {
            return candidate;
        }
    }

    return undefined;
}

function looksFrontendPath(relativePath: string) {
    return /(^|\/)(frontend|client|web|pages|components|app)(\/|$)/i.test(relativePath);
}
