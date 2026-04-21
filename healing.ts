import * as fs from 'fs';
import { loadTriadConfig } from './config';
import {
    BlastRadius,
    buildEvidence,
    buildSummary,
    chooseSuggestedAction,
    classifyDiagnosis,
    estimateBlastRadius,
    getContractGuardLine,
    getHealingOutputRuleLines,
    HealingDiagnosis,
    parseTraceLine,
    RuntimeTraceFrame,
    scoreNodeMatch
} from './healingRightBranch';
import { parseNodeRef, readTriadMap, TriadNodeDefinition } from './protocol';
import { normalizePath, WorkspacePaths } from './workspace';

export * from './healingRightBranch';

/**
 * @LeftBranch
 */
export function prepareHealingArtifacts(paths: WorkspacePaths, errorText: string, retryCount = 0) {
    const config = loadTriadConfig(paths);
    const nodes = readTriadMap(paths.mapFile);
    const diagnosis = diagnoseRuntimeFailure(paths, errorText, retryCount, nodes);
    const requiresHumanApproval =
        diagnosis.blastRadius.risk === 'high' ||
        (diagnosis.diagnosis === 'contract' && config.runtimeHealing.requireHumanApprovalForContractChanges);
    const finalDiagnosis: HealingDiagnosis = {
        ...diagnosis,
        requiresHumanApproval
    };
    const prompt = buildHealingPrompt(paths, errorText, finalDiagnosis);

    fs.writeFileSync(paths.runtimeErrorFile, errorText.trim(), 'utf-8');
    fs.writeFileSync(paths.healingReportFile, JSON.stringify(finalDiagnosis, null, 2), 'utf-8');
    fs.writeFileSync(paths.healingPromptFile, prompt, 'utf-8');

    return {
        diagnosis: finalDiagnosis,
        prompt
    };
}

/**
 * @LeftBranch
 */
export function diagnoseRuntimeFailure(
    paths: WorkspacePaths,
    errorText: string,
    retryCount: number,
    nodes: TriadNodeDefinition[]
): HealingDiagnosis {
    const config = loadTriadConfig(paths);
    const traceFrames = extractTraceFrames(errorText, paths.projectRoot);
    const match = locateBestNodeMatch(traceFrames, nodes);
    const diagnosis = classifyDiagnosis(errorText);
    const blastRadius = estimateBlastRadius(match?.node ?? null, nodes);
    const suggestedAction = chooseSuggestedAction(diagnosis, retryCount, config.runtimeHealing.maxAutoRetries);
    const evidence = buildEvidence(errorText, traceFrames, match?.node ?? null, diagnosis, blastRadius);

    return {
        projectRoot: normalizePath(paths.projectRoot),
        adapterLanguage: config.architecture.language,
        retryCount,
        matchedNodeId: match?.node.nodeId ?? null,
        matchedSourcePath: match?.node.sourcePath ?? null,
        diagnosis,
        suggestedAction,
        summary: buildSummary(match?.node ?? null, diagnosis, suggestedAction, blastRadius),
        blastRadius,
        traceFrames,
        evidence,
        requiresHumanApproval: false
    };
}

/**
 * @LeftBranch
 */
export function buildHealingPrompt(paths: WorkspacePaths, errorText: string, diagnosis: HealingDiagnosis) {
    const config = loadTriadConfig(paths);
    const triadMapJson = fs.existsSync(paths.mapFile) ? fs.readFileSync(paths.mapFile, 'utf-8').trim() : '[]';
    const triadSpec = fs.existsSync(paths.triadSpecFile) ? fs.readFileSync(paths.triadSpecFile, 'utf-8').trim() : '';
    const latestDemand = fs.existsSync(paths.demandFile) ? fs.readFileSync(paths.demandFile, 'utf-8').trim() : '';
    const contractGuard = getContractGuardLine(config.runtimeHealing.requireHumanApprovalForContractChanges);

    return [
        '[System]',
        '你是 TriadMind 的 Runtime Self-Healing 架构师。',
        '你的任务不是直接输出补丁代码，而是先根据运行时错误回溯到拓扑节点，再输出严格 JSON 升级协议。',
        '优先使用 `modify` 修复当前节点；只有当重试预算耗尽或职责明显过载时，才允许 `create_child`。',
        contractGuard,
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Runtime Healing Config]',
        '```json',
        JSON.stringify(config.runtimeHealing, null, 2),
        '```',
        '',
        '[Latest User Demand]',
        latestDemand ? JSON.stringify(latestDemand) : '""',
        '',
        '[Triad Map JSON]',
        '```json',
        triadMapJson,
        '```',
        '',
        '[Runtime Error]',
        '```text',
        errorText.trim(),
        '```',
        '',
        '[Healing Diagnosis]',
        '```json',
        JSON.stringify(diagnosis, null, 2),
        '```',
        '',
        '[Output Rules]',
        ...getHealingOutputRuleLines(),
        '',
        '[Output Target]',
        normalizePath(paths.draftFile)
    ].join('\n');
}

function extractTraceFrames(errorText: string, projectRoot: string) {
    const frames: RuntimeTraceFrame[] = [];
    const projectRootNormalized = normalizePath(projectRoot).toLowerCase();

    for (const rawLine of errorText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        const frame = parseTraceLine(line, projectRootNormalized, projectRoot);
        if (frame) {
            frames.push(frame);
        }
    }

    return frames;
}

function locateBestNodeMatch(frames: RuntimeTraceFrame[], nodes: TriadNodeDefinition[]) {
    let bestMatch:
        | {
              node: TriadNodeDefinition;
              score: number;
          }
        | undefined;

    for (const frame of frames) {
        for (const node of nodes) {
            const score = scoreNodeMatch(frame, node);
            if (score <= 0) {
                continue;
            }

            if (!bestMatch || score > bestMatch.score) {
                bestMatch = {
                    node,
                    score
                };
            }
        }
    }

    return bestMatch;
}
