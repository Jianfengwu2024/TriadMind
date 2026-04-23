import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeGraphIndex, filterRuntimeGraph, traceRuntimeGraph } from '../runtime/runtimeGraph';
import { RuntimeMap } from '../runtime/types';

function createRuntimeMapFixture(): RuntimeMap {
    return {
        schemaVersion: '1.0',
        project: 'runtime-graph-test',
        generatedAt: new Date().toISOString(),
        view: 'full',
        nodes: [
            { id: 'ApiRoute.POST./items/{id}/run', type: 'ApiRoute', label: 'POST /items/{id}/run' },
            { id: 'Service.ItemService.run', type: 'Service', label: 'ItemService.run', sourcePath: 'backend/service.py' },
            { id: 'Cache.Redis', type: 'Cache', label: 'Redis' },
            { id: 'ExternalApi.Webhook', type: 'ExternalApi', label: 'Webhook' }
        ],
        edges: [
            { from: 'ApiRoute.POST./items/{id}/run', to: 'Service.ItemService.run', type: 'invokes' },
            { id: 'edge-writes-redis', from: 'Service.ItemService.run', to: 'Cache.Redis', type: 'writes' },
            { from: 'Unknown.Node', to: 'Cache.Redis', type: 'depends_on' }
        ]
    };
}

test('buildRuntimeGraphIndex normalizes missing edge ids and adjacency lists', () => {
    const index = buildRuntimeGraphIndex(createRuntimeMapFixture());

    assert.equal(index.nodes.length, 4);
    assert.equal(index.edges.length, 2);
    assert.equal(index.incoming.get('Service.ItemService.run')?.length, 1);
    assert.equal(index.outgoing.get('Service.ItemService.run')?.length, 1);
    assert.ok(index.edges.some((edge) => edge.id.startsWith('RuntimeEdge.')));
    assert.ok(index.edgeById.has('edge-writes-redis'));
});

test('traceRuntimeGraph supports upstream/downstream/both with depth', () => {
    const index = buildRuntimeGraphIndex(createRuntimeMapFixture());

    const downstream = traceRuntimeGraph(index, 'ApiRoute.POST./items/{id}/run', 'downstream', 2);
    assert.deepEqual(
        Array.from(downstream.nodeIds).sort(),
        ['ApiRoute.POST./items/{id}/run', 'Cache.Redis', 'Service.ItemService.run']
    );
    assert.equal(downstream.edgeIds.size, 2);

    const upstream = traceRuntimeGraph(index, 'Cache.Redis', 'upstream', 1);
    assert.deepEqual(Array.from(upstream.nodeIds).sort(), ['Cache.Redis', 'Service.ItemService.run']);
    assert.equal(upstream.edgeIds.size, 1);

    const both = traceRuntimeGraph(index, 'Service.ItemService.run', 'both', 1);
    assert.deepEqual(
        Array.from(both.nodeIds).sort(),
        ['ApiRoute.POST./items/{id}/run', 'Cache.Redis', 'Service.ItemService.run']
    );
    assert.equal(both.edgeIds.size, 2);
});

test('filterRuntimeGraph applies query/type filters and hide-isolated option', () => {
    const index = buildRuntimeGraphIndex(createRuntimeMapFixture());

    const byQuery = filterRuntimeGraph(index, {
        query: 'service.itemservice',
        hideIsolated: false
    });
    assert.equal(byQuery.nodes.length, 1);
    assert.equal(byQuery.nodes[0].id, 'Service.ItemService.run');
    assert.equal(byQuery.edges.length, 0);

    const byTypeAndEdge = filterRuntimeGraph(index, {
        nodeTypes: ['ApiRoute', 'Service', 'Cache', 'ExternalApi'],
        edgeTypes: ['invokes'],
        hideIsolated: true
    });
    assert.deepEqual(
        byTypeAndEdge.nodes.map((node) => node.id).sort(),
        ['ApiRoute.POST./items/{id}/run', 'Service.ItemService.run']
    );
    assert.equal(byTypeAndEdge.edges.length, 1);
    assert.equal(byTypeAndEdge.edges[0].type, 'invokes');
});
