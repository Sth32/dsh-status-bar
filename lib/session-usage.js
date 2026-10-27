/**
 * `sessionUsage` projection unit: the whole session's token usage, folded
 * across every committed assistant/message event. Unlike `sessionModel`
 * (which keeps only the LAST model pair), this fold aggregates tokens by
 * REQUESTED model and keeps each message's pair and timestamp in `bySeq`.
 * Pricing continues to use the request's price-book entry and schedule.
 */
import { z } from 'zod';
import { modelIdentityFromSource } from "./model-identity.js";
const sessionUsageSchema = z.object({
    models: z.record(z.string(), z.object({
        input: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
        output: z.number(),
    }).strict()),
    bySeq: z.record(z.string(), z.object({
        provider: z.string(),
        requestedModel: z.string(),
        responseModel: z.string().nullable(),
        time: z.number(),
    }).strict()),
}).strict();
export const sessionUsageProjectionDefinition = {
    key: 'sessionUsage',
    stateSchema: sessionUsageSchema,
    init: () => ({ models: {}, bySeq: {} }),
    apply: (state, event) => {
        if (event.type !== 'assistant/message')
            return state;
        const usage = event.data.usage;
        if (usage === undefined)
            return state;
        const identity = modelIdentityFromSource(event.data.message.source);
        if (identity === null)
            return state;
        const current = state.models[identity.requestedModel];
        const nextModel = {
            input: (current?.input ?? 0) + usage.inputTokens,
            cacheRead: (current?.cacheRead ?? 0) + (usage.cacheReadTokens ?? 0),
            cacheWrite: (current?.cacheWrite ?? 0) + (usage.cacheWriteTokens ?? 0),
            output: (current?.output ?? 0) + usage.outputTokens,
        };
        return {
            models: { ...state.models, [identity.requestedModel]: nextModel },
            bySeq: { ...state.bySeq, [String(event.seq)]: { ...identity, time: event.time } },
        };
    },
    wire: { viewSchema: sessionUsageSchema, view: state => state },
    stateVersion: 2,
};
//# sourceMappingURL=session-usage.js.map