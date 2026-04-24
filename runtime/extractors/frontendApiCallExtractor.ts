import { RuntimeDiagnostic, RuntimeEdge, RuntimeNode, RuntimeTopologyExtractor } from '../types';
import {
    apiRouteId,
    buildApiPathVariants,
    labelFromPath,
    lineEvidence,
    normalizeApiComparablePath,
    normalizeApiPath,
    normalizeRuntimeId
} from '../runtimeUtils';

type KnownRoute = {
    id: string;
    method: string;
    path: string;
    variants: string[];
};

type FrontendApiCall = {
    method: string;
    rawPath: string;
    path: string;
    text: string;
    index: number;
};

type ResolvedApiPath = {
    rawPath: string;
    normalizedPath: string;
};

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
                const targetRoute = matchRoute(call.method, call.path, knownRoutes);
                const targetId = targetRoute?.id ?? apiRouteId('UNKNOWN', call.path);

                if (!targetRoute) {
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
                        code: 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED',
                        extractor: 'FrontendApiCallExtractor',
                        message: `Could not match frontend API call raw=${call.rawPath} normalized=${call.path} to a known ApiRoute`,
                        sourcePath: file.relativePath
                    });
                }

                edges.push({
                    from: frontendId,
                    to: targetId,
                    type: 'calls',
                    confidence: targetRoute ? 0.78 : 0.45,
                    metadata: {
                        method: call.method,
                        path: call.path,
                        rawPath: call.rawPath
                    },
                    evidence: [lineEvidence(file, 'call', call.text, call.index, targetRoute ? 0.78 : 0.45)]
                });
            }
        }

        return { nodes, edges, diagnostics };
    }
};

function collectFrontendCalls(file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number]) {
    const calls: FrontendApiCall[] = [];

    const fetchRegex =
        /fetch\(\s*([`"'][\s\S]*?[`"']|[^,\n)]+(?:\s*\+\s*[^,\n)]+)*)\s*(?:,\s*([\s\S]*?))?\)/g;
    for (const match of file.content.matchAll(fetchRegex)) {
        const options = match[2] ?? '';
        const methodMatch = options.match(/method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/i);
        const parsedPath = resolveApiPathExpression(match[1]);
        if (!parsedPath) {
            continue;
        }
        calls.push({
            method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
            rawPath: parsedPath.rawPath,
            path: parsedPath.normalizedPath,
            text: match[0],
            index: match.index ?? 0
        });
    }

    const clientRegex =
        /\b(?:axios|apiClient)\.(get|post|put|delete|patch)\(\s*([`"'][\s\S]*?[`"']|[^,\n)]+(?:\s*\+\s*[^,\n)]+)*)/gi;
    for (const match of file.content.matchAll(clientRegex)) {
        const parsedPath = resolveApiPathExpression(match[2]);
        if (!parsedPath) {
            continue;
        }
        calls.push({
            method: match[1].toUpperCase(),
            rawPath: parsedPath.rawPath,
            path: parsedPath.normalizedPath,
            text: match[0],
            index: match.index ?? 0
        });
    }

    const objectClientRegex = /\b(?:axios|apiClient)\(\s*\{([\s\S]*?)\}\s*\)/gi;
    for (const match of file.content.matchAll(objectClientRegex)) {
        const body = match[1] ?? '';
        const methodMatch = body.match(/\bmethod\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/i);
        const urlMatch = body.match(/\b(?:url|path)\s*:\s*([`"'][\s\S]*?[`"']|[^,\n}]+)/i);
        if (!urlMatch) {
            continue;
        }
        const parsedPath = resolveApiPathExpression(urlMatch[1]);
        if (!parsedPath) {
            continue;
        }
        calls.push({
            method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
            rawPath: parsedPath.rawPath,
            path: parsedPath.normalizedPath,
            text: match[0],
            index: match.index ?? 0
        });
    }

    return calls.filter((call) => call.path.startsWith('/'));
}

function resolveApiPathExpression(expression: string) {
    const trimmed = String(expression ?? '').trim();
    if (!trimmed) {
        return undefined;
    }

    const literal = readLiteralPath(trimmed);
    if (literal) {
        return {
            rawPath: literal,
            normalizedPath: normalizeFrontendApiCallPath(literal)
        } as ResolvedApiPath;
    }

    if (!trimmed.includes('+')) {
        return undefined;
    }

    const tokens = trimmed.split('+').map((token) => token.trim()).filter(Boolean);
    const parts: string[] = [];
    let sawPathLiteral = false;

    for (const token of tokens) {
        const tokenLiteral = readLiteralPath(token);
        if (tokenLiteral) {
            parts.push(tokenLiteral);
            if (tokenLiteral.includes('/')) {
                sawPathLiteral = true;
            }
            continue;
        }

        if (/(?:baseUrl|apiBase|origin|host|endpoint|serverUrl|apiUrl)/i.test(token)) {
            continue;
        }

        parts.push('/:param');
    }

    if (!sawPathLiteral && parts.length === 0) {
        return undefined;
    }

    const rawPath = parts.join('');
    return {
        rawPath,
        normalizedPath: normalizeFrontendApiCallPath(rawPath)
    } as ResolvedApiPath;
}

function readLiteralPath(value: string) {
    const quoted = value.match(/^["']([\s\S]*)["']$/);
    if (quoted) {
        return quoted[1];
    }
    const template = value.match(/^`([\s\S]*)`$/);
    if (!template) {
        return undefined;
    }
    return template[1];
}

function normalizeFrontendApiCallPath(value: string) {
    const normalizedRaw = String(value ?? '').replace(/\$\{[^}]+\}/g, ':param');
    let normalized = normalizeApiPath(normalizedRaw);
    const apiAnchorIndex = normalized.search(/\/api(?:\/v\d+)?(?:\/|$)/i);
    if (apiAnchorIndex > 0) {
        normalized = normalized.slice(apiAnchorIndex);
    }
    return normalizeApiPath(normalized);
}

function collectKnownRoutes(files: Parameters<RuntimeTopologyExtractor['extract']>[0]['files']) {
    const routes = new Map<string, KnownRoute>();

    for (const file of files) {
        collectPythonRoutes(file, routes);
        collectJavaScriptRoutes(file, routes);
    }

    return Array.from(routes.values());
}

function collectPythonRoutes(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    routes: Map<string, KnownRoute>
) {
    const routerPrefixes = new Map<string, string>();
    for (const match of file.content.matchAll(/\b([A-Za-z_][\w]*)\s*=\s*APIRouter\(([^)]*)\)/g)) {
        const name = match[1];
        const args = match[2] ?? '';
        const prefixMatch = args.match(/prefix\s*=\s*["'`]([^"'`]+)["'`]/);
        if (prefixMatch?.[1]) {
            routerPrefixes.set(name, normalizeApiPath(prefixMatch[1]));
        }
    }

    const methodDecoratorRegex = /@([A-Za-z_][\w]*)\.(get|post|put|delete|patch|options|head)\(\s*["'`]([^"'`]+)["'`]/gi;
    for (const match of file.content.matchAll(methodDecoratorRegex)) {
        const method = match[2].toUpperCase();
        const routerName = match[1];
        const prefix = routerPrefixes.get(routerName) ?? '';
        registerRoute(routes, method, combineRoutePath(prefix, match[3]));
    }

    const genericRouteRegex = /@([A-Za-z_][\w]*)\.route\(\s*["'`]([^"'`]+)["'`]([^)]*)\)/gi;
    for (const match of file.content.matchAll(genericRouteRegex)) {
        const routerName = match[1];
        const prefix = routerPrefixes.get(routerName) ?? '';
        const methods = Array.from((match[3] ?? '').matchAll(/["'`](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)["'`]/gi)).map(
            (entry) => entry[1].toUpperCase()
        );
        for (const method of methods.length > 0 ? methods : ['GET']) {
            registerRoute(routes, method, combineRoutePath(prefix, match[2]));
        }
    }
}

function collectJavaScriptRoutes(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    routes: Map<string, KnownRoute>
) {
    const jsRegex =
        /\b(?:app|router)\.(get|post|put|delete|patch|options|head)\(\s*["'`]([^"'`]+)["'`]|@(Get|Post|Put|Delete|Patch)\(\s*["'`]([^"'`]*)["'`]\s*\)/gi;
    for (const match of file.content.matchAll(jsRegex)) {
        const method = (match[1] ?? match[3] ?? 'GET').toUpperCase();
        const routePath = match[2] ?? match[4] ?? '/';
        registerRoute(routes, method, routePath);
    }
}

function registerRoute(routes: Map<string, KnownRoute>, method: string, pathValue: string) {
    const normalizedPath = normalizeApiPath(pathValue);
    const id = apiRouteId(method, normalizedPath);
    routes.set(id, {
        id,
        method,
        path: normalizedPath,
        variants: buildApiPathVariants(normalizedPath)
    });
}

function combineRoutePath(prefix: string, routePath: string) {
    if (!prefix) {
        return normalizeApiPath(routePath);
    }
    return normalizeApiPath(`${prefix}/${routePath}`);
}

function matchRoute(method: string, callPath: string, knownRoutes: KnownRoute[]) {
    const callVariants = buildFrontendCallPathVariants(callPath);
    const candidates = knownRoutes.filter((route) => route.method === method.toUpperCase());

    for (const candidate of candidates) {
        if (hasExactVariantMatch(callVariants, candidate.variants)) {
            return candidate;
        }
    }

    for (const candidate of candidates) {
        if (hasDynamicVariantMatch(callVariants, candidate.variants)) {
            return candidate;
        }
    }

    return undefined;
}

function buildFrontendCallPathVariants(pathValue: string) {
    const variants = new Set<string>(buildApiPathVariants(pathValue));

    for (const variant of Array.from(variants)) {
        const dynamicTrimmed = trimDynamicPrefix(variant);
        if (dynamicTrimmed) {
            buildApiPathVariants(dynamicTrimmed).forEach((item) => variants.add(item));
        }

        const apiAnchorIndex = variant.search(/\/api(?:\/v\d+)?(?:\/|$)/i);
        if (apiAnchorIndex > 0) {
            buildApiPathVariants(variant.slice(apiAnchorIndex)).forEach((item) => variants.add(item));
        }
    }

    return Array.from(variants);
}

function trimDynamicPrefix(pathValue: string) {
    const segments = normalizeApiPath(pathValue).split('/').filter(Boolean);
    if (segments.length < 3) {
        return undefined;
    }

    let index = 0;
    while (index < segments.length - 1 && isDynamicSegment(segments[index])) {
        index += 1;
    }

    if (index === 0 || index >= segments.length - 1) {
        return undefined;
    }

    return normalizeApiPath(`/${segments.slice(index).join('/')}`);
}

function hasExactVariantMatch(callVariants: string[], routeVariants: string[]) {
    const routeSet = new Set(routeVariants);
    return callVariants.some((variant) => routeSet.has(variant));
}

function hasDynamicVariantMatch(callVariants: string[], routeVariants: string[]) {
    for (const callVariant of callVariants) {
        for (const routeVariant of routeVariants) {
            if (matchComparablePath(callVariant, routeVariant)) {
                return true;
            }
        }
    }
    return false;
}

function matchComparablePath(leftPath: string, rightPath: string) {
    const leftParts = normalizeApiComparablePath(leftPath).split('/').filter(Boolean);
    const rightParts = normalizeApiComparablePath(rightPath).split('/').filter(Boolean);

    if (leftParts.length !== rightParts.length) {
        return false;
    }

    for (let index = 0; index < leftParts.length; index += 1) {
        const left = leftParts[index];
        const right = rightParts[index];
        if (left === right) {
            continue;
        }
        if (isDynamicSegment(left) || isDynamicSegment(right)) {
            continue;
        }
        return false;
    }

    return true;
}

function isDynamicSegment(segment: string) {
    return (
        segment === ':param' ||
        /^\{[^/}]+\}$/.test(segment) ||
        /^\[[^/\]]+\]$/.test(segment) ||
        /^:[A-Za-z_][\w-]*$/.test(segment)
    );
}

function looksFrontendPath(relativePath: string) {
    return /(^|\/)(frontend|client|web|pages|components|app)(\/|$)/i.test(relativePath);
}
