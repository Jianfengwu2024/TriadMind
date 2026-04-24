import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePaths } from './workspace';

export type GovernMetricKey =
    | 'diagnostics_no_code'
    | 'execute_like_ratio'
    | 'ghost_ratio'
    | 'rendered_edges_consistency'
    | 'runtime_unmatched_route_count';

export type GovernRuleOperator = 'eq' | 'lt' | 'lte' | 'lte_baseline_factor';

export type ForbiddenRunMutation = 'modify_policy' | 'modify_baseline';

export interface GovernMetricRule {
    op: GovernRuleOperator;
    value: number | boolean;
}

export interface GovernLanguageGhostPolicy {
    include_in_demand: boolean;
    top_k: number;
    min_confidence: number | 'low' | 'medium' | 'high';
}

export interface GovernPolicy {
    version: string;
    mode: 'hard';
    must_pass: Record<string, GovernMetricRule>;
    language_ghost_policy?: Record<string, GovernLanguageGhostPolicy>;
    forbidden_in_run?: ForbiddenRunMutation[];
    baseline_path?: string;
}

export const DEFAULT_GOVERN_POLICY: GovernPolicy = {
    version: '1.0',
    mode: 'hard',
    must_pass: {
        diagnostics_no_code: { op: 'eq', value: 0 },
        execute_like_ratio: { op: 'lt', value: 0.1 },
        ghost_ratio: { op: 'lt', value: 0.4 },
        rendered_edges_consistency: { op: 'eq', value: true },
        runtime_unmatched_route_count: { op: 'lte_baseline_factor', value: 1.1 }
    },
    language_ghost_policy: {
        python: { include_in_demand: false, top_k: 0, min_confidence: 'high' },
        javascript: { include_in_demand: false, top_k: 0, min_confidence: 'high' },
        typescript: { include_in_demand: true, top_k: 5, min_confidence: 'high' },
        java: { include_in_demand: true, top_k: 5, min_confidence: 'high' },
        go: { include_in_demand: true, top_k: 5, min_confidence: 'high' },
        rust: { include_in_demand: true, top_k: 8, min_confidence: 'high' }
    },
    forbidden_in_run: ['modify_policy', 'modify_baseline']
};

export function buildDefaultGovernPolicy(): GovernPolicy {
    return JSON.parse(JSON.stringify(DEFAULT_GOVERN_POLICY)) as GovernPolicy;
}

export function resolveGovernPolicyPath(paths: WorkspacePaths, overridePath?: string) {
    const raw = String(overridePath ?? '').trim();
    if (!raw) {
        return paths.governPolicyFile;
    }
    return path.isAbsolute(raw) ? raw : path.resolve(paths.projectRoot, raw);
}

export function ensureGovernPolicyFile(paths: WorkspacePaths) {
    if (fs.existsSync(paths.governPolicyFile)) {
        return;
    }

    fs.mkdirSync(path.dirname(paths.governPolicyFile), { recursive: true });
    fs.writeFileSync(paths.governPolicyFile, JSON.stringify(buildDefaultGovernPolicy(), null, 2), 'utf-8');
}

