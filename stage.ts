import {
    evaluateTriadizationFocusGateArtifacts,
    TriadizationFocusGateFailureKind,
    TriadizationFocusGateReport
} from './verify';

export interface StageAnalysisInput {
    latestDemand: string;
    draftProtocol: string;
    macroSplit: string;
    mesoSplit: string;
    microSplit: string;
    approvedProtocol: string;
    triadizationReport?: string;
}

export interface StageAnalysisResult {
    hasRelevantApprovedProtocol: boolean;
    hasRelevantDraftProtocol: boolean;
    hasMacroSplit: boolean;
    hasMesoSplit: boolean;
    hasMicroSplit: boolean;
    hasTriadizationReport: boolean;
    triadizationFocus?: string;
    triadizationAction?: string;
    hasBlockingTriadizationFocusGate: boolean;
    triadizationFocusGateStatus: TriadizationFocusGateReport['status'];
    triadizationFocusGateKind?: TriadizationFocusGateFailureKind;
    triadizationFocusGateSummary?: string;
    triadizationFocusGateRepairTarget?: string;
    triadizationFocusGateDetails: string[];
    currentStage: string;
}

export function analyzeWorkspaceStage(input: StageAnalysisInput): StageAnalysisResult {
    const latestDemandText = normalizeDemandText(input.latestDemand);
    const draftProtocolJson = safeParseJson(input.draftProtocol);
    const macroSplitJson = safeParseJson(input.macroSplit);
    const mesoSplitJson = safeParseJson(input.mesoSplit);
    const microSplitJson = safeParseJson(input.microSplit);
    const approvedProtocolJson = safeParseJson(input.approvedProtocol);
    const triadizationReportJson = safeParseJson(input.triadizationReport ?? '');

    const hasApprovedProtocol = hasProtocolActions(approvedProtocolJson);
    const hasDraftProtocol = hasProtocolActions(draftProtocolJson);
    const hasRelevantApprovedProtocol = hasApprovedProtocol && isProtocolForDemand(approvedProtocolJson, latestDemandText);
    const hasRelevantDraftProtocol = hasDraftProtocol && isProtocolForDemand(draftProtocolJson, latestDemandText);
    const hasMacroSplit = hasMacroSplitContent(macroSplitJson);
    const hasMesoSplit = hasMesoSplitContent(mesoSplitJson);
    const hasMicroSplit = hasMicroSplitContent(microSplitJson);
    const primaryProposal = getPrimaryTriadizationProposal(triadizationReportJson);
    const hasTriadizationReport = Boolean(primaryProposal);
    const triadizationFocus = primaryProposal
        ? `${primaryProposal.targetNodeId} -> ${primaryProposal.recommendedOperation}`
        : undefined;
    const triadizationAction =
        typeof primaryProposal?.recommendedOperation === 'string' ? primaryProposal.recommendedOperation : undefined;

    const focusGate = evaluateTriadizationFocusGateArtifacts(draftProtocolJson, microSplitJson);
    const hasBlockingTriadizationFocusGate = !hasRelevantApprovedProtocol && focusGate.status === 'fail';

    const baseStage = resolveBaseStage({
        hasRelevantDraftProtocol,
        hasRelevantApprovedProtocol,
        hasMicroSplit,
        hasMesoSplit,
        hasMacroSplit,
        hasBlockingTriadizationFocusGate
    });
    const focusGateStage = hasBlockingTriadizationFocusGate ? buildFocusGateStageMessage(focusGate) : '';
    const triadizationStage =
        primaryProposal && !hasRelevantApprovedProtocol
            ? `阶段零-顶点三元化诊断：建议先对节点 ${primaryProposal.targetNodeId} 执行 ${primaryProposal.recommendedOperation}，确认后再进入后续协议演进。`
            : '';
    const currentStage = [triadizationStage, focusGateStage, baseStage].filter(Boolean).join(' ');

    return {
        hasRelevantApprovedProtocol,
        hasRelevantDraftProtocol,
        hasMacroSplit,
        hasMesoSplit,
        hasMicroSplit,
        hasTriadizationReport,
        triadizationFocus,
        triadizationAction,
        hasBlockingTriadizationFocusGate,
        triadizationFocusGateStatus: focusGate.status,
        triadizationFocusGateKind: focusGate.failureKind,
        triadizationFocusGateSummary: focusGate.summary,
        triadizationFocusGateRepairTarget: focusGate.repairTarget,
        triadizationFocusGateDetails: focusGate.details,
        currentStage
    };
}

function resolveBaseStage(input: {
    hasRelevantDraftProtocol: boolean;
    hasRelevantApprovedProtocol: boolean;
    hasMicroSplit: boolean;
    hasMesoSplit: boolean;
    hasMacroSplit: boolean;
    hasBlockingTriadizationFocusGate: boolean;
}) {
    if (input.hasRelevantDraftProtocol) {
        return input.hasBlockingTriadizationFocusGate
            ? '阶段一-门禁中：draft-protocol.json 已生成，但当前 triadization focus 仍未闭环，先修复焦点门禁后再进入 visualizer 审核。'
            : '阶段一-审核中：draft-protocol.json 已完成，应先进入 visualizer 审核。';
    }

    if (input.hasRelevantApprovedProtocol) {
        return '阶段二：协议已批准，可以按 handoff 约束继续完善代码实现。';
    }

    if (input.hasMicroSplit) {
        return input.hasBlockingTriadizationFocusGate
            ? '阶段一-Micro 门禁中：micro-split 已生成，但当前 triadization focus 仍未闭环，先修复焦点门禁后再汇总 draft-protocol.json。'
            : '阶段一-Micro：类级属性/方法拆分已完成，下一步应汇总 draft-protocol.json。';
    }

    if (input.hasMesoSplit) {
        return '阶段一-Meso：类与数据管道拆分已完成，下一步应进入 Micro-Split。';
    }

    if (input.hasMacroSplit) {
        return '阶段一-Macro：挂载点与左右分支拆分已完成，下一步应进入 Meso-Split。';
    }

    return '阶段一-规划中：尚未完成有效拆分，先执行 Macro-Split。';
}

function buildFocusGateStageMessage(focusGate: TriadizationFocusGateReport) {
    const failureKind = focusGate.failureKind ?? 'triadization_focus_gate';
    const repairSuffix = focusGate.repairTarget ? ` 优先修复 ${focusGate.repairTarget}。` : '';
    return `当前阻塞：${failureKind}。${focusGate.summary}${repairSuffix}`;
}

function safeParseJson(content: string) {
    if (!content.trim()) {
        return undefined;
    }

    try {
        return JSON.parse(content);
    } catch {
        return undefined;
    }
}

function hasProtocolActions(value: any) {
    return Array.isArray(value?.actions) && value.actions.length > 0;
}

function isProtocolForDemand(value: any, latestDemand: string) {
    if (!latestDemand) {
        return true;
    }

    return normalizeDemandText(value?.userDemand) === latestDemand;
}

function hasMacroSplitContent(value: any) {
    return Boolean(
        value &&
            (hasNonEmptyString(value.anchorNodeId) ||
                hasNonEmptyArray(value.leftBranch) ||
                hasNonEmptyArray(value.rightBranch))
    );
}

function hasMesoSplitContent(value: any) {
    return Boolean(value && (hasNonEmptyArray(value.classes) || hasNonEmptyArray(value.pipelines)));
}

function hasMicroSplitContent(value: any) {
    if (!value || !Array.isArray(value.classes) || value.classes.length === 0) {
        return false;
    }

    return value.classes.some(
        (item: any) =>
            hasNonEmptyArray(item?.staticRightBranch) ||
            hasNonEmptyArray(item?.dynamicLeftBranch) ||
            hasNonEmptyArray(item?.properties) ||
            hasNonEmptyArray(item?.methods)
    );
}

function hasNonEmptyArray(value: unknown) {
    return Array.isArray(value) && value.length > 0;
}

function hasNonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeDemandText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getPrimaryTriadizationProposal(value: any) {
    const proposal = value?.primaryProposal;
    if (
        proposal &&
        typeof proposal.targetNodeId === 'string' &&
        typeof proposal.recommendedOperation === 'string'
    ) {
        return proposal;
    }

    return undefined;
}
