import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@openauthjs/openauth/pkce", () => ({
  generatePKCE: vi.fn().mockResolvedValue({
    challenge: "test-challenge-abc123",
    verifier: "test-verifier-xyz789",
  }),
}))

vi.mock("../constants", () => ({
  ANTIGRAVITY_CLIENT_ID: "test-client-id",
  ANTIGRAVITY_CLIENT_SECRET: "test-client-secret",
  ANTIGRAVITY_REDIRECT_URI: "http://localhost:51121/callback",
  ANTIGRAVITY_SCOPES: ["https://www.googleapis.com/auth/cloud-platform", "openid", "email"],
  ANTIGRAVITY_ENDPOINT_FALLBACKS: ["https://cloudcode-pa.googleapis.com"],
  ANTIGRAVITY_LOAD_ENDPOINTS: ["https://cloudcode-pa.googleapis.com"],
  getAntigravityHeaders: () => ({
    "User-Agent": "antigravity/test",
    "Client-Metadata": '{"ideType":"ANTIGRAVITY"}',
  }),
  GEMINI_CLI_HEADERS: { "User-Agent": "GeminiCLI/test" },
}))

vi.mock("../plugin/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../plugin/auth", () => ({
  calculateTokenExpiry: vi.fn((startTime: number, expiresIn: number) => startTime + expiresIn * 1000),
}))

import { authorizeAntigravity, exchangeAntigravity } from "../antigravity/oauth.ts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeState(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

// ---------------------------------------------------------------------------
// authorizeAntigravity
// ---------------------------------------------------------------------------

describe("authorizeAntigravity", () => {
  it("returns a URL with required OAuth params", async () => {
    const result = await authorizeAntigravity()

    const url = new URL(result.url)
    expect(url.hostname).toBe("accounts.google.com")
    expect(url.searchParams.get("client_id")).toBe("test-client-id")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:51121/callback")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge-abc123")
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
  })

  it("embeds verifier in state parameter", async () => {
    const result = await authorizeAntigravity()
    const url = new URL(result.url)
    const stateParam = url.searchParams.get("state")
    expect(stateParam).toBeDefined()

    const decoded = JSON.parse(
      Buffer.from(stateParam!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    )
    expect(decoded.verifier).toBe("test-verifier-xyz789")
  })

  it("returns the verifier and projectId in result", async () => {
    const result = await authorizeAntigravity("my-project")

    expect(result.verifier).toBe("test-verifier-xyz789")
    expect(result.projectId).toBe("my-project")
  })

  it("uses empty string projectId when not provided", async () => {
    const result = await authorizeAntigravity()
    expect(result.projectId).toBe("")
  })

  it("includes scopes in URL", async () => {
    const result = await authorizeAntigravity()
    const url = new URL(result.url)
    const scope = url.searchParams.get("scope")
    expect(scope).toContain("cloud-platform")
    expect(scope).toContain("openid")
    expect(scope).toContain("email")
  })
})

// ---------------------------------------------------------------------------
// exchangeAntigravity
// ---------------------------------------------------------------------------

describe("exchangeAntigravity", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  function makeState(verifier: string, projectId = "") {
    return encodeState({ verifier, projectId })
  }

  function mockFetchSequence(responses: Array<{ ok: boolean; json?: object; text?: string }>) {
    let callIndex = 0
    global.fetch = vi.fn().mockImplementation(() => {
      const resp = responses[callIndex++]
      return Promise.resolve({
        ok: resp?.ok ?? true,
        json: () => Promise.resolve(resp?.json ?? {}),
        text: () => Promise.resolve(resp?.text ?? ""),
      })
    }) as typeof fetch
  }

  it("returns success on valid code+state exchange", async () => {
    mockFetchSequence([
      {
        // token exchange
        ok: true,
        json: {
          access_token: "access-abc",
          refresh_token: "refresh-xyz",
          expires_in: 3600,
        },
      },
      {
        // userinfo
        ok: true,
        json: { email: "user@example.com" },
      },
      {
        // loadCodeAssist (for projectId)
        ok: true,
        json: { cloudaicompanionProject: "my-managed-project" },
      },
    ])

    const state = makeState("test-verifier-xyz789", "")
    const result = await exchangeAntigravity("auth-code-123", state)

    expect(result.type).toBe("success")
    if (result.type !== "success") return

    expect(result.access).toBe("access-abc")
    expect(result.refresh).toContain("refresh-xyz")
    expect(result.email).toBe("user@example.com")
  })

  it("returns failure when token exchange fails", async () => {
    mockFetchSequence([
      { ok: false, text: "invalid_grant" },
    ])

    const state = makeState("test-verifier-xyz789")
    const result = await exchangeAntigravity("bad-code", state)

    expect(result.type).toBe("failed")
    if (result.type !== "failed") return
    expect(result.error).toContain("invalid_grant")
  })

  it("returns failure when refresh_token is missing from response", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "access-only",
          expires_in: 3600,
          // no refresh_token
        },
      },
      { ok: true, json: { email: "user@example.com" } },
    ])

    const state = makeState("test-verifier-xyz789")
    const result = await exchangeAntigravity("auth-code", state)

    expect(result.type).toBe("failed")
    if (result.type !== "failed") return
    expect(result.error).toContain("Missing refresh token")
  })

  it("uses projectId from state if provided", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "access-abc",
          refresh_token: "refresh-xyz",
          expires_in: 3600,
        },
      },
      { ok: true, json: { email: "user@example.com" } },
    ])

    const state = makeState("test-verifier-xyz789", "preset-project-id")
    const result = await exchangeAntigravity("auth-code", state)

    expect(result.type).toBe("success")
    if (result.type !== "success") return
    expect(result.projectId).toBe("preset-project-id")
    // Should NOT call loadCodeAssist because projectId is already set
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("calls loadCodeAssist to get projectId when not in state", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "access-abc",
          refresh_token: "refresh-xyz",
          expires_in: 3600,
        },
      },
      { ok: true, json: { email: "user@example.com" } },
      {
        // loadCodeAssist
        ok: true,
        json: { cloudaicompanionProject: { id: "fetched-project" } },
      },
    ])

    const state = makeState("test-verifier-xyz789", "")
    const result = await exchangeAntigravity("auth-code", state)

    expect(result.type).toBe("success")
    if (result.type !== "success") return
    expect(result.projectId).toBe("fetched-project")
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it("returns type=failed when state is invalid JSON", async () => {
    const result = await exchangeAntigravity("code", "not-valid-base64!!!")
    expect(result.type).toBe("failed")
  })

  it("returns type=failed when state is missing verifier", async () => {
    const badState = Buffer.from(JSON.stringify({ projectId: "proj" }), "utf8").toString("base64url")
    const result = await exchangeAntigravity("code", badState)
    expect(result.type).toBe("failed")
  })

  it("handles userinfo fetch failure gracefully (no email)", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "access-abc",
          refresh_token: "refresh-xyz",
          expires_in: 3600,
        },
      },
      { ok: false, text: "Forbidden" }, // userinfo fails
      {
        ok: true,
        json: { cloudaicompanionProject: "fallback-proj" },
      },
    ])

    const state = makeState("test-verifier-xyz789", "")
    const result = await exchangeAntigravity("auth-code", state)

    expect(result.type).toBe("success")
    if (result.type !== "success") return
    // email should be undefined when userinfo fails
    expect(result.email).toBeUndefined()
  })

  it("stored refresh includes projectId joined with pipe", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          access_token: "access-abc",
          refresh_token: "my-refresh-token",
          expires_in: 3600,
        },
      },
      { ok: true, json: { email: "user@example.com" } },
      {
        ok: true,
        json: { cloudaicompanionProject: "project-123" },
      },
    ])

    const state = makeState("test-verifier-xyz789", "")
    const result = await exchangeAntigravity("auth-code", state)

    expect(result.type).toBe("success")
    if (result.type !== "success") return
    expect(result.refresh).toBe("my-refresh-token|project-123")
  })
})
