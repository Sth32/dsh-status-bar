import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageLedger } from '../lib/usage-ledger.js'
import { message, time } from './fixtures.mjs'

function dataDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-ledger-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const legacy = { t: time, model: 'A', input: 100, cacheRead: 20, cacheWrite: 5, output: 10 }
const stale = { ...legacy, t: time - 121 * 24 * 3_600_000 }
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n'

test('append persists one message\'s pair, and restarts preserve requested-model totals', t => {
  const dir = dataDir(t)
  const ledger = new UsageLedger(dir)
  for (const [seq, report] of [[1, 'B'], [2, 'C'], [3, undefined]]) ledger.record(message(seq, report))
  const rows = readFileSync(join(dir, 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepEqual(rows.map(row => [row.version, row.requestedModel, row.responseModel]), [
    [2, 'A', 'B'], [2, 'A', 'C'], [2, 'A', null],
  ])
  const expected = ledger.query('day', 0, time)
  assert.deepEqual(new UsageLedger(dir).query('day', 0, time), expected)
  assert.deepEqual(expected.buckets.flatMap(bucket => Object.keys(bucket.usage)), ['A'])
})

test('compaction and reload keep B, C, missing, legacy, and providers separate', t => {
  const dir = dataDir(t)
  const file = join(dir, 'usage.jsonl')
  writeFileSync(file, lines([legacy]))
  const ledger = new UsageLedger(dir)
  for (const event of [
    message(1, 'B'), message(2, 'B'), message(3, 'C'), message(4, undefined),
    message(5, 'B', { provider: 'other-provider' }),
  ]) ledger.record(event)
  const before = ledger.query('day', 0, time)
  appendFileSync(file, lines(Array.from({ length: 12 }, () => stale)))
  const compacted = new UsageLedger(dir)
  assert.deepEqual(compacted.query('day', 0, time), before)
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(rows.length, 5)
  assert.ok(rows.every(row => row.version === 2 && row.requestedModel === 'A'))
  assert.deepEqual(rows.map(row => [row.provider, row.responseModel, row.input]), [
    [null, null, 100], ['test-provider', 'B', 200], ['test-provider', 'C', 100],
    ['test-provider', null, 100], ['other-provider', 'B', 100],
  ])
  assert.deepEqual(new UsageLedger(dir).query('day', 0, time), before)
})

test('legacy model is only a request, including after migration', t => {
  const dir = dataDir(t)
  const file = join(dir, 'usage.jsonl')
  writeFileSync(file, lines([{ ...legacy, responseModel: 'unproven' }, stale, stale]))
  const ledger = new UsageLedger(dir)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8').trim()), {
    version: 2, t: time, provider: null, requestedModel: 'A', responseModel: null,
    input: 100, cacheRead: 20, cacheWrite: 5, output: 10,
  })
  assert.equal(ledger.query('day', 0, time).buckets.reduce((total, bucket) => total + (bucket.usage.A?.input ?? 0), 0), 100)
})

test('unreadable or future records do not get silently deleted by compaction', t => {
  for (const bad of ['not-json', JSON.stringify({ ...legacy, version: 99 }), JSON.stringify({ ...legacy, input: 'bad' })]) {
    const dir = dataDir(t)
    const file = join(dir, 'usage.jsonl')
    const text = lines([legacy, stale, stale]) + bad + '\n'
    writeFileSync(file, text)
    const ledger = new UsageLedger(dir)
    assert.equal(readFileSync(file, 'utf8'), text)
    assert.equal(ledger.query('day', 0, time).buckets.reduce((total, bucket) => total + (bucket.usage.A?.input ?? 0), 0), 100)
  }
})
