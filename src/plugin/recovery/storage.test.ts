/**
 * Tests for src/plugin/recovery/storage.ts
 *
 * These tests mock the filesystem and verify the logic of the storage helpers
 * without touching actual disk.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "node:path"

// ---------------------------------------------------------------------------
// Filesystem mock — using vi.mock with factory (hoisted correctly)
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

// Mock constants to use a fixed path
vi.mock("./constants", () => ({
  MESSAGE_STORAGE: "/fake/opencode/storage/message",
  PART_STORAGE: "/fake/opencode/storage/part",
  THINKING_TYPES: new Set(["thinking", "redacted_thinking", "reasoning"]),
  META_TYPES: new Set(["step-start", "step-finish"]),
  CONTENT_TYPES: new Set(["text", "tool", "tool_use", "tool_result"]),
}))

import * as fs from "node:fs"
import {
  getMessageDir,
  readMessages,
  readParts,
  hasContent,
  findMessagesWithThinkingBlocks,
  prependThinkingPart,
  stripThinkingParts,
  generatePartId,
  injectTextPart,
} from "./storage.ts"

// ---------------------------------------------------------------------------
// Typed helper — avoids repeating casts for readdirSync mocks
// ---------------------------------------------------------------------------

type ReaddirReturn = ReturnType<typeof fs.readdirSync>

function mockReaddirValue(files: string[]) {
  vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReaddirReturn)
}

function mockReaddirImpl(fn: (p: unknown) => string[]) {
  vi.mocked(fs.readdirSync).mockImplementation(fn as unknown as typeof fs.readdirSync)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "session-abc"
const MSG_ID = "msg-001"
const MSG_STORAGE = "/fake/opencode/storage/message"
const PART_STORAGE = "/fake/opencode/storage/part"

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MSG_ID,
    role: "assistant",
    time: { created: Date.now() },
    ...overrides,
  }
}

function makePart(overrides: Record<string, unknown> = {}) {
  return {
    id: "prt_test",
    type: "text",
    text: "hello",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// generatePartId
// ---------------------------------------------------------------------------

describe("generatePartId", () => {
  it("starts with prt_", () => {
    expect(generatePartId()).toMatch(/^prt_/)
  })

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePartId()))
    expect(ids.size).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// getMessageDir
// ---------------------------------------------------------------------------

describe("getMessageDir", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns empty string when MESSAGE_STORAGE does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(getMessageDir(SESSION_ID)).toBe("")
  })

  it("returns direct path when session directory exists directly", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      if (p === MSG_STORAGE) return true
      if (p === path.join(MSG_STORAGE, SESSION_ID)) return true
      return false
    })
    expect(getMessageDir(SESSION_ID)).toBe(path.join(MSG_STORAGE, SESSION_ID))
  })

  it("searches subdirectories when direct path doesn't exist", () => {
    const subDir = "subdir-1"
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      if (p === MSG_STORAGE) return true
      if (p === path.join(MSG_STORAGE, SESSION_ID)) return false
      if (p === path.join(MSG_STORAGE, subDir, SESSION_ID)) return true
      return false
    })
    mockReaddirValue([subDir])

    expect(getMessageDir(SESSION_ID)).toBe(path.join(MSG_STORAGE, subDir, SESSION_ID))
  })

  it("returns empty string when session not found in any subdirectory", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      if (p === MSG_STORAGE) return true
      return false
    })
    mockReaddirValue(["sub1", "sub2"])

    expect(getMessageDir(SESSION_ID)).toBe("")
  })
})

// ---------------------------------------------------------------------------
// readMessages
// ---------------------------------------------------------------------------

describe("readMessages", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns empty array when session dir not found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(readMessages(SESSION_ID)).toEqual([])
  })

  it("reads and parses .json files from message dir", () => {
    const msgDir = path.join(MSG_STORAGE, SESSION_ID)
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      return p === MSG_STORAGE || p === msgDir
    })
    mockReaddirValue(["msg-001.json"])
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(makeMessage({ id: "msg-001", time: { created: 100 } })))

    const messages = readMessages(SESSION_ID)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe("msg-001")
  })

  it("skips non-.json files", () => {
    const msgDir = path.join(MSG_STORAGE, SESSION_ID)
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => p === MSG_STORAGE || p === msgDir)
    mockReaddirValue(["msg.txt", "msg.json"])
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(makeMessage()))

    const messages = readMessages(SESSION_ID)
    expect(messages).toHaveLength(1)
  })

  it("sorts messages by created time ascending", () => {
    const msgDir = path.join(MSG_STORAGE, SESSION_ID)
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => p === MSG_STORAGE || p === msgDir)
    mockReaddirValue(["b.json", "a.json"])
    let callCount = 0
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      const msgs = [
        makeMessage({ id: "b", time: { created: 200 } }),
        makeMessage({ id: "a", time: { created: 100 } }),
      ]
      return JSON.stringify(msgs[callCount++])
    })

    const messages = readMessages(SESSION_ID)
    expect(messages[0]?.id).toBe("a")
    expect(messages[1]?.id).toBe("b")
  })

  it("skips files with invalid JSON", () => {
    const msgDir = path.join(MSG_STORAGE, SESSION_ID)
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => p === MSG_STORAGE || p === msgDir)
    mockReaddirValue(["bad.json"])
    vi.mocked(fs.readFileSync).mockReturnValue("{ invalid json")

    expect(readMessages(SESSION_ID)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// readParts
// ---------------------------------------------------------------------------

describe("readParts", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns empty array when part directory does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(readParts(MSG_ID)).toEqual([])
  })

  it("reads and parses .json files from part dir", () => {
    const partDir = path.join(PART_STORAGE, MSG_ID)
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => p === partDir)
    mockReaddirValue(["part1.json"])
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(makePart({ id: "part1", type: "text", text: "hi" })))

    const parts = readParts(MSG_ID)
    expect(parts).toHaveLength(1)
    expect(parts[0]?.type).toBe("text")
  })
})

// ---------------------------------------------------------------------------
// hasContent
// ---------------------------------------------------------------------------

function makePart2(type: string, extra: Record<string, unknown> = {}) {
  return { id: "p", sessionID: "s", messageID: "m", type, ...extra }
}

describe("hasContent", () => {
  it("returns false for thinking type", () => {
    expect(hasContent(makePart2("thinking") as Parameters<typeof hasContent>[0])).toBe(false)
  })

  it("returns false for meta types", () => {
    expect(hasContent(makePart2("step-start") as Parameters<typeof hasContent>[0])).toBe(false)
    expect(hasContent(makePart2("step-finish") as Parameters<typeof hasContent>[0])).toBe(false)
  })

  it("returns false for text part with empty/whitespace text", () => {
    expect(hasContent(makePart2("text", { text: "   " }) as Parameters<typeof hasContent>[0])).toBe(false)
    expect(hasContent(makePart2("text", { text: "" }) as Parameters<typeof hasContent>[0])).toBe(false)
  })

  it("returns true for text part with non-empty text", () => {
    expect(hasContent(makePart2("text", { text: "hello" }) as Parameters<typeof hasContent>[0])).toBe(true)
  })

  it("returns true for tool type", () => {
    expect(hasContent(makePart2("tool") as Parameters<typeof hasContent>[0])).toBe(true)
  })

  it("returns true for tool_result type", () => {
    expect(hasContent(makePart2("tool_result") as Parameters<typeof hasContent>[0])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// findMessagesWithThinkingBlocks
// ---------------------------------------------------------------------------

describe("findMessagesWithThinkingBlocks", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns IDs of assistant messages with thinking parts", () => {
    const msgDir = path.join(MSG_STORAGE, SESSION_ID)
    // getMessageDir: message storage exists, direct path exists
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      return p === MSG_STORAGE || p === msgDir || p === path.join(PART_STORAGE, "msg-thinking")
    })
    // readMessages: one assistant message
    mockReaddirImpl((p: unknown) => {
      if (p === msgDir) return ["msg-thinking.json"]
      // parts dir
      return ["part1.json"]
    })
    vi.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
      if (String(p).endsWith("msg-thinking.json")) {
        return JSON.stringify(makeMessage({ id: "msg-thinking", role: "assistant" }))
      }
      return JSON.stringify({ id: "p1", type: "thinking" })
    })

    const result = findMessagesWithThinkingBlocks(SESSION_ID)
    expect(result).toContain("msg-thinking")
  })

  it("returns empty array when no messages have thinking", () => {
    const msgDir = path.join(MSG_STORAGE, SESSION_ID)
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      return p === MSG_STORAGE || p === msgDir || p === path.join(PART_STORAGE, MSG_ID)
    })
    mockReaddirImpl((p: unknown) => {
      if (String(p).includes("message")) return ["msg-001.json"]
      return ["p1.json"]
    })
    vi.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
      if (String(p).endsWith("msg-001.json")) return JSON.stringify(makeMessage({ role: "assistant" }))
      return JSON.stringify({ id: "p1", type: "text", text: "response" })
    })

    const result = findMessagesWithThinkingBlocks(SESSION_ID)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// prependThinkingPart
// ---------------------------------------------------------------------------

describe("prependThinkingPart", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes synthetic thinking part file", () => {
    const partDir = path.join(PART_STORAGE, MSG_ID)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined)

    const result = prependThinkingPart(SESSION_ID, MSG_ID)

    expect(result).toBe(true)
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce()
    const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string]
    const written = JSON.parse(content as string)
    expect(written.type).toBe("thinking")
    expect(written.synthetic).toBe(true)
    expect(written.sessionID).toBe(SESSION_ID)
    expect(written.messageID).toBe(MSG_ID)
    void partDir
  })

  it("creates directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined)
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined)

    prependThinkingPart(SESSION_ID, MSG_ID)

    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalled()
  })

  it("returns false on write error", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error("disk full") })

    const result = prependThinkingPart(SESSION_ID, MSG_ID)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// stripThinkingParts
// ---------------------------------------------------------------------------

describe("stripThinkingParts", () => {
  beforeEach(() => vi.clearAllMocks())

  it("removes thinking part files and returns true", () => {
    const partDir = path.join(PART_STORAGE, MSG_ID)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    mockReaddirValue(["p-thinking.json", "p-text.json"])
    vi.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
      if (String(p).includes("thinking")) return JSON.stringify({ type: "thinking" })
      return JSON.stringify({ type: "text", text: "hello" })
    })
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined)

    const result = stripThinkingParts(MSG_ID)

    expect(result).toBe(true)
    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledOnce()
    void partDir
  })

  it("returns false when part dir does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(stripThinkingParts(MSG_ID)).toBe(false)
  })

  it("returns false when no thinking parts found", () => {
    const partDir = path.join(PART_STORAGE, MSG_ID)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    mockReaddirValue(["p-text.json"])
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ type: "text", text: "hello" }))

    const result = stripThinkingParts(MSG_ID)
    expect(result).toBe(false)
    void partDir
  })
})

// ---------------------------------------------------------------------------
// injectTextPart
// ---------------------------------------------------------------------------

describe("injectTextPart", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a text part file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined)

    const result = injectTextPart(SESSION_ID, MSG_ID, "injected text")

    expect(result).toBe(true)
    const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string]
    const written = JSON.parse(content as string)
    expect(written.type).toBe("text")
    expect(written.text).toBe("injected text")
    expect(written.synthetic).toBe(true)
  })

  it("returns false on write error", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error("fail") })

    expect(injectTextPart(SESSION_ID, MSG_ID, "text")).toBe(false)
  })
})
