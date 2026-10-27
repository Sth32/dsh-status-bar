import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSegments, lastModel, usageHistory, effectivePrices } from '../src/client/segments.ts'
import { stepModel, stepCost, costBreakdown } from '../src/client/session-usage-cost.ts'
import { DEFAULT_CONFIG, normalizeModelConfig } from '../src/client/config.ts'
import { zh, en } from '../src/client/locales.ts'
import { sessionUsageProjectionDefinition as usage } from '../lib/session-usage.js'
import { message, assistantNode, time } from './fixtures.mjs'

const cost = {
  currency: 'USD',
  models: Object.fromEntries([['A', 1], ['B', 1000], ['C', 2000]].map(([name, rate]) => [name,
    normalizeModelConfig({ input: rate, output: rate, cacheRead: rate, cacheWrite: rate, peakOffpeak: false }),
  ])),
}
const pricing = { dayRules: false, overrides: [] }
const translate = dictionary => (key, params = {}) => dictionary[key].replace(/\{(\w+)\}/g, (_, name) => params[name])

for (const [label, modelSegments] of [
  ['both', ['requestedModel', 'responseModel']],
  ['request only', ['requestedModel']],
  ['response only', ['responseModel']],
  ['neither', []],
]) {
  test(`model visibility: ${label}; preserve unknown, provider and requested-model pricing`, () => {
    const config = { ...DEFAULT_CONFIG, cost, segments: [...modelSegments, 'cost'] }
    for (const dictionary of [zh, en]) {
      for (const responseModel of ['B', 'C', 'unknown', null]) {
        const identity = Object.freeze({ provider: 'test-provider', requestedModel: 'A', responseModel })
        const source = {
          chat: { nodes: [] }, sessionModel: identity,
          sessionUsage: usage.apply(usage.init(), message(1, responseModel)), now: time,
        }
        const t = translate(dictionary)
        const description = t('bar.modelDetails', { provider: identity.provider, requested: 'A', response: responseModel ?? t('model.unknown') })
        const expected = []
        if (modelSegments.includes('requestedModel')) expected.push({ id: 'requestedModel', text: t('bar.requestedModel', { model: 'A' }), description })
        if (modelSegments.includes('responseModel')) expected.push({ id: 'responseModel', text: t('bar.responseModel', { model: responseModel ?? t('model.unknown') }), description })
        expected.push({ id: 'cost', text: '≈$0.0001' })
        assert.deepEqual(buildSegments(source, config, t), expected)
        assert.deepEqual(source.sessionModel, { provider: 'test-provider', requestedModel: 'A', responseModel })
      }
    }
  })
}

test('model segments respect independent ordering among other visible segments', () => {
  const config = { ...DEFAULT_CONFIG, segments: ['responseModel', 'queue', 'requestedModel'] }
  const source = { chat: { nodes: [] }, queueLength: 2, sessionModel: { provider: 'p', requestedModel: 'A', responseModel: 'B' } }
  const description = translate(en)('bar.modelDetails', { provider: 'p', requested: 'A', response: 'B' })
  assert.deepEqual(buildSegments(source, config, translate(en)), [
    { id: 'responseModel', text: 'Resp:B', description },
    { id: 'queue', text: 'Queue 2' },
    { id: 'requestedModel', text: 'Req:A', description },
  ])
})

for (const [language, dictionary, labels, disclaimer] of [
  ['zh', zh, ['请求:A', '响应:未知'], ['SDK 报告不验证实际后端', '缺失不能用请求模型回填']],
  ['en', en, ['Req:A', 'Resp:unknown'], ['does not verify the actual backend', 'must never be filled from the requested model']],
]) {
  test(`${language}: compact labels localize missing values and keep complete provenance in descriptions`, () => {
    const config = { ...DEFAULT_CONFIG, segments: ['requestedModel', 'responseModel'] }
    const identity = { provider: 'provider.example/full-route', requestedModel: 'A', responseModel: null }
    const source = { chat: { nodes: [] }, sessionModel: identity }
    const views = buildSegments(source, config, translate(dictionary))
    assert.deepEqual(views.map(view => view.text), labels)
    for (const view of views) {
      assert.ok(!view.text.includes('SDK'))
      assert.ok(view.description.includes(identity.provider))
      assert.ok(view.description.includes('A'))
      for (const phrase of disclaimer) assert.ok(view.description.includes(phrase))
    }
    const fullReport = 'provider-model-with-an-unabridged-version-suffix-1234567890'
    identity.responseModel = fullReport
    assert.ok(buildSegments(source, config, translate(dictionary))[1].description.includes(fullReport))
    assert.equal(source.sessionModel.responseModel, fullReport)
  })
}

test('window fallback stops at the latest assistant and never borrows older metadata', () => {
  const first = assistantNode(message(1, 'B'))
  const latest = assistantNode(message(2, undefined))
  delete latest.providerMetadata
  assert.equal(lastModel({ nodes: [first, latest] }, undefined), null)
  assert.deepEqual(lastModel({ nodes: [first] }, undefined), {
    provider: 'test-provider', requestedModel: 'A', responseModel: null,
  })
})

test('history pairs by sequence, including missing reports and a changed request', () => {
  const events = [message(1, 'B'), message(2, 'C'), message(3, undefined), message(4, 'Z', { requestedModel: 'X' })]
  const state = events.reduce((fold, event) => usage.apply(fold, event), usage.init())
  const rows = usageHistory({ nodes: events.map(assistantNode) }, state, cost, 200, pricing)
  assert.deepEqual(rows.map(row => [row.seq, row.requestedModel, row.responseModel]), [
    [4, 'X', 'Z'], [3, 'A', null], [2, 'A', 'C'], [1, 'A', 'B'],
  ])
  assert.equal(rows[0].cost, null)
  for (const row of rows.slice(1)) assert.equal(row.cost, 135 / 1_000_000)
})

test('response prices cannot replace the request price or price an unknown request', () => {
  const event = message(1, 'B')
  const state = usage.apply(usage.init(), event)
  assert.equal(effectivePrices(state.bySeq['1'], cost, time, false).input, 1)
  assert.equal(stepCost(state, 1, undefined, event.data.usage, cost, pricing), 135 / 1_000_000)
  assert.equal(costBreakdown(state, cost, time, pricing).total, 135 / 1_000_000)
  assert.equal(effectivePrices({ provider: 'p', requestedModel: 'unpriced', responseModel: 'B' }, cost, time), null)
})

test('old bySeq rows and metadata preserve request pricing with unknown response', () => {
  const old = { models: {}, bySeq: { '7': { provider: 'old-p', model: 'A', time } } }
  assert.deepEqual(stepModel(old, 7, { provider: 'wrong-p', model: 'B' }), {
    provider: 'old-p', requestedModel: 'A', responseModel: null,
  })
  assert.deepEqual(stepModel(undefined, 8, { provider: 'p', model: 'A' }), {
    provider: 'p', requestedModel: 'A', responseModel: null,
  })
  assert.deepEqual(stepModel(undefined, 8, {
    provider: 'p', model: 'A', requestedModel: 'unproven-request', responseModel: 'unproven-response',
  }), { provider: 'p', requestedModel: 'A', responseModel: null })
})

test('an unknown report in a matching history row does not borrow a different row', () => {
  const state = [message(1, 'B'), message(2, undefined)].reduce((fold, event) => usage.apply(fold, event), usage.init())
  assert.equal(stepModel(state, 2, { provider: 'p', model: 'B' }).responseModel, null)
  assert.equal(stepModel(state, 2, { provider: 'p', model: 'B' }).requestedModel, 'A')
})
