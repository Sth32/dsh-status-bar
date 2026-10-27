/**
 * `sessionModel` projection unit: the model pair of the last committed model
 * message. The client snapshot's assistant nodes do not carry
 * provenance, so the bar reads this projection instead of walking nodes.
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { modelIdentityFromSource, type SessionModelState } from './model-identity.ts'
export type { SessionModelState } from './model-identity.ts'

const sessionModelSchema = z.object({
  provider: z.string().nullable(),
  requestedModel: z.string().nullable(),
  responseModel: z.string().nullable(),
  seq: z.number().nullable(),
  updatedAt: z.number().nullable(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Last assistant-message model identity (null until the first message). */
    sessionModel: SessionModelState
  }
  interface SessionProjectionStateMap {
    /** Host fold state; the wire value is the state itself (view = identity). */
    sessionModel: SessionModelState
  }
}

export const sessionModelProjectionDefinition = {
  key: 'sessionModel',
  stateSchema: sessionModelSchema,
  init: () => ({ provider: null, requestedModel: null, responseModel: null, seq: null, updatedAt: null }),
  apply: (state, event) => {
    if (event.type !== 'assistant/message') return state
    const identity = modelIdentityFromSource(event.data.message.source)
    if (identity === null) return state
    // Replace the whole pair even when the request is unchanged. A missing
    // report on this message must clear the previous message's report.
    return { ...identity, seq: event.seq, updatedAt: event.time }
  },
  wire: { viewSchema: sessionModelSchema, view: state => state },
  stateVersion: 2,
} satisfies ProjectionDefinition<'sessionModel', SessionModelState>
