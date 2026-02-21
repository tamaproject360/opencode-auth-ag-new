import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  generateFingerprint,
  collectCurrentFingerprint,
  updateFingerprintVersion,
  buildFingerprintHeaders,
  getSessionFingerprint,
  regenerateSessionFingerprint,
  MAX_FINGERPRINT_HISTORY,
  type Fingerprint,
} from "./fingerprint.ts"

vi.mock("../constants", () => ({
  getAntigravityVersion: vi.fn().mockReturnValue("1.6.0"),
}))

describe("generateFingerprint", () => {
  it("returns an object with required fields", () => {
    const fp = generateFingerprint()
    expect(fp).toHaveProperty("deviceId")
    expect(fp).toHaveProperty("sessionToken")
    expect(fp).toHaveProperty("userAgent")
    expect(fp).toHaveProperty("apiClient")
    expect(fp).toHaveProperty("clientMetadata")
    expect(fp).toHaveProperty("createdAt")
  })

  it("deviceId is a valid UUID", () => {
    const fp = generateFingerprint()
    expect(fp.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it("sessionToken is a 32-char hex string", () => {
    const fp = generateFingerprint()
    expect(fp.sessionToken).toMatch(/^[0-9a-f]{32}$/)
  })

  it("userAgent contains the current Antigravity version", () => {
    const fp = generateFingerprint()
    expect(fp.userAgent).toContain("antigravity/1.6.0")
  })

  it("userAgent is for darwin or win32 platform", () => {
    const fp = generateFingerprint()
    expect(fp.userAgent).toMatch(/antigravity\/[\d.]+ (darwin|win32)\//)
  })

  it("clientMetadata has expected fields", () => {
    const fp = generateFingerprint()
    expect(fp.clientMetadata.ideType).toBe("ANTIGRAVITY")
    expect(fp.clientMetadata.pluginType).toBe("GEMINI")
    expect(["WINDOWS", "MACOS"]).toContain(fp.clientMetadata.platform)
  })

  it("platform in clientMetadata matches OS in userAgent", () => {
    const fp = generateFingerprint()
    if (fp.userAgent.includes("win32")) {
      expect(fp.clientMetadata.platform).toBe("WINDOWS")
    } else {
      expect(fp.clientMetadata.platform).toBe("MACOS")
    }
  })

  it("generates different fingerprints on each call", () => {
    const fp1 = generateFingerprint()
    const fp2 = generateFingerprint()
    // Very unlikely to be equal
    expect(fp1.deviceId).not.toBe(fp2.deviceId)
    expect(fp1.sessionToken).not.toBe(fp2.sessionToken)
  })

  it("createdAt is a recent timestamp", () => {
    const before = Date.now()
    const fp = generateFingerprint()
    const after = Date.now()
    expect(fp.createdAt).toBeGreaterThanOrEqual(before)
    expect(fp.createdAt).toBeLessThanOrEqual(after)
  })
})

describe("collectCurrentFingerprint", () => {
  it("returns a fingerprint with real OS platform info in userAgent", () => {
    const fp = collectCurrentFingerprint()
    // userAgent format: antigravity/<version> <platform>/<arch>
    expect(fp.userAgent).toMatch(/^antigravity\/[\d.]+ \w+\/\w+$/)
  })

  it("has fixed apiClient for current platform", () => {
    const fp = collectCurrentFingerprint()
    expect(fp.apiClient).toBe("google-cloud-sdk vscode_cloudshelleditor/0.1")
  })

  it("has ideType ANTIGRAVITY", () => {
    const fp = collectCurrentFingerprint()
    expect(fp.clientMetadata.ideType).toBe("ANTIGRAVITY")
  })
})

describe("updateFingerprintVersion", () => {
  it("updates version in userAgent when outdated", async () => {
    const { getAntigravityVersion } = await import("../constants")
    vi.mocked(getAntigravityVersion).mockReturnValue("2.0.0")

    const fp: Fingerprint = {
      deviceId: "abc",
      sessionToken: "def",
      userAgent: "antigravity/1.0.0 darwin/arm64",
      apiClient: "sdk",
      clientMetadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" },
      createdAt: Date.now(),
    }

    const changed = updateFingerprintVersion(fp)
    expect(changed).toBe(true)
    expect(fp.userAgent).toBe("antigravity/2.0.0 darwin/arm64")

    vi.mocked(getAntigravityVersion).mockReturnValue("1.6.0")
  })

  it("returns false when version is already current", async () => {
    const { getAntigravityVersion } = await import("../constants")
    vi.mocked(getAntigravityVersion).mockReturnValue("1.6.0")

    const fp: Fingerprint = {
      deviceId: "abc",
      sessionToken: "def",
      userAgent: "antigravity/1.6.0 darwin/arm64",
      apiClient: "sdk",
      clientMetadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" },
      createdAt: Date.now(),
    }

    const changed = updateFingerprintVersion(fp)
    expect(changed).toBe(false)
    expect(fp.userAgent).toBe("antigravity/1.6.0 darwin/arm64")
  })

  it("returns false when userAgent does not match pattern", () => {
    const fp: Fingerprint = {
      deviceId: "abc",
      sessionToken: "def",
      userAgent: "unknown-agent",
      apiClient: "sdk",
      clientMetadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" },
      createdAt: Date.now(),
    }

    const changed = updateFingerprintVersion(fp)
    expect(changed).toBe(false)
  })
})

describe("buildFingerprintHeaders", () => {
  it("returns User-Agent header when fingerprint is provided", () => {
    const fp: Fingerprint = {
      deviceId: "abc",
      sessionToken: "def",
      userAgent: "antigravity/1.6.0 darwin/arm64",
      apiClient: "sdk",
      clientMetadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" },
      createdAt: Date.now(),
    }

    const headers = buildFingerprintHeaders(fp)
    expect(headers["User-Agent"]).toBe("antigravity/1.6.0 darwin/arm64")
  })

  it("returns empty object when fingerprint is null", () => {
    const headers = buildFingerprintHeaders(null)
    expect(headers).toEqual({})
  })
})

describe("MAX_FINGERPRINT_HISTORY", () => {
  it("is 5", () => {
    expect(MAX_FINGERPRINT_HISTORY).toBe(5)
  })
})

describe("session fingerprint management", () => {
  beforeEach(() => {
    // Force a fresh session fingerprint for each test
    regenerateSessionFingerprint()
  })

  it("getSessionFingerprint returns same instance on repeated calls", () => {
    const fp1 = getSessionFingerprint()
    const fp2 = getSessionFingerprint()
    expect(fp1).toBe(fp2)
  })

  it("regenerateSessionFingerprint returns a new instance", () => {
    const fp1 = getSessionFingerprint()
    const fp2 = regenerateSessionFingerprint()
    expect(fp1).not.toBe(fp2)
  })

  it("after regeneration, getSessionFingerprint returns the new one", () => {
    const newFp = regenerateSessionFingerprint()
    const retrieved = getSessionFingerprint()
    expect(retrieved).toBe(newFp)
  })

  it("regenerated fingerprint has a valid UUID", () => {
    const fp = regenerateSessionFingerprint()
    expect(fp.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
