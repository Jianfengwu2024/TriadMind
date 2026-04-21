export interface StageAnalysisInput {
    latestDemand: string;
    draftProtocol: string;
    macroSplit: string;
    mesoSplit: string;
    microSplit: string;
    approvedProtocol: string;
}

export interface StageAnalysisResult {
    hasRelevantApprovedProtocol: boolean;
    hasRelevantDraftProtocol: boolean;
    hasMacroSplit: boolean;
    hasMesoSplit: boolean;
    hasMicroSplit: boolean;
    currentStage: string;
}

export function analyzeWorkspaceStage(input: StageAnalysisInput): StageAnalysisResult {
    const latestDemandText = normalizeDemandText(input.latestDemand);
    const draftProtocolJson = safeParseJson(input.draftProtocol);
    const macroSplitJson = safeParseJson(input.macroSplit);
    const mesoSplitJson = safeParseJson(input.mesoSplit);
    const microSplitJson = safeParseJson(input.microSplit);
    const approvedProtocolJson = safeParseJson(input.approvedProtocol);

    const hasApprovedProtocol = hasProtocolActions(approvedProtocolJson);
    const hasDraftProtocol = hasProtocolActions(draftProtocolJson);
    const hasRelevantApprovedProtocol = hasApprovedProtocol && isProtocolForDemand(approvedProtocolJson, latestDemandText);
    const hasRelevantDraftProtocol = hasDraftProtocol && isProtocolForDemand(draftProtocolJson, latestDemandText);
    const hasMacroSplit = hasMacroSplitContent(macroSplitJson);
    const hasMesoSplit = hasMesoSplitContent(mesoSplitJson);
    const hasMicroSplit = hasMicroSplitContent(microSplitJson);

    const currentStage = hasRelevantDraftProtocol
        ? '阶段一审核中：draft-protocol.json 已完成，应先走 visualizer 审核。'
        : hasRelevantApprovedProtocol
          ? '阶段二：协议已批准，可以按 handoff 约束继续完善代码实现。'
          : hasMicroSplit
            ? '阶段一-Micro：类级属性 / 方法拆分已完成，下一步应汇总 draft-protocol.json。'
            : hasMesoSplit
              ? '阶段一-Meso：类与数据管道拆分已完成，下一步应进入 Micro-Split。'
              : hasMacroSplit
                ? '阶段一-Macro：挂载点与左右分支拆分已完成，下一步应进入 Meso-Split。'
                : '阶段一规划中：尚未完成有效拆分，先执行 Macro-Split。';

    return {
        hasRelevantApprovedProtocol,
        hasRelevantDraftProtocol,
        hasMacroSplit,
        hasMesoSplit,
        hasMicroSplit,
        currentStage
    };
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
