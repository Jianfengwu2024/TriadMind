import { createHash } from 'node:crypto';

export interface BrokenContract {
    consumerNodeId: string;
    demand: string;
    previousProducers: string[];
}

export interface RemovedEdge {
    from: string;
    to: string;
    contract: string;
}

export interface DriftReport {
    isDegraded: boolean;
    newCycles: string[][];
    brokenContracts: BrokenContract[];
    removedEdges: RemovedEdge[];
    summary: string[];
}

export interface RenormalizeAction {
    op: 'create_macro_node';
    macro_node_id: string;
    absorbed_nodes: string[];
    new_demand: string[];
    new_answer: string[];
    rationale: string;
}

export interface RenormalizeProtocol {
    protocolVersion: string;
    protocolType: 'triadmind-renormalize';
    actions: RenormalizeAction[];
    summary: string[];
}

type TriadMapNode = {
    nodeId?: unknown;
    fission?: {
        demand?: unknown;
        answer?: unknown;
    };
};

type TopologyGraph = {
    nodeIds: string[];
    adjacency: Map<string, Set<string>>;
    edges: RemovedEdge[];
    edgeKeys: Set<string>;
    producersByContract: Map<string, Set<string>>;
    consumersByContract: Map<string, Set<string>>;
    demandKeysByNode: Map<string, string[]>;
};

type CanonicalNodeEntry = {
    node: TriadMapNode;
    originalIndex: number;
    baseSignature: string;
    refinedSignature: string;
    structuralFingerprint: string;
};

const NONE_TOKENS = new Set(['', 'none', 'void', 'null', 'undefined']);
const MAX_CANONICAL_PERMUTATIONS = 4096;

/**
 * @LeftBranch
 */
export function calculateBlastRadius(map: any[], targetNodeId: string, isContractChange: boolean): string[] {
    if (!isContractChange) {
        return [];
    }

    const graph = buildTopologyGraph(map);
    if (!graph.adjacency.has(targetNodeId)) {
        return [];
    }

    const impacted = new Set<string>();
    const queue: string[] = [targetNodeId];
    let cursor = 0;

    while (cursor < queue.length) {
        const currentNodeId = queue[cursor];
        cursor += 1;

        const downstreams = graph.adjacency.get(currentNodeId);
        if (!downstreams) {
            continue;
        }

        for (const downstreamNodeId of downstreams) {
            if (downstreamNodeId === targetNodeId || impacted.has(downstreamNodeId)) {
                continue;
            }

            impacted.add(downstreamNodeId);
            queue.push(downstreamNodeId);
        }
    }

    return Array.from(impacted);
}

/**
 * @LeftBranch
 */
export function detectCycles(map: any[]): string[][] {
    const graph = buildTopologyGraph(map);
    return getCycles(graph);
}

/**
 * @LeftBranch
 */
export function generateRenormalizeProtocol(map: any[], cycles: string[][]): RenormalizeProtocol {
    const graph = buildTopologyGraph(map);
    const nodeMap = buildNodeMap(map);
    const actions = cycles
        .filter((cycle) => cycle.length > 0)
        .map((cycle) => buildRenormalizeAction(cycle, graph, nodeMap));

    const summary =
        actions.length > 0
            ? actions.map(
                  (action) =>
                      `${action.macro_node_id} absorbs ${action.absorbed_nodes.length} node(s) with ${action.new_demand.length} external demand(s) and ${action.new_answer.length} external answer(s).`
              )
            : ['No cyclic strongly connected components found; no renormalization action generated.'];

    return {
        protocolVersion: '1.0',
        protocolType: 'triadmind-renormalize',
        actions,
        summary
    };
}

/**
 * @LeftBranch
 */
export function detectTopologicalDrift(oldMap: any[], newMap: any[]): DriftReport {
    const oldGraph = buildTopologyGraph(oldMap);
    const newGraph = buildTopologyGraph(newMap);

    const oldCycleSignatures = new Set(getCycleSignatures(oldGraph));
    const newCycles = detectCycles(newMap).filter((cycle) => !oldCycleSignatures.has(toCycleSignature(cycle)));

    const brokenContracts = detectBrokenContracts(oldGraph, newGraph);
    const removedEdges = detectRemovedEdges(oldGraph, newGraph);

    const summary: string[] = [];
    if (newCycles.length > 0) {
        summary.push(`Detected ${newCycles.length} newly introduced cycle(s).`);
    }
    if (brokenContracts.length > 0) {
        summary.push(`Detected ${brokenContracts.length} broken contract demand(s).`);
    }
    if (removedEdges.length > 0) {
        summary.push(`Detected ${removedEdges.length} removed producer-consumer edge(s).`);
    }
    if (summary.length === 0) {
        summary.push('No topological degradation detected.');
    }

    return {
        isDegraded: newCycles.length > 0 || brokenContracts.length > 0 || removedEdges.length > 0,
        newCycles,
        brokenContracts,
        removedEdges,
        summary
    };
}

/**
 * @LeftBranch
 */
export function normalizeSubgraph(subgraph: any[]): any[] {
    const nodes = toUniqueTriadNodes(subgraph);
    if (nodes.length <= 1) {
        return nodes.map((node) => cloneJson(node));
    }

    const graph = buildTopologyGraph(nodes);
    const incoming = buildIncomingAdjacency(graph);
    const entries = buildCanonicalEntries(nodes, graph, incoming);
    const orderedEntries = resolveCanonicalOrdering(entries, nodes);

    return orderedEntries.map((entry) => cloneJson(entry.node));
}

/**
 * @LeftBranch
 */
export function generateMayanMatrix(normalizedNodes: any[]): number[][] {
    const nodes = toUniqueTriadNodes(normalizedNodes);
    const size = nodes.length;
    const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));

    if (size === 0) {
        return matrix;
    }

    const graph = buildTopologyGraph(nodes);
    const indexByNodeId = new Map<string, number>();

    nodes.forEach((node, index) => {
        const nodeId = typeof node.nodeId === 'string' ? node.nodeId.trim() : '';
        if (nodeId) {
            indexByNodeId.set(nodeId, index);
        }
    });

    for (const edge of graph.edges) {
        const producerIndex = indexByNodeId.get(edge.from);
        const consumerIndex = indexByNodeId.get(edge.to);
        if (producerIndex === undefined || consumerIndex === undefined) {
            continue;
        }

        matrix[consumerIndex][producerIndex] = 1;
    }

    return matrix;
}

/**
 * @LeftBranch
 */
export function generateFeatureHash(matrix: number[][]): string {
    const normalizedMatrix = Array.isArray(matrix)
        ? matrix.map((row) => (Array.isArray(row) ? row.map((value) => (value ? 1 : 0)) : []))
        : [];
    const size = normalizedMatrix.length;
    const bitString = normalizedMatrix.map((row) => row.map((value) => (value ? '1' : '0')).join('')).join('');
    const digest = createHash('sha256')
        .update(`mayan:${size}:${bitString}`, 'utf8')
        .digest('hex')
        .slice(0, 8)
        .toUpperCase();

    return `Feature-0x${digest}`;
}

function detectBrokenContracts(oldGraph: TopologyGraph, newGraph: TopologyGraph): BrokenContract[] {
    const brokenContracts: BrokenContract[] = [];

    for (const [consumerNodeId, demandKeys] of newGraph.demandKeysByNode.entries()) {
        for (const demandKey of demandKeys) {
            const newProducers = newGraph.producersByContract.get(demandKey);
            if (newProducers && newProducers.size > 0) {
                continue;
            }

            const previousProducers = oldGraph.producersByContract.get(demandKey);
            if (!previousProducers || previousProducers.size === 0) {
                continue;
            }

            brokenContracts.push({
                consumerNodeId,
                demand: demandKey,
                previousProducers: Array.from(previousProducers).sort()
            });
        }
    }

    return brokenContracts.sort(
        (left, right) =>
            left.consumerNodeId.localeCompare(right.consumerNodeId) || left.demand.localeCompare(right.demand)
    );
}

function detectRemovedEdges(oldGraph: TopologyGraph, newGraph: TopologyGraph): RemovedEdge[] {
    const newNodeIds = new Set(newGraph.nodeIds);
    const removedEdges: RemovedEdge[] = [];

    for (const edge of oldGraph.edges) {
        if (!newNodeIds.has(edge.from) || !newNodeIds.has(edge.to)) {
            continue;
        }

        const edgeKey = toEdgeKey(edge.from, edge.to, edge.contract);
        if (!newGraph.edgeKeys.has(edgeKey)) {
            removedEdges.push(edge);
        }
    }

    return removedEdges.sort(
        (left, right) =>
            left.from.localeCompare(right.from) ||
            left.to.localeCompare(right.to) ||
            left.contract.localeCompare(right.contract)
    );
}

function getCycleSignatures(graph: TopologyGraph) {
    return getCycles(graph).map((cycle) => toCycleSignature(cycle));
}

function toUniqueTriadNodes(subgraph: any[]) {
    const nodes = Array.isArray(subgraph) ? (subgraph as TriadMapNode[]) : [];
    const seen = new Set<string>();
    const uniqueNodes: TriadMapNode[] = [];

    for (const node of nodes) {
        const nodeId = typeof node?.nodeId === 'string' ? node.nodeId.trim() : '';
        if (!nodeId || seen.has(nodeId)) {
            continue;
        }

        seen.add(nodeId);
        uniqueNodes.push(node);
    }

    return uniqueNodes;
}

function buildIncomingAdjacency(graph: TopologyGraph) {
    const incoming = new Map<string, Set<string>>();

    for (const nodeId of graph.nodeIds) {
        incoming.set(nodeId, new Set<string>());
    }

    for (const [from, downstreams] of graph.adjacency.entries()) {
        for (const to of downstreams) {
            ensureSet(incoming, to).add(from);
        }
    }

    return incoming;
}

function buildCanonicalEntries(
    nodes: TriadMapNode[],
    graph: TopologyGraph,
    incoming: Map<string, Set<string>>
): CanonicalNodeEntry[] {
    const nodeIdSet = new Set(graph.nodeIds);
    const answerKeysByNode = new Map<string, string[]>();
    const baseEntries: Array<CanonicalNodeEntry & { nodeId: string }> = [];

    for (const node of nodes) {
        const nodeId = typeof node.nodeId === 'string' ? node.nodeId.trim() : '';
        if (!nodeId) {
            continue;
        }

        const demandKeys = getDemandKeys(node);
        const answerKeys = getAnswerKeys(node);
        answerKeysByNode.set(nodeId, answerKeys);

        const internalDemand = demandKeys.filter((demandKey) =>
            Array.from(graph.producersByContract.get(demandKey) ?? []).some((producerNodeId) => nodeIdSet.has(producerNodeId))
        );
        const externalDemand = demandKeys.filter((demandKey) => !internalDemand.includes(demandKey));

        const internalAnswer = answerKeys.filter((answerKey) =>
            Array.from(graph.consumersByContract.get(answerKey) ?? []).some((consumerNodeId) => nodeIdSet.has(consumerNodeId))
        );
        const externalAnswer = answerKeys.filter((answerKey) => !internalAnswer.includes(answerKey));

        const baseSignature = stableStringify({
            demand: demandKeys,
            answer: answerKeys,
            internalDemand,
            externalDemand,
            internalAnswer,
            externalAnswer,
            inDegree: (incoming.get(nodeId) ?? new Set<string>()).size,
            outDegree: (graph.adjacency.get(nodeId) ?? new Set<string>()).size,
            selfLoop: graph.adjacency.get(nodeId)?.has(nodeId) ?? false
        });

        baseEntries.push({
            node,
            nodeId,
            originalIndex: baseEntries.length,
            baseSignature,
            refinedSignature: baseSignature,
            structuralFingerprint: stableStringify({
                demand: demandKeys,
                answer: answerKeys
            })
        });
    }

    let colors = new Map(baseEntries.map((entry) => [entry.nodeId, entry.baseSignature]));

    for (let iteration = 0; iteration < nodes.length; iteration += 1) {
        let changed = false;
        const nextColors = new Map<string, string>();

        for (const entry of baseEntries) {
            const outgoingColors = Array.from(graph.adjacency.get(entry.nodeId) ?? [])
                .map((nodeId) => colors.get(nodeId) ?? '')
                .sort();
            const incomingColors = Array.from(incoming.get(entry.nodeId) ?? [])
                .map((nodeId) => colors.get(nodeId) ?? '')
                .sort();

            const refined = stableStringify({
                self: colors.get(entry.nodeId) ?? entry.baseSignature,
                incoming: incomingColors,
                outgoing: outgoingColors,
                contracts: entry.baseSignature
            });

            nextColors.set(entry.nodeId, refined);
            if (refined !== colors.get(entry.nodeId)) {
                changed = true;
            }
        }

        colors = nextColors;
        if (!changed) {
            break;
        }
    }

    return baseEntries.map(({ nodeId, ...entry }) => ({
        ...entry,
        refinedSignature: colors.get(nodeId) ?? entry.baseSignature,
        structuralFingerprint: stableStringify({
            base: entry.baseSignature,
            refined: colors.get(nodeId) ?? entry.baseSignature,
            answers: answerKeysByNode.get(nodeId) ?? []
        })
    }));
}

function resolveCanonicalOrdering(entries: CanonicalNodeEntry[], nodes: TriadMapNode[]) {
    const groupedEntries = new Map<string, CanonicalNodeEntry[]>();
    for (const entry of entries) {
        ensureArray(groupedEntries, entry.refinedSignature).push(entry);
    }

    const sortedGroups = Array.from(groupedEntries.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, group]) =>
            group.slice().sort((left, right) => {
                const diff = left.baseSignature.localeCompare(right.baseSignature);
                if (diff !== 0) {
                    return diff;
                }

                return left.structuralFingerprint.localeCompare(right.structuralFingerprint);
            })
        );

    const ambiguousGroupSizes = sortedGroups
        .filter((group) => group.length > 1)
        .map((group) => factorial(group.length));
    const permutationBudget = ambiguousGroupSizes.reduce((product, value) => product * value, 1);

    if (permutationBudget > MAX_CANONICAL_PERMUTATIONS) {
        return sortedGroups
            .flat()
            .sort(
                (left, right) =>
                    left.refinedSignature.localeCompare(right.refinedSignature) ||
                    left.baseSignature.localeCompare(right.baseSignature) ||
                    left.structuralFingerprint.localeCompare(right.structuralFingerprint) ||
                    getStableNodeFallback(left.node).localeCompare(getStableNodeFallback(right.node)) ||
                    left.originalIndex - right.originalIndex
            );
    }

    const candidates = sortedGroups.map((group) => (group.length <= 1 ? [group] : permute(group)));
    let bestOrder: CanonicalNodeEntry[] | null = null;
    let bestSignature = '';

    const visit = (groupIndex: number, partial: CanonicalNodeEntry[]) => {
        if (groupIndex >= candidates.length) {
            const signature = buildCanonicalOrderSignature(partial, nodes);
            if (!bestOrder || signature.localeCompare(bestSignature) < 0) {
                bestOrder = partial.slice();
                bestSignature = signature;
            }
            return;
        }

        for (const candidate of candidates[groupIndex]) {
            partial.push(...candidate);
            visit(groupIndex + 1, partial);
            partial.length -= candidate.length;
        }
    };

    visit(0, []);
    return bestOrder ?? sortedGroups.flat();
}

function buildCanonicalOrderSignature(order: CanonicalNodeEntry[], _nodes: TriadMapNode[]) {
    const matrix = generateMayanMatrix(order.map((entry) => entry.node));
    const flattenedMatrix = matrix.map((row) => row.join('')).join('|');
    const nodeSignature = order
        .map((entry) => `${entry.refinedSignature}::${entry.baseSignature}::${entry.structuralFingerprint}`)
        .join('||');
    return `${flattenedMatrix}##${nodeSignature}`;
}

function factorial(value: number) {
    let result = 1;
    for (let cursor = 2; cursor <= value; cursor += 1) {
        result *= cursor;
    }
    return result;
}

function permute<T>(items: T[]): T[][] {
    if (items.length <= 1) {
        return [items.slice()];
    }

    const result: T[][] = [];
    const used = Array.from({ length: items.length }, () => false);
    const current: T[] = [];

    const visit = () => {
        if (current.length === items.length) {
            result.push(current.slice());
            return;
        }

        for (let index = 0; index < items.length; index += 1) {
            if (used[index]) {
                continue;
            }

            used[index] = true;
            current.push(items[index]);
            visit();
            current.pop();
            used[index] = false;
        }
    };

    visit();
    return result;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
    }

    return JSON.stringify(value);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getStableNodeFallback(node: TriadMapNode) {
    return stableStringify({
        category: (node as Record<string, unknown>)?.category ?? null,
        sourcePath: (node as Record<string, unknown>)?.sourcePath ?? null,
        fission: node.fission ?? null
    });
}

function ensureArray<T>(map: Map<string, T[]>, key: string) {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }

    const created: T[] = [];
    map.set(key, created);
    return created;
}

function getCycles(graph: TopologyGraph) {
    const stronglyConnectedComponents = tarjan(graph.adjacency, graph.nodeIds);
    const cycles = stronglyConnectedComponents
        .filter((component) => component.length > 1 || hasSelfLoop(component[0], graph.adjacency))
        .map((component) => component.slice().sort());

    cycles.sort((left, right) => toCycleSignature(left).localeCompare(toCycleSignature(right)));
    return cycles;
}

function hasSelfLoop(nodeId: string | undefined, adjacency: Map<string, Set<string>>) {
    if (!nodeId) {
        return false;
    }

    return adjacency.get(nodeId)?.has(nodeId) ?? false;
}

function tarjan(adjacency: Map<string, Set<string>>, nodeIds: string[]) {
    let index = 0;
    const indexMap = new Map<string, number>();
    const lowLinkMap = new Map<string, number>();
    const stack: string[] = [];
    const inStack = new Set<string>();
    const components: string[][] = [];

    const visit = (nodeId: string) => {
        indexMap.set(nodeId, index);
        lowLinkMap.set(nodeId, index);
        index += 1;
        stack.push(nodeId);
        inStack.add(nodeId);

        for (const nextNodeId of adjacency.get(nodeId) ?? []) {
            if (!indexMap.has(nextNodeId)) {
                visit(nextNodeId);
                lowLinkMap.set(nodeId, Math.min(lowLinkMap.get(nodeId)!, lowLinkMap.get(nextNodeId)!));
                continue;
            }

            if (inStack.has(nextNodeId)) {
                lowLinkMap.set(nodeId, Math.min(lowLinkMap.get(nodeId)!, indexMap.get(nextNodeId)!));
            }
        }

        if (lowLinkMap.get(nodeId) !== indexMap.get(nodeId)) {
            return;
        }

        const component: string[] = [];
        while (stack.length > 0) {
            const stackedNodeId = stack.pop()!;
            inStack.delete(stackedNodeId);
            component.push(stackedNodeId);
            if (stackedNodeId === nodeId) {
                break;
            }
        }
        components.push(component);
    };

    for (const nodeId of nodeIds) {
        if (!indexMap.has(nodeId)) {
            visit(nodeId);
        }
    }

    return components;
}

function buildTopologyGraph(map: any[]): TopologyGraph {
    const nodeIds: string[] = [];
    const adjacency = new Map<string, Set<string>>();
    const edges: RemovedEdge[] = [];
    const edgeKeys = new Set<string>();
    const producersByContract = new Map<string, Set<string>>();
    const consumersByContract = new Map<string, Set<string>>();
    const demandKeysByNode = new Map<string, string[]>();

    const nodes = Array.isArray(map) ? (map as TriadMapNode[]) : [];

    for (const item of nodes) {
        const nodeId = typeof item?.nodeId === 'string' ? item.nodeId.trim() : '';
        if (!nodeId) {
            continue;
        }

        nodeIds.push(nodeId);
        adjacency.set(nodeId, new Set<string>());

        for (const answerKey of getAnswerKeys(item)) {
            ensureSet(producersByContract, answerKey).add(nodeId);
        }

        demandKeysByNode.set(nodeId, getDemandKeys(item));
    }

    for (const nodeId of nodeIds) {
        const demandKeys = demandKeysByNode.get(nodeId) ?? [];
        for (const demandKey of demandKeys) {
            for (const producerNodeId of producersByContract.get(demandKey) ?? []) {
                adjacency.get(producerNodeId)?.add(nodeId);
                ensureSet(consumersByContract, demandKey).add(nodeId);
                const edge = {
                    from: producerNodeId,
                    to: nodeId,
                    contract: demandKey
                };
                const edgeKey = toEdgeKey(edge.from, edge.to, edge.contract);
                if (!edgeKeys.has(edgeKey)) {
                    edgeKeys.add(edgeKey);
                    edges.push(edge);
                }
            }
        }
    }

    return {
        nodeIds: Array.from(new Set(nodeIds)).sort(),
        adjacency,
        edges,
        edgeKeys,
        producersByContract,
        consumersByContract,
        demandKeysByNode
    };
}

function buildNodeMap(map: any[]) {
    const result = new Map<string, TriadMapNode>();
    const nodes = Array.isArray(map) ? (map as TriadMapNode[]) : [];

    for (const item of nodes) {
        const nodeId = typeof item?.nodeId === 'string' ? item.nodeId.trim() : '';
        if (nodeId) {
            result.set(nodeId, item);
        }
    }

    return result;
}

function buildRenormalizeAction(
    cycle: string[],
    graph: TopologyGraph,
    nodeMap: Map<string, TriadMapNode>
): RenormalizeAction {
    const cycleNodeIds = cycle.slice().sort();
    const cycleNodeIdSet = new Set(cycleNodeIds);
    const externalDemand = new Set<string>();
    const externalAnswer = new Set<string>();

    for (const nodeId of cycleNodeIds) {
        const demandKeys = graph.demandKeysByNode.get(nodeId) ?? [];
        for (const demandKey of demandKeys) {
            const producers = graph.producersByContract.get(demandKey) ?? new Set<string>();
            const hasInternalProducer = Array.from(producers).some((producerNodeId) => cycleNodeIdSet.has(producerNodeId));
            if (!hasInternalProducer) {
                externalDemand.add(demandKey);
            }
        }
    }

    for (const nodeId of cycleNodeIds) {
        const answerKeys = getAnswerKeys(nodeMap.get(nodeId) ?? {});
        for (const answerKey of answerKeys) {
            const consumers = getConsumersForContract(answerKey, graph);
            const hasExternalConsumer = consumers.some((consumerNodeId) => !cycleNodeIdSet.has(consumerNodeId));
            const hasNoConsumer = consumers.length === 0;
            if (hasExternalConsumer || hasNoConsumer) {
                externalAnswer.add(answerKey);
            }
        }
    }

    return {
        op: 'create_macro_node',
        macro_node_id: buildMacroNodeId(cycleNodeIds),
        absorbed_nodes: cycleNodeIds,
        new_demand: Array.from(externalDemand).sort(),
        new_answer: Array.from(externalAnswer).sort(),
        rationale: `Collapse the strongly connected component ${cycleNodeIds.join(', ')} into a language-agnostic macro node and expose only its external contract boundary.`
    };
}

function getConsumersForContract(contract: string, graph: TopologyGraph) {
    return Array.from(graph.consumersByContract.get(contract) ?? []).sort();
}

function buildMacroNodeId(nodeIds: string[]) {
    const signature = nodeIds
        .map((nodeId) => nodeId.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
        .filter(Boolean)
        .join('__');

    return `MacroNode.${signature || 'Cycle'}`;
}

function getDemandKeys(node: TriadMapNode) {
    return getFissionArray(node, 'demand')
        .map((entry) => normalizeDemandContract(entry))
        .filter((entry): entry is string => Boolean(entry));
}

function getAnswerKeys(node: TriadMapNode) {
    return getFissionArray(node, 'answer')
        .map((entry) => normalizeAnswerContract(entry))
        .filter((entry): entry is string => Boolean(entry));
}

function getFissionArray(node: TriadMapNode, key: 'demand' | 'answer') {
    const value = node?.fission?.[key];
    return Array.isArray(value) ? value.map((entry) => String(entry ?? '').trim()) : [];
}

function normalizeDemandContract(entry: string) {
    if (!entry || /^\[ghost/i.test(entry)) {
        return null;
    }

    const match = entry.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const typeText = match ? match[1].trim() : entry.trim();
    return normalizeContractKey(typeText);
}

function normalizeAnswerContract(entry: string) {
    return normalizeContractKey(entry);
}

function normalizeContractKey(value: string) {
    const compact = value
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*([<>{}()[\]|,:=&?])\s*/g, '$1');

    if (NONE_TOKENS.has(compact.toLowerCase())) {
        return null;
    }

    return compact;
}

function ensureSet(map: Map<string, Set<string>>, key: string) {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }

    const created = new Set<string>();
    map.set(key, created);
    return created;
}

function toEdgeKey(from: string, to: string, contract: string) {
    return `${from}=>${to}::${contract}`;
}

function toCycleSignature(cycle: string[]) {
    return cycle.slice().sort().join(' -> ');
}
