import { RuntimeEdge, RuntimeNode, RuntimeNodeType, RuntimeTopologyExtractor } from '../types';
import { inferServiceId, lineEvidence, normalizeRuntimeId } from '../runtimeUtils';

type ResourcePattern = {
    nodeId: string;
    nodeType: RuntimeNodeType;
    label: string;
    typeByCall?: (call: string) => RuntimeEdge['type'];
    patterns: RegExp[];
};

const RESOURCE_PATTERNS: ResourcePattern[] = [
    {
        nodeId: 'Cache.Redis',
        nodeType: 'Cache',
        label: 'Redis',
        typeByCall: (call) => (/\.get\(/i.test(call) ? 'reads' : /\.set\(|\.publish\(/i.test(call) ? 'writes' : 'caches'),
        patterns: [/\bimport\s+redis\b/i, /\bfrom\s+redis\s+import\b/i, /\baioredis\b/i, /\bredis\.(get|set|publish|delete)\(/gi]
    },
    {
        nodeId: 'DataStore.Postgres',
        nodeType: 'DataStore',
        label: 'Postgres',
        typeByCall: (call) => (/query|select|get/i.test(call) ? 'reads' : 'writes'),
        patterns: [/\bsqlalchemy\b/i, /\bpostgres\b/i, /\bsession\.(execute|query|add|commit)\(/gi, /\bdb\.(query|execute|insert|update)\(/gi]
    },
    {
        nodeId: 'DataStore.Mongo',
        nodeType: 'DataStore',
        label: 'MongoDB',
        typeByCall: (call) => (/find|get/i.test(call) ? 'reads' : 'writes'),
        patterns: [/\bpymongo\b/i, /\bMongoClient\b/i, /\bcollection\.(find|insert|update|delete)/gi]
    },
    {
        nodeId: 'ObjectStore.MinIO',
        nodeType: 'ObjectStore',
        label: 'MinIO',
        typeByCall: (call) => (/get_object|download|read/i.test(call) ? 'reads' : 'writes'),
        patterns: [/\bminio\b/i, /\bMinio\s*\(/gi, /\bclient\.(get_object|put_object|fget_object|fput_object)\(/gi]
    },
    {
        nodeId: 'ObjectStore.S3',
        nodeType: 'ObjectStore',
        label: 'S3',
        typeByCall: (call) => (/get_object|download|read/i.test(call) ? 'reads' : 'writes'),
        patterns: [/\bboto3\b/i, /\bS3Client\b/i, /\bput_object\(|\bget_object\(/gi]
    },
    {
        nodeId: 'ExternalApi.HTTP',
        nodeType: 'ExternalApi',
        label: 'HTTP API',
        typeByCall: () => 'calls',
        patterns: [/\brequests\.(get|post|put|delete)\(/gi, /\bhttpx\.(get|post|put|delete)\(/gi, /\bfetch\(/gi]
    },
    {
        nodeId: 'ModelProvider.OpenAI',
        nodeType: 'ModelProvider',
        label: 'OpenAI',
        typeByCall: () => 'uses_model',
        patterns: [/\bopenai\b/i, /\bOpenAI\b/i, /\bchat\.completions\b/i, /\bresponses\.create\(/i]
    },
    {
        nodeId: 'ExternalTool.subprocess',
        nodeType: 'ExternalTool',
        label: 'subprocess',
        typeByCall: () => 'uses_tool',
        patterns: [/\bsubprocess\.(run|Popen|call)\(/gi, /\bexecSync\(/gi, /\bspawn\(/gi]
    },
    {
        nodeId: 'FileSystem.Local',
        nodeType: 'FileSystem',
        label: 'Local file system',
        typeByCall: (call) => (/read/i.test(call) ? 'reads' : 'writes'),
        patterns: [/\bopen\(/gi, /\bfs\.(readFile|writeFile|createReadStream|createWriteStream)\(/gi]
    }
];

export const resourceAccessExtractor: RuntimeTopologyExtractor = {
    name: 'ResourceAccessExtractor',
    detect(context) {
        return context.files.some((file) =>
            RESOURCE_PATTERNS.some((pattern) =>
                pattern.patterns.some((expression) => new RegExp(expression.source, expression.flags).test(file.content))
            )
        );
    },
    extract(context) {
        const nodes: RuntimeNode[] = [];
        const edges: RuntimeEdge[] = [];

        for (const file of context.files) {
            for (const resource of RESOURCE_PATTERNS) {
                for (const expression of resource.patterns) {
                    expression.lastIndex = 0;
                    const matches = collectMatches(file.content, expression);
                    if (matches.length === 0) {
                        continue;
                    }

                    nodes.push({
                        id: resource.nodeId,
                        type: resource.nodeType,
                        label: resource.label,
                        category: resource.nodeType === 'ExternalApi' || resource.nodeType === 'ModelProvider' || resource.nodeType === 'ExternalTool' ? 'external' : 'infra',
                        sourcePath: file.relativePath,
                        evidence: matches.map((match) => lineEvidence(file, 'import', match[0], match.index, 0.65))
                    });

                    const ownerId = inferOwnerNode(file.relativePath, file.content, matches[0].index ?? 0);
                    nodes.push({
                        id: ownerId.id,
                        type: ownerId.type,
                        label: ownerId.id.replace(/^(Service|WorkflowNode|Task)\./, ''),
                        sourcePath: file.relativePath,
                        category: 'backend',
                        evidence: [lineEvidence(file, 'inferred', ownerId.anchor, ownerId.index, 0.5)]
                    });

                    for (const match of matches) {
                        edges.push({
                            from: ownerId.id,
                            to: resource.nodeId,
                            type: resource.typeByCall?.(match[0]) ?? 'depends_on',
                            confidence: 0.65,
                            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.65)]
                        });
                    }
                }
            }
        }

        return { nodes, edges };
    }
};

function inferOwnerNode(relativePath: string, content: string, accessIndex: number) {
    const prior = content.slice(0, accessIndex);
    const functionMatches = Array.from(prior.matchAll(/(?:async\s+def|def|function)\s+([A-Za-z_][\w]*)\s*\(|(?:async\s+)?([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/g));
    const latestFunction = functionMatches[functionMatches.length - 1];
    const classMatches = Array.from(prior.matchAll(/class\s+([A-Za-z_][\w]*)/g));
    const latestClass = classMatches[classMatches.length - 1];

    if (latestFunction) {
        const functionName = latestFunction[1] ?? latestFunction[2];
        const ownerType =
            /node|step|stage/i.test(functionName) ? 'WorkflowNode' : /task|worker/i.test(functionName) ? 'Task' : 'Service';
        return {
            id: normalizeRuntimeId(`${ownerType}.${functionName}`),
            type: ownerType as RuntimeNode['type'],
            index: latestFunction.index ?? 0,
            anchor: latestFunction[0]
        };
    }

    if (latestClass) {
        const className = latestClass[1];
        const ownerType =
            /node|step|stage/i.test(className) ? 'WorkflowNode' : /task|worker/i.test(className) ? 'Task' : 'Service';
        return {
            id: normalizeRuntimeId(`${ownerType}.${className}`),
            type: ownerType as RuntimeNode['type'],
            index: latestClass.index ?? 0,
            anchor: latestClass[0]
        };
    }

    return {
        id: inferServiceId(relativePath.replace(/\.[^.]+$/, '')),
        type: 'Service' as const,
        index: 0,
        anchor: relativePath
    };
}

function collectMatches(content: string, expression: RegExp) {
    const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
    return Array.from(content.matchAll(new RegExp(expression.source, flags)));
}
