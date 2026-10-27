import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { buildSegments } from '../src/client/segments.ts'
import { DEFAULT_CONFIG } from '../src/client/config.ts'
import { zh, en } from '../src/client/locales.ts'

// Compile the actual JSX component with the existing compiler; render real React
// markup without requiring a DSH desktop or adding a test framework dependency.
const compiled = ts.transpileModule(readFileSync(new URL('../src/client/Segment.tsx', import.meta.url), 'utf8'), {
  fileName: 'Segment.tsx', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
})
assert.equal(compiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
const exports = {}
runInNewContext(compiled.outputText, { exports, require: createRequire(import.meta.url) })
const { Segment } = exports

test('model hover titles and accessible descriptions expose full details in both languages', () => {
  for (const dictionary of [zh, en]) {
    const t = (key, params = {}) => dictionary[key].replace(/\{(\w+)\}/g, (_, name) => params[name])
    const views = buildSegments({
      chat: { nodes: [] }, sessionModel: { provider: 'provider/full-route', requestedModel: 'A', responseModel: null },
    }, { ...DEFAULT_CONFIG, segments: ['requestedModel', 'responseModel'] }, t)
    const html = renderToStaticMarkup(createElement('div', null, ...views.map(view => createElement(Segment, { key: view.id, view }))))
    assert.equal((html.match(/title="Provider: provider\/full-route/g) ?? []).length, 2)
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 2)
    assert.equal((html.match(/role="group"/g) ?? []).length, 2)
    const descriptionIds = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match => match[1])
    assert.equal(new Set(descriptionIds).size, 2)
    for (const id of descriptionIds) assert.ok(html.includes(`id="${id}" class="dsb-sr-only"`))
    for (const view of views) assert.ok(html.includes(`aria-label="${view.text}"`))
    assert.ok(html.includes('SDK'))
    assert.ok(html.includes(t('model.unknown')))
  }
})

test('ordinary segments keep their text/status dot without adding focus stops or descriptions', () => {
  const html = renderToStaticMarkup(createElement(Segment, { view: { id: 'status', state: 'idle', text: 'Idle' } }))
  assert.ok(html.includes('class="dsb-dot"'))
  assert.ok(html.includes('aria-hidden="true"'))
  assert.ok(html.includes('Idle'))
  assert.ok(!html.includes('tabindex'))
  assert.ok(!html.includes('aria-describedby'))
  assert.ok(!html.includes('title='))
})
