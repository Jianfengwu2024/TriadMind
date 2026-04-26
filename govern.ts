import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CoverageReport, runCoverage } from './coverage';
import {
    GovernCoverageRule,
    ForbiddenRunMutation,
    GovernLanguageGhostPolicy,
    GovernMetricRule,
    GovernPolicy,
    GovernRuleOperator,
    resolveGovernPolicyPath
} from './governPolicy';
import { runTopologyVerify, VerifyMetrics } from './verify';
import { WorkspacePaths } from './workspace';

const REQUIRED_GOVERN_METRICS = [
    'diagnostics_no_code',
    'execute_like_ratio',
    'ghost_ratio',
    'rendered_edges_consistency',
    'runtime_unmatched_route_count'
] as const;

const REQUIRED_RUNTIME_ARTIFACTS: Array<{ key: string; pathResolver: (paths: WorkspacePaths) => string }> = [
    { key: 'triad-map.json', pathResolver: (paths) => paths.mapFile },
    { key: 'runtime-map.json', pathResolver: (paths) => paths.runtimeMapFile },
    { key: 'runtime-diagnostics.json', pathResolver: (paths) => paths.runtimeDiagnosticsFile }
];

const GHOST_DEMAND_PATTERN = /^\[Ghost:[^\]]+\]/i;
const DEFAULT_BASELINE_FACTOR = 1.1;

export const GOVERN_EXIT_CODES = {
    pass: 0,
    gate_fail: 2,
    policy_invalid: 3,
    artifact_missing: 4,
    metric_unavailable: 5,
    forbidden_change_detected: 6,
    llm_fix_failed_or_not_improved: 7
} as const;

export type GovernExitCode = (typeof GOVERN_EXIT_CODES)[keyof typeof GOVERN_EXIT_CODES];
export type GovernMode = 'check' | 'ci' | 'fix';

export interface GovernRunOptions {
    mode: GovernMode;
    policyPath?: string;
    llm?: string;
    maxIterations?: number;
    dryRun?: boolean;
}

export interface GovernCheckResult {
    key: string;
    status: 'pass' | 'fail' | 'error';
    expected: number | boolean | string;
    actual: number | boolean | string | null;
    detail: string;
    mustPass: boolean;
}

export interface GovernReport {
    schemaVersion: '1.0';
    generatedAt: string;
    durationMs: number;
    mode: GovernMode;
    strict: true;
    projectRoot: string;
    policyPath: string;
    policyVersion?: string;
    policyMode?: string;
    passed: boolean;
    exitCode: GovernExitCode;
    checks: GovernCheckResult[];
    metrics: Record<string, unknown>;
    artifacts: {
        triadMapFile: string;
        runtimeMapFile: string;
        runtimeDiagnosticsFile: string;
        coverageReportFile: string;
        governReportFile: string;
        governAuditFile: string;
        governFixesFile?: string;
    };
    baseline?: {
        path: string;
        runtime_unmatched_route_count: number;
    };
    policyViolations: string[];
    forbiddenChanges: string[];
    failures: string[];
}

export interface GovernExecutionResult {
    exitCode: GovernExitCode;
    report: GovernReport;
}

interface GovernLanguagePolicyNormalized {
    includeInDemand: boolean;
    topK: number;
    minConfidence: number;
}

interface GovernCoverageRuleNormalized {
    metric: 'triad' | 'runtime' | 'combined';
    op: 'gt' | 'gte';
    value: number;
    mustPass: boolean;
}

interface GovernPolicyNormalized {
    version: string;
    mode: 'hard';
    mustPass: Record<string, GovernMetricRule>;
    languageGhostPolicy: Record<string, GovernLanguagePolicyNormalized>;
    coverageByRoot: Record<string, GovernCoverageRuleNormalized>;
    forbiddenInRun: Set<ForbiddenRunMutation>;
    baselinePath?: string;
}

interface TriadNodeLike {
    nodeId?: string;
    sourcePath?: string;
    fission?: {
        demand?: unknown[];
        evidence?: {
            ghostReads?: Array<{
                retainedInDemand?: boolean;
                score?: number;
            }>;
        };
    };
}

interface RuntimeDiagnosticLike {
    level?: string;
    code?: string;
    extractor?: string;
    message?: string;
}

interface FileFingerprint {
    path: string;
    exists: boolean;
    hash: string;
}

interface ForbiddenFileSnapshot {
    policy: FileFingerprint;
    baseline: FileFingerprint;
}

export function runGovern(paths: WorkspacePaths, options: GovernRunOptions): GovernExecutionResult {
    const startedAt = Date.now();
    const auditLines: string[] = [];
    const report = createBaseReport(paths, options.mode, resolveGovernPolicyPath(paths, options.policyPath));
    const addAudit = (message: string) => auditLines.push(`[${new Date().toISOString()}] ${message}`);

    addAudit(`govern ${options.mode} start`);
    addAudit(`policy path ${report.policyPath}`);

    if (!options.policyPath && !fs.existsSync(report.policyPath)) {
        addAudit('default policy file missing; govern command will fail closed');
    }

    const loadedPolicy = loadGovernPolicy(report.policyPath);
    if (!loadedPolicy.policy) {
        report.failures.push(loadedPolicy.error ?? `Invalid govern policy: ${report.policyPath}`);
        report.checks.push({
            key: 'govern_policy_valid',
            status: 'error',
            expected: 'valid hard policy',
            actual: null,
            detail: loadedPolicy.error ?? 'Unknown policy validation error',
            mustPass: true
        });
        report.exitCode = GOVERN_EXIT_CODES.policy_invalid;
        report.passed = false;
        addAudit(`policy invalid: ${loadedPolicy.error ?? 'unknown error'}`);
        return finalizeGovernRun(paths, report, auditLines, options, startedAt);
    }

    report.policyVersion = loadedPolicy.policy.version;
    report.policyMode = loadedPolicy.policy.mode;
    addAudit(`policy loaded version=${loadedPolicy.policy.version}`);

    const missingArtifacts = REQUIRED_RUNTIME_ARTIFACTS.filter((item) => !fs.existsSync(item.pathResolver(paths)));
    if (missingArtifacts.length > 0) {
        const missingKeys = missingArtifacts.map((item) => item.key);
        report.failures.push(`Missing required artifact(s): ${missingKeys.join(', ')}`);
        report.checks.push({
            key: 'required_artifacts_present',
            status: 'error',
            expected: 'all required runtime artifacts exist',
            actual: `missing: ${missingKeys.join(', ')}`,
            detail: missingKeys.map((key) => `${key} missing`).join('; '),
            mustPass: true
        });
        report.exitCode = GOVERN_EXIT_CODES.artifact_missing;
        report.passed = false;
        addAudit(`artifact missing: ${missingKeys.join(', ')}`);
        return finalizeGovernRun(paths, report, auditLines, options, startedAt);
    }

    const baselinePath = resolveBaselinePath(paths, loadedPolicy.policy, report.policyPath);
    const forbiddenBefore = captureForbiddenSnapshot(report.policyPath, baselinePath);

    const verifyReport = runTopologyVerify(paths, {
        strict: true,
        baselinePath
    });
    const coverageReport = runCoverage(paths);

    const metrics = { ...(verifyReport.metrics as VerifyMetrics) } as Record<string, unknown>;
    metrics.coverage_summary = {
        triad: coverageReport.summary.triadCoverage,
        runtime: coverageReport.summary.runtimeCoverage,
        combined: coverageReport.summary.combinedCoverage,
        total_source_files: coverageReport.summary.totalSourceFiles
    };
    metrics.coverage_by_root = buildCoverageMetricSnapshot(coverageReport);
    metrics.view_mapping_summary = buildViewMapMetricSnapshot(paths.viewMapFile);
    const diagnosticsShapeErrors = validateRuntimeDiagnosticsShape(paths.runtimeDiagnosticsFile);
    if (diagnosticsShapeErrors.length > 0) {
        report.checks.push({
            key: 'runtime_diagnostics_schema_valid',
            status: 'error',
            expected: 'level/code/extractor/message present in every diagnostic',
            actual: diagnosticsShapeErrors.length,
            detail: diagnosticsShapeErrors.slice(0, 5).join('; '),
            mustPass: true
        });
        report.failures.push(`Invalid runtime diagnostics schema: ${diagnosticsShapeErrors[0]}`);
    } else {
        report.checks.push({
            key: 'runtime_diagnostics_schema_valid',
            status: 'pass',
            expected: true,
            actual: true,
            detail: 'All runtime diagnostics include level/code/extractor/message',
            mustPass: true
        });
    }

    const mustPassEvaluation = evaluateMustPassRules(loadedPolicy.policy, metrics, baselinePath);
    report.checks.push(...mustPassEvaluation.checks);
    report.baseline = mustPassEvaluation.baseline;
    mustPassEvaluation.errors.forEach((item) => report.failures.push(item));
    report.checks.push(...evaluateCoverageRules(loadedPolicy.policy.coverageByRoot, coverageReport));

    const triadNodes = readTriadNodes(paths.mapFile);
    const languagePolicy = evaluateLanguageGhostPolicy(triadNodes, loadedPolicy.policy.languageGhostPolicy);
    report.policyViolations = languagePolicy.violations;
    report.checks.push({
        key: 'language_ghost_policy_compliance',
        status: languagePolicy.violations.length > 0 ? 'fail' : 'pass',
        expected: true,
        actual: languagePolicy.violations.length === 0,
        detail:
            languagePolicy.violations.length > 0
                ? languagePolicy.violations.slice(0, 5).join('; ')
                : 'Language ghost policy constraints satisfied',
        mustPass: true
    });
    metrics.language_ghost_policy_violations = languagePolicy.violations.length;
    metrics.language_ghost_policy_violation_samples = languagePolicy.violations.slice(0, 10);

    report.metrics = metrics;

    const hasMetricErrors = report.checks.some((check) => check.status === 'error');
    const hasGateFailures = report.checks.some((check) => check.mustPass && check.status === 'fail');
    const hasPolicyViolations = report.policyViolations.length > 0;

    if (options.mode === 'fix') {
        const patchBody = buildFixPatch(report, options, baselinePath);
        fs.mkdirSync(path.dirname(paths.governFixesFile), { recursive: true });
        fs.writeFileSync(paths.governFixesFile, patchBody, 'utf-8');
        addAudit(`fix patch written: ${paths.governFixesFile}`);
    }

    const forbiddenAfter = captureForbiddenSnapshot(report.policyPath, baselinePath);
    const forbiddenChanges = detectForbiddenChanges(forbiddenBefore, forbiddenAfter, loadedPolicy.policy.forbiddenInRun);
    report.forbiddenChanges = forbiddenChanges;

    if (forbiddenChanges.length > 0) {
        report.exitCode = GOVERN_EXIT_CODES.forbidden_change_detected;
        report.passed = false;
        report.failures.push(...forbiddenChanges);
        addAudit(`forbidden changes detected: ${forbiddenChanges.join(', ')}`);
    } else if (hasMetricErrors) {
        report.exitCode = GOVERN_EXIT_CODES.metric_unavailable;
        report.passed = false;
        addAudit('metric unavailable errors detected');
    } else if (options.mode === 'fix') {
        if (!hasGateFailures && !hasPolicyViolations) {
            report.exitCode = GOVERN_EXIT_CODES.pass;
            report.passed = true;
            addAudit('fix mode passed without additional patch requirement');
        } else {
            report.exitCode = GOVERN_EXIT_CODES.llm_fix_failed_or_not_improved;
            report.passed = false;
            report.failures.push(
                options.dryRun
                    ? 'Dry-run fix generated patch but did not apply changes'
                    : `Auto-fix did not improve must_pass checks (llm=${options.llm ?? 'not-set'})`
            );
            addAudit('fix mode ended without gate improvement');
        }
    } else if (hasGateFailures || hasPolicyViolations) {
        report.exitCode = GOVERN_EXIT_CODES.gate_fail;
        report.passed = false;
        addAudit('gate fail');
    } else {
        report.exitCode = GOVERN_EXIT_CODES.pass;
        report.passed = true;
        addAudit('gate pass');
    }

    return finalizeGovernRun(paths, report, auditLines, options, startedAt);
}

export function formatGovernReport(report: GovernReport) {
    const summary = report.passed ? 'PASS' : `FAIL(code=${report.exitCode})`;
    const lines = [
        `TriadMind Govern (${summary})`,
        `mode=${report.mode}, strict=true, policy=${report.policyPath}`,
        `generatedAt=${report.generatedAt}, durationMs=${report.durationMs}`,
        `checks=${report.checks.length}, failures=${report.failures.length}, policyViolations=${report.policyViolations.length}`,
        `artifacts: report=${report.artifacts.governReportFile}, audit=${report.artifacts.governAuditFile}${
            report.artifacts.governFixesFile ? `, fixes=${report.artifacts.governFixesFile}` : ''
        }`
    ];
    for (const check of report.checks) {
        const icon = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'ERROR';
        lines.push(`[${icon}] ${check.key} | expected=${check.expected} | actual=${check.actual ?? '-'} | ${check.detail}`);
    }
    if (report.policyViolations.length > 0) {
        lines.push(`policy_violations=${report.policyViolations.slice(0, 8).join('; ')}`);
    }
    if (report.forbiddenChanges.length > 0) {
        lines.push(`forbidden_changes=${report.forbiddenChanges.join('; ')}`);
    }
    return lines.join('\n');
}

function finalizeGovernRun(
    paths: WorkspacePaths,
    report: GovernReport,
    auditLines: string[],
    options: GovernRunOptions,
    startedAt: number
): GovernExecutionResult {
    report.durationMs = Math.max(0, Date.now() - startedAt);
    report.generatedAt = new Date().toISOString();
    auditLines.push(`[${new Date().toISOString()}] finalize exitCode=${report.exitCode}`);

    if (options.mode === 'fix' && !fs.existsSync(paths.governFixesFile)) {
        fs.mkdirSync(path.dirname(paths.governFixesFile), { recursive: true });
        fs.writeFileSync(
            paths.governFixesFile,
            buildFixPatch(report, options, report.baseline?.path ?? paths.verifyBaselineFile),
            'utf-8'
        );
    }

    const artifactWriteResult = writeGovernArtifacts(paths, report, auditLines, options.mode);
    if (artifactWriteResult.missing.length > 0) {
        report.failures.push(`Govern output artifact(s) missing: ${artifactWriteResult.missing.join(', ')}`);
        report.checks.push({
            key: 'govern_artifacts_written',
            status: 'error',
            expected: 'all govern output artifacts exist',
            actual: `missing: ${artifactWriteResult.missing.join(', ')}`,
            detail: 'govern-report/govern-audit/govern-fixes must exist after run',
            mustPass: true
        });
        report.exitCode = GOVERN_EXIT_CODES.artifact_missing;
        report.passed = false;
        report.durationMs = Math.max(0, Date.now() - startedAt);
        report.generatedAt = new Date().toISOString();
        writeGovernArtifacts(paths, report, auditLines, options.mode);
    }

    return {
        exitCode: report.exitCode,
        report
    };
}

function createBaseReport(paths: WorkspacePaths, mode: GovernMode, policyPath: string): GovernReport {
    return {
        schemaVersion: '1.0',
        generatedAt: new Date().toISOString(),
        durationMs: 0,
        mode,
        strict: true,
        projectRoot: paths.projectRoot,
        policyPath,
        passed: false,
        exitCode: GOVERN_EXIT_CODES.gate_fail,
        checks: [],
        metrics: {},
        artifacts: {
            triadMapFile: paths.mapFile,
            runtimeMapFile: paths.runtimeMapFile,
            runtimeDiagnosticsFile: paths.runtimeDiagnosticsFile,
            coverageReportFile: paths.coverageReportFile,
            governReportFile: paths.governReportFile,
            governAuditFile: paths.governAuditFile,
            governFixesFile: mode === 'fix' ? paths.governFixesFile : undefined
        },
        policyViolations: [],
        forbiddenChanges: [],
        failures: []
    };
}

function evaluateMustPassRules(
    policy: GovernPolicyNormalized,
    metrics: Record<string, unknown>,
    baselinePath: string
): {
    checks: GovernCheckResult[];
    errors: string[];
    baseline?: { path: string; runtime_unmatched_route_count: number };
} {
    const checks: GovernCheckResult[] = [];
    const errors: string[] = [];
    let baselineCount: number | undefined;

    for (const key of REQUIRED_GOVERN_METRICS) {
        const rule = policy.mustPass[key];
        if (!rule) {
            checks.push({
                key,
                status: 'error',
                expected: 'govern policy must define this rule',
                actual: null,
                detail: `must_pass.${key} is required in hard mode`,
                mustPass: true
            });
            errors.push(`Missing hard-mode must_pass rule: ${key}`);
            continue;
        }

        const actual = metrics[key];
        const evaluated = evaluateSingleRule(key, actual, rule, baselinePath, baselineCount);
        checks.push(evaluated.check);
        if (evaluated.error) {
            errors.push(evaluated.error);
        }
        if (typeof evaluated.baselineCount === 'number') {
            baselineCount = evaluated.baselineCount;
        }
    }

    return {
        checks,
        errors,
        baseline:
            typeof baselineCount === 'number'
                ? {
                      path: baselinePath,
                      runtime_unmatched_route_count: baselineCount
                  }
                : undefined
    };
}

function evaluateSingleRule(
    key: string,
    actual: unknown,
    rule: GovernMetricRule,
    baselinePath: string,
    cachedBaselineCount?: number
): {
    check: GovernCheckResult;
    error?: string;
    baselineCount?: number;
} {
    if (rule.op === 'lte_baseline_factor') {
        const actualNumber = toFiniteNumber(actual);
        if (typeof actualNumber !== 'number') {
            return {
                check: metricUnavailableCheck(
                    key,
                    `Metric "${key}" is not available for lte_baseline_factor evaluation`,
                    rule.value
                ),
                error: `Metric unavailable: ${key}`
            };
        }
        const baselineCount = typeof cachedBaselineCount === 'number' ? cachedBaselineCount : readBaselineCount(baselinePath);
        if (typeof baselineCount !== 'number') {
            return {
                check: metricUnavailableCheck(
                    key,
                    `Baseline unavailable at ${baselinePath} for lte_baseline_factor`,
                    rule.value
                ),
                error: `Baseline unavailable for ${key}: ${baselinePath}`
            };
        }

        const factor = toFiniteNumber(rule.value);
        const safeFactor = typeof factor === 'number' && factor > 0 ? factor : DEFAULT_BASELINE_FACTOR;
        const expectedLimit = Math.max(0, Math.ceil(baselineCount * safeFactor));
        const passed = actualNumber <= expectedLimit;
        return {
            check: {
                key,
                status: passed ? 'pass' : 'fail',
                expected: `<= ceil(${baselineCount} * ${safeFactor}) = ${expectedLimit}`,
                actual: actualNumber,
                detail: `baseline=${baselinePath}`,
                mustPass: true
            },
            baselineCount
        };
    }

    if (rule.op === 'eq') {
        const expected = rule.value;
        if (typeof expected === 'boolean') {
            if (typeof actual !== 'boolean') {
                return {
                    check: metricUnavailableCheck(key, `Metric "${key}" expected boolean but unavailable`, expected),
                    error: `Metric unavailable: ${key}`
                };
            }
            return {
                check: {
                    key,
                    status: actual === expected ? 'pass' : 'fail',
                    expected,
                    actual,
                    detail: `must equal ${expected}`,
                    mustPass: true
                }
            };
        }

        const actualNumber = toFiniteNumber(actual);
        const expectedNumber = toFiniteNumber(expected);
        if (typeof actualNumber !== 'number' || typeof expectedNumber !== 'number') {
            return {
                check: metricUnavailableCheck(key, `Metric "${key}" expected numeric equality`, expected),
                error: `Metric unavailable: ${key}`
            };
        }
        return {
            check: {
                key,
                status: actualNumber === expectedNumber ? 'pass' : 'fail',
                expected: expectedNumber,
                actual: actualNumber,
                detail: `must equal ${expectedNumber}`,
                mustPass: true
            }
        };
    }

    const actualNumber = toFiniteNumber(actual);
    const expectedNumber = toFiniteNumber(rule.value);
    if (typeof actualNumber !== 'number' || typeof expectedNumber !== 'number') {
        return {
            check: metricUnavailableCheck(key, `Metric "${key}" expected numeric threshold`, rule.value),
            error: `Metric unavailable: ${key}`
        };
    }

    const passed = rule.op === 'lt' ? actualNumber < expectedNumber : actualNumber <= expectedNumber;
    return {
        check: {
            key,
            status: passed ? 'pass' : 'fail',
            expected: rule.op === 'lt' ? `< ${expectedNumber}` : `<= ${expectedNumber}`,
            actual: actualNumber,
            detail: rule.op === 'lt' ? `must be < ${expectedNumber}` : `must be <= ${expectedNumber}`,
            mustPass: true
        }
    };
}

function metricUnavailableCheck(key: string, detail: string, expected: unknown): GovernCheckResult {
    return {
        key,
        status: 'error',
        expected: stringifyExpected(expected),
        actual: null,
        detail,
        mustPass: true
    };
}

function evaluateLanguageGhostPolicy(
    triadNodes: TriadNodeLike[],
    policyByLanguage: Record<string, GovernLanguagePolicyNormalized>
) {
    const violations: string[] = [];

    for (const node of triadNodes) {
        const language = inferLanguageFromSourcePath(node.sourcePath);
        const policy = resolveLanguageGhostPolicy(language, policyByLanguage);
        const demand = Array.isArray(node.fission?.demand) ? node.fission!.demand! : [];
        const ghostDemandEntries = demand.filter((entry) => GHOST_DEMAND_PATTERN.test(String(entry ?? '').trim()));
        if (!policy.includeInDemand && ghostDemandEntries.length > 0) {
            violations.push(`${language}:${node.nodeId ?? 'unknown'} includes ghost demand while disabled`);
            continue;
        }

        if (policy.includeInDemand && ghostDemandEntries.length > policy.topK) {
            violations.push(
                `${language}:${node.nodeId ?? 'unknown'} ghost demand ${ghostDemandEntries.length} exceeds top_k=${policy.topK}`
            );
        }

        const retainedGhostReads = (node.fission?.evidence?.ghostReads ?? []).filter((entry) => entry?.retainedInDemand);
        const belowThreshold = retainedGhostReads.find((entry) => Number(entry?.score ?? 0) < policy.minConfidence);
        if (belowThreshold) {
            violations.push(
                `${language}:${node.nodeId ?? 'unknown'} retained ghost score ${Number(
                    belowThreshold.score ?? 0
                )} below min_confidence=${policy.minConfidence}`
            );
        }
    }

    return {
        violations: dedupeStrings(violations).slice(0, 100)
    };
}

function resolveLanguageGhostPolicy(
    language: string,
    policyByLanguage: Record<string, GovernLanguagePolicyNormalized>
): GovernLanguagePolicyNormalized {
    const fallback = policyByLanguage.default ?? {
        includeInDemand: true,
        topK: 5,
        minConfidence: 4
    };
    return policyByLanguage[language] ?? fallback;
}

function validateRuntimeDiagnosticsShape(runtimeDiagnosticsPath: string) {
    const diagnostics = readRuntimeDiagnostics(runtimeDiagnosticsPath);
    const errors: string[] = [];
    diagnostics.forEach((item, index) => {
        const prefix = `diagnostics[${index}]`;
        if (!isNonEmptyText(item.level)) {
            errors.push(`${prefix}.level is missing`);
        }
        if (!isNonEmptyText(item.code)) {
            errors.push(`${prefix}.code is missing`);
        }
        if (!isNonEmptyText(item.extractor)) {
            errors.push(`${prefix}.extractor is missing`);
        }
        if (!isNonEmptyText(item.message)) {
            errors.push(`${prefix}.message is missing`);
        }
    });
    return errors;
}

function writeGovernArtifacts(paths: WorkspacePaths, report: GovernReport, auditLines: string[], mode: GovernMode) {
    const requiredArtifacts = [paths.governReportFile, paths.governAuditFile];
    if (mode === 'fix') {
        requiredArtifacts.push(paths.governFixesFile);
    }

    fs.mkdirSync(paths.triadDir, { recursive: true });
    fs.writeFileSync(paths.governReportFile, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(paths.governAuditFile, `${auditLines.join('\n')}\n`, 'utf-8');

    const missing = requiredArtifacts.filter((artifactPath) => !fs.existsSync(artifactPath));
    return { missing };
}

function readTriadNodes(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (!Array.isArray(parsed)) {
        return [] as TriadNodeLike[];
    }
    return parsed as TriadNodeLike[];
}

function readRuntimeDiagnostics(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (Array.isArray(parsed)) {
        return parsed as RuntimeDiagnosticLike[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { diagnostics?: unknown[] }).diagnostics)) {
        return ((parsed as { diagnostics?: unknown[] }).diagnostics ?? []) as RuntimeDiagnosticLike[];
    }
    return [] as RuntimeDiagnosticLike[];
}

function readJsonIfExists(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        return JSON.parse(content) as unknown;
    } catch {
        return undefined;
    }
}

function loadGovernPolicy(policyPath: string): { policy?: GovernPolicyNormalized; error?: string } {
    if (!fs.existsSync(policyPath)) {
        return {
            error: `Policy file not found: ${policyPath}`
        };
    }

    const parsed = readJsonIfExists(policyPath);
    if (!parsed || typeof parsed !== 'object') {
        return {
            error: `Policy file is not valid JSON object: ${policyPath}`
        };
    }

    const policy = parsed as GovernPolicy;
    const version = String(policy.version ?? '').trim();
    if (!version) {
        return {
            error: `Policy version is required: ${policyPath}`
        };
    }

    if (policy.mode !== 'hard') {
        return {
            error: `Policy mode must be "hard": ${policyPath}`
        };
    }

    const mustPass = normalizeMustPass(policy.must_pass);
    if (!mustPass) {
        return {
            error: 'Policy must_pass must be a non-empty object'
        };
    }

    for (const key of REQUIRED_GOVERN_METRICS) {
        if (!mustPass[key]) {
            return {
                error: `Policy must_pass.${key} is required in hard mode`
            };
        }
    }

    const normalizedLanguagePolicy = normalizeLanguageGhostPolicy(policy.language_ghost_policy);
    if (!normalizedLanguagePolicy) {
        return {
            error: 'Policy language_ghost_policy must be a non-empty object'
        };
    }

    const coverageByRoot = normalizeCoverageByRoot(policy.coverage_by_root);
    if (policy.coverage_by_root && !coverageByRoot) {
        return {
            error: 'Policy coverage_by_root contains invalid rule definitions'
        };
    }

    const forbiddenInRun = normalizeForbiddenMutations(policy.forbidden_in_run);
    if (!forbiddenInRun) {
        return {
            error: 'Policy forbidden_in_run contains unsupported values'
        };
    }

    const baselinePath = normalizeOptionalText(policy.baseline_path);
    return {
        policy: {
            version,
            mode: 'hard',
            mustPass,
            languageGhostPolicy: normalizedLanguagePolicy,
            coverageByRoot: coverageByRoot ?? {},
            forbiddenInRun,
            baselinePath
        }
    };
}

function normalizeMustPass(raw: unknown) {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const result: Record<string, GovernMetricRule> = {};
    for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
        const key = String(rawKey ?? '').trim();
        if (!key) {
            continue;
        }
        if (!rawValue || typeof rawValue !== 'object') {
            return undefined;
        }

        const rule = rawValue as GovernMetricRule;
        const op = String(rule.op ?? '').trim() as GovernRuleOperator;
        if (op !== 'eq' && op !== 'lt' && op !== 'lte' && op !== 'lte_baseline_factor') {
            return undefined;
        }

        const value = (rule as { value?: unknown }).value;
        if (op === 'eq') {
            if (typeof value !== 'number' && typeof value !== 'boolean') {
                return undefined;
            }
        } else {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return undefined;
            }
        }

        result[key] = {
            op,
            value: value as number | boolean
        };
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeLanguageGhostPolicy(raw: unknown) {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const result: Record<string, GovernLanguagePolicyNormalized> = {};
    for (const [languageKey, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        const candidate = value as GovernLanguageGhostPolicy;
        if (typeof candidate.include_in_demand !== 'boolean') {
            return undefined;
        }
        const topK = toFiniteNumber(candidate.top_k);
        const minConfidence = normalizeMinConfidence(candidate.min_confidence);
        if (typeof topK !== 'number' || topK < 0 || typeof minConfidence !== 'number' || minConfidence < 0) {
            return undefined;
        }

        result[String(languageKey).trim().toLowerCase()] = {
            includeInDemand: candidate.include_in_demand,
            topK: Math.max(0, Math.floor(topK)),
            minConfidence
        };
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCoverageByRoot(raw: unknown) {
    if (raw === undefined) {
        return {} as Record<string, GovernCoverageRuleNormalized>;
    }
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const normalized: Record<string, GovernCoverageRuleNormalized> = {};
    for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
        const key = String(rawKey ?? '').trim();
        if (!key || !rawValue || typeof rawValue !== 'object') {
            return undefined;
        }

        const rule = rawValue as GovernCoverageRule;
        const op = String(rule.op ?? '').trim() as 'gt' | 'gte';
        const value = toFiniteNumber(rule.value);
        const metric = String(rule.metric ?? 'combined').trim().toLowerCase();
        if ((op !== 'gt' && op !== 'gte') || typeof value !== 'number' || value < 0 || value > 1) {
            return undefined;
        }
        if (metric !== 'triad' && metric !== 'runtime' && metric !== 'combined') {
            return undefined;
        }

        normalized[key] = {
            metric,
            op,
            value,
            mustPass: rule.must_pass === true
        };
    }

    return normalized;
}

function normalizeForbiddenMutations(raw: unknown) {
    if (raw === undefined) {
        return new Set<ForbiddenRunMutation>();
    }
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const set = new Set<ForbiddenRunMutation>();
    for (const item of raw) {
        const normalized = String(item ?? '').trim();
        if (normalized === 'modify_policy' || normalized === 'modify_baseline') {
            set.add(normalized);
            continue;
        }
        return undefined;
    }
    return set;
}

function normalizeMinConfidence(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'high') {
        return 4;
    }
    if (normalized === 'medium') {
        return 3;
    }
    if (normalized === 'low') {
        return 2;
    }
    return undefined;
}

function resolveBaselinePath(paths: WorkspacePaths, policy: GovernPolicyNormalized, policyPath: string) {
    const configured = normalizeOptionalText(policy.baselinePath);
    if (!configured) {
        return paths.verifyBaselineFile;
    }
    if (path.isAbsolute(configured)) {
        return configured;
    }
    const projectRelative = path.resolve(paths.projectRoot, configured);
    if (fs.existsSync(projectRelative)) {
        return projectRelative;
    }
    return path.resolve(path.dirname(policyPath), configured);
}

function readBaselineCount(baselinePath: string) {
    const parsed = readJsonIfExists(baselinePath);
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    const count = toFiniteNumber((parsed as { runtime_unmatched_route_count?: unknown }).runtime_unmatched_route_count);
    if (typeof count !== 'number' || count < 0) {
        return undefined;
    }
    return Math.floor(count);
}

function captureForbiddenSnapshot(policyPath: string, baselinePath: string): ForbiddenFileSnapshot {
    return {
        policy: fingerprintFile(policyPath),
        baseline: fingerprintFile(baselinePath)
    };
}

function detectForbiddenChanges(
    before: ForbiddenFileSnapshot,
    after: ForbiddenFileSnapshot,
    forbiddenInRun: Set<ForbiddenRunMutation>
) {
    const changes: string[] = [];
    if (forbiddenInRun.has('modify_policy') && !isSameFingerprint(before.policy, after.policy)) {
        changes.push(`Forbidden mutation detected: modify_policy (${before.policy.path})`);
    }
    if (forbiddenInRun.has('modify_baseline') && !isSameFingerprint(before.baseline, after.baseline)) {
        changes.push(`Forbidden mutation detected: modify_baseline (${before.baseline.path})`);
    }
    return changes;
}

function fingerprintFile(filePath: string): FileFingerprint {
    if (!fs.existsSync(filePath)) {
        return {
            path: filePath,
            exists: false,
            hash: ''
        };
    }
    const buffer = fs.readFileSync(filePath);
    return {
        path: filePath,
        exists: true,
        hash: crypto.createHash('sha256').update(buffer).digest('hex')
    };
}

function isSameFingerprint(left: FileFingerprint, right: FileFingerprint) {
    return left.exists === right.exists && left.hash === right.hash;
}

function inferLanguageFromSourcePath(sourcePath: string | undefined) {
    const normalized = String(sourcePath ?? '').toLowerCase();
    if (/\.(ts|tsx|mts|cts)$/.test(normalized)) return 'typescript';
    if (/\.(js|jsx|mjs|cjs)$/.test(normalized)) return 'javascript';
    if (/\.py$/.test(normalized)) return 'python';
    if (/\.go$/.test(normalized)) return 'go';
    if (/\.rs$/.test(normalized)) return 'rust';
    if (/\.(cc|cpp|cxx|hpp|hh|h)$/.test(normalized)) return 'cpp';
    if (/\.java$/.test(normalized)) return 'java';
    return 'unknown';
}

function buildFixPatch(report: GovernReport, options: GovernRunOptions, baselinePath: string) {
    const failedChecks = report.checks.filter((check) => check.status !== 'pass' && check.mustPass);
    const header = [
        '# TriadMind Govern Auto-Fix Patch (planning output)',
        `# generatedAt=${new Date().toISOString()}`,
        `# mode=${options.mode}`,
        `# llm=${options.llm ?? 'unset'}`,
        `# maxIterations=${Math.max(1, Math.floor(options.maxIterations ?? 3))}`,
        `# dryRun=${Boolean(options.dryRun)}`,
        `# baseline=${baselinePath}`,
        ''
    ];

    if (failedChecks.length === 0) {
        return [...header, '# No failing must_pass checks; no patch actions emitted.'].join('\n');
    }

    const body = failedChecks.map((check, index) => {
        return [
            `## FIX-${String(index + 1).padStart(2, '0')} ${check.key}`,
            `- expected: ${check.expected}`,
            `- actual: ${check.actual ?? '-'}`,
            `- detail: ${check.detail}`,
            '- action: inspect topology artifacts and produce a focused code patch without changing policy/baseline',
            ''
        ].join('\n');
    });

    return [...header, ...body].join('\n');
}

function dedupeStrings(values: string[]) {
    return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function toFiniteNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalText(value: unknown) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : undefined;
}

function stringifyExpected(value: unknown) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return JSON.stringify(value);
}

function isNonEmptyText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
}

function buildCoverageMetricSnapshot(report: CoverageReport) {
    return {
        by_category: Object.fromEntries(
            Object.entries(report.byCategory).map(([key, bucket]) => [
                key,
                {
                    triad: bucket.triadCoverage,
                    runtime: bucket.runtimeCoverage,
                    combined: bucket.combinedCoverage,
                    total_source_files: bucket.totalSourceFiles
                }
            ])
        ),
        by_root: Object.fromEntries(
            Object.entries(report.byRoot).map(([key, bucket]) => [
                key,
                {
                    triad: bucket.triadCoverage,
                    runtime: bucket.runtimeCoverage,
                    combined: bucket.combinedCoverage,
                    total_source_files: bucket.totalSourceFiles,
                    exists: bucket.exists ?? false
                }
            ])
        )
    };
}

function buildViewMapMetricSnapshot(viewMapPath: string) {
    const parsed = readJsonIfExists(viewMapPath);
    const stats = parsed && typeof parsed === 'object' ? (parsed as { stats?: Record<string, unknown> }).stats : undefined;
    if (!stats || typeof stats !== 'object') {
        return {
            present: false
        };
    }

    return {
        present: true,
        runtime_match_rate: toFiniteNumber(stats.runtimeMatchRate) ?? 0,
        capability_leaf_match_rate: toFiniteNumber(stats.capabilityLeafMatchRate) ?? 0,
        leaf_capability_match_rate: toFiniteNumber(stats.leafCapabilityMatchRate) ?? 0,
        end_to_end_traceability_rate: toFiniteNumber(stats.endToEndTraceabilityRate) ?? 0,
        runtime_to_capability_links: toFiniteNumber(stats.runtimeToCapabilityLinkCount) ?? 0,
        capability_to_leaf_links: toFiniteNumber(stats.capabilityToLeafLinkCount) ?? 0,
        runtime_to_leaf_links: toFiniteNumber(stats.runtimeToLeafLinkCount) ?? 0
    };
}

function evaluateCoverageRules(
    coverageRules: Record<string, GovernCoverageRuleNormalized>,
    coverageReport: CoverageReport
) {
    return Object.entries(coverageRules).map(([key, rule]) => {
        const bucket = coverageReport.byCategory[key] ?? coverageReport.byRoot[key];
        const actual = bucket ? selectCoverageMetric(bucket, rule.metric) : null;
        const totalFiles = bucket?.totalSourceFiles ?? 0;
        const passed =
            typeof actual === 'number' &&
            totalFiles > 0 &&
            (rule.op === 'gt' ? actual > rule.value : actual >= rule.value);

        return {
            key: `coverage_by_root.${key}`,
            status: passed ? 'pass' : 'fail',
            expected: `${rule.op === 'gt' ? '>' : '>='} ${rule.value} (${rule.metric})`,
            actual,
            detail:
                bucket && totalFiles > 0
                    ? `${bucket.key} ${rule.metric} coverage across ${totalFiles} source files`
                    : `${key} has no discoverable source files in coverage report`,
            mustPass: rule.mustPass
        } satisfies GovernCheckResult;
    });
}

function selectCoverageMetric(
    bucket: { triadCoverage: number; runtimeCoverage: number; combinedCoverage: number },
    metric: 'triad' | 'runtime' | 'combined'
) {
    if (metric === 'triad') {
        return bucket.triadCoverage;
    }
    if (metric === 'runtime') {
        return bucket.runtimeCoverage;
    }
    return bucket.combinedCoverage;
}
