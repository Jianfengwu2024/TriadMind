import { RuntimeEdge, RuntimeEvidence, RuntimeNode, RuntimeSourceFile } from './types';

export function normalizeRuntimeId(value: string) {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/\s+/g, '_')
        .replace(/[^\w./:{}-]+/g, '_')
        .replace(/_+/g, '_');
}

export function findLineColumn(content: string, index: number) {
    const before = content.slice(0, Math.max(0, index));
    const lines = before.split(/\r?\n/);
    return {
        line: lines.length,
        column: (lines[lines.length - 1]?.length ?? 0) + 1
    };
}

export function lineEvidence(
    file: RuntimeSourceFile,
    kind: RuntimeEvidence['kind'],
    text: string,
    index = 0,
    confidence = 0.7
): RuntimeEvidence {
    return {
        sourcePath: file.relativePath,
        ...findLineColumn(file.content, index),
        kind,
        text: text.trim().slice(0, 240),
        confidence
    };
}

export function inferredEvidence(sourcePath?: string, confidence = 0.5, text = 'Inferred from runtime extraction pattern') {
    return {
        sourcePath,
        kind: 'inferred' as const,
        text,
        confidence
    };
}

export function ensureNodeEvidence(node: RuntimeNode): RuntimeNode {
    return {
        ...node,
        evidence: node.evidence?.length ? node.evidence : [inferredEvidence(node.sourcePath)]
    };
}

export function ensureEdgeEvidence(edge: RuntimeEdge): RuntimeEdge {
    return {
        ...edge,
        evidence: edge.evidence?.length ? edge.evidence : [inferredEvidence(undefined, edge.confidence ?? 0.5)]
    };
}

export function dedupeEvidence(evidence: RuntimeEvidence[]) {
    const seen = new Set<string>();
    return evidence.filter((item) => {
        const key = [
            item.kind,
            item.sourcePath ?? '',
            item.line ?? '',
            item.column ?? '',
            item.text ?? ''
        ].join('::');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function mergeRuntimeNodes(nodes: RuntimeNode[]) {
    const byId = new Map<string, RuntimeNode>();
    for (const rawNode of nodes) {
        const node = ensureNodeEvidence(rawNode);
        const existing = byId.get(node.id);
        if (!existing) {
            byId.set(node.id, node);
            continue;
        }

        byId.set(node.id, {
            ...existing,
            ...node,
            metadata: {
                ...(existing.metadata ?? {}),
                ...(node.metadata ?? {})
            },
            evidence: dedupeEvidence([...(existing.evidence ?? []), ...(node.evidence ?? [])])
        });
    }
    return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function mergeRuntimeEdges(edges: RuntimeEdge[]) {
    const byKey = new Map<string, RuntimeEdge>();
    for (const rawEdge of edges) {
        const edge = ensureEdgeEvidence(rawEdge);
        const key = `${edge.from}::${edge.type}::${edge.to}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, edge);
            continue;
        }

        byKey.set(key, {
            ...existing,
            ...edge,
            metadata: {
                ...(existing.metadata ?? {}),
                ...(edge.metadata ?? {})
            },
            confidence: Math.max(existing.confidence ?? 0, edge.confidence ?? 0),
            evidence: dedupeEvidence([...(existing.evidence ?? []), ...(edge.evidence ?? [])])
        });
    }

    return Array.from(byKey.values())
        .map((edge) => ({
            ...edge,
            id: edge.id ?? normalizeRuntimeId(`RuntimeEdge.${edge.from}.${edge.type}.${edge.to}`)
        }))
        .sort((left, right) => (left.id ?? '').localeCompare(right.id ?? ''));
}

export function inferServiceId(callExpression: string) {
    const normalized = callExpression.trim();
    const methodCall = normalized.match(/(?:self\.)?([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*\(/);
    if (methodCall) {
        return normalizeRuntimeId(`Service.${toPascalServiceName(methodCall[1])}.${methodCall[2]}`);
    }

    const directCall = normalized.match(/\b([A-Za-z_][\w]*)\s*\(/);
    if (directCall) {
        return normalizeRuntimeId(`Service.${directCall[1]}`);
    }

    return normalizeRuntimeId(`Service.${normalized}`);
}

export function toPascalServiceName(value: string) {
    const cleaned = value.replace(/_service$/i, '').replace(/service$/i, '');
    return `${toPascalCase(cleaned)}Service`;
}

export function toPascalCase(value: string) {
    return value
        .split(/[^A-Za-z0-9]+|_/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

export function labelFromPath(relativePath: string) {
    const basename = relativePath.split(/[\\/]/).pop() ?? relativePath;
    return basename.replace(/\.(tsx?|jsx?|py|json|ya?ml|toml)$/i, '').replace(/[-_]/g, ' ');
}

export function normalizeApiPath(pathValue: string) {
    let value = String(pathValue ?? '').trim();
    if (!value) {
        return '/';
    }

    value = value.replace(/\$\{[^}]+\}/g, ':param');

    if (/^https?:\/\//i.test(value)) {
        try {
            const parsed = new URL(value);
            value = parsed.pathname;
        } catch {
            // keep raw value when URL parsing fails
        }
    }

    value = value.split(/[?#]/)[0] ?? value;

    if (!value.startsWith('/')) {
        value = `/${value}`;
    }
    value = value.replace(/\/+/g, '/');
    if (value.length > 1 && value.endsWith('/')) {
        value = value.slice(0, -1);
    }
    return value;
}

export function normalizeApiComparablePath(pathValue: string) {
    return normalizeApiPath(pathValue).replace(/\{[^/}]+\}|\[[^/\]]+\]|:[A-Za-z_][\w-]*/g, ':param');
}

export function buildApiPathVariants(pathValue: string) {
    const normalized = normalizeApiPath(pathValue);
    const variants = new Set<string>([normalized, normalizeApiComparablePath(normalized)]);

    const withoutApiPrefix = normalized.replace(/^\/api(?:\/v\d+)?(?=\/|$)/i, '');
    if (withoutApiPrefix && withoutApiPrefix !== normalized) {
        const candidate = normalizeApiPath(withoutApiPrefix);
        variants.add(candidate);
        variants.add(normalizeApiComparablePath(candidate));
    }

    const withoutVersionPrefix = normalized.replace(/^\/v\d+(?=\/|$)/i, '');
    if (withoutVersionPrefix && withoutVersionPrefix !== normalized) {
        const candidate = normalizeApiPath(withoutVersionPrefix);
        variants.add(candidate);
        variants.add(normalizeApiComparablePath(candidate));
    }

    return Array.from(variants);
}

export function apiRouteId(method: string, routePath: string) {
    return normalizeRuntimeId(`ApiRoute.${method.toUpperCase()}.${normalizeApiPath(routePath)}`);
}
