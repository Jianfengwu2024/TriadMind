import * as fs from 'fs';
import * as path from 'path';
import { UpgradeProtocol } from './protocol';
import { normalizePath, WorkspacePaths } from './workspace';

export interface SnapshotFileEntry {
    path: string;
    exists: boolean;
    content: string;
}

export interface TriadSnapshot {
    id: string;
    label: string;
    createdAt: string;
    files: SnapshotFileEntry[];
}

export function createSnapshot(paths: WorkspacePaths, label: string, filePaths: string[]) {
    fs.mkdirSync(paths.snapshotDir, { recursive: true });

    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${sanitizeLabel(label)}`;
    const uniqueFiles = Array.from(new Set(filePaths.map((filePath) => normalizePath(filePath)).filter(Boolean)));
    const snapshot: TriadSnapshot = {
        id,
        label,
        createdAt: new Date().toISOString(),
        files: uniqueFiles.map((filePath) => readSnapshotFile(paths.projectRoot, filePath))
    };

    const snapshotPath = getSnapshotPath(paths, id);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    updateSnapshotIndex(paths, snapshot);
    return snapshot;
}

export function listSnapshots(paths: WorkspacePaths) {
    if (!fs.existsSync(paths.snapshotIndexFile)) {
        return [] as Array<Pick<TriadSnapshot, 'id' | 'label' | 'createdAt'>>;
    }

    try {
        const raw = fs.readFileSync(paths.snapshotIndexFile, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw) as Array<Pick<TriadSnapshot, 'id' | 'label' | 'createdAt'>>;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function restoreSnapshot(paths: WorkspacePaths, snapshotId?: string) {
    const id = snapshotId ?? listSnapshots(paths)[0]?.id;
    if (!id) {
        throw new Error('No snapshot found to restore');
    }

    const snapshotPath = getSnapshotPath(paths, id);
    if (!fs.existsSync(snapshotPath)) {
        throw new Error(`Snapshot file not found: ${snapshotPath}`);
    }

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8').replace(/^\uFEFF/, '')) as TriadSnapshot;
    for (const file of snapshot.files) {
        const absolutePath = path.join(paths.projectRoot, file.path);
        if (!file.exists) {
            if (fs.existsSync(absolutePath)) {
                fs.unlinkSync(absolutePath);
            }
            continue;
        }

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, file.content, 'utf-8');
    }

    return snapshot;
}

export function collectProtocolSnapshotFiles(paths: WorkspacePaths, protocol: UpgradeProtocol) {
    const files = new Set<string>([
        normalizePath(path.relative(paths.projectRoot, paths.mapFile)),
        normalizePath(path.relative(paths.projectRoot, paths.draftFile)),
        normalizePath(path.relative(paths.projectRoot, paths.approvedProtocolFile)),
        normalizePath(path.relative(paths.projectRoot, paths.handoffPromptFile)),
        normalizePath(path.relative(paths.projectRoot, paths.lastApplyFilesFile))
    ]);

    const existingNodeSourceMap = readNodeSourceMap(paths.mapFile);
    for (const action of protocol.actions) {
        if (action.op === 'reuse') {
            continue;
        }

        if (action.op === 'modify') {
            const sourcePath = action.sourcePath ?? existingNodeSourceMap.get(action.nodeId);
            if (sourcePath) {
                files.add(normalizePath(sourcePath));
            }
            continue;
        }

        if (action.node.sourcePath) {
            files.add(normalizePath(action.node.sourcePath));
            continue;
        }

        const parentSourcePath = existingNodeSourceMap.get(action.parentNodeId);
        if (parentSourcePath) {
            files.add(normalizePath(parentSourcePath));
        }
    }

    return Array.from(files);
}

function readSnapshotFile(projectRoot: string, filePath: string): SnapshotFileEntry {
    const absolutePath = path.join(projectRoot, filePath);
    const exists = fs.existsSync(absolutePath);
    return {
        path: filePath,
        exists,
        content: exists ? fs.readFileSync(absolutePath, 'utf-8') : ''
    };
}

function readNodeSourceMap(mapPath: string) {
    const result = new Map<string, string>();
    if (!fs.existsSync(mapPath)) {
        return result;
    }

    try {
        const nodes = JSON.parse(fs.readFileSync(mapPath, 'utf-8').replace(/^\uFEFF/, '')) as Array<{
            nodeId?: string;
            sourcePath?: string;
        }>;
        nodes.forEach((node) => {
            if (node.nodeId && node.sourcePath) {
                result.set(node.nodeId, node.sourcePath);
            }
        });
    } catch {
        return result;
    }

    return result;
}

function updateSnapshotIndex(paths: WorkspacePaths, snapshot: TriadSnapshot) {
    const index = listSnapshots(paths).filter((item) => item.id !== snapshot.id);
    index.unshift({
        id: snapshot.id,
        label: snapshot.label,
        createdAt: snapshot.createdAt
    });
    fs.mkdirSync(paths.snapshotDir, { recursive: true });
    fs.writeFileSync(paths.snapshotIndexFile, JSON.stringify(index.slice(0, 30), null, 2), 'utf-8');
}

function getSnapshotPath(paths: WorkspacePaths, snapshotId: string) {
    return path.join(paths.snapshotDir, `${snapshotId}.json`);
}

function sanitizeLabel(label: string) {
    return label.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'snapshot';
}
