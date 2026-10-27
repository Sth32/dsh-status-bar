/**
 * `sessionUsage` projection unit: the whole session's token usage, folded
 * across every committed assistant/message event. Unlike `sessionModel`
 * (which keeps only the LAST model pair), this fold aggregates tokens by
 * REQUESTED model and keeps each message's pair and timestamp in `bySeq`.
 * Pricing continues to use the request's price-book entry and schedule.
 */
import { z } from 'zod';
import { type SessionUsageState } from './model-identity.ts';
export type { SessionUsageState } from './model-identity.ts';
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** Whole-session per-model usage plus the per-step model/time ledger. */
        sessionUsage: SessionUsageState;
    }
    interface SessionProjectionStateMap {
        /** Host fold state; the wire value is the state itself (view = identity). */
        sessionUsage: SessionUsageState;
    }
}
export declare const sessionUsageProjectionDefinition: {
    key: "sessionUsage";
    stateSchema: z.ZodObject<{
        models: z.ZodRecord<z.ZodString, z.ZodObject<{
            input: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
            output: z.ZodNumber;
        }, z.core.$strict>>;
        bySeq: z.ZodRecord<z.ZodString, z.ZodObject<{
            provider: z.ZodString;
            requestedModel: z.ZodString;
            responseModel: z.ZodNullable<z.ZodString>;
            time: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    init: () => {
        models: {};
        bySeq: {};
    };
    apply: (state: NoInfer<SessionUsageState>, event: import("@deepseek-ai/dsh-session").SessionEvent) => SessionUsageState;
    wire: {
        viewSchema: z.ZodObject<{
            models: z.ZodRecord<z.ZodString, z.ZodObject<{
                input: z.ZodNumber;
                cacheRead: z.ZodNumber;
                cacheWrite: z.ZodNumber;
                output: z.ZodNumber;
            }, z.core.$strict>>;
            bySeq: z.ZodRecord<z.ZodString, z.ZodObject<{
                provider: z.ZodString;
                requestedModel: z.ZodString;
                responseModel: z.ZodNullable<z.ZodString>;
                time: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        view: (state: NoInfer<SessionUsageState>) => SessionUsageState;
    };
    stateVersion: number;
};
