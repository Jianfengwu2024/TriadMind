import { RuntimeMap, RuntimeNodeType, RuntimeView } from './types';

const VIEW_NODE_TYPES: Record<Exclude<RuntimeView, 'full'>, RuntimeNodeType[]> = {
    workflow: ['Workflow', 'WorkflowNode', 'WorkflowEdge', 'Task', 'Worker', 'Queue', 'Service'],
    'request-flow': [
        'FrontendEntry',
        'FrontendComponent',
        'ApiRoute',
        'Service',
        'Task',
        'Worker',
        'Queue',
        'DataStore',
        'Cache',
        'ObjectStore',
        'ExternalApi'
    ],
    resources: [
        'Service',
        'WorkflowNode',
        'Task',
        'DataStore',
        'ObjectStore',
        'Cache',
        'FileSystem',
        'ExternalApi',
        'ExternalTool',
        'ModelProvider'
    ],
    events: ['MessageProducer', 'EventConsumer', 'Queue', 'Worker', 'Task'],
    infra: ['DataStore', 'ObjectStore', 'Cache', 'Queue', 'Config', 'Secret', 'Scheduler']
};

export function filterRuntimeMapByView(runtimeMap: RuntimeMap, view: RuntimeView): RuntimeMap {
    if (view === 'full') {
        return {
            ...runtimeMap,
            view
        };
    }

    const allowedTypes = new Set<RuntimeNodeType>(VIEW_NODE_TYPES[view]);
    const nodes = runtimeMap.nodes.filter((node) => allowedTypes.has(node.type));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = runtimeMap.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

    return {
        ...runtimeMap,
        view,
        nodes,
        edges
    };
}

export function normalizeRuntimeView(value: string | undefined, fallback: RuntimeView = 'full'): RuntimeView {
    if (
        value === 'workflow' ||
        value === 'request-flow' ||
        value === 'resources' ||
        value === 'events' ||
        value === 'infra' ||
        value === 'full'
    ) {
        return value;
    }

    return fallback;
}
