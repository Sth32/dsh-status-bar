/** Model identities from ONE committed assistant message, never from settings. */
export interface ModelIdentity {
    provider: string;
    /** Request identity; also the existing price-book key. */
    requestedModel: string;
    /** Explicit adapter/SDK report, not a verification of the backend. */
    responseModel: string | null;
}
export interface SessionModelState {
    provider: string | null;
    requestedModel: string | null;
    responseModel: string | null;
    seq: number | null;
    updatedAt: number | null;
}
export interface SessionUsageState {
    /** Requested model id → whole-session token buckets. */
    models: Record<string, {
        input: number;
        cacheRead: number;
        cacheWrite: number;
        output: number;
    }>;
    /** Message sequence → its own model pair and timestamp. */
    bySeq: Record<string, ModelIdentity & {
        time: number;
    }>;
}
/**
 * Read the known pi-ai v2 response envelope. Other adapters/versions and
 * missing/invalid reports remain unknown. source.model is NEVER a response
 * fallback. See docs/model-provenance.md for the locked SDK's limitations.
 */
export declare function modelIdentityFromSource(value: unknown): ModelIdentity | null;
/**
 * Client wire compatibility: old projections/node metadata only had `model`.
 * That value is a request identity, and provides no response evidence.
 */
export declare function modelIdentityFromProjection(value: unknown): ModelIdentity | null;
//# sourceMappingURL=model-identity.d.ts.map