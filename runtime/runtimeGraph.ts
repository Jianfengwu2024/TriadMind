import { RuntimeEdge, RuntimeMap, RuntimeNode, RuntimeNodeType } from './types';
import { normalizeRuntimeId } from './runtimeUtils';

export type RuntimeTraceDirection = 'upstream' | 'downstream' | 'both';

export interface NormalizedRuntimeEdge extends RuntimeEdge {
    id: string;
}

export interface RuntimeGraphIndex {
    nodes: RuntimeNode[];
    edges: NormalizedRuntimeEdge[];
    nodeById: Map<string, RuntimeNode>;
    edgeById: Map<string, NormalizedRuntimeEdge>;
    incoming: Map<string, NormalizedRuntimeEdge[]>;
    outgoing: Map<string, NormalizedRuntimeEdge[]>;
}

export interface RuntimeTraceResult {
    nodeIds: Set<string>;
    edgeIds: Set<string>;
}

export interface RuntimeGraphFilters {
    query?: string;
    nodeTypes?: Set<RuntimeNodeType> | RuntimeNodeType[];
    edgeTypes?: Set<string> | string[];
    hideIsolated?: boolean;
    includeNodeIds?: Set<string> | string[];
}

export function buildRuntimeGraphIndex(runtimeMap: RuntimeMap): RuntimeGraphIndex {
    const nodeById = new Map<string, RuntimeNode>();
    const edgeById = new Map<string, NormalizedRuntimeEdge>();
    const incoming = new Map<string, NormalizedRuntimeEdge[]>();
    const outgoing = new Map<string, NormalizedRuntimeEdge[]>();

    for (const node of runtimeMap.nodes) {
        nodeById.set(node.id, node);
        incoming.set(node.id, []);
        outgoing.set(node.id, []);
    }

    const edges = runtimeMap.edges
        .filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to))
        .map((edge) => ({
            ...edge,
            id: edge.id ?? normalizeRuntimeId(`RuntimeEdge.${edge.from}.${edge.type}.${edge.to}`)
        }));

    for (const edge of edges) {
        edgeById.set(edge.id, edge);
        outgoing.get(edge.from)?.push(edge);
        incoming.get(edge.to)?.push(edge);
    }

    return {
        nodes: runtimeMap.nodes,
        edges,
        nodeById,
        edgeById,
        incoming,
        outgoing
    };
}

export function traceRuntimeGraph(
    index: RuntimeGraphIndex,
    startNodeId: string,
    direction: RuntimeTraceDirection,
    depth: number
): RuntimeTraceResult {
    const maxDepth = Math.max(0, Math.floor(depth));
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    if (!index.nodeById.has(startNodeId)) {
        return { nodeIds, edgeIds };
    }

    nodeIds.add(startNodeId);
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];
    const visited = new Set<string>([`${startNodeId}:0`]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current.depth >= maxDepth) {
            continue;
        }

        const edges = getTraceEdges(index, current.nodeId, direction);
        for (const edge of edges) {
            const nextNodeId = edge.from === current.nodeId ? edge.to : edge.from;
            edgeIds.add(edge.id);
            nodeIds.add(edge.from);
            nodeIds.add(edge.to);

            const visitKey = `${nextNodeId}:${current.depth + 1}`;
            if (!visited.has(visitKey)) {
                visited.add(visitKey);
                queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
            }
        }
    }

    return { nodeIds, edgeIds };
}

export function filterRuntimeGraph(index: RuntimeGraphIndex, filters: RuntimeGraphFilters = {}) {
    const query = normalizeQuery(filters.query);
    const nodeTypes = toSet(filters.nodeTypes);
    const edgeTypes = toSet(filters.edgeTypes);
    const includeNodeIds = toSet(filters.includeNodeIds);

    const nodes = index.nodes.filter((node) => {
        if (nodeTypes && !nodeTypes.has(node.type)) {
            return false;
        }
        if (includeNodeIds && !includeNodeIds.has(node.id)) {
            return false;
        }
        if (query && !matchesNodeQuery(node, query)) {
            return false;
        }
        return true;
    });
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = index.edges.filter(
        (edge) =>
            visibleNodeIds.has(edge.from) &&
            visibleNodeIds.has(edge.to) &&
            (!edgeTypes || edgeTypes.has(edge.type))
    );

    if (!filters.hideIsolated) {
        return { nodes, edges };
    }

    const connectedNodeIds = new Set<string>();
    for (const edge of edges) {
        connectedNodeIds.add(edge.from);
        connectedNodeIds.add(edge.to);
    }

    return {
        nodes: nodes.filter((node) => connectedNodeIds.has(node.id)),
        edges
    };
}

function getTraceEdges(index: RuntimeGraphIndex, nodeId: string, direction: RuntimeTraceDirection) {
    if (direction === 'upstream') {
        return index.incoming.get(nodeId) ?? [];
    }
    if (direction === 'downstream') {
        return index.outgoing.get(nodeId) ?? [];
    }
    return [...(index.incoming.get(nodeId) ?? []), ...(index.outgoing.get(nodeId) ?? [])];
}

function matchesNodeQuery(node: RuntimeNode, query: string) {
    return [node.id, node.label, node.type, node.sourcePath ?? '', node.framework ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query);
}

function normalizeQuery(value: string | undefined) {
    return String(value ?? '').trim().toLowerCase();
}

function toSet<T extends string>(value?: Set<T> | T[]) {
    if (!value) {
        return undefined;
    }
    return value instanceof Set ? value : new Set(value);
}
