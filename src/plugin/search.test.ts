import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock dependencies before importing
vi.mock("../constants", () => ({
  ANTIGRAVITY_ENDPOINT: "https://cloudcode-pa.googleapis.com",
  SEARCH_MODEL: "gemini-flash",
  SEARCH_TIMEOUT_MS: 30000,
  SEARCH_SYSTEM_INSTRUCTION: "You are a helpful search assistant.",
  getAntigravityHeaders: () => ({
    "User-Agent": "antigravity/test",
    "x-goog-api-client": "test",
  }),
}))

vi.mock("./logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

import { executeSearch } from "./search.ts"
import type { SearchArgs } from "./search.ts"

// ---------------------------------------------------------------------------
// Helper: build a mock fetch response
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Bad Request",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    clone: () => makeResponse(body, ok, status),
  } as unknown as Response
}

function makeSearchBody(text: string, overrides: Record<string, unknown> = {}) {
  return {
    response: {
      candidates: [
        {
          content: { parts: [{ text }], role: "model" },
          finishReason: "STOP",
          ...overrides,
        },
      ],
      ...overrides,
    },
  }
}

describe("executeSearch", () => {
  const accessToken = "test-access-token"
  const projectId = "test-project-id"

  beforeEach(() => {
    global.fetch = vi.fn()
    vi.clearAllMocks()
  })

  describe("basic search flow", () => {
    it("calls fetch with POST to Antigravity endpoint", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result text")))

      await executeSearch({ query: "test query" }, accessToken, projectId)

      expect(global.fetch).toHaveBeenCalledTimes(1)
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]!
      expect(String(url)).toContain("generateContent")
      expect(init?.method).toBe("POST")
    })

    it("includes Authorization header with access token", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result text")))

      await executeSearch({ query: "test query" }, accessToken, projectId)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const headers = init?.headers as Record<string, string>
      expect(headers["Authorization"]).toBe(`Bearer ${accessToken}`)
    })

    it("includes Content-Type application/json", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result text")))

      await executeSearch({ query: "test query" }, accessToken, projectId)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const headers = init?.headers as Record<string, string>
      expect(headers["Content-Type"]).toBe("application/json")
    })

    it("returns formatted search results with text", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeResponse(makeSearchBody("Here is the answer to your query.")),
      )

      const result = await executeSearch({ query: "test query" }, accessToken, projectId)

      expect(result).toContain("## Search Results")
      expect(result).toContain("Here is the answer to your query.")
    })

    it("includes googleSearch tool in request payload", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch({ query: "what is AI" }, accessToken, projectId)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      expect(body.request.tools).toContainEqual({ googleSearch: {} })
    })

    it("includes project ID in request body", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch({ query: "test" }, accessToken, "my-project-id")

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      expect(body.project).toBe("my-project-id")
    })
  })

  describe("URL handling", () => {
    it("adds urlContext tool when URLs are provided", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch(
        { query: "summarize this", urls: ["https://example.com"] },
        accessToken,
        projectId,
      )

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      expect(body.request.tools).toContainEqual({ urlContext: {} })
    })

    it("does not add urlContext when no URLs provided", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch({ query: "test" }, accessToken, projectId)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      const tools = body.request.tools as Array<Record<string, unknown>>
      expect(tools.some((t) => "urlContext" in t)).toBe(false)
    })

    it("appends URLs to prompt when URLs are provided", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch(
        { query: "summarize", urls: ["https://example.com", "https://docs.example.com"] },
        accessToken,
        projectId,
      )

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      const promptPart = body.request.contents[0].parts[0].text as string
      expect(promptPart).toContain("summarize")
      expect(promptPart).toContain("https://example.com")
      expect(promptPart).toContain("https://docs.example.com")
    })

    it("uses plain query as prompt when no URLs", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch({ query: "my query" }, accessToken, projectId)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      const promptPart = body.request.contents[0].parts[0].text as string
      expect(promptPart).toBe("my query")
    })
  })

  describe("response parsing", () => {
    it("extracts grounding sources from groundingChunks", async () => {
      const responseBody = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "Result" }], role: "model" },
              groundingMetadata: {
                webSearchQueries: ["my query"],
                groundingChunks: [
                  { web: { uri: "https://source.com", title: "Source Title" } },
                  { web: { uri: "https://other.com", title: "Other Title" } },
                ],
              },
            },
          ],
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("### Sources")
      expect(result).toContain("[Source Title](https://source.com)")
      expect(result).toContain("[Other Title](https://other.com)")
    })

    it("extracts search queries used", async () => {
      const responseBody = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "Result" }], role: "model" },
              groundingMetadata: {
                webSearchQueries: ["query one", "query two"],
              },
            },
          ],
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("### Search Queries Used")
      expect(result).toContain('"query one"')
      expect(result).toContain('"query two"')
    })

    it("extracts URL retrieval status from urlContextMetadata", async () => {
      const responseBody = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "Result" }], role: "model" },
              urlContextMetadata: {
                url_metadata: [
                  {
                    retrieved_url: "https://example.com",
                    url_retrieval_status: "URL_RETRIEVAL_STATUS_SUCCESS",
                  },
                  {
                    retrieved_url: "https://failed.com",
                    url_retrieval_status: "URL_RETRIEVAL_STATUS_ERROR",
                  },
                ],
              },
            },
          ],
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("### URLs Retrieved")
      expect(result).toContain("✓")
      expect(result).toContain("✗")
      expect(result).toContain("https://example.com")
    })

    it("handles empty candidates gracefully", async () => {
      const responseBody = { response: { candidates: [] } }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("## Search Results")
      expect(typeof result).toBe("string")
    })

    it("handles missing response body gracefully", async () => {
      const responseBody = {}
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(typeof result).toBe("string")
    })

    it("returns error message when response has top-level error", async () => {
      const responseBody = {
        error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("Error")
      expect(result).toContain("Permission denied")
    })

    it("returns error message when nested response has error", async () => {
      const responseBody = {
        response: {
          error: { code: 429, message: "Quota exceeded" },
          candidates: [],
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("Error")
      expect(result).toContain("Quota exceeded")
    })

    it("joins multiple text parts with newline", async () => {
      const responseBody = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: "Part one" }, { text: "Part two" }, { text: "" }],
                role: "model",
              },
            },
          ],
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("Part one")
      expect(result).toContain("Part two")
    })

    it("skips groundingChunks without both uri and title", async () => {
      const responseBody = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "Result" }], role: "model" },
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: "https://source.com" } }, // no title
                  { web: { title: "Title Only" } }, // no uri
                  { web: { uri: "https://both.com", title: "Both" } }, // valid
                ],
              },
            },
          ],
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(responseBody))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      // Only the valid one should appear
      expect(result).toContain("https://both.com")
      expect(result).not.toContain("Title Only")
    })
  })

  describe("error handling", () => {
    it("returns error string when fetch returns non-ok response", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeResponse({ error: "Unauthorized" }, false, 401),
      )

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("## Search Error")
      expect(result).toContain("401")
    })

    it("returns error string when fetch throws network error", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("## Search Error")
      expect(result).toContain("Network error")
    })

    it("returns error string when fetch is aborted", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("## Search Error")
    })

    it("handles non-Error thrown values gracefully", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce("string error")

      const result = await executeSearch({ query: "test" }, accessToken, projectId)

      expect(result).toContain("## Search Error")
      expect(result).toContain("string error")
    })

    it("passes abort signal when provided", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))
      const controller = new AbortController()

      await executeSearch({ query: "test" }, accessToken, projectId, controller.signal)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      expect(init?.signal).toBe(controller.signal)
    })

    it("uses default timeout when no abort signal provided", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeResponse(makeSearchBody("Result")))

      await executeSearch({ query: "test" }, accessToken, projectId)

      const [, init] = vi.mocked(global.fetch).mock.calls[0]!
      // AbortSignal.timeout is used
      expect(init?.signal).toBeDefined()
    })
  })
})
