import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { AccountMetadataV3 } from "./storage"

// ---------------------------------------------------------------------------
// Mock heavy dependencies before importing quota.ts
// ---------------------------------------------------------------------------

vi.mock("../constants", () => ({
  ANTIGRAVITY_ENDPOINT_PROD: "https://cloudcode-pa.googleapis.com",
  ANTIGRAVITY_PROVIDER_ID: "antigravity",
  getAntigravityHeaders: () => ({ "User-Agent": "antigravity/test" }),
}))

vi.mock("./auth", () => ({
  accessTokenExpired: vi.fn().mockReturnValue(false),
  formatRefreshParts: vi.fn((parts: Record<string, string | undefined>) =>
    `${parts.refreshToken ?? ""}|${parts.projectId ?? ""}|${parts.managedProjectId ?? ""}`,
  ),
  parseRefreshParts: vi.fn((refresh: string) => {
    const [refreshToken, projectId, managedProjectId] = (refresh ?? "").split("|")
    return { refreshToken, projectId, managedProjectId }
  }),
}))

vi.mock("./debug", () => ({
  logQuotaFetch: vi.fn(),
  logQuotaStatus: vi.fn(),
}))

vi.mock("./project", () => ({
  ensureProjectContext: vi.fn().mockResolvedValue({
    auth: {
      type: "oauth",
      refresh: "token|proj||",
      access: "access-token",
      expires: Date.now() + 3600000,
    },
    effectiveProjectId: "test-project-id",
  }),
}))

vi.mock("./token", () => ({
  refreshAccessToken: vi.fn(),
}))

vi.mock("./transform/model-resolver", () => ({
  getModelFamily: vi.fn((name: string) => {
    if (name.includes("flash")) return "gemini-flash"
    if (name.includes("gemini")) return "gemini-pro"
    return "unknown"
  }),
}))

import { checkAccountsQuota } from "./quota.ts"
import type { PluginClient } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(overrides: Partial<AccountMetadataV3> = {}): AccountMetadataV3 {
  return {
    email: "test@example.com",
    refreshToken: "refresh-token",
    projectId: "project-id",
    managedProjectId: "managed-project-id",
    addedAt: Date.now() - 10000,
    lastUsed: Date.now(),
    enabled: true,
    ...overrides,
  }
}

function makeClient(): PluginClient {
  return {} as unknown as PluginClient
}

function mockFetch(response: { ok: boolean; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve("")),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkAccountsQuota", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("returns empty array when no accounts provided", async () => {
    const results = await checkAccountsQuota([], makeClient())
    expect(results).toEqual([])
  })

  it("returns ok status with quota for a valid account", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        // fetchAvailableModels
        ok: true,
        json: () =>
          Promise.resolve({
            models: {
              "claude-3-5-sonnet": {
                quotaInfo: { remainingFraction: 0.8, resetTime: "2026-02-22T00:00:00Z" },
              },
              "gemini-3.1-pro": {
                quotaInfo: { remainingFraction: 0.5, resetTime: "2026-02-22T00:00:00Z" },
              },
              "gemini-3.1-flash": {
                quotaInfo: { remainingFraction: 0.3, resetTime: "2026-02-22T00:00:00Z" },
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        // fetchGeminiCliQuota (retrieveUserQuota)
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe("ok")
    expect(results[0]?.email).toBe("test@example.com")
    expect(results[0]?.quota).toBeDefined()
    expect(results[0]?.quota?.modelCount).toBeGreaterThan(0)
  })

  it("aggregates quota into correct groups", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: {
              "claude-3-5-sonnet": {
                quotaInfo: { remainingFraction: 0.6 },
              },
              "claude-3-haiku": {
                quotaInfo: { remainingFraction: 0.9 },
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    const claudeGroup = results[0]?.quota?.groups["claude"]
    expect(claudeGroup).toBeDefined()
    // min of 0.6 and 0.9
    expect(claudeGroup?.remainingFraction).toBeCloseTo(0.6)
    expect(claudeGroup?.modelCount).toBe(2)
  })

  it("marks account as error status on token refresh failure", async () => {
    const { accessTokenExpired } = await import("./auth")
    const { refreshAccessToken } = await import("./token")
    vi.mocked(accessTokenExpired).mockReturnValue(true)
    vi.mocked(refreshAccessToken).mockResolvedValue(undefined)

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    expect(results[0]?.status).toBe("error")
    expect(results[0]?.error).toBeDefined()

    // Restore
    vi.mocked(accessTokenExpired).mockReturnValue(false)
  })

  it("marks account disabled=true when account.enabled is false", async () => {
    global.fetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: {} }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount({ enabled: false })], makeClient())

    expect(results[0]?.disabled).toBe(true)
  })

  it("processes multiple accounts independently", async () => {
    global.fetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: {}, buckets: [] }),
      }) as typeof fetch

    const accounts = [
      makeAccount({ email: "a@example.com" }),
      makeAccount({ email: "b@example.com" }),
    ]
    const results = await checkAccountsQuota(accounts, makeClient())

    expect(results).toHaveLength(2)
    expect(results[0]?.email).toBe("a@example.com")
    expect(results[1]?.email).toBe("b@example.com")
  })

  it("sets error on quota when fetchAvailableModels returns non-ok", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve("Forbidden"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    expect(results[0]?.status).toBe("ok")
    expect(results[0]?.quota?.error).toContain("Failed to fetch")
  })

  it("handles gemini cli quota buckets", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            buckets: [
              {
                modelId: "gemini-3-pro",
                remainingFraction: 0.7,
                resetTime: "2026-02-22T00:00:00Z",
              },
              {
                modelId: "gemini-2.5-pro",
                remainingFraction: 0.4,
              },
              {
                // Not a relevant model — should be filtered
                modelId: "gemini-1.5-pro",
                remainingFraction: 0.9,
              },
            ],
          }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    expect(results[0]?.geminiCliQuota?.models).toHaveLength(2)
    const ids = results[0]?.geminiCliQuota?.models.map((m) => m.modelId)
    expect(ids).toContain("gemini-3-pro")
    expect(ids).toContain("gemini-2.5-pro")
    expect(ids).not.toContain("gemini-1.5-pro")
  })

  it("normalizes out-of-range remainingFraction values", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: {
              "claude-3": { quotaInfo: { remainingFraction: -0.5 } },
              "claude-haiku": { quotaInfo: { remainingFraction: 1.5 } },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    const claudeGroup = results[0]?.quota?.groups["claude"]
    // min(clamp(-0.5,0,1), clamp(1.5,0,1)) = min(0, 1) = 0
    expect(claudeGroup?.remainingFraction).toBe(0)
  })

  it("uses earliest resetTime when multiple models in same group", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: {
              "claude-a": {
                quotaInfo: {
                  remainingFraction: 0.5,
                  resetTime: "2026-02-22T10:00:00Z",
                },
              },
              "claude-b": {
                quotaInfo: {
                  remainingFraction: 0.3,
                  resetTime: "2026-02-22T08:00:00Z",
                },
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      }) as typeof fetch

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    const claudeGroup = results[0]?.quota?.groups["claude"]
    // Earliest reset time should be picked
    expect(claudeGroup?.resetTime).toBe("2026-02-22T08:00:00Z")
  })
})

// ---------------------------------------------------------------------------
// Pure helper function tests (no network)
// ---------------------------------------------------------------------------

// We test the internal pure logic indirectly via checkAccountsQuota,
// but also test it through the exported quota types.

describe("quota group classification (via model names)", () => {
  // getModelFamily is mocked so we test classifyQuotaGroup via API output

  it("classifies models correctly through aggregation", async () => {
    const originalFetch = global.fetch

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: {
              "gemini-3.1-flash-thinking": {
                quotaInfo: { remainingFraction: 0.5 },
              },
              "gemini-3.1-pro-latest": {
                quotaInfo: { remainingFraction: 0.6 },
              },
              "old-gemini-1.5-pro": {
                quotaInfo: { remainingFraction: 0.9 },
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      }) as typeof fetch

    const { getModelFamily } = await import("./transform/model-resolver")
    vi.mocked(getModelFamily).mockImplementation((name: string) => {
      if (name.includes("flash")) return "gemini-flash"
      return "gemini-pro"
    })

    const results = await checkAccountsQuota([makeAccount()], makeClient())

    // old-gemini-1.5-pro should be classified as null (no gemini-3 in name)
    // So only 2 models should be counted
    expect(results[0]?.quota?.modelCount).toBe(2)

    global.fetch = originalFetch
  })
})
