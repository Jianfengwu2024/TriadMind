import * as fs from 'fs';
import * as path from 'path';
import { RuntimeMap } from './runtime/types';
import { WorkspacePaths } from './workspace';

type ViewName = 'runtime' | 'capability' | 'leaf';
type ViewRelation =
    | 'exact'
    | 'folded_leaf'
    | 'owner_match'
    | 'source_match'
    | 'name_match'
    | 'runtime_capability'
    | 'runtime_leaf_derived';

type TriadNode = {
    nodeId?: string;
    sourcePath?: string;
    topology?: {
        foldedLeaves?: string[];
    };
};

type RuntimeNode = RuntimeMap['nodes'][number];

export interface ViewMapDiagnostic {
    level: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    sourcePath?: string;
}

export interface ViewMapLink {
    id: string;
    fromView: ViewName;
    fromId: string;
    toView: ViewName;
    toId: string;
    relation: ViewRelation;
    confidence: number;
    reason: string;
    sourcePath?: string;
}

export interface ViewMap {
    schemaVersion: '1.0';
    project: string;
    generatedAt: string;
    stats: {
        runtimeNodes: number;
        capabilityNodes: number;
        leafNodes: number;
        linkCount: number;
    };
    links: ViewMapLink[];
    diagnostics: ViewMapDiagnostic[];
}

export interface ViewMapOptions {
    maxCandidatesPerRuntimeNode?: number;
}

type RuntimeCapabilityCandidate = {
    capabilityId: string;
    score: number;
    reason: string;
    sourcePath?: string;
};

export function generateViewMap(paths: WorkspacePaths, options: ViewMapOptions = {}): ViewMap {
    const diagnostics: ViewMapDiagnostic[] = [];
    const capabilityNodes = readTriadNodes(paths.mapFile, diagnostics, 'VIEW_MAP_MISSING_TRIAD_MAP');
    const leafNodes = readTriadNodes(paths.leafMapFile, diagnostics, 'VIEW_MAP_MISSING_LEAF_MAP');
    const runtimeMap = readRuntimeMap(paths.runtimeMapFile, diagnostics);
    const maxCandidatesPerRuntimeNode = normalizePositiveInteger(options.maxCandidatesPerRuntimeNode, 3);

    const linksByKey = new Map<string, ViewMapLink>();
    const capabilityById = new Map<string, TriadNode>();
    const leafById = new Map<string, TriadNode>();
    const capabilityToLeaf = new Map<string, Set<string>>();
    const leafToCapability = new Map<string, Set<string>>();

    for (const node of capabilityNodes) {
        const nodeId = normalizeNodeId(node.nodeId);
        if (nodeId) {
            capabilityById.set(nodeId, node);
        }
    }
    for (const node of leafNodes) {
        const nodeId = normalizeNodeId(node.nodeId);
        if (nodeId) {
            leafById.set(nodeId, node);
        }
    }

    for (const [capabilityId, capabilityNode] of capabilityById.entries()) {
        const linkedLeafIds = new Set<string>();
        if (leafById.has(capabilityId)) {
            linkedLeafIds.add(capabilityId);
            addBidirectionalLink(
                linksByKey,
                {
                    fromView: 'capability',
                    fromId: capabilityId,
                    toView: 'leaf',
                    toId: capabilityId,
                    relation: 'exact',
                    confidence: 0.99,
                    reason: 'capability nodeId exactly matches leaf nodeId',
                    sourcePath: capabilityNode.sourcePath
                }
            );
        }

        const foldedLeaves = Array.isArray(capabilityNode.topology?.foldedLeaves)
            ? capabilityNode.topology?.foldedLeaves ?? []
            : [];
        for (const foldedLeaf of foldedLeaves) {
            const foldedLeafId = normalizeNodeId(foldedLeaf);
            if (!foldedLeafId || !leafById.has(foldedLeafId)) {
                continue;
            }
            linkedLeafIds.add(foldedLeafId);
            addBidirectionalLink(
                linksByKey,
                {
                    fromView: 'capability',
                    fromId: capabilityId,
                    toView: 'leaf',
                    toId: foldedLeafId,
                    relation: 'folded_leaf',
                    confidence: 0.96,
                    reason: 'capability topology.foldedLeaves references this leaf node',
                    sourcePath: capabilityNode.sourcePath
                }
            );
        }

        const owner = extractOwner(capabilityId);
        const sourcePath = normalizeSourcePath(capabilityNode.sourcePath);
        if (owner) {
            const ownerCandidates = leafNodes
                .filter((leafNode) => normalizeSourcePath(leafNode.sourcePath) === sourcePath)
                .map((leafNode) => normalizeNodeId(leafNode.nodeId))
                .filter((leafId): leafId is string => Boolean(leafId))
                .filter((leafId) => extractOwner(leafId) === owner)
                .slice(0, 12);

            for (const leafId of ownerCandidates) {
                if (linkedLeafIds.has(leafId)) {
                    continue;
                }
                linkedLeafIds.add(leafId);
                addBidirectionalLink(
                    linksByKey,
                    {
                        fromView: 'capability',
                        fromId: capabilityId,
                        toView: 'leaf',
                        toId: leafId,
                        relation: 'owner_match',
                        confidence: 0.78,
                        reason: 'capability and leaf share sourcePath + owner name',
                        sourcePath
                    }
                );
            }
        }

        capabilityToLeaf.set(capabilityId, linkedLeafIds);
        for (const leafId of linkedLeafIds) {
            const capabilities = leafToCapability.get(leafId) ?? new Set<string>();
            capabilities.add(capabilityId);
            leafToCapability.set(leafId, capabilities);
        }
    }

    const runtimeNodes = runtimeMap?.nodes ?? [];
    let runtimeUnmatchedCount = 0;
    const unmatchedSamples: string[] = [];
    for (const runtimeNode of runtimeNodes) {
        const runtimeId = normalizeNodeId(runtimeNode.id);
        if (!runtimeId) {
            continue;
        }

        const candidates = collectRuntimeCapabilityCandidates(runtimeNode, capabilityById);
        if (candidates.length === 0) {
            runtimeUnmatchedCount += 1;
            if (unmatchedSamples.length < 10) {
                unmatchedSamples.push(runtimeId);
            }
            continue;
        }

        for (const candidate of candidates.slice(0, maxCandidatesPerRuntimeNode)) {
            addBidirectionalLink(
                linksByKey,
                {
                    fromView: 'runtime',
                    fromId: runtimeId,
                    toView: 'capability',
                    toId: candidate.capabilityId,
                    relation: 'runtime_capability',
                    confidence: normalizeConfidence(candidate.score / 100),
                    reason: candidate.reason,
                    sourcePath: candidate.sourcePath
                }
            );

            const linkedLeafIds = capabilityToLeaf.get(candidate.capabilityId) ?? new Set<string>();
            for (const leafId of Array.from(linkedLeafIds).slice(0, 8)) {
                addBidirectionalLink(
                    linksByKey,
                    {
                        fromView: 'runtime',
                        fromId: runtimeId,
                        toView: 'leaf',
                        toId: leafId,
                        relation: 'runtime_leaf_derived',
                        confidence: normalizeConfidence(candidate.score / 120),
                        reason: 'runtime node matched capability; leaf link derived from capability↔leaf mapping',
                        sourcePath: candidate.sourcePath
                    }
                );
            }
        }
    }

    if (runtimeUnmatchedCount > 0) {
        diagnostics.push({
            level: 'info',
            code: 'VIEW_MAP_RUNTIME_NODE_UNMATCHED_SUMMARY',
            message: `Runtime nodes without cross-view match: ${runtimeUnmatchedCount}${
                unmatchedSamples.length > 0 ? ` [${unmatchedSamples.join(', ')}]` : ''
            }`
        });
    }

    const links = Array.from(linksByKey.values()).sort((left, right) => left.id.localeCompare(right.id));
    return {
        schemaVersion: '1.0',
        project: path.basename(paths.projectRoot),
        generatedAt: new Date().toISOString(),
        stats: {
            runtimeNodes: runtimeNodes.length,
            capabilityNodes: capabilityById.size,
            leafNodes: leafById.size,
            linkCount: links.length
        },
        links,
        diagnostics
    };
}

export function writeViewMapArtifacts(paths: WorkspacePaths, options: ViewMapOptions = {}) {
    const viewMap = generateViewMap(paths, options);
    fs.mkdirSync(path.dirname(paths.viewMapFile), { recursive: true });
    fs.writeFileSync(paths.viewMapFile, JSON.stringify(viewMap, null, 2), 'utf-8');
    fs.writeFileSync(paths.viewMapDiagnosticsFile, JSON.stringify(viewMap.diagnostics, null, 2), 'utf-8');
    return viewMap;
}

function collectRuntimeCapabilityCandidates(runtimeNode: RuntimeNode, capabilityById: Map<string, TriadNode>) {
    const runtimeSourcePath = normalizeSourcePath(runtimeNode.sourcePath);
    const runtimeTokens = tokenize(`${runtimeNode.id} ${runtimeNode.label} ${runtimeNode.sourcePath ?? ''}`);
    const handlerToken = normalizeText(
        typeof runtimeNode.metadata?.handler === 'string' ? String(runtimeNode.metadata?.handler) : ''
    );
    const serviceMethod = parseServiceRuntimeId(runtimeNode.id);
    const candidates: RuntimeCapabilityCandidate[] = [];

    for (const [capabilityId, capabilityNode] of capabilityById.entries()) {
        let score = 0;
        const reasons: string[] = [];
        const capabilitySourcePath = normalizeSourcePath(capabilityNode.sourcePath);
        const capabilityTokens = tokenize(`${capabilityId} ${capabilitySourcePath}`);

        if (runtimeSourcePath && capabilitySourcePath && runtimeSourcePath === capabilitySourcePath) {
            score += 65;
            reasons.push('source_path_exact');
        } else if (
            runtimeSourcePath &&
            capabilitySourcePath &&
            (runtimeSourcePath.endsWith(capabilitySourcePath) || capabilitySourcePath.endsWith(runtimeSourcePath))
        ) {
            score += 28;
            reasons.push('source_path_partial');
        }

        if (handlerToken) {
            const capabilityMethod = normalizeText(extractMethod(capabilityId));
            if (capabilityMethod && (capabilityMethod === handlerToken || capabilityId.toLowerCase().includes(handlerToken))) {
                score += 34;
                reasons.push('handler_match');
            }
        }

        if (serviceMethod) {
            const capabilityLower = capabilityId.toLowerCase();
            if (
                capabilityLower.includes(serviceMethod.service.toLowerCase()) &&
                capabilityLower.includes(serviceMethod.method.toLowerCase())
            ) {
                score += 40;
                reasons.push('service_method_match');
            }
        }

        const overlap = countTokenOverlap(runtimeTokens, capabilityTokens);
        if (overlap > 0) {
            score += Math.min(24, overlap * 6);
            reasons.push(`token_overlap_${overlap}`);
        }

        if (score < 35) {
            continue;
        }

        candidates.push({
            capabilityId,
            score,
            reason: reasons.join('+'),
            sourcePath: capabilityNode.sourcePath
        });
    }

    return candidates
        .sort((left, right) => right.score - left.score || left.capabilityId.localeCompare(right.capabilityId))
        .slice(0, 6);
}

function parseServiceRuntimeId(runtimeId: string) {
    const parts = String(runtimeId ?? '').split('.').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'Service') {
        return undefined;
    }
    return {
        service: parts[1],
        method: parts.slice(2).join('.')
    };
}

function countTokenOverlap(leftTokens: Set<string>, rightTokens: Set<string>) {
    let overlap = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) {
            overlap += 1;
        }
    }
    return overlap;
}

function tokenize(value: string) {
    return new Set(
        String(value ?? '')
            .toLowerCase()
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .split(/[^a-z0-9]+/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length >= 3)
            .filter((entry) => !GENERIC_TOKENS.has(entry))
    );
}

function extractOwner(nodeId: string) {
    const parts = String(nodeId ?? '').split('.').filter(Boolean);
    if (parts.length <= 1) {
        return '';
    }
    return parts.slice(0, -1).join('.');
}

function extractMethod(nodeId: string) {
    const parts = String(nodeId ?? '').split('.').filter(Boolean);
    return parts[parts.length - 1] ?? '';
}

function addBidirectionalLink(linksByKey: Map<string, ViewMapLink>, link: Omit<ViewMapLink, 'id'>) {
    addLink(linksByKey, link);
    if (link.fromView === link.toView && link.fromId === link.toId) {
        return;
    }
    addLink(linksByKey, {
        ...link,
        fromView: link.toView,
        fromId: link.toId,
        toView: link.fromView,
        toId: link.fromId
    });
}

function addLink(linksByKey: Map<string, ViewMapLink>, link: Omit<ViewMapLink, 'id'>) {
    const normalizedLink: Omit<ViewMapLink, 'id'> = {
        ...link,
        confidence: normalizeConfidence(link.confidence)
    };
    const linkId = buildLinkId(normalizedLink);
    const existing = linksByKey.get(linkId);
    if (!existing) {
        linksByKey.set(linkId, {
            id: linkId,
            ...normalizedLink
        });
        return;
    }

    linksByKey.set(linkId, {
        ...existing,
        confidence: Math.max(existing.confidence, normalizedLink.confidence),
        reason: existing.reason === normalizedLink.reason ? existing.reason : `${existing.reason}|${normalizedLink.reason}`,
        sourcePath: existing.sourcePath ?? normalizedLink.sourcePath
    });
}

function buildLinkId(link: Omit<ViewMapLink, 'id'>) {
    return [
        link.fromView,
        normalizeNodeId(link.fromId),
        link.relation,
        link.toView,
        normalizeNodeId(link.toId)
    ].join('::');
}

function readTriadNodes(filePath: string, diagnostics: ViewMapDiagnostic[], missingCode: string) {
    if (!fs.existsSync(filePath)) {
        diagnostics.push({
            level: 'warning',
            code: missingCode,
            message: `Missing topology file: ${filePath}`
        });
        return [] as TriadNode[];
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? (parsed as TriadNode[]) : ([] as TriadNode[]);
    } catch {
        diagnostics.push({
            level: 'error',
            code: 'VIEW_MAP_PARSE_FAILED',
            message: `Failed to parse topology file: ${filePath}`
        });
        return [] as TriadNode[];
    }
}

function readRuntimeMap(filePath: string, diagnostics: ViewMapDiagnostic[]) {
    if (!fs.existsSync(filePath)) {
        diagnostics.push({
            level: 'warning',
            code: 'VIEW_MAP_MISSING_RUNTIME_MAP',
            message: `Missing runtime topology file: ${filePath}`
        });
        return undefined;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(content) as RuntimeMap;
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            diagnostics.push({
                level: 'error',
                code: 'VIEW_MAP_RUNTIME_MAP_INVALID',
                message: `Invalid runtime map shape: ${filePath}`
            });
            return undefined;
        }
        return parsed;
    } catch {
        diagnostics.push({
            level: 'error',
            code: 'VIEW_MAP_RUNTIME_MAP_PARSE_FAILED',
            message: `Failed to parse runtime map: ${filePath}`
        });
        return undefined;
    }
}

function normalizeNodeId(value: string | undefined) {
    return normalizeText(value).replace(/\\/g, '/');
}

function normalizeSourcePath(value: string | undefined) {
    return normalizeText(value).replace(/\\/g, '/').toLowerCase();
}

function normalizeText(value: string | undefined) {
    return String(value ?? '').trim();
}

function normalizeConfidence(value: number) {
    if (!Number.isFinite(value)) {
        return 0.5;
    }
    return Math.max(0.01, Math.min(0.99, Number(value.toFixed(4))));
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

const GENERIC_TOKENS = new Set([
    'service',
    'workflow',
    'runtime',
    'node',
    'task',
    'worker',
    'method',
    'class',
    'module',
    'file',
    'api',
    'route',
    'frontend',
    'backend',
    'core'
]);
