import * as fs from 'fs';
import * as path from 'path';
import { RuntimeDiagnostic, RuntimeMap } from './types';

export function writeRuntimeMap(runtimeMap: RuntimeMap, runtimeMapPath: string) {
    fs.mkdirSync(path.dirname(runtimeMapPath), { recursive: true });
    fs.writeFileSync(runtimeMapPath, JSON.stringify(runtimeMap, null, 2), 'utf-8');
}

export function writeRuntimeDiagnostics(diagnostics: RuntimeDiagnostic[], diagnosticsPath: string) {
    fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2), 'utf-8');
}

export function writeRuntimeMapArtifacts(runtimeMap: RuntimeMap, runtimeMapPath: string, diagnosticsPath: string) {
    writeRuntimeMap(runtimeMap, runtimeMapPath);
    writeRuntimeDiagnostics(runtimeMap.diagnostics ?? [], diagnosticsPath);
}
