import { TriadLanguage } from './config';
import { parseNodeRef, TriadNodeDefinition } from './protocol';

export interface TriadOperationIR {
    nodeId: string;
    name: string;
    demand: string[];
    answer: string[];
    responsibility: string;
}

export interface TriadVertexIR {
    nodeId: string;
    category?: string;
    sourcePath?: string;
    container: {
        kind: 'class' | 'module';
        name: string;
    };
    staticRightBranch: string[];
    dynamicLeftBranch: TriadOperationIR[];
}

export interface TriadTopologyIR {
    language: TriadLanguage;
    vertices: TriadVertexIR[];
}

export function buildTopologyIR(nodes: TriadNodeDefinition[], language: TriadLanguage): TriadTopologyIR {
    const vertexMap = new Map<string, TriadVertexIR>();

    for (const node of nodes) {
        const ref = parseNodeRef(node.nodeId, node.category);
        const vertexKey = `${node.category ?? 'core'}:${ref.className}:${node.sourcePath ?? ''}`;
        const existing =
            vertexMap.get(vertexKey) ??
            {
                nodeId: `${ref.className}`,
                category: node.category,
                sourcePath: node.sourcePath,
                container: {
                    kind: node.sourcePath ? 'class' : 'module',
                    name: ref.className
                },
                staticRightBranch: dedupeStrings(node.fission.demand),
                dynamicLeftBranch: []
            };

        existing.staticRightBranch = dedupeStrings([...existing.staticRightBranch, ...node.fission.demand]);
        existing.dynamicLeftBranch.push({
            nodeId: node.nodeId,
            name: ref.methodName,
            demand: node.fission.demand,
            answer: node.fission.answer,
            responsibility: node.fission.problem
        });

        vertexMap.set(vertexKey, existing);
    }

    return {
        language,
        vertices: Array.from(vertexMap.values()).sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    };
}

function dedupeStrings(values: string[]) {
    return Array.from(new Set(values));
}
