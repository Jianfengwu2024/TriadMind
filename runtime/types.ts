import { TriadConfig } from '../config';

export type RuntimeNodeType =
    | 'FrontendEntry'
    | 'FrontendComponent'
    | 'ApiRoute'
    | 'CliCommand'
    | 'RpcEndpoint'
    | 'EventConsumer'
    | 'MessageProducer'
    | 'Workflow'
    | 'WorkflowNode'
    | 'WorkflowEdge'
    | 'Service'
    | 'Worker'
    | 'Task'
    | 'Queue'
    | 'Scheduler'
    | 'DataStore'
    | 'ObjectStore'
    | 'Cache'
    | 'FileSystem'
    | 'ExternalApi'
    | 'ExternalTool'
    | 'ModelProvider'
    | 'Kernel'
    | 'Plugin'
    | 'Config'
    | 'Secret'
    | 'UnknownRuntime';

export type RuntimeEdgeType =
    | 'calls'
    | 'invokes'
    | 'dispatches'
    | 'publishes'
    | 'subscribes'
    | 'enqueues'
    | 'consumes'
    | 'schedules'
    | 'contains'
    | 'connects'
    | 'reads'
    | 'writes'
    | 'caches'
    | 'loads_config'
    | 'uses_secret'
    | 'uses_tool'
    | 'uses_model'
    | 'executes'
    | 'returns_to'
    | 'depends_on';

export interface RuntimeEvidence {
    sourcePath?: string;
    line?: number;
    column?: number;
    kind: 'decorator' | 'call' | 'import' | 'config' | 'env' | 'registry' | 'manifest' | 'convention' | 'inferred';
    text?: string;
    confidence?: number;
}

export interface RuntimeNode {
    id: string;
    type: RuntimeNodeType;
    label: string;
    sourcePath?: string;
    category?: 'frontend' | 'backend' | 'core' | 'infra' | 'external';
    framework?: string;
    metadata?: Record<string, unknown>;
    evidence?: RuntimeEvidence[];
}

export interface RuntimeEdge {
    id?: string;
    from: string;
    to: string;
    type: RuntimeEdgeType;
    label?: string;
    metadata?: Record<string, unknown>;
    evidence?: RuntimeEvidence[];
    confidence?: number;
}

export type RuntimeView = 'workflow' | 'request-flow' | 'resources' | 'events' | 'infra' | 'full';

export interface RuntimeDiagnostic {
    level: 'info' | 'warning' | 'error';
    code: string;
    extractor: string;
    message: string;
    sourcePath?: string;
}

export interface RuntimeMap {
    schemaVersion: '1.0';
    project: string;
    generatedAt: string;
    view?: RuntimeView;
    nodes: RuntimeNode[];
    edges: RuntimeEdge[];
    diagnostics?: RuntimeDiagnostic[];
}

export type RuntimeSourceLanguage =
    | 'python'
    | 'typescript'
    | 'javascript'
    | 'json'
    | 'yaml'
    | 'toml'
    | 'dockerfile'
    | 'unknown';

export interface RuntimeSourceFile {
    absolutePath: string;
    relativePath: string;
    language: RuntimeSourceLanguage;
    content: string;
}

export interface RuntimeExtractContext {
    projectRoot: string;
    config: TriadConfig;
    view: RuntimeView;
    includeFrontend: boolean;
    includeInfra: boolean;
    frameworkHint?: string;
    files: RuntimeSourceFile[];
}

export interface RuntimeTopologyPatch {
    nodes?: RuntimeNode[];
    edges?: RuntimeEdge[];
    diagnostics?: RuntimeDiagnostic[];
}

export interface RuntimeTopologyExtractor {
    name: string;
    detect(context: RuntimeExtractContext): boolean | Promise<boolean>;
    extract(context: RuntimeExtractContext): RuntimeTopologyPatch | Promise<RuntimeTopologyPatch>;
}

export interface RuntimeExtractOptions {
    view?: RuntimeView;
    includeFrontend?: boolean;
    includeInfra?: boolean;
    frameworkHint?: string;
    extractors?: RuntimeTopologyExtractor[];
}

export interface RuntimeConfig {
    enabled: boolean;
    defaultView: RuntimeView;
    includeFrontend: boolean;
    includeInfra: boolean;
    frameworkHints: string[];
    excludePathPatterns: string[];
    maxSourceFileBytes: number;
    maxScannedFiles: number;
    failOnExtractorError: boolean;
    minConfidence: number;
}
