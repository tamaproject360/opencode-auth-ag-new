import { describe, it, expect } from "vitest"
import { EmptyResponseError, ToolIdMismatchError } from "./errors.ts"

describe("EmptyResponseError", () => {
  it("creates error with default message when no message provided", () => {
    const err = new EmptyResponseError("antigravity", "gemini-pro", 3)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(EmptyResponseError)
    expect(err.name).toBe("EmptyResponseError")
    expect(err.provider).toBe("antigravity")
    expect(err.model).toBe("gemini-pro")
    expect(err.attempts).toBe(3)
    expect(err.message).toContain("3 attempts")
    expect(err.message).toContain("empty response")
  })

  it("uses custom message when provided", () => {
    const err = new EmptyResponseError("antigravity", "gemini-flash", 1, "Custom error message")
    expect(err.message).toBe("Custom error message")
    expect(err.provider).toBe("antigravity")
    expect(err.model).toBe("gemini-flash")
    expect(err.attempts).toBe(1)
  })

  it("is catchable as Error", () => {
    const err = new EmptyResponseError("antigravity", "claude-sonnet", 2)
    let caught: unknown
    try {
      throw err
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).toBeInstanceOf(EmptyResponseError)
  })

  it("has correct name property for identification", () => {
    const err = new EmptyResponseError("provider", "model", 5)
    expect(err.name).toBe("EmptyResponseError")
  })

  it("default message mentions try again", () => {
    const err = new EmptyResponseError("provider", "model", 1)
    expect(err.message).toContain("try again")
  })

  it("readonly properties cannot be reassigned (type-level)", () => {
    const err = new EmptyResponseError("antigravity", "gemini-pro", 3)
    // Just verifying values are accessible and correct
    expect(err.provider).toBe("antigravity")
    expect(err.model).toBe("gemini-pro")
    expect(err.attempts).toBe(3)
  })
})

describe("ToolIdMismatchError", () => {
  it("creates error with default message listing IDs", () => {
    const err = new ToolIdMismatchError(["tool-1", "tool-2"], ["tool-3"])
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ToolIdMismatchError)
    expect(err.name).toBe("ToolIdMismatchError")
    expect(err.expectedIds).toEqual(["tool-1", "tool-2"])
    expect(err.foundIds).toEqual(["tool-3"])
    expect(err.message).toContain("tool-1")
    expect(err.message).toContain("tool-2")
    expect(err.message).toContain("tool-3")
    expect(err.message).toContain("mismatch")
  })

  it("uses custom message when provided", () => {
    const err = new ToolIdMismatchError(["a"], ["b"], "Custom mismatch message")
    expect(err.message).toBe("Custom mismatch message")
    expect(err.expectedIds).toEqual(["a"])
    expect(err.foundIds).toEqual(["b"])
  })

  it("handles empty arrays", () => {
    const err = new ToolIdMismatchError([], [])
    expect(err.expectedIds).toEqual([])
    expect(err.foundIds).toEqual([])
    expect(err.message).toContain("expected []")
    expect(err.message).toContain("found []")
  })

  it("handles multiple IDs in both arrays", () => {
    const expected = ["id-1", "id-2", "id-3"]
    const found = ["id-4", "id-5"]
    const err = new ToolIdMismatchError(expected, found)
    expect(err.expectedIds).toEqual(expected)
    expect(err.foundIds).toEqual(found)
    expect(err.message).toContain("id-1, id-2, id-3")
    expect(err.message).toContain("id-4, id-5")
  })

  it("is catchable as Error", () => {
    const err = new ToolIdMismatchError(["x"], ["y"])
    let caught: unknown
    try {
      throw err
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).toBeInstanceOf(ToolIdMismatchError)
  })

  it("has correct name property", () => {
    const err = new ToolIdMismatchError(["a"], ["b"])
    expect(err.name).toBe("ToolIdMismatchError")
  })

  it("different error types are distinguishable via instanceof", () => {
    const err1 = new EmptyResponseError("p", "m", 1)
    const err2 = new ToolIdMismatchError(["a"], ["b"])
    expect(err1 instanceof EmptyResponseError).toBe(true)
    expect(err1 instanceof ToolIdMismatchError).toBe(false)
    expect(err2 instanceof ToolIdMismatchError).toBe(true)
    expect(err2 instanceof EmptyResponseError).toBe(false)
  })
})
