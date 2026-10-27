# Requested model and SDK-reported response model

The plugin stores two independent fields from the **same committed assistant
message**. `requestedModel` is the request identity and remains the price-book
key. `responseModel` is an explicit report retained by DSH's adapter/SDK. An
absent, invalid or unsupported report is stored as `null` and displayed as
`unknown` in English or `未知` in Chinese. The request is never substituted for
a response report.

The bar uses short labels: `Req:A | Resp:B` or `请求:A | 响应:B`. Hover titles
and linked accessible descriptions retain the full provider and both model IDs,
their source, and the **Response model (SDK-reported)** qualification. It is not
proof of the backend's identity, weights, routing or billing. A compatible API
gateway can report its own identifier. These changes do not intercept global
`fetch`, inspect credentials, or modify DSH or pi-ai.

## Audited versions and artifact verification

Audit date: 2026-10-27. The target is the latest published DSH release at that
date, [`dsh-v0.2.1-rc.3`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3)
(a prerelease), commit `1f81c047fc48fa190a683e469daa699857e9afe8`.

DSH's [locked llm-pi-ai dependency](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/pnpm-lock.yaml#L11215-L11228)
resolves `@earendil-works/pi-ai` to **1.1.0**, even though the package specifier
is `^1.1.0`. The lockfile records this tarball integrity:

```text
sha512-1T7LAkc/5Bvc0v6w4vAGVdCrli0o/E0pEmYKTnixu95vSFArBjvbhS/G4ZwI0RUePgf0Imcu0VyqlM4EcXxqfw==
```

The npm tarball downloaded with `npm pack @earendil-works/pi-ai@1.1.0
--ignore-scripts` was hashed with SHA-512 and matched that value. Its published
JavaScript was inspected, and the source-map `sourcesContent` for the seven
files below matched the repository sources at the SDK's `v1.1.0` commit
`abe508e1b89912adde45528136c3221eb69acdd7` byte for byte:

- `packages/ai/src/api/anthropic-messages.ts`
- `packages/ai/src/api/openai-completions.ts`
- `packages/ai/src/api/openai-responses.ts`
- `packages/ai/src/api/openai-responses-shared.ts`
- `packages/ai/src/api/simple-options.ts`
- `packages/ai/src/models.ts`
- `packages/ai/src/types.ts`

DSH also applies a [local pi-ai patch](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/patches/%40earendil-works__pi-ai%401.1.0.patch)
(lockfile patch hash `66eaf960054f10441b93ac3857114e96c1901f6d183713e2f21437b007111644`).
Its hunks remove partial tool-argument JSON parsing; they do not change the
model assignments described below. The SDK was audited as a dependency of
DSH; it is **not** added as a dependency of this plugin.

## Where the SDK value actually comes from

| SDK API path | Assignment in the locked SDK | What the plugin can conclude |
| --- | --- | --- |
| Anthropic Messages | [`anthropic-messages.ts`, lines 669–670](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/anthropic-messages.ts#L669-L670): reads `event.message.model` on `message_start`; assigns `output.responseModel` only if it differs from `model.id`. | A retained value in this audited path is copied from the streamed response. Equality with the request is omitted by the SDK. |
| OpenAI Chat Completions | [`openai-completions.ts`, lines 565–566](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-completions.ts#L565-L566): checks that `chunk.model` is a nonempty string different from `model.id`, then uses `output.responseModel ||= chunk.model`. | Retains the **first differing** reported stream model. It is not necessarily the final chunk's model if the wire value changes within a request. |
| OpenAI Responses | [`openai-responses.ts`](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-responses.ts) and [`openai-responses-shared.ts`](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-responses-shared.ts) have no `responseModel` assignment. `output.model` is initialized from the requested `model.id`. | No response identity is available through the inspected metadata; display `unknown`, even if the raw protocol includes a model elsewhere. |
| DSH native DeepSeek Messages | [Adapter translation](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-deepseek/src/translate.ts) and [replay metadata](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-deepseek/src/replay.ts) do not expose a separate response model in the supported path. | Display `unknown`; the replay's `model` is the request identity. |

The SDK's [`AssistantMessage.responseModel` declaration](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/types.ts#L550-L565)
also documents this different-from-request behavior. The code, not just that
comment or the field name, was checked. Other/custom provider paths have not
been independently proven to copy a raw wire field. If they supply a recognized
envelope, the UI still makes only the weaker **SDK-reported** claim.

**Missing does not mean equal.** In these versions, missing may mean equality
was omitted by the SDK, an unsupported API path, a missing wire field, absent
legacy metadata, or metadata DSH discarded during assembly. The plugin cannot
distinguish those cases. All remain `unknown`.

## DSH to plugin data flow

DSH's [agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/core/agent-loop/src/agent.ts#L529-L535)
stores the request's provider and model in the assistant message source.
[`toPiReplayState`](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-pi-ai/src/replay.ts#L77-L87)
copies `message.responseModel` only when defined, alongside the requested model
in the version-2 response envelope. This is the durable path the plugin reads:

```text
event.data.message.source.model
  → requestedModel
event.data.message.source.replayState.response.responseModel
  → responseModel (only a recognized, matching pi-ai v2 envelope)
```

`src/model-identity.ts` owns that parsing. It checks the envelope kind/version,
nonempty API identifier, and matching provider/request identity. It does not
scan arbitrary metadata keys, copy `response.model`, infer from current settings,
or borrow another message's report. Blank/non-string reports are unknown.

The `sessionModel` projection always replaces the pair on a committed model
message, including same-request B → C → missing transitions. It keeps that
message's sequence and timestamp. The two projections use state version 2 so
DSH rebuilds old version-1 caches from its retained event log. Responses without
token usage still update `sessionModel`; `sessionUsage` only counts messages
with usage, as before.

The history table resolves each pair by the row's sequence. Old client snapshots
and old node provider metadata can supply a request identity only. A latest
assistant with no metadata does not cause a search back to an older assistant.
During generation, the bar continues to show the latest committed model message;
this change does not claim to provide a raw live-wire response monitor.

## OpenAI Responses acquisition gap — diagnosis and proposal only

The initial status-bar implementation consumed an existing `responseModel`
field; it did **not** collect the OpenAI Responses raw event's model. The compact
UI update does not fix this gap. An export without that field proves only that
the field was not retained; it cannot prove the API omitted `model`.

Three distinct fields must not be conflated:

1. A parsed provider event's `event.response.model` is the wire report we want
   to preserve. It still does not verify the gateway's actual backend.
2. The SDK's normalized `AssistantMessage.model` is initialized from the
   requested `model.id` in
   [`openai-responses.ts:137–142`](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-responses.ts#L137-L142).
   The [shared finalizer](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-responses-shared.ts#L552-L602)
   copies the response ID, usage and stop status, but never copies its model.
3. DSH passes `model.id` to `toStreamChunks` in
   [`adapter.ts:416–426`](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-pi-ai/src/adapter.ts#L416-L426).
   The [done conversion](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-pi-ai/src/stream.ts#L208-L214)
   forwards that request identity to
   [`toPiReplayState`](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-pi-ai/src/replay.ts#L77-L87),
   which sets `replayState.response.model = requestedModel` and copies
   `message.responseModel` only if defined. This replay `model` is explicitly
   request-derived, not a substitute for the missing wire report.

### Existing extension points

The locked SDK already exposes a read-only, per-request
[`onProviderStreamEvent`](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/types.ts#L193-L204)
observer. [`Models.applyAuth` / `streamSimple`](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/models.ts#L865-L906)
retain it, [`buildBaseOptions`](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/simple-options.ts#L36-L64)
forwards it, and the Responses provider
[passes it to its stream processor](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-responses.ts#L191-L199).
The processor [awaits it for each parsed event before normalization](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/openai-responses-shared.ts#L599-L602).
`onResponse` exposes HTTP status/headers, not the response body, so it does not
solve this problem.

DSH's current adapter constructs a whitelist of SDK options at the call site
above and does not supply that observer. The public
[`GenerateOptions`](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm/src/types.ts#L529-L571)
has no raw-event hook. The
[`llm/stream` waterfall](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm/src/index.ts#L62-L75)
can wrap normalized chunks or replace the entire call, but its agent-loop
request is deep-frozen. A passive status-bar plugin cannot obtain the discarded
wire field from that stream or pass an extra option through this adapter.

Registering a new adapter is supported, but
[duplicate provider routes are rejected](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm/src/index.ts#L395-L443).
A plugin could own a separate route or replace the whole request pipeline in a
waterfall; either would take responsibility for transport, auth, replay and
retry behavior. That is a substantially larger provider implementation, not a
small observer attached to the existing route. Private-object monkey patches
and global fetch interception are not proposed.

### Smallest recommended change, pending separate approval

Modify only DSH's `packages/llm/llm-pi-ai` adapter package: its `src/adapter.ts`,
a small internal event-collector helper, and corresponding tests. No SDK
upgrade, SDK patch, public `GenerateOptions` change, session schema change,
core fork, or global network hook is needed for this design. **None of these
adapter changes is implemented in this status-bar commit.**

- Create the collector inside each `streamWithSnapshot` invocation, scoped to
  `model.api === 'openai-responses'`, and pass its observer to `streamSimple`.
- Observe only `response.created`, `response.in_progress`,
  `response.completed` and `response.incomplete`. Accept only explicit,
  nonblank string `event.response.model` values, including values equal to the
  request. Prefer a terminal event's valid value; if it omits the field, a
  previously observed report for that same response ID remains evidence.
- Keep response IDs and request attempts isolated. Conflicting IDs must not be
  combined, and a new call without a report starts unknown. Do not retain raw
  events, prompts, output text, headers or credentials.
- Before yielding that call's successful `finish` chunk, clone its existing
  pi-ai v2 replay envelope and add only the captured `responseModel` to
  `replayState.response`. Preserve `response.model`, source identity, content,
  stop reason, usage and price-book selection. The existing agent/session path
  then persists the report on the same assistant message.
- Keep the current failure/abort semantics: DSH's
  [error conversion has no replay state](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-pi-ai/src/stream.ts#L216-L226).
  Do not attach a failed attempt's captured report to a later successful retry.
  No raw report means unknown; old history cannot be backfilled.

Acceptance tests for that future change must exercise the actual locked SDK
with controlled raw Responses SSE fixtures, then DSH finish conversion and
message persistence. Replay-envelope fixtures alone cannot establish capture.
Cover distinct/equal/absent/blank/invalid models, created-only versus terminal
override, stop/tool-use/incomplete completion, response-ID mismatch, concurrent
calls, retry/abort/error isolation, B → C → missing, reload/compaction, and
unchanged requested-model pricing. A real provider integration remains a
separate local check; even a correctly preserved wire report does not verify
backend identity.

## Visibility and configuration migration

`requestedModel` and `responseModel` are independent segment IDs in the shared
registry used by the settings checkboxes, ordering controls and quick menu.
Both default to enabled. Hiding either segment changes only bar rendering;
the message pair, provider, history and requested-model pricing remain intact.

Each visible model segment has a native hover title, a short accessible name
and a unique `aria-describedby` target containing the full explanation. Model
segments can receive keyboard focus; ordinary segments do not add tab stops.
The description remains available when only one of the two model segments is
enabled. The bar's truncated-line tooltip also includes the full descriptions.

Config schema version 4 keeps the existing `dsh.statusBar.v1` storage key.
Loading a legacy enabled `model` expands it in place to requested, then response.
An absent legacy segment stays disabled, and an explicit empty list stays empty
instead of being reset to defaults. Other segment order and the existing
master/native, price-book and calendar settings are preserved. Duplicate/unknown
IDs are filtered. If new segment IDs already exist in a mixed configuration,
their explicit visibility wins; a stale `model` must not re-enable a hidden one.
Current-version configurations never expand the old ID. Settings are persisted
in the new form on the next settings change, following the existing store behavior.

## Ledger and pricing compatibility

New `usage.jsonl` records have `version: 2`, `t`, `provider`, `requestedModel`,
nullable `responseModel`, and the existing four token counts. Hourly compaction
groups by **provider + requestedModel + responseModel**, so B, C and unknown
cannot collapse into a single misleading identity. Reload preserves those pairs.

Legacy unversioned `{ model, ... }` rows load as `requestedModel: model`,
`responseModel: null`, `provider: null`. Their response identity cannot be
reconstructed. Compaction upgrades readable rows, but skips rewriting if the
file includes an unreadable/future-version record, to avoid silently deleting it.
The existing 120-day retention applies.

The chart API and price-book keys remain requested model IDs. Chart totals fold
the separate identity groups back into those keys; a different or missing SDK
report does not change estimated cost. This is an estimate from configured
rates, not a provider billing assertion. No prices or dependencies are upgraded.

## Regression tests and local integration

Validation performed in the development conversation on 2026-10-27 with Node
`24.22.1`, pnpm `11.25.0`, TypeScript `6.0.3` and tsdown `0.22.14`:

| Check | Result |
| --- | --- |
| Original lockfile, frozen dependency install | Passed; no dependency/lockfile changes |
| Original lockfile, host + client declarations + browser bundle | Passed; committed `lib/` is generated by this build |
| Model, client, accessibility and ledger regressions | 41 passed, 0 failed |
| Temporary project with all 18 direct DSH packages at `0.2.1-rc.3` | Full build passed; the same 41 tests passed; all 33 emitted JS/declaration files match the original-lockfile build byte for byte |
| Shipped JavaScript syntax | All 7 files passed `node --check` |
| Desktop/provider integration | Pending the user's local environment |

The repository's unchanged `pnpm-lock.yaml` has SHA-256
`b8cdc6f722c920107848765f7294c695972a760b2bffd5a92f017142b9dc89b8`.
The temporary compatibility project's dependency resolution was generated by
pnpm and is not part of the plugin commit.

Use Node 24 for the build/test commands (the client unit tests use Node's
built-in TypeScript stripping). No new test framework is required:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run verify  # after rebuilt lib/ is committed
```

Tests cover all four visibility combinations, independent ordering, legacy
enabled/disabled settings, empty lists, master/native flags, persistence/reload,
same-message extraction, invalid/absent/foreign metadata, B → C →
missing, no-usage messages, legacy projections/events, price selection, both
locales, compact labels, hover/accessibility markup, per-sequence history,
append/reload, legacy migration and compaction.
They are **plugin regression tests with fixtures**, not independent evidence
that a provider really ran a particular model. The SDK source audit above is a
separate check of provenance and its limits.

For desktop integration, use a test session on DSH `0.2.1-rc.3`. With a controlled
OpenAI Chat Completions provider requesting A, report B then C then omit the model on
three separate messages. Check the bar and history for A/B, A/C, A/unknown,
reload the session and restart DSH, and check again. Also exercise an equal-to-A
wire report: this SDK omits it, so the expected UI remains A/unknown. Test native
DeepSeek and OpenAI Responses for unknown, old sessions for request-only history,
and both languages/narrow window layouts. These desktop/provider integration
checks require the user's local DSH environment.
