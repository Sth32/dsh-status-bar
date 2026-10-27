import { test } from 'node:test'
import assert from 'node:assert/strict'

const storageKey = 'dsh.statusBar.v1'
let reloadId = 0

/** Exercise the real localStorage load/persist path with a fresh module instance. */
function storedConfig(t, initial) {
  const values = new Map(initial === undefined ? [] : [[storageKey, JSON.stringify(initial)]])
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    } },
  })
  t.after(() => {
    if (previous === undefined) delete globalThis.window
    else Object.defineProperty(globalThis, 'window', previous)
  })
  return {
    reload: () => import(`../src/client/config.ts?model-controls=${reloadId++}`),
    read: () => JSON.parse(values.get(storageKey) ?? 'null'),
    write: value => values.set(storageKey, JSON.stringify(value)),
  }
}

test('fresh installs enable both independently registered model segments', async t => {
  const config = await storedConfig(t).reload()
  assert.equal(config.CONFIG_VERSION, 4)
  assert.deepEqual(config.getConfig(), config.DEFAULT_CONFIG)
  assert.deepEqual(config.getConfig().segments.slice(0, 3), ['status', 'requestedModel', 'responseModel'])
  assert.equal(config.SEGMENT_IDS.includes('model'), false)
  assert.equal(config.SEGMENT_META.requestedModel.label, 'seg.requestedModel')
  assert.equal(config.SEGMENT_META.responseModel.label, 'seg.responseModel')
  assert.equal(config.SEGMENT_IDS.length, 17)
  assert.equal(config.getConfig().segments.length, 14)
})

test('legacy enabled model expands consecutively in place without changing other settings', async t => {
  const store = storedConfig(t)
  for (const version of [undefined, 1, 2, 3]) {
    store.write({
      version, segments: ['queue', 'model', 'tokens', 'status', 'context', 'cost'], wrap: true,
      cost: { currency: 'USD', models: { A: { input: 7, output: 11, peakOffpeak: false } } },
      calendar: { dayRules: false, autoFetch: false, overrides: [{ date: '2026-10-27', kind: 'work', label: 'manual' }] },
    })
    const { getConfig } = await store.reload()
    const loaded = getConfig()
    assert.deepEqual(loaded.segments, ['queue', 'requestedModel', 'responseModel', 'tokens', 'status', 'context', 'cost'])
    assert.equal(loaded.version, 4)
    assert.equal(loaded.wrap, true)
    assert.equal(loaded.cost.currency, 'USD')
    assert.equal(loaded.cost.models.A.input, 7)
    assert.equal(loaded.cost.models.A.output, 11)
    assert.equal(loaded.cost.models.A.peakOffpeak, false)
    assert.deepEqual(loaded.calendar, { dayRules: false, autoFetch: false, overrides: [{ date: '2026-10-27', kind: 'work', label: 'manual' }] })
  }
})

test('legacy disabled model and empty/all-filtered segment lists stay disabled', async t => {
  const store = storedConfig(t)
  for (const version of [undefined, 1, 2, 3]) {
    for (const [segments, expected] of [
      [['tokens', 'queue', 'status'], ['tokens', 'queue', 'status']],
      [[], []],
      [['agent', 'invalid'], []],
    ]) {
      store.write({ version, segments })
      const { getConfig } = await store.reload()
      assert.deepEqual(getConfig().segments, expected)
    }
  }
})

test('legacy migration preserves disabled master and native-mode switches', async t => {
  const store = storedConfig(t)
  for (const switches of [{ enabled: false, native: false }, { enabled: true, native: true }]) {
    store.write({ version: 3, segments: ['model', 'tokens'], wrap: false, ...switches })
    const config = await store.reload()
    assert.deepEqual(config.getConfig().segments, ['requestedModel', 'responseModel', 'tokens'])
    assert.equal(config.getConfig().enabled, switches.enabled)
    assert.equal(config.getConfig().native, switches.native)
    assert.equal(config.getConfig().wrap, false)
    config.updateConfig({ segments: ['responseModel', 'tokens'] })
    const reloaded = (await store.reload()).getConfig()
    assert.equal(reloaded.enabled, switches.enabled)
    assert.equal(reloaded.native, switches.native)
  }
})

test('legacy duplicate/unknown IDs cannot duplicate or displace the migrated pair', async t => {
  const config = await storedConfig(t, {
    version: 3, segments: ['tokens', 'model', 'queue', 'model', 'tokens', 'invalid', 'status'],
  }).reload()
  assert.deepEqual(config.getConfig().segments, ['tokens', 'requestedModel', 'responseModel', 'queue', 'status'])
})

test('explicit new visibility wins over stale legacy IDs in mixed configurations', async t => {
  const store = storedConfig(t)
  for (const [version, segments, expected] of [
    [3, ['model', 'responseModel', 'tokens'], ['responseModel', 'tokens']],
    [3, ['requestedModel', 'tokens', 'model'], ['requestedModel', 'tokens']],
    [4, ['model', 'tokens'], ['tokens']],
    [4, ['model'], []],
  ]) {
    store.write({ version, segments })
    assert.deepEqual((await store.reload()).getConfig().segments, expected)
  }
})

for (const [label, segments] of [
  ['both', ['responseModel', 'tokens', 'requestedModel', 'queue']],
  ['request only', ['tokens', 'requestedModel', 'queue']],
  ['response only', ['responseModel', 'tokens', 'queue']],
  ['neither', ['tokens', 'queue']],
]) {
  test(`new configuration reload preserves ${label} and its saved order`, async t => {
    const store = storedConfig(t, { version: 4, segments, wrap: true })
    const config = await store.reload()
    assert.deepEqual(config.getConfig().segments, segments)
    config.updateConfig({ wrap: false })
    assert.equal(store.read().version, 4)
    assert.deepEqual(store.read().segments, segments)
    assert.deepEqual((await store.reload()).getConfig(), config.getConfig())
  })
}

test('independent toggles use the existing append-on-enable convention and persist every combination', async t => {
  const store = storedConfig(t, { version: 3, segments: ['model', 'tokens'] })
  let config = await store.reload()
  for (const [id, expected] of [
    ['requestedModel', ['responseModel', 'tokens']],
    ['responseModel', ['tokens']],
    ['requestedModel', ['tokens', 'requestedModel']],
    ['responseModel', ['tokens', 'requestedModel', 'responseModel']],
  ]) {
    config.toggleSegment(id)
    assert.deepEqual(config.getConfig().segments, expected)
    assert.deepEqual(store.read().segments, expected)
    assert.equal(store.read().version, 4)
    config = await store.reload()
    assert.deepEqual(config.getConfig().segments, expected)
  }
})

test('reordering either model persists independently and leaves other segments in order', async t => {
  const store = storedConfig(t, { version: 3, segments: ['tokens', 'model', 'status'] })
  const config = await store.reload()
  config.moveSegment('responseModel', -1)
  assert.deepEqual(config.getConfig().segments, ['tokens', 'responseModel', 'requestedModel', 'status'])
  config.moveSegment('requestedModel', 1)
  assert.deepEqual(config.getConfig().segments, ['tokens', 'responseModel', 'status', 'requestedModel'])
  config.moveSegment('requestedModel', 1)
  assert.deepEqual((await store.reload()).getConfig().segments, ['tokens', 'responseModel', 'status', 'requestedModel'])
})

test('turning off the final segments remains all-off after save/reload', async t => {
  const store = storedConfig(t, { version: 3, segments: ['model'] })
  const config = await store.reload()
  config.toggleSegment('requestedModel')
  config.toggleSegment('responseModel')
  assert.deepEqual(store.read().segments, [])
  assert.deepEqual((await store.reload()).getConfig().segments, [])
})

test('reset restores both default model segments while retaining holiday overrides', async t => {
  const overrides = [{ date: '2026-10-27', kind: 'off', label: 'manual' }]
  const store = storedConfig(t, { version: 4, segments: [], calendar: { overrides } })
  const config = await store.reload()
  config.resetConfig()
  const reloaded = (await store.reload()).getConfig()
  assert.deepEqual(reloaded.segments, config.DEFAULT_CONFIG.segments)
  assert.deepEqual(reloaded.calendar.overrides, overrides)
})
