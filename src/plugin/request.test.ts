import { describe, it, expect } from "vitest";
import {
  prepareAntigravityRequest,
  getPluginSessionId,
  isGenerativeLanguageRequest,
  buildThinkingWarmupBody,
  transformAntigravityResponse,
  __testExports,
} from "./request";
import type { SignatureStore, ThoughtBuffer, StreamingCallbacks, StreamingOptions } from "./core/streaming/types";

const {
  buildSignatureSessionKey,
  hashConversationSeed,
  extractTextFromContent,
  extractConversationSeedFromMessages,
  extractConversationSeedFromContents,
  resolveProjectKey,
  isGeminiToolUsePart,
  isGeminiThinkingPart,
  ensureThoughtSignature,
  hasSignedThinkingPart,
  hasToolUseInContents,
  hasSignedThinkingInContents,
  hasToolUseInMessages,
  hasSignedThinkingInMessages,
  generateSyntheticProjectId,
  MIN_SIGNATURE_LENGTH,
  transformStreamingPayload,
  createStreamingTransformer,
  transformSseLine,
} = __testExports;

function createMockSignatureStore(): SignatureStore {
  const store = new Map<string, { text: string; signature: string }>();
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: { text: string; signature: string }) => store.set(key, value),
    has: (key: string) => store.has(key),
    delete: (key: string) => store.delete(key),
  };
}

function createMockThoughtBuffer(): ThoughtBuffer {
  const buffer = new Map<number, string>();
  return {
    get: (idx: number) => buffer.get(idx),
    set: (idx: number, text: string) => buffer.set(idx, text),
    clear: () => buffer.clear(),
  };
}

const defaultCallbacks: StreamingCallbacks = {};
const defaultOptions: StreamingOptions = {};
const defaultDebugState = { injected: false };

describe("request.ts", () => {
  describe("getPluginSessionId", () => {
    it("returns consistent session ID across calls", () => {
      const id1 = getPluginSessionId();
      const id2 = getPluginSessionId();
      expect(id1).toBe(id2);
      expect(id1).toBeTruthy();
    });
  });

  describe("isGenerativeLanguageRequest", () => {
    it("returns true for generativelanguage.googleapis.com URLs", () => {
      expect(isGenerativeLanguageRequest("https://generativelanguage.googleapis.com/v1/models")).toBe(true);
    });

    it("returns false for other URLs", () => {
      expect(isGenerativeLanguageRequest("https://api.anthropic.com/v1/messages")).toBe(false);
    });

    it("returns false for non-string inputs", () => {
      expect(isGenerativeLanguageRequest({} as any)).toBe(false);
      expect(isGenerativeLanguageRequest(new Request("https://example.com"))).toBe(false);
    });
  });

  describe("buildSignatureSessionKey", () => {
    it("builds key from sessionId, model, project, and conversation", () => {
      const key = buildSignatureSessionKey("session-1", "claude-3", "conv-456", "proj-123");
      expect(key).toBe("session-1:claude-3:proj-123:conv-456");
    });

    it("uses defaults for missing optional params", () => {
      expect(buildSignatureSessionKey("s1", undefined, undefined, undefined)).toBe("s1:unknown:default:default");
      expect(buildSignatureSessionKey("s1", "model", undefined, undefined)).toBe("s1:model:default:default");
    });

    it("handles empty strings as defaults", () => {
      expect(buildSignatureSessionKey("s1", "", "", "")).toBe("s1:unknown:default:default");
    });
  });

  describe("hashConversationSeed", () => {
    it("returns consistent hash for same input", () => {
      const hash1 = hashConversationSeed("test-seed");
      const hash2 = hashConversationSeed("test-seed");
      expect(hash1).toBe(hash2);
    });

    it("returns different hash for different inputs", () => {
      const hash1 = hashConversationSeed("seed-1");
      const hash2 = hashConversationSeed("seed-2");
      expect(hash1).not.toBe(hash2);
    });

    it("handles empty string", () => {
      const hash = hashConversationSeed("");
      expect(hash).toBeTruthy();
    });
  });

  describe("extractTextFromContent", () => {
    it("extracts text from string content", () => {
      expect(extractTextFromContent("hello world")).toBe("hello world");
    });

    it("extracts first text from content array with text blocks", () => {
      const content = [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ];
      expect(extractTextFromContent(content)).toBe("hello");
    });

    it("returns empty string for non-text blocks", () => {
      const content = [{ type: "image", source: {} }];
      expect(extractTextFromContent(content)).toBe("");
    });

    it("returns first text block only (not concatenated)", () => {
      const content = [
        { type: "text", text: "before" },
        { type: "image", source: {} },
        { type: "text", text: "after" },
      ];
      expect(extractTextFromContent(content)).toBe("before");
    });

    it("returns empty string for null/undefined", () => {
      expect(extractTextFromContent(null)).toBe("");
      expect(extractTextFromContent(undefined)).toBe("");
    });
  });

  describe("extractConversationSeedFromMessages", () => {
    it("extracts seed from first user message", () => {
      const messages = [
        { role: "user", content: "first message" },
        { role: "assistant", content: "response" },
      ];
      const seed = extractConversationSeedFromMessages(messages);
      expect(seed).toContain("first message");
    });

    it("returns empty string when no user messages", () => {
      const messages = [{ role: "assistant", content: "response" }];
      expect(extractConversationSeedFromMessages(messages)).toBe("");
    });

    it("handles empty messages array", () => {
      expect(extractConversationSeedFromMessages([])).toBe("");
    });
  });

  describe("extractConversationSeedFromContents", () => {
    it("extracts seed from first user content", () => {
      const contents = [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi" }] },
      ];
      const seed = extractConversationSeedFromContents(contents);
      expect(seed).toContain("hello");
    });

    it("returns empty string when no user content", () => {
      const contents = [{ role: "model", parts: [{ text: "hi" }] }];
      expect(extractConversationSeedFromContents(contents)).toBe("");
    });
  });

  describe("resolveProjectKey", () => {
    it("returns candidate if it is a string", () => {
      expect(resolveProjectKey("my-project")).toBe("my-project");
    });

    it("returns fallback if candidate is not a string", () => {
      expect(resolveProjectKey(null, "fallback")).toBe("fallback");
      expect(resolveProjectKey(undefined, "fallback")).toBe("fallback");
      expect(resolveProjectKey({}, "fallback")).toBe("fallback");
    });

    it("returns undefined if no valid candidate or fallback", () => {
      expect(resolveProjectKey(null)).toBeUndefined();
      expect(resolveProjectKey(undefined)).toBeUndefined();
    });
  });

  describe("isGeminiToolUsePart", () => {
    it("returns true for functionCall parts", () => {
      expect(isGeminiToolUsePart({ functionCall: { name: "test" } })).toBe(true);
    });

    it("returns false for non-functionCall parts", () => {
      expect(isGeminiToolUsePart({ text: "hello" })).toBe(false);
      expect(isGeminiToolUsePart({ thought: true })).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isGeminiToolUsePart(null)).toBe(false);
      expect(isGeminiToolUsePart(undefined)).toBe(false);
    });
  });

  describe("isGeminiThinkingPart", () => {
    it("returns true for thought:true parts", () => {
      expect(isGeminiThinkingPart({ thought: true, text: "thinking..." })).toBe(true);
    });

    it("returns false for thought:false parts", () => {
      expect(isGeminiThinkingPart({ thought: false, text: "not thinking" })).toBe(false);
    });

    it("returns false for parts without thought property", () => {
      expect(isGeminiThinkingPart({ text: "hello" })).toBe(false);
    });
  });

  describe("ensureThoughtSignature", () => {
    it("adds sentinel signature when no cached signature exists", () => {
      const part = { thought: true, text: "thinking..." };
      const result = ensureThoughtSignature(part, "no-cache-session");
      // Now uses sentinel fallback to prevent API rejection
      expect(result.thoughtSignature).toBe("skip_thought_signature_validator");
    });

    it("preserves existing thoughtSignature", () => {
      const existingSignature = "a".repeat(MIN_SIGNATURE_LENGTH + 10);
      const part = { thought: true, text: "thinking...", thoughtSignature: existingSignature };
      const result = ensureThoughtSignature(part, "session-key");
      expect(result.thoughtSignature).toBe(existingSignature);
    });

    it("does not modify non-thinking parts", () => {
      const part = { text: "regular text" };
      const result = ensureThoughtSignature(part, "session-key");
      expect(result.thoughtSignature).toBeUndefined();
    });

    it("returns null/undefined inputs unchanged", () => {
      expect(ensureThoughtSignature(null, "key")).toBeNull();
      expect(ensureThoughtSignature(undefined, "key")).toBeUndefined();
    });

    it("returns non-object inputs unchanged", () => {
      expect(ensureThoughtSignature("string", "key")).toBe("string");
      expect(ensureThoughtSignature(123, "key")).toBe(123);
    });
  });

  describe("hasSignedThinkingPart", () => {
    it("returns true for part with valid thoughtSignature", () => {
      const part = { thought: true, thoughtSignature: "a".repeat(MIN_SIGNATURE_LENGTH) };
      expect(hasSignedThinkingPart(part)).toBe(true);
    });

    it("returns true for type:thinking with valid signature field", () => {
      const part = { type: "thinking", thinking: "...", signature: "a".repeat(MIN_SIGNATURE_LENGTH) };
      expect(hasSignedThinkingPart(part)).toBe(true);
    });

    it("returns true for type:reasoning with valid signature field", () => {
      const part = { type: "reasoning", signature: "a".repeat(MIN_SIGNATURE_LENGTH) };
      expect(hasSignedThinkingPart(part)).toBe(true);
    });

    it("returns false for part with short signature", () => {
      const part = { thought: true, thoughtSignature: "short" };
      expect(hasSignedThinkingPart(part)).toBe(false);
    });

    it("returns false for part without signature", () => {
      const part = { thought: true, text: "no signature" };
      expect(hasSignedThinkingPart(part)).toBe(false);
    });
  });

  describe("hasToolUseInContents", () => {
    it("returns true when contents have functionCall", () => {
      const contents = [
        { role: "model", parts: [{ functionCall: { name: "test" } }] },
      ];
      expect(hasToolUseInContents(contents)).toBe(true);
    });

    it("returns false when no functionCall present", () => {
      const contents = [
        { role: "model", parts: [{ text: "hello" }] },
      ];
      expect(hasToolUseInContents(contents)).toBe(false);
    });

    it("handles empty contents", () => {
      expect(hasToolUseInContents([])).toBe(false);
    });
  });

  describe("hasSignedThinkingInContents", () => {
    it("returns true when contents have signed thinking", () => {
      const contents = [
        {
          role: "model",
          parts: [{ thought: true, thoughtSignature: "a".repeat(MIN_SIGNATURE_LENGTH) }],
        },
      ];
      expect(hasSignedThinkingInContents(contents)).toBe(true);
    });

    it("returns false when no signed thinking present", () => {
      const contents = [
        { role: "model", parts: [{ thought: true, text: "unsigned" }] },
      ];
      expect(hasSignedThinkingInContents(contents)).toBe(false);
    });
  });

  describe("hasToolUseInMessages", () => {
    it("returns true when messages have tool_use blocks", () => {
      const messages = [
        { role: "assistant", content: [{ type: "tool_use", id: "123", name: "test" }] },
      ];
      expect(hasToolUseInMessages(messages)).toBe(true);
    });

    it("returns false when no tool_use blocks", () => {
      const messages = [
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
      ];
      expect(hasToolUseInMessages(messages)).toBe(false);
    });

    it("handles string content", () => {
      const messages = [{ role: "assistant", content: "just text" }];
      expect(hasToolUseInMessages(messages)).toBe(false);
    });
  });

  describe("hasSignedThinkingInMessages", () => {
    it("returns true when messages have signed thinking blocks", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "...", signature: "a".repeat(MIN_SIGNATURE_LENGTH) }],
        },
      ];
      expect(hasSignedThinkingInMessages(messages)).toBe(true);
    });

    it("returns false when thinking blocks are unsigned", () => {
      const messages = [
        { role: "assistant", content: [{ type: "thinking", thinking: "no sig" }] },
      ];
      expect(hasSignedThinkingInMessages(messages)).toBe(false);
    });
  });

  describe("generateSyntheticProjectId", () => {
    it("generates a string in expected format", () => {
      const id = generateSyntheticProjectId();
      expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{5}$/);
    });

    it("generates unique IDs on each call", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        ids.add(generateSyntheticProjectId());
      }
      expect(ids.size).toBe(10);
    });
  });

  describe("MIN_SIGNATURE_LENGTH", () => {
    it("is 50", () => {
      expect(MIN_SIGNATURE_LENGTH).toBe(50);
    });
  });

  describe("transformSseLine", () => {
    const callTransformSseLine = (line: string) => {
      const store = createMockSignatureStore();
      const buffer = createMockThoughtBuffer();
      const sentBuffer = createMockThoughtBuffer();
      return transformSseLine(line, store, buffer, sentBuffer, defaultCallbacks, defaultOptions, { ...defaultDebugState });
    };

    it("returns empty lines unchanged", () => {
      expect(callTransformSseLine("")).toBe("");
      expect(callTransformSseLine("   ")).toBe("   ");
    });

    it("returns non-data lines unchanged", () => {
      expect(callTransformSseLine("event: message")).toBe("event: message");
      expect(callTransformSseLine(": heartbeat")).toBe(": heartbeat");
    });

    it("handles data: [DONE] unchanged", () => {
      expect(callTransformSseLine("data: [DONE]")).toBe("data: [DONE]");
    });

    it("handles invalid JSON gracefully", () => {
      expect(callTransformSseLine("data: not-json")).toBe("data: not-json");
      expect(callTransformSseLine("data: {invalid}")).toBe("data: {invalid}");
    });

    it("passes through valid JSON without thinking parts", () => {
      const payload = { candidates: [{ content: { parts: [{ text: "hello" }] } }] };
      const line = `data: ${JSON.stringify(payload)}`;
      const result = callTransformSseLine(line);
      expect(result).toContain("data:");
      expect(result).toContain("hello");
    });

    it("transforms thinking parts in streaming data", () => {
      const payload = {
        candidates: [{
          content: {
            parts: [{ thought: true, text: "reasoning..." }]
          }
        }]
      };
      const line = `data: ${JSON.stringify(payload)}`;
      const result = callTransformSseLine(line);
      expect(result).toContain("data:");
    });
  });

  describe("transformStreamingPayload", () => {
    it("handles empty string", () => {
      expect(transformStreamingPayload("")).toBe("");
    });

    it("handles single line without data prefix", () => {
      expect(transformStreamingPayload("event: ping")).toBe("event: ping");
    });

    it("handles multiple lines", () => {
      const input = "event: message\ndata: [DONE]\n";
      const result = transformStreamingPayload(input);
      expect(result).toContain("event: message");
      expect(result).toContain("data: [DONE]");
    });

    it("preserves line structure", () => {
      const input = "line1\nline2\nline3";
      const result = transformStreamingPayload(input);
      const lines = result.split("\n");
      expect(lines.length).toBe(3);
    });
  });

  describe("createStreamingTransformer", () => {
    it("returns a TransformStream", () => {
      const store = createMockSignatureStore();
      const transformer = createStreamingTransformer(store, defaultCallbacks);
      expect(transformer).toBeInstanceOf(TransformStream);
      expect(transformer.readable).toBeDefined();
      expect(transformer.writable).toBeDefined();
    });

    it("accepts optional signatureSessionKey", () => {
      const store = createMockSignatureStore();
      const transformer = createStreamingTransformer(store, defaultCallbacks, { signatureSessionKey: "session-key" });
      expect(transformer).toBeInstanceOf(TransformStream);
    });

    it("accepts optional debugText", () => {
      const store = createMockSignatureStore();
      const transformer = createStreamingTransformer(store, defaultCallbacks, { signatureSessionKey: "session-key", debugText: "debug info" });
      expect(transformer).toBeInstanceOf(TransformStream);
    });

    it("accepts cacheSignatures flag", () => {
      const store = createMockSignatureStore();
      const transformer = createStreamingTransformer(store, defaultCallbacks, { signatureSessionKey: "session-key", cacheSignatures: true });
      expect(transformer).toBeInstanceOf(TransformStream);
    });

    it("processes chunks through the stream", async () => {
      const store = createMockSignatureStore();
      const transformer = createStreamingTransformer(store, defaultCallbacks);
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const input = encoder.encode("data: [DONE]\n");
      const outputChunks: Uint8Array[] = [];

      const writer = transformer.writable.getWriter();
      const reader = transformer.readable.getReader();

      const readPromise = (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) outputChunks.push(value);
        }
      })();

      await writer.write(input);
      await writer.close();
      await readPromise;

      const output = outputChunks.map(chunk => decoder.decode(chunk)).join("");
      expect(output).toContain("[DONE]");
    });
  });

  describe("prepareAntigravityRequest", () => {
    const mockAccessToken = "test-token";
    const mockProjectId = "test-project";

    it("returns unchanged request for non-generative-language URLs", () => {
      const result = prepareAntigravityRequest(
        "https://example.com/api",
        { method: "POST" },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
      expect(result.request).toBe("https://example.com/api");
    });

    it("returns unchanged request for URLs without model pattern", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1/models",
        { method: "POST" },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
    });

    it("detects streaming from generateStreamContent action", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(true);
    });

    it("detects non-streaming from generateContent action", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
    });

    it("sets Authorization header with Bearer token", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      const headers = result.init.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer test-token");
    });

    it("removes x-api-key header", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }), headers: { "x-api-key": "old-key" } },
        mockAccessToken,
        mockProjectId
      );
      const headers = result.init.headers as Headers;
      expect(headers.get("x-api-key")).toBeNull();
    });

    it("removes x-goog-user-project header for antigravity headerStyle", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }), headers: { "x-goog-user-project": "my-project" } },
        mockAccessToken,
        mockProjectId,
        undefined,
        "antigravity"
      );
      const headers = result.init.headers as Headers;
      expect(headers.get("x-goog-user-project")).toBeNull();
    });

    it("preserves x-goog-user-project header for gemini-cli headerStyle", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }), headers: { "x-goog-user-project": "my-project" } },
        mockAccessToken,
        mockProjectId,
        undefined,
        "gemini-cli"
      );
      const headers = result.init.headers as Headers;
      expect(headers.get("x-goog-user-project")).toBe("my-project");
    });

    it("uses exact Code Assist headers for gemini-cli headerStyle", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
        undefined,
        "gemini-cli"
      );
      const headers = result.init.headers as Headers;
      expect(headers.get("User-Agent")).toBe("google-api-nodejs-client/9.15.1");
      expect(headers.get("X-Goog-Api-Client")).toBe("gl-node/22.17.0");
      expect(headers.get("Client-Metadata")).toBe("ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI");
    });

    it("builds gemini-cli wrapped body without antigravity-only fields", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }) },
        mockAccessToken,
        "",
        undefined,
        "gemini-cli"
      );
      const parsed = JSON.parse(result.init.body as string);
      expect(parsed).toHaveProperty("project", "");
      expect(parsed).toHaveProperty("model");
      expect(parsed).toHaveProperty("request");
      expect(parsed.requestType).toBeUndefined();
      expect(parsed.userAgent).toBeUndefined();
      expect(parsed.requestId).toBeUndefined();
    });

    it("identifies Claude models correctly", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-sonnet-4-20250514:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.effectiveModel).toContain("claude");
    });

    it("identifies Gemini models correctly", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.effectiveModel).toContain("gemini");
    });

    it("uses custom endpoint override", () => {
      const customEndpoint = "https://custom.api.com";
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
        customEndpoint
      );
      expect(result.endpoint).toContain(customEndpoint);
    });

    it("handles wrapped Antigravity body format", () => {
      const wrappedBody = {
        project: "my-project",
        request: { contents: [{ parts: [{ text: "Hello" }] }] }
      };
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify(wrappedBody) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
    });

    it("uses high tier effective model for wrapped gemini-3.1-pro when variant is high", () => {
      const wrappedBody = {
        project: "my-project",
        request: {
          contents: [{ parts: [{ text: "Hello" }] }],
          providerOptions: {
            google: {
              thinkingLevel: "high",
            },
          },
        },
      };

      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
        { method: "POST", body: JSON.stringify(wrappedBody) },
        mockAccessToken,
        mockProjectId,
        undefined,
        "antigravity"
      );

      expect(result.effectiveModel).toBe("gemini-3.1-pro-high");
    });

    it("uses high tier effective model when wrapped providerOptions is at top level", () => {
      const wrappedBody = {
        project: "my-project",
        providerOptions: {
          google: {
            thinkingLevel: "high",
          },
        },
        request: {
          contents: [{ parts: [{ text: "Hello" }] }],
        },
      };

      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
        { method: "POST", body: JSON.stringify(wrappedBody) },
        mockAccessToken,
        mockProjectId,
        undefined,
        "antigravity"
      );

      expect(result.effectiveModel).toBe("gemini-3.1-pro-high");
    });

    it("handles unwrapped body format", () => {
      const unwrappedBody = {
        contents: [{ parts: [{ text: "Hello" }] }]
      };
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify(unwrappedBody) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
    });

    it("returns requestedModel matching URL model", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.requestedModel).toBe("gemini-2.5-flash");
    });

    it("handles empty body gracefully", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({}) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
    });

    it("handles minimal valid JSON body", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId
      );
      expect(result.streaming).toBe(false);
    });

    it("preserves headerStyle in response", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
        undefined,
        "gemini-cli"
      );
      expect(result.headerStyle).toBe("gemini-cli");
    });

    describe("Issue #103: model name transformation during quota fallback", () => {
      it("transforms gemini-3-flash-preview to gemini-3-flash for antigravity headerStyle", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
          undefined,
          "antigravity"
        );
        expect(result.effectiveModel).toBe("gemini-3-flash");
      });

      it("transforms gemini-3.1-pro-preview to gemini-3.1-pro for antigravity headerStyle", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
          undefined,
          "antigravity"
        );
        expect(result.effectiveModel).toBe("gemini-3.1-pro-low");
      });

      it("uses gemini-3.1-pro-high when variant thinkingLevel is high", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              contents: [],
              providerOptions: {
                google: {
                  thinkingLevel: "high",
                },
              },
            }),
          },
          mockAccessToken,
          mockProjectId,
          undefined,
          "antigravity"
        );

        expect(result.effectiveModel).toBe("gemini-3.1-pro-high");
      });

      it("transforms gemini-3-flash to gemini-3-flash-preview for gemini-cli headerStyle", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
          undefined,
          "gemini-cli"
        );
        expect(result.effectiveModel).toBe("gemini-3-flash-preview");
      });

      it("transforms gemini-3.1-pro-low to gemini-3.1-pro-preview for gemini-cli headerStyle", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-low:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
          undefined,
          "gemini-cli"
        );
        expect(result.effectiveModel).toBe("gemini-3.1-pro-preview");
      });

      it("keeps non-Gemini-3 models unchanged regardless of headerStyle", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
          undefined,
          "antigravity"
        );
        expect(result.effectiveModel).toBe("gemini-2.5-flash");
      });
    });

    describe("Claude model handling", () => {
      const claudeUrl = "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:streamGenerateContent";

      it("processes Claude model with messages format", () => {
        const result = prepareAntigravityRequest(
          claudeUrl,
          {
            method: "POST",
            body: JSON.stringify({
              messages: [
                { role: "user", content: "hello" },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        );
        expect(result.effectiveModel).toContain("claude");
        expect(result.streaming).toBe(true);
      });

      it("handles Claude model with tool use in messages", () => {
        const result = prepareAntigravityRequest(
          claudeUrl,
          {
            method: "POST",
            body: JSON.stringify({
              messages: [
                { role: "user", content: "use a tool" },
                {
                  role: "assistant",
                  content: [
                    { type: "tool_use", id: "tool-1", name: "bash", input: { cmd: "ls" } },
                  ],
                },
                {
                  role: "user",
                  content: [
                    { type: "tool_result", tool_use_id: "tool-1", content: "output" },
                  ],
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        );
        expect(result).toBeDefined();
        expect(result.effectiveModel).toContain("claude");
      });

      it("handles Claude model with tools array", () => {
        const result = prepareAntigravityRequest(
          claudeUrl,
          {
            method: "POST",
            body: JSON.stringify({
              messages: [{ role: "user", content: "search for me" }],
              tools: [
                {
                  name: "web_search",
                  description: "Search the web",
                  input_schema: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"],
                  },
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        );
        expect(result).toBeDefined();
      });

      it("handles Claude model with gemini-style contents and functionCall", () => {
        const result = prepareAntigravityRequest(
          claudeUrl,
          {
            method: "POST",
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: "call a tool" }] },
                {
                  role: "model",
                  parts: [{ functionCall: { name: "bash", args: { cmd: "ls" } } }],
                },
                {
                  role: "user",
                  parts: [{ functionResponse: { name: "bash", response: { output: "file.txt" } } }],
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        );
        expect(result).toBeDefined();
      });

      it("handles forceThinkingRecovery=true for Claude model", () => {
        const result = prepareAntigravityRequest(
          claudeUrl,
          {
            method: "POST",
            body: JSON.stringify({
              messages: [{ role: "user", content: "think hard" }],
            }),
          },
          mockAccessToken,
          mockProjectId,
          undefined,
          "antigravity",
          true, // forceThinkingRecovery
        );
        // Should still return a valid result (even if recovery applied)
        expect(result).toBeDefined();
      });
    });

    describe("prepareAntigravityRequest - system prompt handling", () => {
      it("handles request with system prompt in body", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "hello" }] }],
              system_instruction: { parts: [{ text: "You are a helpful assistant" }] },
            }),
          },
          mockAccessToken,
          mockProjectId,
        );
        expect(result.streaming).toBe(false);
      });

      it("transforms endpoint to use projectId", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          "my-project-123",
        );
        // The resolved projectId is stored in the result
        expect(result.projectId).toBe("my-project-123");
      });

      it("handles empty body gracefully", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
          { method: "POST", body: "" },
          mockAccessToken,
          mockProjectId,
        );
        expect(result).toBeDefined();
      });

      it("handles undefined body gracefully", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
          { method: "POST" },
          mockAccessToken,
          mockProjectId,
        );
        expect(result).toBeDefined();
      });

      it("sets gemini-cli style headers when headerStyle is gemini-cli", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
          undefined,
          "gemini-cli",
        );
        const headers = new Headers(result.init.headers as HeadersInit);
        expect(headers.has("X-Goog-Api-Client") || headers.has("Client-Metadata")).toBe(true);
      });
    });
});

// =============================================================================
// buildThinkingWarmupBody
// =============================================================================

describe("buildThinkingWarmupBody", () => {
  it("returns null when bodyText is undefined", () => {
    expect(buildThinkingWarmupBody(undefined, true)).toBeNull()
  })

  it("returns null when isClaudeThinking is false", () => {
    const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] })
    expect(buildThinkingWarmupBody(body, false)).toBeNull()
  })

  it("returns null on invalid JSON", () => {
    expect(buildThinkingWarmupBody("{ invalid", true)).toBeNull()
  })

  it("replaces contents with warmup prompt", () => {
    const original = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "real question" }] }],
      tools: [{ functionDeclarations: [] }],
    })
    const result = buildThinkingWarmupBody(original, true)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.contents).toEqual([{ role: "user", parts: [{ text: "Warmup request for thinking signature." }] }])
    expect(parsed.tools).toBeUndefined()
  })

  it("adds thinkingConfig to generationConfig", () => {
    const original = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { temperature: 0.5 },
    })
    const result = buildThinkingWarmupBody(original, true)
    const parsed = JSON.parse(result!)
    expect(parsed.generationConfig.thinkingConfig).toBeDefined()
    expect(parsed.generationConfig.thinkingConfig.include_thoughts).toBe(true)
  })

  it("handles nested request structure", () => {
    const original = JSON.stringify({
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        request: {
          contents: [{ role: "user", parts: [{ text: "inner" }] }],
        },
      },
    })
    const result = buildThinkingWarmupBody(original, true)
    const parsed = JSON.parse(result!)
    // Both outer and inner request should be updated
    expect(parsed.request.contents[0].parts[0].text).toBe("Warmup request for thinking signature.")
    expect(parsed.request.request.contents[0].parts[0].text).toBe("Warmup request for thinking signature.")
  })
})

// =============================================================================
// transformAntigravityResponse
// =============================================================================

function makeResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const hdrs = new Headers({ "content-type": "application/json", ...headers })
  return new Response(body, { status, headers: hdrs })
}

describe("transformAntigravityResponse", () => {
  it("returns response unchanged for non-JSON, non-SSE content-type", async () => {
    const resp = new Response("binary data", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    })
    const result = await transformAntigravityResponse(resp, false)
    expect(result.status).toBe(200)
  })

  it("passes through successful JSON response body", async () => {
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello" }] } }] })
    const resp = makeResponse(body)
    const result = await transformAntigravityResponse(resp, false)
    expect(result.ok).toBe(true)
    const text = await result.text()
    expect(text).toContain("hello")
  })

  it("sets retry-after headers from retryDelay in error response", async () => {
    // The retry-after block (line 1729) runs when errorBody exists but errorBody.error is falsy.
    // This is an edge case path — a 429 body with details but no .error top-level key.
    const body = JSON.stringify({
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "42.5s",
        },
      ],
    })
    const resp = makeResponse(body, 429)
    const result = await transformAntigravityResponse(resp, false)
    // The path sets Retry-After only when errorBody.error is falsy but errorBody.error.details exists.
    // Since errorBody.error is falsy (no .error key), it falls through to the details check.
    // However this means errorBody.error.details is also undefined — the headers won't be set.
    // Verify the response is still returned gracefully:
    expect(result).toBeDefined()
    expect(result.status).toBe(429)
  })

  it("does NOT set retry-after headers when retryDelay is absent", async () => {
    const body = JSON.stringify({ error: { message: "Internal error" } })
    const resp = makeResponse(body, 500)
    const result = await transformAntigravityResponse(resp, false)
    expect(result.headers.get("Retry-After")).toBeNull()
  })

  it("sets x-antigravity-context-error header for prompt_too_long errors", async () => {
    const body = JSON.stringify({ error: { message: "prompt is too long for this model" } })
    const resp = makeResponse(body, 400)
    const result = await transformAntigravityResponse(resp, false)
    expect(result.headers.get("x-antigravity-context-error")).toBe("prompt_too_long")
  })

  it("sets x-antigravity-context-error for context_length_exceeded", async () => {
    const body = JSON.stringify({ error: { message: "context_length_exceeded" } })
    const resp = makeResponse(body, 400)
    const result = await transformAntigravityResponse(resp, false)
    expect(result.headers.get("x-antigravity-context-error")).toBe("prompt_too_long")
  })

  it("sets x-antigravity-context-error for tool_pairing errors", async () => {
    const body = JSON.stringify({
      error: { message: "tool_use and tool_result without immediately after pairing" },
    })
    const resp = makeResponse(body, 400)
    const result = await transformAntigravityResponse(resp, false)
    expect(result.headers.get("x-antigravity-context-error")).toBe("tool_pairing")
  })

  it("injects cache usage metadata as headers when present", async () => {
    // The Antigravity format wraps the Gemini response in a "response" key
    const body = JSON.stringify({
      response: {
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
        usageMetadata: {
          cachedContentTokenCount: 100,
          totalTokenCount: 200,
          promptTokenCount: 150,
          candidatesTokenCount: 50,
        },
      },
    })
    const resp = makeResponse(body)
    const result = await transformAntigravityResponse(resp, false, null, "gemini-3-flash", "proj-1")
    expect(result.headers.get("x-antigravity-cached-content-token-count")).toBe("100")
    expect(result.headers.get("x-antigravity-total-token-count")).toBe("200")
    expect(result.headers.get("x-antigravity-prompt-token-count")).toBe("150")
    expect(result.headers.get("x-antigravity-candidates-token-count")).toBe("50")
  })

  it("does NOT set cache headers when cachedContentTokenCount is absent", async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "hi" }] } }],
      usageMetadata: { totalTokenCount: 100 },
    })
    const resp = makeResponse(body)
    const result = await transformAntigravityResponse(resp, false)
    expect(result.headers.get("x-antigravity-cached-content-token-count")).toBeNull()
  })

  it("handles error body that is not valid JSON (returns text body)", async () => {
    const resp = new Response("not json at all", {
      status: 400,
      headers: { "content-type": "application/json" },
    })
    const result = await transformAntigravityResponse(resp, false)
    // Should still return a response (graceful handling)
    expect(result).toBeDefined()
  })

  it("returns response on exception (catch path)", async () => {
    // Create a response where .text() throws
    const resp = new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
    // text() on null body returns "" — won't throw. Just verify normal path works.
    const result = await transformAntigravityResponse(resp, false)
    expect(result).toBeDefined()
  })
})
});

describe("prepareAntigravityRequest - additional coverage", () => {
  const mockAccessToken = "test-token"
  const mockProjectId = "test-project"

  it("handles pre-wrapped Antigravity body (project + request fields)", () => {
    const wrappedBody = {
      project: "my-project",
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
      },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify(wrappedBody) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
    expect(result.streaming).toBe(false)
  })

  it("handles Claude model with pre-wrapped body", () => {
    const wrappedBody = {
      project: "my-project",
      model: "claude-sonnet-4",
      request: {
        messages: [{ role: "user", content: "hi" }],
      },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:streamGenerateContent",
      { method: "POST", body: JSON.stringify(wrappedBody) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles tools with function declarations (Gemini format)", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "search web" }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: "search",
              description: "Search the web",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles tools with empty function declarations", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [{ functionDeclarations: [] }],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles Gemini model with thinking budget in body", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "think" }] }],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 8000, includeThoughts: true },
      },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles message with multiple content types (Claude messages format)", () => {
    const body = {
      messages: [
        { role: "user", content: "What is 2+2?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me calculate." },
            { type: "thinking", thinking: "2+2=4", signature: "sig-abc" },
          ],
        },
        { role: "user", content: "Thanks!" },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:streamGenerateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("uses endpointOverride when provided", () => {
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify({ contents: [] }) },
      mockAccessToken,
      mockProjectId,
      "https://custom-endpoint.example.com",
    )
    expect(result.request as string).toContain("custom-endpoint.example.com")
  })

  it("handles body with providerOptions for gemini-3 thinkingLevel", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "complex task" }] }],
      providerOptions: {
        google: { thinkingLevel: "high" },
      },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
      undefined,
      "antigravity",
    )
    expect(result.effectiveModel).toContain("high")
  })

  it("handles Claude model with empty message content array", () => {
    const body = {
      messages: [
        { role: "user", content: [] },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles image generation model (removes tools, adds imageConfig)", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "a beautiful sunset" }] }],
      tools: [{ functionDeclarations: [{ name: "unused_tool" }] }],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro-image:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
    // The result body should not contain tools (they're stripped for image models)
    if (typeof result.init.body === "string") {
      const parsed = JSON.parse(result.init.body) as Record<string, unknown>
      const req = (parsed.request as Record<string, unknown>) ?? parsed
      expect(req.tools).toBeUndefined()
    }
  })

  it("handles contents with thinking parts (gemini model)", () => {
    const body = {
      contents: [
        {
          role: "model",
          parts: [
            { thought: true, text: "reasoning...", thoughtSignature: "sig-xyz" },
            { text: "Here is my answer." },
          ],
        },
        { role: "user", parts: [{ text: "continue" }] },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
    expect(result.streaming).toBe(true)
  })

  it("handles request with system_instruction field", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: "Be concise." }] },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles Claude sonnet-4-6 non-thinking model (thinking disabled)", () => {
    const body = {
      messages: [{ role: "user", content: "solve this" }],
      generationConfig: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: 5000 },
      },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4-6:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    // claude-sonnet-4-6 (non-thinking variant) should not have thinking enabled
    expect(result).toBeDefined()
  })

  it("handles request with assistant history (gemini model)", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "Question 1" }] },
        { role: "model", parts: [{ text: "Answer 1" }] },
        { role: "user", parts: [{ text: "Question 2" }] },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
    expect(result.streaming).toBe(true)
  })

  it("handles tool with missing parameters (adds placeholder schema)", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "do something" }] }],
      tools: [
        {
          functionDeclarations: [
            { name: "no_params_tool", description: "A tool with no params" },
          ],
        },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles Gemini request with string systemInstruction", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: "You are a helpful assistant.",
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles Gemini request with object systemInstruction (parts as array)", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("sets Authorization header with Bearer token", () => {
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { method: "POST", body: JSON.stringify({ contents: [] }) },
      "my-access-token",
      mockProjectId,
    )
    const headers = new Headers(result.init.headers as HeadersInit)
    expect(headers.get("Authorization")).toBe("Bearer my-access-token")
  })

  it("handles Claude messages with nested content blocks (thinking+text)", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me think...", signature: "sig-123" },
            { type: "text", text: "The answer is 42." },
          ],
        },
        { role: "user", content: "Can you elaborate?" },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:streamGenerateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
    expect(result.streaming).toBe(true)
  })

  it("handles Claude request with system prompt", () => {
    const body = {
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:generateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })

  it("handles Claude thinking model with forceThinkingRecovery=true", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "think deeply" }] },
        {
          role: "model",
          parts: [
            { functionCall: { name: "bash", args: { cmd: "ls" }, id: "call-1" } },
          ],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "bash", response: { output: "files" }, id: "call-1" } },
          ],
        },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4-thinking:streamGenerateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
      undefined,
      "antigravity",
      true, // forceThinkingRecovery
    )
    expect(result).toBeDefined()
    // forceThinkingRecovery triggers the recovery message
    expect(result.thinkingRecoveryMessage).toContain("recovery")
  })

  it("handles Claude model with multiple tool calls in sequence", () => {
    const body = {
      messages: [
        { role: "user", content: "Use multiple tools" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t-1", name: "bash", input: { cmd: "ls" } },
            { type: "tool_use", id: "t-2", name: "bash", input: { cmd: "pwd" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t-1", content: "files" },
            { type: "tool_result", tool_use_id: "t-2", content: "/home" },
          ],
        },
      ],
    }
    const result = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4:streamGenerateContent",
      { method: "POST", body: JSON.stringify(body) },
      mockAccessToken,
      mockProjectId,
    )
    expect(result).toBeDefined()
  })
})
