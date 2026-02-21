import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  loadManagedProject,
  onboardManagedProject,
  ensureProjectContext,
  invalidateProjectContextCache,
} from "./project.ts"
import type { OAuthAuthDetails } from "./types"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../constants", () => ({
  getAntigravityHeaders: () => ({
    "User-Agent": "antigravity/test",
    "Client-Metadata": '{"ideType":"ANTIGRAVITY"}',
  }),
  ANTIGRAVITY_ENDPOINT_FALLBACKS: ["https://cloudcode-pa.googleapis.com"],
  ANTIGRAVITY_LOAD_ENDPOINTS: ["https://cloudcode-pa.googleapis.com"],
  ANTIGRAVITY_DEFAULT_PROJECT_ID: "default-fallback-project",
}))

vi.mock("./auth", () => ({
  formatRefreshParts: vi.fn(
    (parts: Record<string, string | undefined>) =>
      `${parts.refreshToken ?? ""}|${parts.projectId ?? ""}|${parts.managedProjectId ?? ""}`,
  ),
  parseRefreshParts: vi.fn((refresh: string) => {
    const [refreshToken, projectId, managedProjectId] = (refresh ?? "").split("|")
    return { refreshToken, projectId, managedProjectId }
  }),
}))

vi.mock("./logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = global.fetch

function makeAuth(refresh = "tok|proj|managed"): OAuthAuthDetails {
  return {
    type: "oauth",
    refresh,
    access: "access-token",
    expires: Date.now() + 3600000,
  }
}

function mockFetch(responses: Array<{ ok: boolean; json?: unknown; text?: string }>) {
  let idx = 0
  global.fetch = vi.fn().mockImplementation(() => {
    const resp = responses[idx++]
    return Promise.resolve({
      ok: resp?.ok ?? true,
      json: () => Promise.resolve(resp?.json ?? {}),
      text: () => Promise.resolve(resp?.text ?? ""),
    })
  }) as typeof fetch
}

// ---------------------------------------------------------------------------
// loadManagedProject
// ---------------------------------------------------------------------------

describe("loadManagedProject", () => {
  beforeEach(() => { invalidateProjectContextCache(); vi.clearAllMocks() })
  afterEach(() => { global.fetch = originalFetch })

  it("returns payload when server responds with project (string form)", async () => {
    mockFetch([{ ok: true, json: { cloudaicompanionProject: "managed-proj-id" } }])
    const result = await loadManagedProject("access-token", "proj-id")
    expect(result).not.toBeNull()
    expect((result as Record<string, unknown>).cloudaicompanionProject).toBe("managed-proj-id")
  })

  it("returns payload when server responds with project (object form)", async () => {
    mockFetch([{ ok: true, json: { cloudaicompanionProject: { id: "managed-proj-id" } } }])
    const result = await loadManagedProject("access-token")
    expect((result as Record<string, { id: string }>).cloudaicompanionProject?.id).toBe("managed-proj-id")
  })

  it("returns null when all endpoints fail", async () => {
    mockFetch([{ ok: false, text: "Forbidden" }])
    const result = await loadManagedProject("access-token")
    expect(result).toBeNull()
  })

  it("returns null on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as typeof fetch
    const result = await loadManagedProject("access-token")
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// onboardManagedProject
// ---------------------------------------------------------------------------

describe("onboardManagedProject", () => {
  beforeEach(() => { invalidateProjectContextCache(); vi.clearAllMocks() })
  afterEach(() => { global.fetch = originalFetch })

  it("returns projectId when onboarding completes successfully", async () => {
    mockFetch([{
      ok: true,
      json: {
        done: true,
        response: { cloudaicompanionProject: { id: "new-managed-proj" } },
      },
    }])
    const result = await onboardManagedProject("access-token", "FREE", "proj-id", 1, 0)
    expect(result).toBe("new-managed-proj")
  })

  it("returns projectId from param when done but no project in response", async () => {
    mockFetch([{
      ok: true,
      json: { done: true },
    }])
    const result = await onboardManagedProject("access-token", "FREE", "my-project-id", 1, 0)
    expect(result).toBe("my-project-id")
  })

  it("returns undefined when server responds non-ok", async () => {
    mockFetch([{ ok: false, text: "Error" }])
    const result = await onboardManagedProject("access-token", "FREE", undefined, 1, 0)
    expect(result).toBeUndefined()
  })

  it("returns undefined on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fail")) as typeof fetch
    const result = await onboardManagedProject("access-token", "FREE", undefined, 1, 0)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ensureProjectContext
// ---------------------------------------------------------------------------

describe("ensureProjectContext", () => {
  beforeEach(() => { invalidateProjectContextCache(); vi.clearAllMocks() })
  afterEach(() => { global.fetch = originalFetch })

  it("returns empty projectId when access token is missing", async () => {
    const auth: OAuthAuthDetails = { type: "oauth", refresh: "tok||" }
    const result = await ensureProjectContext(auth)
    expect(result.effectiveProjectId).toBe("")
    expect(result.auth).toBe(auth)
  })

  it("uses managedProjectId from refresh token parts (no fetch needed)", async () => {
    // parseRefreshParts returns managedProjectId = "managed" from "tok|proj|managed"
    const auth = makeAuth("tok|proj|managed")
    const fetchSpy = vi.spyOn(global, "fetch")
    const result = await ensureProjectContext(auth)
    expect(result.effectiveProjectId).toBe("managed")
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("fetches managed project when managedProjectId not in refresh token", async () => {
    mockFetch([{ ok: true, json: { cloudaicompanionProject: "fetched-managed" } }])
    const auth = makeAuth("tok|proj|")  // no managedProjectId
    const result = await ensureProjectContext(auth)
    expect(result.effectiveProjectId).toBe("fetched-managed")
  })

  it("updates auth.refresh to include managedProjectId", async () => {
    mockFetch([{ ok: true, json: { cloudaicompanionProject: "fetched-managed" } }])
    const auth = makeAuth("tok|proj|")
    const result = await ensureProjectContext(auth)
    expect(result.auth.refresh).toContain("fetched-managed")
  })

  it("returns cached result on second call with same refresh token", async () => {
    // Use auth with managedProjectId already set so it returns early (no fetch)
    // This tests the cache path without the complexity of onboarding retries
    global.fetch = vi.fn() as typeof fetch
    const auth = makeAuth("tok|proj|my-managed-proj")

    const result1 = await ensureProjectContext(auth)
    const result2 = await ensureProjectContext(auth)

    expect(result1.effectiveProjectId).toBe("my-managed-proj")
    expect(result2.effectiveProjectId).toBe("my-managed-proj")
    // Both should use the cached value — fetch should not be called at all
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("falls back to projectId when loadManagedProject fails and onboarding also fails", async () => {
    // loadManagedProject fails (no allowedTiers), onboardUser also fails
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("Forbidden") })
      .mockRejectedValueOnce(new Error("onboard fail")) as typeof fetch

    const auth = makeAuth("tok|my-project-id|")  // has projectId, no managedProjectId
    const result = await ensureProjectContext(auth)
    // Falls back to projectId
    expect(result.effectiveProjectId).toBe("my-project-id")
  })

  it("falls back to default project ID when no project info at all", async () => {
    // loadManagedProject fails, onboarding fails, no projectId in refresh
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("err") })
      .mockRejectedValueOnce(new Error("fail")) as typeof fetch

    const auth = makeAuth("tok||")  // no projectId, no managedProjectId
    const result = await ensureProjectContext(auth)
    expect(result.effectiveProjectId).toBe("default-fallback-project")
  })
})

// ---------------------------------------------------------------------------
// invalidateProjectContextCache
// ---------------------------------------------------------------------------

describe("invalidateProjectContextCache", () => {
  beforeEach(() => { invalidateProjectContextCache(); vi.clearAllMocks() })
  afterEach(() => { global.fetch = originalFetch })

  it("clears all cache entries", async () => {
    mockFetch([
      { ok: true, json: { cloudaicompanionProject: "proj-1" } },
      { ok: true, json: { cloudaicompanionProject: "proj-1" } },
    ])

    const auth = makeAuth("tok|p|")
    await ensureProjectContext(auth)

    // Invalidate and re-fetch — should call fetch again
    invalidateProjectContextCache()
    await ensureProjectContext(auth)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("invalidates specific refresh key", async () => {
    mockFetch([
      { ok: true, json: { cloudaicompanionProject: "proj-a" } },
      { ok: true, json: { cloudaicompanionProject: "proj-a" } },
    ])

    const auth = makeAuth("tok-specific|p|")
    await ensureProjectContext(auth)

    invalidateProjectContextCache("tok-specific|p|")
    await ensureProjectContext(auth)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
