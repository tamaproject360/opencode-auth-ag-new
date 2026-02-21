import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SignatureCache, createSignatureCache } from "./signature-cache.ts"
import type { SignatureCacheConfig } from "../config"

// ---------------------------------------------------------------------------
// Mocks - intercept fs and storage module
// ---------------------------------------------------------------------------

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(""),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  }
})

vi.mock("../storage", () => ({
  ensureGitignoreSync: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<SignatureCacheConfig> = {}): SignatureCacheConfig {
  return {
    enabled: true,
    memory_ttl_seconds: 3600,
    disk_ttl_seconds: 86400,
    write_interval_seconds: 300,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignatureCache", () => {
  let cache: SignatureCache

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    cache = new SignatureCache(makeConfig())
  })

  afterEach(() => {
    cache.shutdown()
    vi.useRealTimers()
  })

  describe("store and retrieve", () => {
    it("stores and retrieves a signature", () => {
      cache.store("key1", "sig-abc")
      expect(cache.retrieve("key1")).toBe("sig-abc")
    })

    it("returns null for unknown key", () => {
      expect(cache.retrieve("nonexistent")).toBeNull()
    })

    it("returns null after memory TTL expires", () => {
      cache.store("key1", "sig-abc")
      // Advance past TTL
      vi.advanceTimersByTime(3601 * 1000)
      expect(cache.retrieve("key1")).toBeNull()
    })

    it("still returns signature within TTL", () => {
      cache.store("key1", "sig-abc")
      vi.advanceTimersByTime(3599 * 1000)
      expect(cache.retrieve("key1")).toBe("sig-abc")
    })

    it("returns null and deletes entry after expiry on retrieve", () => {
      cache.store("key1", "sig-abc")
      vi.advanceTimersByTime(3601 * 1000)
      expect(cache.retrieve("key1")).toBeNull()
      // Second retrieve — also null (key was deleted)
      expect(cache.retrieve("key1")).toBeNull()
    })

    it("overwrites existing key on re-store", () => {
      cache.store("key1", "old-sig")
      cache.store("key1", "new-sig")
      expect(cache.retrieve("key1")).toBe("new-sig")
    })
  })

  describe("has", () => {
    it("returns true for existing, non-expired key", () => {
      cache.store("k", "sig")
      expect(cache.has("k")).toBe(true)
    })

    it("returns false for non-existing key", () => {
      expect(cache.has("missing")).toBe(false)
    })

    it("returns false after TTL expires", () => {
      cache.store("k", "sig")
      vi.advanceTimersByTime(3601 * 1000)
      expect(cache.has("k")).toBe(false)
    })
  })

  describe("storeThinking and retrieveThinking", () => {
    it("stores and retrieves full thinking content", () => {
      cache.storeThinking("k", "thinking text here", "signature-abc", ["tool-1"])
      const result = cache.retrieveThinking("k")
      expect(result).not.toBeNull()
      expect(result?.text).toBe("thinking text here")
      expect(result?.signature).toBe("signature-abc")
      expect(result?.toolIds).toEqual(["tool-1"])
    })

    it("returns null for unknown key", () => {
      expect(cache.retrieveThinking("nonexistent")).toBeNull()
    })

    it("returns null after TTL expires", () => {
      cache.storeThinking("k", "thinking", "sig", [])
      vi.advanceTimersByTime(3601 * 1000)
      expect(cache.retrieveThinking("k")).toBeNull()
    })

    it("does not store when thinkingText is empty", () => {
      cache.storeThinking("k", "", "sig")
      expect(cache.retrieveThinking("k")).toBeNull()
    })

    it("does not store when signature is empty", () => {
      cache.storeThinking("k", "text", "")
      expect(cache.retrieveThinking("k")).toBeNull()
    })
  })

  describe("hasThinking", () => {
    it("returns true when full thinking content exists and not expired", () => {
      cache.storeThinking("k", "thinking text", "sig")
      expect(cache.hasThinking("k")).toBe(true)
    })

    it("returns false when only signature (no thinking text) stored", () => {
      cache.store("k", "sig")
      expect(cache.hasThinking("k")).toBe(false)
    })

    it("returns false after TTL expires", () => {
      cache.storeThinking("k", "thinking", "sig")
      vi.advanceTimersByTime(3601 * 1000)
      expect(cache.hasThinking("k")).toBe(false)
    })
  })

  describe("getStats", () => {
    it("tracks memory hits", () => {
      cache.store("k", "sig")
      cache.retrieve("k")
      cache.retrieve("k")
      expect(cache.getStats().memoryHits).toBe(2)
    })

    it("tracks misses", () => {
      cache.retrieve("missing1")
      cache.retrieve("missing2")
      expect(cache.getStats().misses).toBe(2)
    })

    it("tracks memory entry count", () => {
      cache.store("k1", "s1")
      cache.store("k2", "s2")
      expect(cache.getStats().memoryEntries).toBe(2)
    })

    it("dirty is true after storing", () => {
      cache.store("k", "sig")
      expect(cache.getStats().dirty).toBe(true)
    })

    it("diskEnabled reflects config.enabled", () => {
      const disabledCache = new SignatureCache(makeConfig({ enabled: false }))
      expect(disabledCache.getStats().diskEnabled).toBe(false)
    })
  })

  describe("disabled cache", () => {
    let disabledCache: SignatureCache

    beforeEach(() => {
      disabledCache = new SignatureCache(makeConfig({ enabled: false }))
    })

    afterEach(() => {
      disabledCache.shutdown()
    })

    it("store is a no-op", () => {
      disabledCache.store("k", "sig")
      expect(disabledCache.retrieve("k")).toBeNull()
    })

    it("retrieve always returns null", () => {
      expect(disabledCache.retrieve("k")).toBeNull()
    })

    it("has returns false", () => {
      expect(disabledCache.has("k")).toBe(false)
    })

    it("storeThinking is a no-op", () => {
      disabledCache.storeThinking("k", "thinking", "sig")
      expect(disabledCache.retrieveThinking("k")).toBeNull()
    })

    it("flush returns true without doing anything", async () => {
      expect(await disabledCache.flush()).toBe(true)
    })
  })

  describe("makeKey", () => {
    it("combines sessionId and modelId with colon separator", () => {
      expect(SignatureCache.makeKey("session-123", "claude-3")).toBe("session-123:claude-3")
    })
  })

  describe("shutdown", () => {
    it("can be called without errors", () => {
      cache.store("k", "sig")
      expect(() => cache.shutdown()).not.toThrow()
    })
  })
})

describe("createSignatureCache", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns null when config is undefined", () => {
    expect(createSignatureCache(undefined)).toBeNull()
  })

  it("returns null when config.enabled is false", () => {
    expect(createSignatureCache(makeConfig({ enabled: false }))).toBeNull()
  })

  it("returns a SignatureCache instance when enabled", () => {
    vi.useFakeTimers()
    const cache = createSignatureCache(makeConfig({ enabled: true }))
    expect(cache).toBeInstanceOf(SignatureCache)
    cache?.shutdown()
  })
})
