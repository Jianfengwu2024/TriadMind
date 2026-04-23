import { RuntimeEdge, RuntimeNode, RuntimeTopologyExtractor } from '../types';
import { inferServiceId, lineEvidence, normalizeRuntimeId } from '../runtimeUtils';

const WORKFLOW_KEYWORDS = ['workflow', 'pipeline', 'graph', 'dag'];
const NODE_KEYWORDS = ['node', 'step', 'stage', 'task'];

export const workflowRegistryExtractor: RuntimeTopologyExtractor = {
    name: 'WorkflowRegistryExtractor',
    detect(context) {
        return context.files.some((file) =>
            /Workflow|Node|Step|Stage|Pipeline|Graph|DAG|register_node|register_step|add_node|add_edge|connect\(|workflow\.add_/.test(
                file.content
            )
        );
    },
    extract(context) {
        const nodes: RuntimeNode[] = [];
        const edges: RuntimeEdge[] = [];

        for (const file of context.files) {
            if (file.language === 'python' || file.language === 'typescript' || file.language === 'javascript') {
                extractWorkflowRegistries(file, nodes, edges);
            }
            if (file.language === 'json' || file.language === 'yaml') {
                extractWorkflowManifests(file, nodes, edges);
            }
        }

        return { nodes, edges };
    }
};

function extractWorkflowRegistries(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    nodes: RuntimeNode[],
    edges: RuntimeEdge[]
) {
    const addNodeRegex = /\b([A-Za-z_][\w]*)\.(?:add_node|register_node|register_step|register_task)\(\s*["'`]([^"'`]+)["'`]/g;
    const addEdgeRegex =
        /\b([A-Za-z_][\w]*)\.(?:add_edge|connect)\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g;
    const dispatchRegex =
        /\b([A-Za-z_][\w]*(?:service|Service|task|Task|worker|Worker))\.([A-Za-z_][\w]*(?:run|execute|dispatch|invoke|start))\([^)]*([A-Za-z_][\w]*(?:workflow|Workflow|pipeline|Pipeline|dag|graph))?/g;

    const knownWorkflowIds = new Map<string, string>();
    const knownNodeIds = new Map<string, string>();

    for (const match of file.content.matchAll(addNodeRegex)) {
        const workflowId = inferWorkflowId(match[1]);
        const nodeName = match[2];
        const workflowNodeId = normalizeRuntimeId(`WorkflowNode.${nodeName}`);

        knownWorkflowIds.set(match[1], workflowId);
        knownNodeIds.set(nodeName, workflowNodeId);

        nodes.push({
            id: workflowId,
            type: 'Workflow',
            label: workflowId.replace(/^Workflow\./, ''),
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.75)]
        });
        nodes.push({
            id: workflowNodeId,
            type: 'WorkflowNode',
            label: nodeName,
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.8)]
        });
        edges.push({
            from: workflowId,
            to: workflowNodeId,
            type: 'contains',
            confidence: 0.8,
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.8)]
        });
    }

    for (const match of file.content.matchAll(addEdgeRegex)) {
        const workflowId = knownWorkflowIds.get(match[1]) ?? inferWorkflowId(match[1]);
        const fromNodeId = knownNodeIds.get(match[2]) ?? normalizeRuntimeId(`WorkflowNode.${match[2]}`);
        const toNodeId = knownNodeIds.get(match[3]) ?? normalizeRuntimeId(`WorkflowNode.${match[3]}`);
        const edgeNodeId = normalizeRuntimeId(`WorkflowEdge.${match[2]}->${match[3]}`);

        nodes.push({
            id: workflowId,
            type: 'Workflow',
            label: workflowId.replace(/^Workflow\./, ''),
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.7)]
        });
        nodes.push({
            id: fromNodeId,
            type: 'WorkflowNode',
            label: match[2],
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.72)]
        });
        nodes.push({
            id: toNodeId,
            type: 'WorkflowNode',
            label: match[3],
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.72)]
        });
        nodes.push({
            id: edgeNodeId,
            type: 'WorkflowEdge',
            label: `${match[2]} -> ${match[3]}`,
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.68)]
        });
        edges.push({
            from: workflowId,
            to: edgeNodeId,
            type: 'contains',
            confidence: 0.68,
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.68)]
        });
        edges.push({
            from: fromNodeId,
            to: toNodeId,
            type: 'connects',
            confidence: 0.85,
            evidence: [lineEvidence(file, 'registry', match[0], match.index, 0.85)]
        });
    }

    for (const match of file.content.matchAll(dispatchRegex)) {
        const serviceId = inferServiceId(`${match[1]}.${match[2]}(`);
        const workflowToken = match[3];
        if (!workflowToken) {
            continue;
        }
        const workflowId = inferWorkflowId(workflowToken);
        nodes.push({
            id: serviceId,
            type: match[1].toLowerCase().includes('task') ? 'Task' : 'Service',
            label: serviceId.replace(/^(Service|Task)\./, ''),
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.55)]
        });
        nodes.push({
            id: workflowId,
            type: 'Workflow',
            label: workflowId.replace(/^Workflow\./, ''),
            sourcePath: file.relativePath,
            category: 'backend',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.55)]
        });
        edges.push({
            from: serviceId,
            to: workflowId,
            type: 'dispatches',
            confidence: 0.55,
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.55)]
        });
    }
}

function extractWorkflowManifests(
    file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number],
    nodes: RuntimeNode[],
    edges: RuntimeEdge[]
) {
    const content = file.content;
    if (!/(nodes|edges|steps|tasks|workflow|pipeline)/i.test(content)) {
        return;
    }

    const workflowNameMatch = content.match(/["']?(workflow|pipeline)["']?\s*[:=]\s*["']?([A-Za-z0-9._ -]+)["']?/i);
    const workflowName = workflowNameMatch?.[2] ?? file.relativePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'manifest';
    const workflowId = inferWorkflowId(workflowName);
    nodes.push({
        id: workflowId,
        type: 'Workflow',
        label: workflowName,
        sourcePath: file.relativePath,
        category: 'core',
        evidence: [lineEvidence(file, 'manifest', workflowNameMatch?.[0] ?? 'workflow manifest', workflowNameMatch?.index, 0.6)]
    });

    const nodeRegex = /["']?nodes?["']?\s*:\s*\[([\s\S]*?)\]/i;
    const nodesSection = content.match(nodeRegex)?.[1] ?? '';
    for (const match of nodesSection.matchAll(/["'`]([^"'`]+)["'`]/g)) {
        const workflowNodeId = normalizeRuntimeId(`WorkflowNode.${match[1]}`);
        nodes.push({
            id: workflowNodeId,
            type: 'WorkflowNode',
            label: match[1],
            sourcePath: file.relativePath,
            category: 'core',
            evidence: [lineEvidence(file, 'manifest', match[0], match.index, 0.6)]
        });
        edges.push({
            from: workflowId,
            to: workflowNodeId,
            type: 'contains',
            confidence: 0.6,
            evidence: [lineEvidence(file, 'manifest', match[0], match.index, 0.6)]
        });
    }

    const edgeRegex = /["']?edges?["']?\s*:\s*\[([\s\S]*?)\]/i;
    const edgesSection = content.match(edgeRegex)?.[1] ?? '';
    for (const match of edgesSection.matchAll(/["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) {
        const fromNodeId = normalizeRuntimeId(`WorkflowNode.${match[1]}`);
        const toNodeId = normalizeRuntimeId(`WorkflowNode.${match[2]}`);
        nodes.push({
            id: fromNodeId,
            type: 'WorkflowNode',
            label: match[1],
            sourcePath: file.relativePath,
            category: 'core',
            evidence: [lineEvidence(file, 'manifest', match[0], match.index, 0.58)]
        });
        nodes.push({
            id: toNodeId,
            type: 'WorkflowNode',
            label: match[2],
            sourcePath: file.relativePath,
            category: 'core',
            evidence: [lineEvidence(file, 'manifest', match[0], match.index, 0.58)]
        });
        edges.push({
            from: fromNodeId,
            to: toNodeId,
            type: 'connects',
            confidence: 0.58,
            evidence: [lineEvidence(file, 'manifest', match[0], match.index, 0.58)]
        });
    }
}

function inferWorkflowId(token: string) {
    const normalized = token.trim();
    if (WORKFLOW_KEYWORDS.some((keyword) => normalized.toLowerCase().includes(keyword))) {
        return normalizeRuntimeId(`Workflow.${normalized}`);
    }
    if (NODE_KEYWORDS.some((keyword) => normalized.toLowerCase().includes(keyword))) {
        return normalizeRuntimeId(`Workflow.${normalized}Workflow`);
    }
    return normalizeRuntimeId(`Workflow.${normalized}`);
}
