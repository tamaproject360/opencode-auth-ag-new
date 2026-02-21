import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Shared mock stream captured per test
let capturedStream = { on: vi.fn(), write: vi.fn() }

// Mock heavy filesystem dependencies before importing debug.ts
vi.mock("node:fs", () => {
  return {
    createWriteStream: vi.fn(() => capturedStream),
    mkdirSync: vi.fn(),
  }
})

vi.mock("./storage", () => ({
  ensureGitignoreSync: vi.fn(),
}))

import * as nodeFs from "node:fs"
import {
  initializeDebug,
  isDebugEnabled,
  isVerboseEnabled,
  getLogFilePath,
  startAntigravityDebugRequest,
  logAntigravityDebugResponse,
  logAccountContext,
  logRateLimitEvent,
  logRateLimitSnapshot,
  logModelFamily,
  debugLogToFile,
  logToast,
  logRetryAttempt,
  logCacheStats,
  logQuotaStatus,
  logQuotaFetch,
  logModelUsed,
  DEBUG_MESSAGE_PREFIX,
} from "./debug.ts"
import type { AntigravityConfig } from "./config"

// ---------------------------------------------------------------------------
// Helper: build a minimal config
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AntigravityConfig> = {}): AntigravityConfig {
  return {
    debug: false,
    quiet_mode: false,
    session_recovery: true,
    auto_resume: true,
    resume_text: "Continue",
    auto_update: true,
    account_selection_strategy: "sticky",
    pid_offset_enabled: false,
    soft_quota_threshold_percent: 20,
    keep_thinking: false,
    debug_tui: false,
    log_dir: undefined,
    signature_cache: { enabled: true, ttl_hours: 24 },
    ...overrides,
  } as AntigravityConfig
}

// Reset module-level debugState by setting to disabled
function resetDebugState() {
  delete process.env.OPENCODE_ANTIGRAVITY_DEBUG
  // Reinit with debug disabled so no stream is created
  capturedStream = { on: vi.fn(), write: vi.fn() }
  initializeDebug(makeConfig({ debug: false }))
}

// Helper: init with debug enabled and get a fresh stream
function enableDebug(config: Partial<AntigravityConfig> = {}) {
  capturedStream = { on: vi.fn(), write: vi.fn() }
  initializeDebug(makeConfig({ debug: true, ...config }))
  capturedStream.write.mockClear()
}

function writtenText() {
  return capturedStream.write.mock.calls.map((c: unknown[]) => String(c[0])).join("")
}

describe("DEBUG_MESSAGE_PREFIX", () => {
  it("has the expected value", () => {
    expect(DEBUG_MESSAGE_PREFIX).toBe("[opencode-auth-ag-new debug]")
  })
})

describe("initializeDebug + isDebugEnabled / isVerboseEnabled", () => {
  const savedDebugEnv = process.env.OPENCODE_ANTIGRAVITY_DEBUG

  beforeEach(() => {
    vi.clearAllMocks()
    capturedStream = { on: vi.fn(), write: vi.fn() }
    delete process.env.OPENCODE_ANTIGRAVITY_DEBUG
  })

  afterEach(() => {
    if (savedDebugEnv !== undefined) {
      process.env.OPENCODE_ANTIGRAVITY_DEBUG = savedDebugEnv
    } else {
      delete process.env.OPENCODE_ANTIGRAVITY_DEBUG
    }
    resetDebugState()
  })

  it("debug disabled when config.debug=false and no env var", () => {
    initializeDebug(makeConfig({ debug: false }))
    expect(isDebugEnabled()).toBe(false)
    expect(isVerboseEnabled()).toBe(false)
  })

  it("debug enabled when config.debug=true", () => {
    initializeDebug(makeConfig({ debug: true }))
    expect(isDebugEnabled()).toBe(true)
    expect(isVerboseEnabled()).toBe(false)
  })

  it("verbose enabled when config.debug=true and env var=2", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "2"
    initializeDebug(makeConfig({ debug: true }))
    expect(isDebugEnabled()).toBe(true)
    expect(isVerboseEnabled()).toBe(true)
  })

  it("verbose enabled when config.debug=true and env var=verbose", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "verbose"
    initializeDebug(makeConfig({ debug: true }))
    expect(isDebugEnabled()).toBe(true)
    expect(isVerboseEnabled()).toBe(true)
  })

  it("debug enabled by env var=1 even when config.debug=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "1"
    initializeDebug(makeConfig({ debug: false }))
    expect(isDebugEnabled()).toBe(true)
    expect(isVerboseEnabled()).toBe(false)
  })

  it("verbose enabled by env var=2 even when config.debug=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "2"
    initializeDebug(makeConfig({ debug: false }))
    expect(isDebugEnabled()).toBe(true)
    expect(isVerboseEnabled()).toBe(true)
  })

  it("debug enabled by env var=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "true"
    initializeDebug(makeConfig({ debug: false }))
    expect(isDebugEnabled()).toBe(true)
  })

  it("debug not enabled by env var=0", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "0"
    initializeDebug(makeConfig({ debug: false }))
    expect(isDebugEnabled()).toBe(false)
  })

  it("calls ensureGitignoreSync when debug is enabled", async () => {
    const { ensureGitignoreSync } = await import("./storage.ts")
    vi.clearAllMocks()
    capturedStream = { on: vi.fn(), write: vi.fn() }
    initializeDebug(makeConfig({ debug: true }))
    expect(ensureGitignoreSync).toHaveBeenCalled()
  })

  it("does not call ensureGitignoreSync when debug is disabled", async () => {
    const { ensureGitignoreSync } = await import("./storage.ts")
    vi.clearAllMocks()
    capturedStream = { on: vi.fn(), write: vi.fn() }
    initializeDebug(makeConfig({ debug: false }))
    expect(ensureGitignoreSync).not.toHaveBeenCalled()
  })
})

describe("getLogFilePath", () => {
  afterEach(() => resetDebugState())

  it("returns undefined when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    expect(getLogFilePath()).toBeUndefined()
  })

  it("returns a string path when debug is enabled", () => {
    capturedStream = { on: vi.fn(), write: vi.fn() }
    initializeDebug(makeConfig({ debug: true }))
    const path = getLogFilePath()
    expect(typeof path).toBe("string")
    expect(path).toContain("antigravity-debug-")
    expect(path).toContain(".log")
  })

  it("uses custom log_dir from config", () => {
    capturedStream = { on: vi.fn(), write: vi.fn() }
    initializeDebug(makeConfig({ debug: true, log_dir: "D:/custom/logs" }))
    const path = getLogFilePath()
    expect(path).toContain("custom")
    expect(path).toContain("logs")
  })
})

describe("startAntigravityDebugRequest", () => {
  afterEach(() => resetDebugState())

  it("returns null when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    const ctx = startAntigravityDebugRequest({
      originalUrl: "https://api.example.com",
      resolvedUrl: "https://api.example.com",
      streaming: false,
    })
    expect(ctx).toBeNull()
  })

  it("returns a context object when debug is enabled", () => {
    enableDebug()
    const ctx = startAntigravityDebugRequest({
      originalUrl: "https://api.example.com",
      resolvedUrl: "https://api.example.com",
      streaming: true,
    })
    expect(ctx).not.toBeNull()
    expect(ctx!.id).toMatch(/^ANTIGRAVITY-\d+$/)
    expect(ctx!.streaming).toBe(true)
    expect(typeof ctx!.startedAt).toBe("number")
  })

  it("writes to log writer when debug is enabled", () => {
    enableDebug()
    startAntigravityDebugRequest({
      originalUrl: "https://api.example.com",
      resolvedUrl: "https://resolved.example.com",
      streaming: false,
      projectId: "my-project",
    })

    expect(capturedStream.write).toHaveBeenCalled()
    const written = writtenText()
    expect(written).toContain("ANTIGRAVITY-")
    expect(written).toContain("https://resolved.example.com")
  })

  it("logs redacted Authorization header", () => {
    enableDebug()
    startAntigravityDebugRequest({
      originalUrl: "https://api.example.com",
      resolvedUrl: "https://api.example.com",
      streaming: false,
      headers: { Authorization: "Bearer secret-token" },
    })

    const written = writtenText()
    expect(written).toContain("[redacted]")
    expect(written).not.toContain("secret-token")
  })
})

describe("logAntigravityDebugResponse", () => {
  afterEach(() => resetDebugState())

  it("does nothing when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    // Should not throw
    logAntigravityDebugResponse(
      { id: "ANTIGRAVITY-1", streaming: false, startedAt: Date.now() },
      new Response("", { status: 200 }),
    )
  })

  it("does nothing when context is null", () => {
    enableDebug()
    capturedStream.write.mockClear()
    logAntigravityDebugResponse(null, new Response("", { status: 200 }))
    expect(capturedStream.write).not.toHaveBeenCalled()
  })

  it("writes response info when debug enabled and context present", () => {
    enableDebug()
    const ctx = startAntigravityDebugRequest({
      originalUrl: "https://api.example.com",
      resolvedUrl: "https://api.example.com",
      streaming: false,
    })

    capturedStream.write.mockClear()
    logAntigravityDebugResponse(ctx, new Response("body text", { status: 200 }), {
      note: "Test note",
    })

    const written = writtenText()
    expect(written).toContain("200")
    expect(written).toContain("Test note")
  })
})

describe("logAccountContext", () => {
  afterEach(() => resetDebugState())

  it("does nothing when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    // Should not throw
    logAccountContext("Selecting", {
      index: 0,
      email: "user@example.com",
      family: "gemini",
      totalAccounts: 3,
    })
  })

  it("logs with email when available", () => {
    enableDebug()
    logAccountContext("Selecting", {
      index: 0,
      email: "user@example.com",
      family: "gemini",
      totalAccounts: 3,
    })
    const written = writtenText()
    expect(written).toContain("user@example.com")
    expect(written).toContain("gemini")
  })

  it("logs without email using Account N label", () => {
    enableDebug()
    logAccountContext("Selecting", {
      index: 2,
      family: "claude",
      totalAccounts: 5,
    })
    const written = writtenText()
    expect(written).toContain("Account 3")
    expect(written).toContain("claude")
  })

  it("includes active rate limit info", () => {
    enableDebug()
    const futureTime = Date.now() + 60000 // 60s from now
    logAccountContext("Rotating", {
      index: 0,
      family: "gemini",
      totalAccounts: 2,
      rateLimitState: { gemini: futureTime },
    })
    expect(writtenText()).toContain("rateLimits")
  })
})

describe("logRateLimitEvent", () => {
  afterEach(() => resetDebugState())

  it("does nothing when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    logRateLimitEvent(0, "user@test.com", "gemini", 429, 5000, { message: "Rate limited" })
  })

  it("logs rate limit info when debug enabled", () => {
    enableDebug()
    logRateLimitEvent(0, "user@test.com", "gemini", 429, 5000, {
      message: "Quota exceeded",
      quotaResetTime: "2026-02-21T18:00:00Z",
      retryDelayMs: 3000,
      reason: "RATE_LIMIT",
    })
    const written = writtenText()
    expect(written).toContain("429")
    expect(written).toContain("user@test.com")
    expect(written).toContain("gemini")
    expect(written).toContain("Quota exceeded")
    expect(written).toContain("RATE_LIMIT")
  })
})

describe("logRateLimitSnapshot", () => {
  afterEach(() => resetDebugState())

  it("does nothing when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    logRateLimitSnapshot("gemini", [{ index: 0, email: "a@b.com" }])
  })

  it("logs snapshot with ready and limited accounts", () => {
    enableDebug()
    logRateLimitSnapshot("gemini", [
      { index: 0, email: "a@b.com" },
      { index: 1, email: "c@d.com", rateLimitResetTimes: { gemini: Date.now() + 30000 } },
    ])
    const written = writtenText()
    expect(written).toContain("gemini")
    expect(written).toContain("a@b.com")
    expect(written).toContain("c@d.com")
  })
})

describe("logToast / logRetryAttempt / logCacheStats / logQuotaStatus / logQuotaFetch / logModelUsed / logModelFamily / debugLogToFile", () => {
  afterEach(() => resetDebugState())

  it("logToast does nothing when debug disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    expect(() => logToast("test message", "info")).not.toThrow()
  })

  it("logToast writes TOAST/SUCCESS when debug enabled", () => {
    enableDebug()
    logToast("Auth successful", "success")
    const written = writtenText()
    expect(written).toContain("Toast/SUCCESS")
    expect(written).toContain("Auth successful")
  })

  it("logRetryAttempt writes retry info", () => {
    enableDebug()
    logRetryAttempt(2, 5, "empty_response", 1000)
    const written = writtenText()
    expect(written).toContain("Attempt 2/5")
    expect(written).toContain("empty_response")
    expect(written).toContain("delay=1000ms")
  })

  it("logRetryAttempt shows ∞ for unlimited retries", () => {
    enableDebug()
    logRetryAttempt(1, -1, "rate_limit")
    expect(writtenText()).toContain("∞")
  })

  it("logCacheStats shows HIT when cacheReadTokens > 0", () => {
    enableDebug()
    logCacheStats("gemini-pro", 500, 0, 1000)
    const written = writtenText()
    expect(written).toContain("HIT")
    expect(written).toContain("50%")
  })

  it("logCacheStats shows WRITE when only cacheWriteTokens > 0", () => {
    enableDebug()
    logCacheStats("gemini-pro", 0, 200, 1000)
    expect(writtenText()).toContain("WRITE")
  })

  it("logCacheStats shows MISS when no cache tokens", () => {
    enableDebug()
    logCacheStats("gemini-pro", 0, 0, 1000)
    expect(writtenText()).toContain("MISS")
  })

  it("logQuotaStatus shows EXHAUSTED when quotaPercent=0", () => {
    enableDebug()
    logQuotaStatus("user@test.com", 0, 0, "gemini")
    expect(writtenText()).toContain("EXHAUSTED")
  })

  it("logQuotaStatus shows LOW when quotaPercent < 20", () => {
    enableDebug()
    logQuotaStatus(undefined, 0, 15, "claude")
    const written = writtenText()
    expect(written).toContain("LOW")
    expect(written).toContain("Account 1")
  })

  it("logQuotaStatus shows OK when quotaPercent >= 20", () => {
    enableDebug()
    logQuotaStatus("u@g.com", 2, 50)
    expect(writtenText()).toContain("OK")
  })

  it("logQuotaFetch logs start/complete/error events", () => {
    enableDebug()
    logQuotaFetch("start", 3, "checking quotas")
    logQuotaFetch("complete", 3)
    logQuotaFetch("error")
    const written = writtenText()
    expect(written).toContain("START")
    expect(written).toContain("COMPLETE")
    expect(written).toContain("ERROR")
  })

  it("logModelUsed logs model difference when different", () => {
    enableDebug()
    logModelUsed("antigravity-gemini-pro", "gemini-1.5-pro", "u@g.com")
    const written = writtenText()
    expect(written).toContain("requested=antigravity-gemini-pro")
    expect(written).toContain("actual=gemini-1.5-pro")
  })

  it("logModelUsed logs just model when same", () => {
    enableDebug()
    logModelUsed("gemini-pro", "gemini-pro")
    const written = writtenText()
    expect(written).toContain("gemini-pro")
    expect(written).not.toContain("requested=")
  })

  it("logModelFamily writes url and family info", () => {
    enableDebug()
    logModelFamily("https://api.example.com/models", "gemini-pro", "gemini")
    const written = writtenText()
    expect(written).toContain("ModelFamily")
    expect(written).toContain("gemini")
  })

  it("debugLogToFile writes custom message", () => {
    enableDebug()
    debugLogToFile("Custom debug message XYZ")
    expect(writtenText()).toContain("Custom debug message XYZ")
  })

  it("debugLogToFile does nothing when debug is disabled", () => {
    initializeDebug(makeConfig({ debug: false }))
    expect(() => debugLogToFile("Should not write")).not.toThrow()
  })
})
