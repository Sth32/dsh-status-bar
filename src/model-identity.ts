/** Model identities from ONE committed assistant message, never from settings. */
export interface ModelIdentity {
  provider: string
  /** Request identity; also the existing price-book key. */
  requestedModel: string
  /** Explicit adapter/SDK report, not a verification of the backend. */
  responseModel: string | null
}

export interface SessionModelState {
  provider: string | null
  requestedModel: string | null
  responseModel: string | null
  seq: number | null
  updatedAt: number | null
}

export interface SessionUsageState {
  /** Requested model id → whole-session token buckets. */
  models: Record<string, { input: number; cacheRead: number; cacheWrite: number; output: number }>
  /** Message sequence → its own model pair and timestamp. */
  bySeq: Record<string, ModelIdentity & { time: number }>
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function modelName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Read the known pi-ai v2 response envelope. Other adapters/versions and
 * missing/invalid reports remain unknown. source.model is NEVER a response
 * fallback. See docs/model-provenance.md for the locked SDK's limitations.
 */
export function modelIdentityFromSource(value: unknown): ModelIdentity | null {
  const source = record(value)
  if (source?.kind !== 'model') return null
  const provider = modelName(source.provider)
  const requestedModel = modelName(source.model)
  if (provider === null || requestedModel === null) return null
  const replay = record(source.replayState)
  const response = record(replay?.response)
  const matches = response?.kind === 'pi-ai' && response.version === 2
    && modelName(response.api) !== null
    && response.provider === provider && response.model === requestedModel
  return {
    provider,
    requestedModel,
    responseModel: matches ? modelName(response.responseModel) : null,
  }
}

/**
 * Client wire compatibility: old projections/node metadata only had `model`.
 * That value is a request identity, and provides no response evidence.
 */
export function modelIdentityFromProjection(value: unknown): ModelIdentity | null {
  const entry = record(value)
  if (entry === null) return null
  const legacy = !('requestedModel' in entry)
  const requestedModel = modelName(legacy ? entry.model : entry.requestedModel)
  const provider = modelName(entry.provider)
  if (provider === null || requestedModel === null) return null
  return {
    provider,
    requestedModel,
    responseModel: legacy ? null : modelName(entry.responseModel),
  }
}
