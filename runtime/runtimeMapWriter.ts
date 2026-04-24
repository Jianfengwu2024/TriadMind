import * as fs from 'fs';
import * as path from 'path';
import { RuntimeDiagnostic, RuntimeMap } from './types';
import { normalizeRuntimeDiagnostics } from './runtimeDiagnostics';

export function writeRuntimeMap(runtimeMap: RuntimeMap, runtimeMapPath: string) {
    fs.mkdirSync(path.dirname(runtimeMapPath), { recursive: true });
    fs.writeFileSync(runtimeMapPath, JSON.stringify(runtimeMap, null, 2), 'utf-8');
}

export function writeRuntimeDiagnostics(diagnostics: RuntimeDiagnostic[], diagnosticsPath: string) {
    fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
    const normalizedDiagnostics = normalizeRuntimeDiagnostics(diagnostics, 'RuntimeOrchestrator');
    fs.writeFileSync(diagnosticsPath, JSON.stringify(normalizedDiagnostics, null, 2), 'utf-8');
}

export function writeRuntimeMapArtifacts(runtimeMap: RuntimeMap, runtimeMapPath: string, diagnosticsPath: string) {
    const normalizedDiagnostics = normalizeRuntimeDiagnostics(runtimeMap.diagnostics ?? [], 'RuntimeOrchestrator');
    writeRuntimeMap(
        {
            ...runtimeMap,
            diagnostics: normalizedDiagnostics
        },
        runtimeMapPath
    );
    writeRuntimeDiagnostics(normalizedDiagnostics, diagnosticsPath);
}
