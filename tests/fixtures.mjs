// Keep retention-window tests independent of the calendar date of the run.
export const time = new Date().setHours(12, 15, 0, 0)

export function message(seq, responseModel, options = {}) {
  const provider = options.provider ?? 'test-provider'
  const requestedModel = options.requestedModel ?? 'A'
  const response = {
    kind: 'pi-ai', version: 2, api: 'openai-completions',
    provider, model: requestedModel, stopReason: 'stop',
    ...(responseModel === undefined ? {} : { responseModel }),
    ...options.response,
  }
  return {
    type: 'assistant/message', seq, time: options.time ?? time + seq,
    data: {
      message: {
        role: 'assistant', content: [{ type: 'text', text: 'fixture' }],
        source: { kind: 'model', provider, model: requestedModel, replayState: { response, blocks: [{ type: 'text' }] } },
      },
      ...(options.noUsage ? {} : { usage: { inputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 5, outputTokens: 10 } }),
    },
  }
}

export function assistantNode(event) {
  return {
    kind: 'assistant', seq: event.seq, turn: 1, time: event.time,
    usage: event.data.usage,
    providerMetadata: { provider: event.data.message.source.provider, model: event.data.message.source.model },
  }
}
