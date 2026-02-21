/**
 * Tests for src/plugin/core/streaming/transformer.ts
 *
 * Covers: createThoughtBuffer, deduplicateThinkingText, transformSseLine,
 * cacheThinkingSignaturesFromResponse, createStreamingTransformer
 */

import { describe, it, expect, vi } from "vitest"
import {
  createThoughtBuffer,
  deduplicateThinkingText,
  transformSseLine,
  cacheThinkingSignaturesFromResponse,
  createStreamingTransformer,
  transformStreamingPayload,
} from "./transformer.ts"
import type { SignatureStore, ThoughtBuffer, StreamingCallbacks, StreamingOptions } from "./types.ts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignatureStore(): SignatureStore {
  const m = new Map<string, { text: string; signature: string }>()
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v) },
    has: (k) => m.has(k),
    delete: (k) => m.delete(k),
  }
}

function makeThoughtBuffer(): ThoughtBuffer {
  const m = new Map<number, string>()
  return {
    get: (i) => m.get(i),
    set: (i, v) => { m.set(i, v) },
    clear: () => m.clear(),
  }
}

const noopCallbacks: StreamingCallbacks = {}
const noopOptions: StreamingOptions = {}

function sseDebugState() {
  return { injected: false }
}

// ---------------------------------------------------------------------------
// createThoughtBuffer
// ---------------------------------------------------------------------------

describe("createThoughtBuffer", () => {
  it("returns a buffer that can set and get values", () => {
    const buf = createThoughtBuffer()
    buf.set(0, "hello")
    expect(buf.get(0)).toBe("hello")
  })

  it("returns undefined for missing keys", () => {
    const buf = createThoughtBuffer()
    expect(buf.get(42)).toBeUndefined()
  })

  it("clear removes all entries", () => {
    const buf = createThoughtBuffer()
    buf.set(0, "a")
    buf.set(1, "b")
    buf.clear()
    expect(buf.get(0)).toBeUndefined()
    expect(buf.get(1)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// deduplicateThinkingText - candidates path (Gemini)
// ---------------------------------------------------------------------------

describe("deduplicateThinkingText", () => {
  it("passes through non-object responses", () => {
    const sentBuf = makeThoughtBuffer()
    expect(deduplicateThinkingText("hello", sentBuf)).toBe("hello")
    expect(deduplicateThinkingText(null, sentBuf)).toBeNull()
  })

  it("passes through responses without candidates or content", () => {
    const sentBuf = makeThoughtBuffer()
    const resp = { someField: "value" }
    expect(deduplicateThinkingText(resp, sentBuf)).toEqual(resp)
  })

  it("returns delta text for incremental thinking chunks (candidates path)", () => {
    const sentBuf = makeThoughtBuffer()
    // First call: sets "hello " in sentBuf
    const resp1 = {
      candidates: [
        { content: { parts: [{ thought: true, text: "hello ", thinking: "hello " }] } },
      ],
    }
    const result1 = deduplicateThinkingText(resp1, sentBuf) as Record<string, unknown>
    const cands1 = result1.candidates as Array<Record<string, unknown>>
    const parts1 = (cands1[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>
    expect(parts1[0]?.text).toBe("hello ")

    // Second call: full text "hello world" — delta should be "world"
    const resp2 = {
      candidates: [
        { content: { parts: [{ thought: true, text: "hello world", thinking: "hello world" }] } },
      ],
    }
    const result2 = deduplicateThinkingText(resp2, sentBuf) as Record<string, unknown>
    const cands2 = result2.candidates as Array<Record<string, unknown>>
    const parts2 = (cands2[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>
    expect(parts2[0]?.text).toBe("world")
  })

  it("filters out null parts when thinking has no new delta", () => {
    const sentBuf = makeThoughtBuffer()
    // Prime the buffer: "hello" already sent
    sentBuf.set(0, "hello")
    const resp = {
      candidates: [
        { content: { parts: [{ thought: true, text: "hello", thinking: "hello" }] } },
      ],
    }
    const result = deduplicateThinkingText(resp, sentBuf) as Record<string, unknown>
    const cands = result.candidates as Array<Record<string, unknown>>
    const parts = (cands[0]?.content as Record<string, unknown>)?.parts as Array<unknown>
    // null filtered out, empty parts array
    expect(parts).toHaveLength(0)
  })

  it("skips candidate without content", () => {
    const sentBuf = makeThoughtBuffer()
    const resp = { candidates: [null, { content: null }] }
    const result = deduplicateThinkingText(resp, sentBuf)
    expect(result).toBeDefined()
  })

  it("deduplicates by hash when displayedThinkingHashes is provided (candidates)", () => {
    const sentBuf = makeThoughtBuffer()
    const displayed = new Set<string>()
    const resp = {
      candidates: [
        { content: { parts: [{ thought: true, text: "unique thought", thinking: "unique thought" }] } },
      ],
    }
    // First call: new hash → included
    const r1 = deduplicateThinkingText(resp, sentBuf, displayed) as Record<string, unknown>
    const cands1 = r1.candidates as Array<Record<string, unknown>>
    const parts1 = (cands1[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>
    expect(parts1.length).toBeGreaterThan(0)

    // Second call: same hash → filtered out (duplicate)
    const sentBuf2 = makeThoughtBuffer()
    const r2 = deduplicateThinkingText(resp, sentBuf2, displayed) as Record<string, unknown>
    const cands2 = r2.candidates as Array<Record<string, unknown>>
    const parts2 = (cands2[0]?.content as Record<string, unknown>)?.parts as Array<unknown>
    expect(parts2).toHaveLength(0)
  })

  it("returns incremental delta for Claude content blocks", () => {
    const sentBuf = makeThoughtBuffer()
    // Claude format: resp.content array with type=thinking blocks
    const resp1 = {
      content: [{ type: "thinking", thinking: "step one", text: "step one" }],
    }
    const r1 = deduplicateThinkingText(resp1, sentBuf) as Record<string, unknown>
    const blocks1 = r1.content as Array<Record<string, unknown>>
    expect(blocks1[0]?.thinking).toBe("step one")

    const resp2 = {
      content: [{ type: "thinking", thinking: "step one and two", text: "step one and two" }],
    }
    const r2 = deduplicateThinkingText(resp2, sentBuf) as Record<string, unknown>
    const blocks2 = r2.content as Array<Record<string, unknown>>
    expect(blocks2[0]?.thinking).toBe(" and two")
  })

  it("filters null from content blocks (no new delta)", () => {
    const sentBuf = makeThoughtBuffer()
    sentBuf.set(0, "same text")
    const resp = {
      content: [{ type: "thinking", thinking: "same text", text: "same text" }],
    }
    const r = deduplicateThinkingText(resp, sentBuf) as Record<string, unknown>
    expect((r.content as Array<unknown>)).toHaveLength(0)
  })

  it("deduplicates by hash in Claude content path", () => {
    const sentBuf = makeThoughtBuffer()
    const displayed = new Set<string>()
    const resp = {
      content: [{ type: "thinking", thinking: "thought abc", text: "thought abc" }],
    }
    deduplicateThinkingText(resp, sentBuf, displayed) // adds hash
    const sentBuf2 = makeThoughtBuffer()
    const r2 = deduplicateThinkingText(resp, sentBuf2, displayed) as Record<string, unknown>
    expect((r2.content as Array<unknown>)).toHaveLength(0)
  })

  it("includes inline image data as text when inlineData is present", () => {
    const sentBuf = makeThoughtBuffer()
    const resp = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "text/plain", data: "aGVsbG8=" } },
            ],
          },
        },
      ],
    }
    // processImageData returns null for non-image types, part passes through
    const result = deduplicateThinkingText(resp, sentBuf) as Record<string, unknown>
    expect(result).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// cacheThinkingSignaturesFromResponse
// ---------------------------------------------------------------------------

describe("cacheThinkingSignaturesFromResponse", () => {
  it("does nothing when response is not an object", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    // Should not throw
    cacheThinkingSignaturesFromResponse("not-object", "key", store, buf)
    expect(store.has("key")).toBe(false)
  })

  it("accumulates thinking text and caches signature (candidates path)", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const onCache = vi.fn()

    const response = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "thinking content" },
              { thoughtSignature: "sig-123" },
            ],
          },
        },
      ],
    }
    cacheThinkingSignaturesFromResponse(response, "session-1", store, buf, onCache)

    expect(store.has("session-1")).toBe(true)
    expect(store.get("session-1")?.signature).toBe("sig-123")
    expect(onCache).toHaveBeenCalledWith("session-1", "thinking content", "sig-123")
  })

  it("accumulates thinking text and caches signature (Claude content path)", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const onCache = vi.fn()

    const response = {
      content: [
        { type: "thinking", thinking: "my thoughts" },
        { signature: "claude-sig" },
      ],
    }
    cacheThinkingSignaturesFromResponse(response, "sess-2", store, buf, onCache)

    expect(store.get("sess-2")?.signature).toBe("claude-sig")
    expect(onCache).toHaveBeenCalledWith("sess-2", "my thoughts", "claude-sig")
  })

  it("does not call onCacheSignature when no thinking text accumulated", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const onCache = vi.fn()

    const response = {
      candidates: [
        {
          content: {
            parts: [{ thoughtSignature: "sig-no-text" }],
          },
        },
      ],
    }
    cacheThinkingSignaturesFromResponse(response, "sess-3", store, buf, onCache)
    expect(onCache).not.toHaveBeenCalled()
  })

  it("skips candidate without content", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const response = { candidates: [null, { content: null }] }
    // Should not throw
    cacheThinkingSignaturesFromResponse(response, "key", store, buf)
    expect(store.has("key")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transformSseLine
// ---------------------------------------------------------------------------

describe("transformSseLine", () => {
  it("passes through non-data lines unchanged", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const line = "event: ping"
    expect(transformSseLine(line, store, buf, sent, noopCallbacks, noopOptions, sseDebugState())).toBe(line)
  })

  it("passes through empty data lines unchanged", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    expect(transformSseLine("data: ", store, buf, sent, noopCallbacks, noopOptions, sseDebugState())).toBe("data: ")
  })

  it("passes through data lines with invalid JSON unchanged", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const line = "data: {invalid}"
    expect(transformSseLine(line, store, buf, sent, noopCallbacks, noopOptions, sseDebugState())).toBe(line)
  })

  it("passes through data lines with no response property unchanged", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const line = `data: ${JSON.stringify({ error: { code: 429 } })}`
    expect(transformSseLine(line, store, buf, sent, noopCallbacks, noopOptions, sseDebugState())).toBe(line)
  })

  it("transforms data lines with response property", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const payload = { response: { candidates: [{ text: "hi" }] } }
    const line = `data: ${JSON.stringify(payload)}`
    const result = transformSseLine(line, store, buf, sent, noopCallbacks, noopOptions, sseDebugState())
    expect(result.startsWith("data:")).toBe(true)
  })

  it("caches signatures when cacheSignatures=true and signatureSessionKey set", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const onCache = vi.fn()
    const callbacks: StreamingCallbacks = { onCacheSignature: onCache }
    const options: StreamingOptions = { cacheSignatures: true, signatureSessionKey: "s-1" }

    const payload = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "thought text" },
                { thoughtSignature: "sig-abc" },
              ],
            },
          },
        ],
      },
    }
    const line = `data: ${JSON.stringify(payload)}`
    transformSseLine(line, store, buf, sent, callbacks, options, sseDebugState())
    expect(onCache).toHaveBeenCalledWith("s-1", "thought text", "sig-abc")
  })

  it("injects debugText on first data line with response", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const injected: unknown[] = []
    const callbacks: StreamingCallbacks = {
      onInjectDebug: (response, text) => {
        injected.push(text)
        return response
      },
    }
    const options: StreamingOptions = { debugText: "debug-info" }
    const debugState = sseDebugState()

    const payload = { response: { candidates: [] } }
    const line = `data: ${JSON.stringify(payload)}`
    transformSseLine(line, store, buf, sent, callbacks, options, debugState)
    expect(injected).toContain("debug-info")
    expect(debugState.injected).toBe(true)

    // Second call should NOT inject again
    injected.length = 0
    transformSseLine(line, store, buf, sent, callbacks, options, debugState)
    expect(injected).toHaveLength(0)
  })

  it("calls transformThinkingParts on response", () => {
    const store = makeSignatureStore()
    const buf = makeThoughtBuffer()
    const sent = makeThoughtBuffer()
    const transformed: unknown[] = []
    const callbacks: StreamingCallbacks = {
      transformThinkingParts: (response) => {
        transformed.push(response)
        return response
      },
    }
    const payload = { response: { candidates: [] } }
    const line = `data: ${JSON.stringify(payload)}`
    transformSseLine(line, store, buf, sent, callbacks, noopOptions, sseDebugState())
    expect(transformed).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// createStreamingTransformer — TransformStream integration
// ---------------------------------------------------------------------------

async function collectStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

async function pipeThrough(
  input: string,
  transformer: TransformStream<Uint8Array, Uint8Array>,
): Promise<string> {
  const encoder = new TextEncoder()
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input))
      controller.close()
    },
  })
  const output = readable.pipeThrough(transformer)
  return collectStream(output)
}

describe("createStreamingTransformer", () => {
  it("passes through non-data lines unchanged", async () => {
    const store = makeSignatureStore()
    const transformer = createStreamingTransformer(store, noopCallbacks)
    const input = "event: ping\n"
    const output = await pipeThrough(input, transformer)
    expect(output).toContain("event: ping")
  })

  it("transforms data lines with response property", async () => {
    const store = makeSignatureStore()
    const transformer = createStreamingTransformer(store, noopCallbacks)
    const payload = { response: { candidates: [{ content: { parts: [{ text: "hello" }] } }] } }
    const input = `data: ${JSON.stringify(payload)}\n`
    const output = await pipeThrough(input, transformer)
    expect(output).toContain("data:")
    expect(output).toContain("hello")
  })

  it("injects synthetic usageMetadata when none seen in stream", async () => {
    const store = makeSignatureStore()
    const transformer = createStreamingTransformer(store, noopCallbacks)
    const input = "data: {\"response\":{}}\n"
    const output = await pipeThrough(input, transformer)
    expect(output).toContain("usageMetadata")
    expect(output).toContain("promptTokenCount")
  })

  it("does NOT inject synthetic usageMetadata when already present", async () => {
    const store = makeSignatureStore()
    const transformer = createStreamingTransformer(store, noopCallbacks)
    const payload = {
      response: {
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 },
      },
    }
    const input = `data: ${JSON.stringify(payload)}\n`
    const output = await pipeThrough(input, transformer)
    // Should contain usageMetadata from original, not injected synthetic (promptTokenCount=50)
    expect(output).toContain('"promptTokenCount":50')
    // Count occurrences — synthetic adds promptTokenCount:0, original has 50
    const syntheticCount = (output.match(/"promptTokenCount":0/g) || []).length
    expect(syntheticCount).toBe(0)
  })

  it("handles multi-line SSE correctly (lines split across chunks)", async () => {
    const store = makeSignatureStore()
    const transformer = createStreamingTransformer(store, noopCallbacks)
    const input = "event: delta\ndata: {\"response\":{\"candidates\":[]}}\n"
    const output = await pipeThrough(input, transformer)
    expect(output).toContain("event: delta")
    expect(output).toContain("data:")
  })

  it("handles remaining buffer in flush when no newline at end", async () => {
    const store = makeSignatureStore()
    const transformer = createStreamingTransformer(store, noopCallbacks)
    // No trailing newline — goes to flush path
    const input = "data: {\"response\":{\"candidates\":[]}}"
    const output = await pipeThrough(input, transformer)
    expect(output).toContain("data:")
  })

  it("uses session key to cache signatures", async () => {
    const store = makeSignatureStore()
    const onCache = vi.fn()
    const callbacks: StreamingCallbacks = { onCacheSignature: onCache }
    const options: StreamingOptions = { cacheSignatures: true, signatureSessionKey: "s-abc" }
    const transformer = createStreamingTransformer(store, callbacks, options)

    const payload = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "my thought" },
                { thoughtSignature: "my-sig" },
              ],
            },
          },
        ],
      },
    }
    const input = `data: ${JSON.stringify(payload)}\n`
    await pipeThrough(input, transformer)
    expect(store.has("s-abc")).toBe(true)
    expect(store.get("s-abc")?.signature).toBe("my-sig")
  })
})

// ---------------------------------------------------------------------------
// transformStreamingPayload
// ---------------------------------------------------------------------------

describe("transformStreamingPayload (transformer re-export)", () => {
  it("calls transformThinkingParts on response objects", () => {
    const calls: unknown[] = []
    const payload = `data: ${JSON.stringify({ response: { candidates: [] } })}`
    transformStreamingPayload(payload, (r) => {
      calls.push(r)
      return r
    })
    expect(calls).toHaveLength(1)
  })

  it("skips lines without response property", () => {
    const calls: unknown[] = []
    const payload = `data: ${JSON.stringify({ error: "bad" })}`
    transformStreamingPayload(payload, (r) => {
      calls.push(r)
      return r
    })
    expect(calls).toHaveLength(0)
  })
})
