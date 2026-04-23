import { RuntimeEdge, RuntimeNode, RuntimeTopologyExtractor } from '../types';
import { inferServiceId, lineEvidence, normalizeRuntimeId } from '../runtimeUtils';

export const taskQueueExtractor: RuntimeTopologyExtractor = {
    name: 'TaskQueueExtractor',
    detect(context) {
        const hint = context.frameworkHint?.toLowerCase();
        return (
            hint === 'celery' ||
            hint === 'rq' ||
            hint === 'bullmq' ||
            context.files.some((file) => /@(?:celery|app|shared_task)\.task|@shared_task|\.delay\(|\.apply_async\(|queue\.enqueue\(|new\s+Worker\(|queue\.add\(/.test(file.content))
        );
    },
    extract(context) {
        const nodes: RuntimeNode[] = [];
        const edges: RuntimeEdge[] = [];

        for (const file of context.files) {
            if (file.language === 'python') {
                extractCelery(file, nodes, edges);
                extractRq(file, nodes, edges);
            }
            if (file.language === 'typescript' || file.language === 'javascript') {
                extractBullMq(file, nodes, edges);
            }
        }

        return { nodes, edges };
    }
};

function extractCelery(file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number], nodes: RuntimeNode[], edges: RuntimeEdge[]) {
    const taskRegex = /@(?:(?:celery|app)\.task|shared_task)(?:\([^)]*\))?\s*(?:\r?\n\s*)+def\s+([A-Za-z_][\w]*)\s*\(/g;
    for (const match of file.content.matchAll(taskRegex)) {
        const taskName = match[1];
        const taskId = normalizeRuntimeId(`Task.${taskName}`);
        const queueId = 'Queue.Celery';
        const workerId = 'Worker.Celery';
        const body = readFunctionBody(file.content, match.index ?? 0);

        nodes.push({
            id: taskId,
            type: 'Task',
            label: taskName,
            sourcePath: file.relativePath,
            category: 'backend',
            framework: 'celery',
            evidence: [lineEvidence(file, 'decorator', match[0], match.index, 0.95)]
        });
        nodes.push({
            id: queueId,
            type: 'Queue',
            label: 'Celery',
            category: 'infra',
            framework: 'celery',
            evidence: [lineEvidence(file, 'convention', match[0], match.index, 0.55)]
        });
        nodes.push({
            id: workerId,
            type: 'Worker',
            label: 'Celery worker',
            category: 'backend',
            framework: 'celery',
            evidence: [lineEvidence(file, 'convention', match[0], match.index, 0.55)]
        });
        edges.push({
            from: workerId,
            to: queueId,
            type: 'consumes',
            confidence: 0.55,
            evidence: [lineEvidence(file, 'convention', match[0], match.index, 0.55)]
        });
        edges.push({
            from: queueId,
            to: taskId,
            type: 'dispatches',
            confidence: 0.6,
            evidence: [lineEvidence(file, 'convention', match[0], match.index, 0.6)]
        });

        for (const call of findServiceOrWorkflowCalls(body)) {
            const targetId = inferServiceId(call.text);
            nodes.push({
                id: targetId,
                type: targetId.toLowerCase().includes('workflow') ? 'Workflow' : 'Service',
                label: targetId.replace(/^(Service|Workflow)\./, ''),
                sourcePath: file.relativePath,
                category: 'backend',
                evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.62)]
            });
            edges.push({
                from: taskId,
                to: targetId,
                type: 'executes',
                confidence: 0.62,
                evidence: [lineEvidence(file, 'call', call.text, (match.index ?? 0) + call.index, 0.62)]
            });
        }
    }

    const enqueueRegex = /\b([A-Za-z_][\w]*)\.(delay|apply_async)\s*\(/g;
    for (const match of file.content.matchAll(enqueueRegex)) {
        const taskId = normalizeRuntimeId(`Task.${match[1]}`);
        const queueId = 'Queue.Celery';
        nodes.push({
            id: taskId,
            type: 'Task',
            label: match[1],
            sourcePath: file.relativePath,
            framework: 'celery',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.65)]
        });
        nodes.push({
            id: queueId,
            type: 'Queue',
            label: 'Celery',
            category: 'infra',
            framework: 'celery',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.65)]
        });
        edges.push({
            from: inferCallerNode(file.relativePath),
            to: taskId,
            type: 'enqueues',
            confidence: 0.55,
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.55)]
        });
        edges.push({
            from: taskId,
            to: queueId,
            type: 'depends_on',
            confidence: 0.45,
            evidence: [lineEvidence(file, 'inferred', match[0], match.index, 0.45)]
        });
    }
}

function extractRq(file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number], nodes: RuntimeNode[], edges: RuntimeEdge[]) {
    const enqueueRegex = /\b([A-Za-z_][\w]*)\.enqueue\(\s*([A-Za-z_][\w.]*)/g;
    for (const match of file.content.matchAll(enqueueRegex)) {
        const queueId = normalizeRuntimeId(`Queue.${match[1]}`);
        const taskId = normalizeRuntimeId(`Task.${match[2].split('.').pop() ?? match[2]}`);
        nodes.push({
            id: queueId,
            type: 'Queue',
            label: match[1],
            sourcePath: file.relativePath,
            framework: 'rq',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.75)]
        });
        nodes.push({
            id: taskId,
            type: 'Task',
            label: taskId.replace(/^Task\./, ''),
            sourcePath: file.relativePath,
            framework: 'rq',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.75)]
        });
        edges.push({
            from: inferCallerNode(file.relativePath),
            to: taskId,
            type: 'enqueues',
            confidence: 0.65,
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.65)]
        });
    }
}

function extractBullMq(file: Parameters<RuntimeTopologyExtractor['extract']>[0]['files'][number], nodes: RuntimeNode[], edges: RuntimeEdge[]) {
    const workerRegex = /new\s+Worker\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of file.content.matchAll(workerRegex)) {
        const queueId = normalizeRuntimeId(`Queue.${match[1]}`);
        const workerId = normalizeRuntimeId(`Worker.${match[1]}`);
        nodes.push({
            id: queueId,
            type: 'Queue',
            label: match[1],
            sourcePath: file.relativePath,
            framework: 'bullmq',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.85)]
        });
        nodes.push({
            id: workerId,
            type: 'Worker',
            label: `${match[1]} worker`,
            sourcePath: file.relativePath,
            framework: 'bullmq',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.85)]
        });
        edges.push({
            from: workerId,
            to: queueId,
            type: 'consumes',
            confidence: 0.8,
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.8)]
        });
    }

    const addRegex = /\b([A-Za-z_][\w]*)\.add\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of file.content.matchAll(addRegex)) {
        const queueId = normalizeRuntimeId(`Queue.${match[1]}`);
        const taskId = normalizeRuntimeId(`Task.${match[2]}`);
        nodes.push({
            id: queueId,
            type: 'Queue',
            label: match[1],
            sourcePath: file.relativePath,
            framework: 'bullmq',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.75)]
        });
        nodes.push({
            id: taskId,
            type: 'Task',
            label: match[2],
            sourcePath: file.relativePath,
            framework: 'bullmq',
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.75)]
        });
        edges.push({
            from: inferCallerNode(file.relativePath),
            to: taskId,
            type: 'enqueues',
            confidence: 0.65,
            evidence: [lineEvidence(file, 'call', match[0], match.index, 0.65)]
        });
    }
}

function readFunctionBody(content: string, startIndex: number) {
    const signatureEnd = content.indexOf(':\n', startIndex);
    const bodyStart = signatureEnd >= 0 ? signatureEnd + 2 : startIndex;
    const nextMatch = content.slice(bodyStart).match(/\n\s*(?:@|def\s+|async\s+def\s+)/);
    const end = nextMatch?.index === undefined ? content.length : bodyStart + nextMatch.index;
    return content.slice(bodyStart, end);
}

function findServiceOrWorkflowCalls(body: string) {
    const calls: Array<{ text: string; index: number }> = [];
    const callRegex = /\b([A-Za-z_][\w]*(?:service|Service|workflow|Workflow|_service))\.([A-Za-z_][\w]*)\s*\(/g;
    for (const match of body.matchAll(callRegex)) {
        calls.push({ text: match[0], index: match.index ?? 0 });
    }
    return calls;
}

function inferCallerNode(relativePath: string) {
    return normalizeRuntimeId(`Service.${relativePath.replace(/\.[^.]+$/, '')}`);
}
