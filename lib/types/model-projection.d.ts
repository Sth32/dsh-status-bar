/**
 * `sessionModel` projection unit: the model pair of the last committed model
 * message. The client snapshot's assistant nodes do not carry
 * provenance, so the bar reads this projection instead of walking nodes.
 */
import { z } from 'zod';
import { type SessionModelState } from './model-identity.ts';
export type { SessionModelState } from './model-identity.ts';
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** Last assistant-message model identity (null until the first message). */
        sessionModel: SessionModelState;
    }
    interface SessionProjectionStateMap {
        /** Host fold state; the wire value is the state itself (view = identity). */
        sessionModel: SessionModelState;
    }
}
export declare const sessionModelProjectionDefinition: {
    key: "sessionModel";
    stateSchema: z.ZodObject<{
        provider: z.ZodNullable<z.ZodString>;
        requestedModel: z.ZodNullable<z.ZodString>;
        responseModel: z.ZodNullable<z.ZodString>;
        seq: z.ZodNullable<z.ZodNumber>;
        updatedAt: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
    init: () => {
        provider: null;
        requestedModel: null;
        responseModel: null;
        seq: null;
        updatedAt: null;
    };
    apply: (state: NoInfer<SessionModelState>, event: import("@deepseek-ai/dsh-session").SessionEvent) => SessionModelState;
    wire: {
        viewSchema: z.ZodObject<{
            provider: z.ZodNullable<z.ZodString>;
            requestedModel: z.ZodNullable<z.ZodString>;
            responseModel: z.ZodNullable<z.ZodString>;
            seq: z.ZodNullable<z.ZodNumber>;
            updatedAt: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        view: (state: NoInfer<SessionModelState>) => SessionModelState;
    };
    stateVersion: number;
};
