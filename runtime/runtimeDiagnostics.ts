import { RuntimeDiagnostic } from './types';

const DEFAULT_EXTRACTOR = 'RuntimeOrchestrator';
const DEFAULT_CODE = 'RUNTIME_DIAGNOSTIC_UNCODED';

type RuntimeDiagnosticInput = Partial<RuntimeDiagnostic> & {
    level?: RuntimeDiagnostic['level'];
    message?: string;
};

export function normalizeRuntimeDiagnostic(
    diagnostic: RuntimeDiagnosticInput,
    fallbackExtractor = DEFAULT_EXTRACTOR
): RuntimeDiagnostic {
    const level = normalizeLevel(diagnostic.level);
    const extractor = normalizeExtractor(diagnostic.extractor, fallbackExtractor);
    const message = normalizeMessage(diagnostic.message);
    const code = normalizeCode(diagnostic.code) ?? fallbackCode(extractor, level);

    return {
        level,
        code,
        extractor,
        message,
        sourcePath: normalizeOptionalText(diagnostic.sourcePath)
    };
}

export function normalizeRuntimeDiagnostics(
    diagnostics: Array<RuntimeDiagnosticInput>,
    fallbackExtractor = DEFAULT_EXTRACTOR
) {
    return diagnostics.map((diagnostic) => normalizeRuntimeDiagnostic(diagnostic, fallbackExtractor));
}

function normalizeLevel(level: RuntimeDiagnosticInput['level']): RuntimeDiagnostic['level'] {
    return level === 'info' || level === 'warning' || level === 'error' ? level : 'info';
}

function normalizeExtractor(extractor: string | undefined, fallbackExtractor: string) {
    const normalized = normalizeOptionalText(extractor);
    return normalized || fallbackExtractor;
}

function normalizeMessage(message: string | undefined) {
    return normalizeOptionalText(message) || 'Runtime diagnostic without message';
}

function normalizeCode(code: string | undefined) {
    const normalized = normalizeOptionalText(code);
    if (!normalized) {
        return undefined;
    }
    return normalized
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
}

function fallbackCode(extractor: string, level: RuntimeDiagnostic['level']) {
    const extractorToken = extractor
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
    if (!extractorToken) {
        return DEFAULT_CODE;
    }
    return `RUNTIME_${extractorToken}_${level.toUpperCase()}`;
}

function normalizeOptionalText(value: string | undefined) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : undefined;
}
