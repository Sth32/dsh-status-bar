import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelIdentityFromSource, modelIdentityFromProjection } from '../lib/model-identity.js'
import { sessionModelProjectionDefinition as model } from '../lib/model-projection.js'
import { sessionUsageProjectionDefinition as usage } from '../lib/session-usage.js'
import { message } from './fixtures.mjs'

// These fixtures test plugin consumption, NOT the origin of SDK fields.
// The independent, pinned SDK source audit is in docs/model-provenance.md.
test('reads the explicit report and request from the same pi-ai v2 envelope', () => {
  assert.deepEqual(modelIdentityFromSource(message(1, 'B').data.message.source), {
    provider: 'test-provider', requestedModel: 'A', responseModel: 'B',
  })
  assert.equal(modelIdentityFromSource(message(1, 'A').data.message.source).responseModel, 'A')
})

test('missing, blank and non-string reports never fall back to the request', () => {
  for (const report of [undefined, null, '', '  ', 1, {}, []]) {
    const identity = modelIdentityFromSource(message(1, report).data.message.source)
    assert.equal(identity.requestedModel, 'A')
    assert.equal(identity.responseModel, null)
  }
})

test('rejects other adapters, versions and mismatched request provenance', () => {
  for (const response of [
    { kind: 'deepseek-messages' }, { version: 1 }, { version: 3 },
    { api: '' }, { provider: 'other-provider' }, { model: 'other-request' },
  ]) {
    assert.equal(modelIdentityFromSource(message(1, 'B', { response }).data.message.source).responseModel, null)
  }
})

test('absent and malformed replay metadata remain unknown without throwing', () => {
  for (const replayState of [undefined, null, [], 'B', {}, { response: [] }, { response: null }]) {
    assert.deepEqual(modelIdentityFromSource({ kind: 'model', provider: 'p', model: 'A', replayState }), {
      provider: 'p', requestedModel: 'A', responseModel: null,
    })
  }
  for (const source of [null, [], {}, { kind: 'synthetic' }, { kind: 'model', model: 'A' }]) {
    assert.equal(modelIdentityFromSource(source), null)
  }
})

test('B → C → missing replaces the pair even though the request is unchanged', () => {
  let state = model.init()
  for (const [seq, report] of [[1, 'B'], [2, 'C'], [3, undefined]]) {
    const event = message(seq, report)
    state = model.apply(state, event)
    assert.deepEqual(state, {
      provider: 'test-provider', requestedModel: 'A', responseModel: report ?? null,
      seq, updatedAt: event.time,
    })
    assert.equal(model.stateSchema.safeParse(state).success, true)
  }
})

test('a model message without usage still clears the last response report', () => {
  const first = model.apply(model.init(), message(1, 'B'))
  const next = model.apply(first, message(2, undefined, { noUsage: true }))
  assert.equal(next.responseModel, null)
  assert.equal(next.seq, 2)
})

test('per-message history keeps each pair while totals retain requested-model keys', () => {
  let state = usage.init()
  for (const [seq, report] of [[1, 'B'], [2, 'C'], [3, undefined]]) {
    state = usage.apply(state, message(seq, report))
  }
  state = usage.apply(state, message(4, 'E', { requestedModel: 'D', provider: 'other-provider' }))
  assert.deepEqual(state.models, {
    A: { input: 300, cacheRead: 60, cacheWrite: 15, output: 30 },
    D: { input: 100, cacheRead: 20, cacheWrite: 5, output: 10 },
  })
  assert.deepEqual(Object.values(state.bySeq).map(row => [row.requestedModel, row.responseModel]), [
    ['A', 'B'], ['A', 'C'], ['A', null], ['D', 'E'],
  ])
  assert.equal(usage.stateSchema.safeParse(state).success, true)
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
})

test('v2 projections require rebuilding v1 caches; old event logs replay safely', () => {
  assert.equal(model.stateVersion, 2)
  assert.equal(usage.stateVersion, 2)
  assert.equal(model.stateSchema.safeParse({ provider: 'p', model: 'A', updatedAt: 1 }).success, false)
  const event = message(1, undefined)
  delete event.data.message.source.replayState
  assert.equal(model.apply(model.init(), event).responseModel, null)
  assert.equal(usage.apply(usage.init(), event).bySeq['1'].responseModel, null)
})

test('legacy client snapshots expose only a request identity', () => {
  assert.deepEqual(modelIdentityFromProjection({ provider: 'p', model: 'A', responseModel: 'unproven' }), {
    provider: 'p', requestedModel: 'A', responseModel: null,
  })
  assert.equal(modelIdentityFromProjection({ provider: null, requestedModel: null, responseModel: null }), null)
})
