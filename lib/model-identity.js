function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function modelName(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
/**
 * Read the known pi-ai v2 response envelope. Other adapters/versions and
 * missing/invalid reports remain unknown. source.model is NEVER a response
 * fallback. See docs/model-provenance.md for the locked SDK's limitations.
 */
export function modelIdentityFromSource(value) {
    const source = record(value);
    if (source?.kind !== 'model')
        return null;
    const provider = modelName(source.provider);
    const requestedModel = modelName(source.model);
    if (provider === null || requestedModel === null)
        return null;
    const replay = record(source.replayState);
    const response = record(replay?.response);
    const matches = response?.kind === 'pi-ai' && response.version === 2
        && modelName(response.api) !== null
        && response.provider === provider && response.model === requestedModel;
    return {
        provider,
        requestedModel,
        responseModel: matches ? modelName(response.responseModel) : null,
    };
}
/**
 * Client wire compatibility: old projections/node metadata only had `model`.
 * That value is a request identity, and provides no response evidence.
 */
export function modelIdentityFromProjection(value) {
    const entry = record(value);
    if (entry === null)
        return null;
    const legacy = !('requestedModel' in entry);
    const requestedModel = modelName(legacy ? entry.model : entry.requestedModel);
    const provider = modelName(entry.provider);
    if (provider === null || requestedModel === null)
        return null;
    return {
        provider,
        requestedModel,
        responseModel: legacy ? null : modelName(entry.responseModel),
    };
}
//# sourceMappingURL=model-identity.js.map