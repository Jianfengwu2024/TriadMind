import { RuntimeNode } from './types';

export interface NormalizedRuntimeLabel {
    label: string;
    hint?: string;
    lowSignal: boolean;
    source: 'metadata' | 'node_label' | 'node_id';
}

const LOW_SIGNAL_TOKENS = new Set([
    'classlist',
    'dimmed',
    'dragging',
    'hover',
    'click',
    'focus',
    'node',
    'edge',
    'item',
    'list',
    'value',
    'state',
    'event',
    'data',
    'default',
    'style',
    'dom',
    'ui',
    'test',
    'tmp'
]);

const BUSINESS_TOKENS = new Set([
    'api',
    'route',
    'handler',
    'service',
    'workflow',
    'worker',
    'task',
    'queue',
    'scheduler',
    'cache',
    'redis',
    'postgres',
    'mongo',
    'db',
    'model',
    'provider',
    'tool',
    'storage',
    'pipeline',
    'executor',
    'command',
    'endpoint'
]);

const METADATA_PRIORITY_KEYS = [
    'displayName',
    'name',
    'handler',
    'service',
    'workflow',
    'task',
    'worker',
    'operation',
    'path',
    'route'
];

export function normalizeRuntimeNodeLabel(node: RuntimeNode): NormalizedRuntimeLabel {
    const candidates: Array<{ value: string; source: NormalizedRuntimeLabel['source'] }> = [];

    const apiRouteLabel = buildApiRouteLabel(node);
    if (apiRouteLabel) {
        candidates.push({ value: apiRouteLabel, source: 'metadata' });
    }

    for (const key of METADATA_PRIORITY_KEYS) {
        const value = node.metadata?.[key];
        if (typeof value === 'string' && value.trim()) {
            candidates.push({ value: value.trim(), source: 'metadata' });
        }
    }

    if (node.label?.trim()) {
        candidates.push({ value: node.label.trim(), source: 'node_label' });
    }

    candidates.push({ value: humanizeRuntimeId(node.id), source: 'node_id' });

    const uniqueCandidates = dedupeCandidates(candidates);
    const scored = uniqueCandidates
        .map((candidate) => ({
            ...candidate,
            ...scoreLabelCandidate(candidate.value)
        }))
        .sort((left, right) => right.score - left.score);

    const best = scored[0];
    if (!best) {
        return {
            label: node.id,
            hint: node.type,
            lowSignal: false,
            source: 'node_id'
        };
    }

    return {
        label: best.value,
        hint: best.source === 'node_id' ? node.type : undefined,
        lowSignal: best.lowSignal,
        source: best.source
    };
}

export function isLowSignalRuntimeLabel(label: string) {
    return scoreLabelCandidate(label).lowSignal;
}

function buildApiRouteLabel(node: RuntimeNode) {
    if (node.type !== 'ApiRoute') {
        return '';
    }

    const method = typeof node.metadata?.method === 'string' ? node.metadata.method.trim().toUpperCase() : '';
    const path = typeof node.metadata?.path === 'string' ? node.metadata.path.trim() : '';
    const label = [method, path].filter(Boolean).join(' ');
    return label || '';
}

function scoreLabelCandidate(label: string) {
    const normalized = label.trim();
    const tokens = normalizeTokens(normalized);
    const distinctTokenCount = new Set(tokens).size;
    const lowSignalTokenCount = tokens.filter((token) => LOW_SIGNAL_TOKENS.has(token)).length;
    const businessTokenCount = tokens.filter((token) => BUSINESS_TOKENS.has(token)).length;
    const hasRouteShape = normalized.includes('/') || /\b(get|post|put|delete|patch)\b/i.test(normalized);
    const hasFunctionShape = /[.:_]/.test(normalized);
    const tokenQuality = Math.max(1, distinctTokenCount) - lowSignalTokenCount * 1.1 + businessTokenCount * 1.8;
    const score = tokenQuality + (hasRouteShape ? 2.4 : 0) + (hasFunctionShape ? 0.4 : 0);
    const lowSignal = businessTokenCount === 0 && lowSignalTokenCount >= Math.max(1, distinctTokenCount - 1);

    return { score, lowSignal };
}

function normalizeTokens(value: string) {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((segment) => splitCamelCase(segment))
        .flat()
        .map((token) => token.toLowerCase());
}

function splitCamelCase(value: string) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean);
}

function humanizeRuntimeId(id: string) {
    if (!id) {
        return 'unknown-runtime-node';
    }

    const parts = id.split('.');
    if (parts[0] === 'ApiRoute' && parts.length >= 3) {
        return `${parts[1]} ${parts.slice(2).join('.')}`;
    }

    const tail = parts[parts.length - 1] ?? id;
    return tail
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
}

function dedupeCandidates(candidates: Array<{ value: string; source: NormalizedRuntimeLabel['source'] }>) {
    const seen = new Set<string>();
    const output: Array<{ value: string; source: NormalizedRuntimeLabel['source'] }> = [];
    for (const candidate of candidates) {
        const key = candidate.value.trim().toLowerCase();
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        output.push(candidate);
    }
    return output;
}
