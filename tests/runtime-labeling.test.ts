import test from 'node:test';
import assert from 'node:assert/strict';
import { isLowSignalRuntimeLabel, normalizeRuntimeNodeLabel } from '../runtime/runtimeLabeling';
import { RuntimeNode } from '../runtime/types';

test('normalizeRuntimeNodeLabel favors business metadata over low-signal labels', () => {
    const node: RuntimeNode = {
        id: 'Service.detect',
        type: 'Service',
        label: 'classList',
        metadata: {
            handler: 'detect_document_layout'
        }
    };

    const normalized = normalizeRuntimeNodeLabel(node);
    assert.equal(normalized.label, 'detect_document_layout');
    assert.equal(normalized.source, 'metadata');
    assert.equal(normalized.lowSignal, false);
});

test('normalizeRuntimeNodeLabel builds api labels from method and path', () => {
    const node: RuntimeNode = {
        id: 'ApiRoute.POST./items/{id}/run',
        type: 'ApiRoute',
        label: 'dragging',
        metadata: {
            method: 'post',
            path: '/items/{id}/run'
        }
    };

    const normalized = normalizeRuntimeNodeLabel(node);
    assert.equal(normalized.label, 'POST /items/{id}/run');
    assert.equal(normalized.source, 'metadata');
});

test('isLowSignalRuntimeLabel detects ui-like labels', () => {
    assert.equal(isLowSignalRuntimeLabel('classList'), true);
    assert.equal(isLowSignalRuntimeLabel('dragging dimmed'), true);
    assert.equal(isLowSignalRuntimeLabel('workflow_executor'), false);
});
