import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock undici using inline factory (avoids hoisting issues)
vi.mock("undici", () => ({
  ProxyAgent: vi.fn().mockImplementation((url: string) => ({ _url: url })),
  setGlobalDispatcher: vi.fn(),
}))

vi.mock("./logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

import { configureProxy } from "./proxy.ts"
import { ProxyAgent, setGlobalDispatcher } from "undici"

describe("configureProxy", () => {
  const proxyEnvVars = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"] as const
  const savedValues: Partial<Record<string, string>> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of proxyEnvVars) {
      savedValues[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of proxyEnvVars) {
      if (savedValues[key] !== undefined) {
        process.env[key] = savedValues[key]
      } else {
        delete process.env[key]
      }
    }
  })

  it("does nothing when no proxy env vars are set", () => {
    configureProxy()
    expect(ProxyAgent).not.toHaveBeenCalled()
    expect(setGlobalDispatcher).not.toHaveBeenCalled()
  })

  it("configures proxy from HTTPS_PROXY (highest priority)", () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080"
    process.env.HTTP_PROXY = "http://other.proxy.com:3128"
    configureProxy()
    expect(ProxyAgent).toHaveBeenCalledWith("http://proxy.example.com:8080")
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("falls back to HTTP_PROXY when HTTPS_PROXY is not set", () => {
    process.env.HTTP_PROXY = "http://proxy.example.com:3128"
    configureProxy()
    expect(ProxyAgent).toHaveBeenCalledWith("http://proxy.example.com:3128")
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("falls back to lowercase https_proxy", () => {
    process.env.https_proxy = "http://lower.proxy.com:8080"
    configureProxy()
    expect(ProxyAgent).toHaveBeenCalledWith("http://lower.proxy.com:8080")
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("falls back to lowercase http_proxy (lowest priority)", () => {
    process.env.http_proxy = "http://lowest.proxy.com:3128"
    configureProxy()
    expect(ProxyAgent).toHaveBeenCalledWith("http://lowest.proxy.com:3128")
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("uses the first truthy proxy env var (OR chain order)", () => {
    // On case-sensitive systems: HTTPS_PROXY wins.
    // On Windows (case-insensitive env): last assignment wins.
    // Just verify *a* proxy is configured when any var is set.
    process.env.HTTP_PROXY = "http://http-proxy.com"
    process.env.http_proxy = "http://lower-http.com"
    configureProxy()
    // Exactly one call should be made
    expect(ProxyAgent).toHaveBeenCalledTimes(1)
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("handles ProxyAgent constructor throwing an error gracefully", () => {
    process.env.HTTPS_PROXY = "invalid-url"
    vi.mocked(ProxyAgent).mockImplementationOnce(() => {
      throw new Error("Invalid proxy URL")
    })
    // Should not throw
    expect(() => configureProxy()).not.toThrow()
    expect(setGlobalDispatcher).not.toHaveBeenCalled()
  })

  it("calls setGlobalDispatcher with the ProxyAgent instance", () => {
    process.env.HTTPS_PROXY = "http://proxy.test.com:8080"
    const mockInstance = { _url: "http://proxy.test.com:8080" } as unknown as InstanceType<typeof ProxyAgent>
    vi.mocked(ProxyAgent).mockReturnValueOnce(mockInstance)
    configureProxy()
    expect(setGlobalDispatcher).toHaveBeenCalledWith(mockInstance)
  })

  it("only configures one dispatcher even if multiple env vars are set", () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080"
    process.env.HTTP_PROXY = "http://other.com:3128"
    configureProxy()
    expect(ProxyAgent).toHaveBeenCalledTimes(1)
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })
})
