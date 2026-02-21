import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as nodeHttp from "node:http"
import * as nodeFs from "node:fs"

// Mock node:http and node:fs before imports
vi.mock("node:http", () => {
  const mockServer = {
    listen: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }
  return {
    createServer: vi.fn(() => mockServer),
    __mockServer: mockServer,
  }
})

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}))

vi.mock("../constants", () => ({
  ANTIGRAVITY_REDIRECT_URI: "http://127.0.0.1:51121/oauth/callback",
}))

// Helper to get the mock server
function getMockServer() {
  return (nodeHttp as unknown as { __mockServer: Record<string, ReturnType<typeof vi.fn>> })
    .__mockServer
}

function setupServer() {
  const server = getMockServer()
  server.listen!.mockImplementation(
    (_port: number, _host: string, cb: () => void) => { cb() },
  )
  server.once!.mockImplementation((_event: string, _handler: unknown) => {})
  server.off!.mockImplementation(() => {})
  server.on!.mockImplementation((_event: string, _handler: unknown) => {})
  server.close!.mockImplementation((cb?: (err?: Error) => void) => {
    if (cb) cb()
  })
  return server
}

import { startOAuthListener } from "./server.ts"

describe("startOAuthListener", () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = [
    "OPENCODE_ANTIGRAVITY_OAUTH_BIND",
    "SSH_CLIENT",
    "SSH_TTY",
    "SSH_CONNECTION",
    "REMOTE_CONTAINERS",
    "CODESPACES",
    "HOSTNAME",
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
  })

  // Helper: start listener, attach .catch to waitForCallback, close cleanly
  async function startAndClose(opts?: { timeoutMs?: number }) {
    const listener = await startOAuthListener(opts ?? { timeoutMs: 100 })
    // Attach catch to prevent unhandled rejection when we close before callback
    listener.waitForCallback().catch(() => {})
    await listener.close().catch(() => {})
    return listener
  }

  it("returns an OAuthListener with waitForCallback and close methods", async () => {
    setupServer()

    const listener = await startAndClose()

    expect(listener).toHaveProperty("waitForCallback")
    expect(listener).toHaveProperty("close")
    expect(typeof listener.waitForCallback).toBe("function")
    expect(typeof listener.close).toBe("function")
  })

  it("calls server.listen with port 51121", async () => {
    const server = setupServer()

    await startAndClose()

    expect(server.listen).toHaveBeenCalledWith(
      51121,
      expect.any(String),
      expect.any(Function),
    )
  })

  it("uses 127.0.0.1 or 0.0.0.0 by default (test environment)", async () => {
    const server = setupServer()

    await startAndClose()

    const [, bindAddress] = server.listen!.mock.calls[0]! as [number, string, () => void]
    expect(["127.0.0.1", "0.0.0.0"]).toContain(bindAddress)
  })

  it("uses custom bind address from OPENCODE_ANTIGRAVITY_OAUTH_BIND env var", async () => {
    process.env.OPENCODE_ANTIGRAVITY_OAUTH_BIND = "0.0.0.0"
    const server = setupServer()

    await startAndClose()

    const [, bindAddress] = server.listen!.mock.calls[0]! as [number, string, () => void]
    expect(bindAddress).toBe("0.0.0.0")
  })

  it("uses 0.0.0.0 when SSH_CLIENT is set", async () => {
    process.env.SSH_CLIENT = "192.168.1.1 50000 22"
    const server = setupServer()

    await startAndClose()

    const [, bindAddress] = server.listen!.mock.calls[0]! as [number, string, () => void]
    expect(bindAddress).toBe("0.0.0.0")
  })

  it("uses 0.0.0.0 when SSH_TTY is set", async () => {
    process.env.SSH_TTY = "/dev/pts/0"
    const server = setupServer()

    await startAndClose()

    const [, bindAddress] = server.listen!.mock.calls[0]! as [number, string, () => void]
    expect(bindAddress).toBe("0.0.0.0")
  })

  it("uses 0.0.0.0 when CODESPACES is set", async () => {
    process.env.CODESPACES = "true"
    const server = setupServer()

    await startAndClose()

    const [, bindAddress] = server.listen!.mock.calls[0]! as [number, string, () => void]
    expect(bindAddress).toBe("0.0.0.0")
  })

  it("uses 0.0.0.0 when REMOTE_CONTAINERS is set", async () => {
    process.env.REMOTE_CONTAINERS = "true"
    const server = setupServer()

    await startAndClose()

    const [, bindAddress] = server.listen!.mock.calls[0]! as [number, string, () => void]
    expect(bindAddress).toBe("0.0.0.0")
  })

  it("close resolves successfully when no callback was received", async () => {
    const server = setupServer()
    server.close!.mockImplementation((cb?: (err?: Error) => void) => { if (cb) cb() })

    const listener = await startOAuthListener({ timeoutMs: 100 })
    // Attach catch to avoid unhandled rejection when close rejects callbackPromise
    listener.waitForCallback().catch(() => {})

    await expect(listener.close()).resolves.toBeUndefined()
  })

  it("close rejects when server.close returns a non-recoverable error", async () => {
    const server = setupServer()
    server.close!.mockImplementation((cb?: (err?: Error) => void) => {
      if (cb) cb(new Error("SOME_ERROR"))
    })

    const listener = await startOAuthListener({ timeoutMs: 100 })
    listener.waitForCallback().catch(() => {})

    await expect(listener.close()).rejects.toThrow("SOME_ERROR")
  })

  it("close resolves even with ERR_SERVER_NOT_RUNNING error", async () => {
    const server = setupServer()
    const notRunningErr = Object.assign(new Error("ERR_SERVER_NOT_RUNNING"), {
      code: "ERR_SERVER_NOT_RUNNING",
    })
    server.close!.mockImplementation((cb?: (err?: Error) => void) => {
      if (cb) cb(notRunningErr)
    })

    const listener = await startOAuthListener({ timeoutMs: 100 })
    listener.waitForCallback().catch(() => {})

    await expect(listener.close()).resolves.toBeUndefined()
  })

  it("throws when server fails to start (non-EADDRINUSE error)", async () => {
    const server = getMockServer()
    server.once!.mockImplementation((event: string, handler: (e: Error) => void) => {
      if (event === "error") {
        setTimeout(() => handler(new Error("EACCES")), 0)
      }
    })
    server.off!.mockImplementation(() => {})
    server.listen!.mockImplementation((_port: number, _host: string, _cb: () => void) => {
      // Don't call cb (let error fire first)
    })

    await expect(startOAuthListener({ timeoutMs: 100 })).rejects.toThrow("EACCES")
  })

  it("throws with helpful message on EADDRINUSE", async () => {
    const server = getMockServer()
    const eaddrinuse = Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" })
    server.once!.mockImplementation((event: string, handler: (e: Error) => void) => {
      if (event === "error") {
        setTimeout(() => handler(eaddrinuse), 0)
      }
    })
    server.off!.mockImplementation(() => {})
    server.listen!.mockImplementation((_port: number, _host: string, _cb: () => void) => {})

    await expect(startOAuthListener({ timeoutMs: 100 })).rejects.toThrow(
      /Port.*in use|already in use/i,
    )
  })

  it("waitForCallback resolves when OAuth callback arrives at correct path", async () => {
    let requestHandler: ((req: unknown, res: unknown) => void) | null = null

    vi.mocked(nodeHttp.createServer).mockImplementationOnce((handler) => {
      requestHandler = handler as (req: unknown, res: unknown) => void
      return getMockServer() as unknown as nodeHttp.Server
    })

    setupServer()
    const listener = await startOAuthListener({ timeoutMs: 5000 })

    const callbackPromise = listener.waitForCallback()

    // Simulate OAuth callback request
    const mockReq = { url: "/oauth/callback?code=auth_code_123&state=state_456" }
    const mockRes = { writeHead: vi.fn(), end: vi.fn() }

    if (requestHandler) {
      requestHandler(mockReq, mockRes)
    }

    const url = await callbackPromise
    expect(url).toBeInstanceOf(URL)
    expect(url.searchParams.get("code")).toBe("auth_code_123")
    expect(url.searchParams.get("state")).toBe("state_456")
  })

  it("responds 200 with HTML on successful callback path", async () => {
    let requestHandler: ((req: unknown, res: unknown) => void) | null = null

    vi.mocked(nodeHttp.createServer).mockImplementationOnce((handler) => {
      requestHandler = handler as (req: unknown, res: unknown) => void
      return getMockServer() as unknown as nodeHttp.Server
    })

    setupServer()
    const listener = await startOAuthListener({ timeoutMs: 5000 })
    const callbackPromise = listener.waitForCallback()

    const mockRes = { writeHead: vi.fn(), end: vi.fn() }
    if (requestHandler) {
      requestHandler({ url: "/oauth/callback?code=abc" }, mockRes)
    }

    await callbackPromise
    expect(mockRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": expect.stringContaining("text/html") }),
    )
  })

  it("responds 404 for unknown paths", async () => {
    let requestHandler: ((req: unknown, res: unknown) => void) | null = null

    vi.mocked(nodeHttp.createServer).mockImplementationOnce((handler) => {
      requestHandler = handler as (req: unknown, res: unknown) => void
      return getMockServer() as unknown as nodeHttp.Server
    })

    setupServer()
    const listener = await startOAuthListener({ timeoutMs: 100 })

    const mockReq = { url: "/unknown/path" }
    const mockRes = { writeHead: vi.fn(), end: vi.fn() }

    if (requestHandler) {
      requestHandler(mockReq, mockRes)
    }

    expect(mockRes.writeHead).toHaveBeenCalledWith(
      404,
      expect.objectContaining({ "Content-Type": "text/plain" }),
    )

    listener.waitForCallback().catch(() => {})
    await listener.close().catch(() => {})
  })

  it("responds 400 for requests with no URL", async () => {
    let requestHandler: ((req: unknown, res: unknown) => void) | null = null

    vi.mocked(nodeHttp.createServer).mockImplementationOnce((handler) => {
      requestHandler = handler as (req: unknown, res: unknown) => void
      return getMockServer() as unknown as nodeHttp.Server
    })

    setupServer()
    const listener = await startOAuthListener({ timeoutMs: 100 })

    const mockReq = { url: null }
    const mockRes = { writeHead: vi.fn(), end: vi.fn() }

    if (requestHandler) {
      requestHandler(mockReq, mockRes)
    }

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.anything())
    listener.waitForCallback().catch(() => {})
    await listener.close().catch(() => {})
  })

  it("uses default 5 minute timeout when no options provided", async () => {
    setupServer()
    // Just verifies it doesn't throw with default options
    const listener = await startOAuthListener()
    listener.waitForCallback().catch(() => {})
    await listener.close().catch(() => {})
  })

  it("waitForCallback resolves only once even if called multiple times", async () => {
    let requestHandler: ((req: unknown, res: unknown) => void) | null = null

    vi.mocked(nodeHttp.createServer).mockImplementationOnce((handler) => {
      requestHandler = handler as (req: unknown, res: unknown) => void
      return getMockServer() as unknown as nodeHttp.Server
    })

    setupServer()
    const listener = await startOAuthListener({ timeoutMs: 5000 })

    const p1 = listener.waitForCallback()
    const p2 = listener.waitForCallback()

    const mockRes = { writeHead: vi.fn(), end: vi.fn() }
    if (requestHandler) {
      requestHandler({ url: "/oauth/callback?code=xyz" }, mockRes)
    }

    const [url1, url2] = await Promise.all([p1, p2])
    expect(url1).toBeInstanceOf(URL)
    expect(url2).toBeInstanceOf(URL)
  })
})
