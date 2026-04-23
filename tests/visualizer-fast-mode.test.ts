import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateDashboard } from '../visualizer';

test('visualizer fast mode skips per-owner strict fingerprints without blocking HTML output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-visualizer-fast-'));
    const triadDir = path.join(root, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });

    const mapPath = path.join(triadDir, 'triad-map.json');
    const protocolPath = path.join(triadDir, 'draft-protocol.json');
    const outputPath = path.join(triadDir, 'visualizer.html');
    const configPath = path.join(triadDir, 'config.json');

    fs.writeFileSync(
        configPath,
        JSON.stringify(
            {
                visualizer: {
                    defaultView: 'architecture',
                    fastMode: true,
                    strictFingerprint: false,
                    fastMayaThreshold: 0,
                    fastFingerprintThreshold: 0,
                    maxFingerprintNodes: 8,
                    maxFingerprintOwners: 50,
                    fingerprintTimeoutMs: 50
                }
            },
            null,
            2
        ),
        'utf-8'
    );
    fs.writeFileSync(
        mapPath,
        JSON.stringify(
            [
                { nodeId: 'Api.handle', fission: { demand: ['OrderCommand'], answer: ['OrderResult'] } },
                { nodeId: 'Service.execute', fission: { demand: ['OrderResult'], answer: ['WorkflowState'] } },
                { nodeId: 'Adapter.apply', fission: { demand: ['WorkflowState'], answer: ['PersistedOrder'] } }
            ],
            null,
            2
        ),
        'utf-8'
    );
    fs.writeFileSync(
        protocolPath,
        JSON.stringify(
            {
                protocolVersion: '1.0',
                project: 'visualizer-fast-mode',
                mapSource: 'triad-map.json',
                userDemand: 'verify fast visualizer',
                actions: []
            },
            null,
            2
        ),
        'utf-8'
    );

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown, ...args: unknown[]) => {
        logs.push([message, ...args].map(String).join(' '));
    };

    try {
        generateDashboard(mapPath, protocolPath, outputPath);
    } finally {
        console.log = originalLog;
    }

    const html = fs.readFileSync(outputPath, 'utf-8');
    assert.match(html, /maya: fast fallback enabled/);
    assert.match(html, /Fingerprint skipped in fast mode/);
    assert.ok(logs.some((line) => line.includes('Visualizer mode: view=architecture')));
    assert.ok(logs.some((line) => line.includes('Strict fingerprint skipped: fallback mode enabled')));
    assert.ok(logs.some((line) => line.includes('Fingerprint owners skipped: 3')));
    assert.ok(logs.some((line) => line.includes('Dashboard generated in')));
});
