import { RuntimeEdge, RuntimeNode, RuntimeTopologyExtractor } from '../types';
import { apiRouteId, inferServiceId, lineEvidence, normalizeApiPath } from '../runtimeUtils';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);

export const httpRouteExtractor: RuntimeTopologyExtractor = {
    name: 'HttpRouteExtractor',
    detect(context) {
        const hint = context.frameworkHint?.toLowerCase();
        return (
            hint === 'fastapi' ||
            hint === 'flask' ||
            hint === 'express' ||
            hint === 'nestjs' ||
            context.files.some((file) =>
                /@(?:app|router|blueprint)\.(?:get|post|put|delete|patch|options|head|route)\(|\b(?:app|router)\.(?:get|post|put|delete|patch|options|head)\(|@(Get|Post|Put|Delete|Patch)\(/.test(
                    file.content
                )
            )
        );
    },
    extract(context) {
        const nodes: RuntimeNode[] = [];
        const edges: RuntimeEdge[] = [];

        for (const file of context.files) {
            if (file.language === 'python') {
                extractPythonRoutes(file, context.frameworkHint, nodes, edges);
            }

            if (file.language === 'typescript' || file.language === 'javascript') {
                extractExpressRoutes(file, nodes, edges);
                extractNestRoutes(file, nodes, edges);
            }
        }

        return { nodes, edges };
    }
};

function extractPythonRoutes(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    frameworkHint: string | undefined,
    nodes: RuntimeNode[],
    edges: RuntimeEdge[]
) {
    const routeRegex =
        /@(?:(?:\w+\.)?(get|post|put|delete|patch|options|head)|(?:app|router|blueprint)\.route)\(\s*["']([^"']+)["']([^)]*)\)\s*(?:\r?\n\s*)+(?:async\s+def|def)\s+([A-Za-z_][\w]*)\s*\(/gi;

    for (const match of file.content.matchAll(routeRegex)) {
        const decoratorText = match[0];
        const methodsText = match[3] ?? '';
        const methods = resolvePythonMethods(match[1], methodsText);
        const routePath = normalizeApiPath(match[2]);
        const handler = match[4];
        const framework = frameworkHint ?? inferPythonFramework(file.content);
        const body = readPythonFunctionBody(file.content, match.index ?? 0);

        for (const method of methods) {
            const routeId = apiRouteId(method, routePath);
            nodes.push({
                id: routeId,
                type: 'ApiRoute',
                label: `${method.toUpperCase()} ${routePath}`,
                sourcePath: file.relativePath,
                category: 'backend',
                framework,
                metadata: {
                    method: method.toUpperCase(),
                    path: routePath,
                    handler
                },
                evidence: [lineEvidence(file, 'decorator', decoratorText, match.index, 0.95)]
            });

            for (const call of findServiceCalls(body)) {
                const serviceId = inferServiceId(call.text);
                nodes.push({
                    id: serviceId,
                    type: 'Service',
                    label: serviceId.replace(/^Service\./, ''),
                    sourcePath: file.relativePath,
                    category: 'backend',
                    metadata: {
                        call: call.text
                    },
                    evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.65)]
                });
                edges.push({
                    from: routeId,
                    to: serviceId,
                    type: 'invokes',
                    confidence: 0.65,
                    evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.65)]
                });
            }
        }
    }
}

function extractExpressRoutes(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    nodes: RuntimeNode[],
    edges: RuntimeEdge[]
) {
    const routeRegex = /\b(?:app|router)\.(get|post|put|delete|patch|options|head)\(\s*["'`]([^"'`]+)["'`]([\s\S]*?)(?:\n\s*\}\s*\)|\)\s*;)/gi;
    for (const match of file.content.matchAll(routeRegex)) {
        const method = match[1].toUpperCase();
        const routePath = normalizeApiPath(match[2]);
        const routeId = apiRouteId(method, routePath);
        const handler = match[3] ?? '';
        nodes.push({
            id: routeId,
            type: 'ApiRoute',
            label: `${method} ${routePath}`,
            sourcePath: file.relativePath,
            category: 'backend',
            framework: 'express',
            metadata: {
                method,
                path: routePath
            },
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.9)]
        });

        for (const call of findServiceCalls(handler)) {
            const serviceId = inferServiceId(call.text);
            nodes.push({
                id: serviceId,
                type: 'Service',
                label: serviceId.replace(/^Service\./, ''),
                sourcePath: file.relativePath,
                category: 'backend',
                evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.6)]
            });
            edges.push({
                from: routeId,
                to: serviceId,
                type: 'invokes',
                confidence: 0.6,
                evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.6)]
            });
        }
    }
}

function extractNestRoutes(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    nodes: RuntimeNode[],
    edges: RuntimeEdge[]
) {
    const controllerMatch = file.content.match(/@Controller\(\s*["'`]([^"'`]*)["'`]\s*\)/);
    const prefix = controllerMatch ? normalizeApiPath(controllerMatch[1]) : '';
    const routeRegex = /@(Get|Post|Put|Delete|Patch)\(\s*["'`]([^"'`]*)["'`]\s*\)\s*(?:\r?\n\s*)+(?:async\s+)?([A-Za-z_][\w]*)\s*\(/g;
    for (const match of file.content.matchAll(routeRegex)) {
        const method = match[1].toUpperCase();
        const routePath = normalizeApiPath(`${prefix}/${match[2]}`.replace(/\/+/g, '/'));
        const routeId = apiRouteId(method, routePath);
        const body = readJsFunctionBody(file.content, match.index ?? 0);
        nodes.push({
            id: routeId,
            type: 'ApiRoute',
            label: `${method} ${routePath}`,
            sourcePath: file.relativePath,
            category: 'backend',
            framework: 'nestjs',
            metadata: {
                method,
                path: routePath,
                handler: match[3]
            },
            evidence: [lineEvidence(file, 'decorator', match[0], match.index, 0.9)]
        });

        for (const call of findServiceCalls(body)) {
            const serviceId = inferServiceId(call.text);
            nodes.push({
                id: serviceId,
                type: 'Service',
                label: serviceId.replace(/^Service\./, ''),
                sourcePath: file.relativePath,
                category: 'backend',
                evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.6)]
            });
            edges.push({
                from: routeId,
                to: serviceId,
                type: 'invokes',
                confidence: 0.6,
                evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.6)]
            });
        }
    }
}

function resolvePythonMethods(decoratorMethod: string | undefined, methodsText: string) {
    if (decoratorMethod && HTTP_METHODS.has(decoratorMethod.toLowerCase())) {
        return [decoratorMethod.toUpperCase()];
    }

    const explicit = Array.from(methodsText.matchAll(/["'](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)["']/gi)).map((match) =>
        match[1].toUpperCase()
    );
    return explicit.length > 0 ? explicit : ['GET'];
}

function inferPythonFramework(content: string) {
    if (/from\s+fastapi\s+import|import\s+fastapi/.test(content)) {
        return 'fastapi';
    }
    if (/from\s+flask\s+import|import\s+flask/.test(content)) {
        return 'flask';
    }
    return 'python-http';
}

function readPythonFunctionBody(content: string, startIndex: number) {
    const signatureEnd = content.indexOf(':\n', startIndex);
    const bodyStart = signatureEnd >= 0 ? signatureEnd + 2 : startIndex;
    const nextMatch = content.slice(bodyStart).match(/\n\s*(?:@|async\s+def\s+|def\s+)/);
    const end = nextMatch?.index === undefined ? content.length : bodyStart + nextMatch.index;
    return content.slice(bodyStart, end);
}

function readJsFunctionBody(content: string, startIndex: number) {
    const nextMatch = content.slice(startIndex + 1).match(/\n\s*@(?:Get|Post|Put|Delete|Patch|Controller)\(/);
    const end = nextMatch?.index === undefined ? content.length : startIndex + 1 + nextMatch.index;
    return content.slice(startIndex, end);
}

function findServiceCalls(body: string) {
    const calls: Array<{ text: string; index: number }> = [];
    const callRegex =
        /\b(?:this\.)?([A-Za-z_][\w]*(?:Service|service|_service)|service|workflow_service|task_service|worker_service)\.([A-Za-z_][\w]*)\s*\(/g;
    for (const match of body.matchAll(callRegex)) {
        calls.push({
            text: match[0],
            index: match.index ?? 0
        });
    }
    return calls;
}
