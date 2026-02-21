import { describe, it, expect } from "vitest"
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
  looksLikeCompactedThinkingTurn,
  hasPossibleCompactedThinking,
} from "./thinking-recovery.ts"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userMsg(text: string) {
  return { role: "user", parts: [{ text }] }
}

function modelMsg(parts: object[]) {
  return { role: "model", parts }
}

function thinkingPart(text = "thinking content") {
  return { thought: true, text }
}

function textPart(text: string) {
  return { text }
}

function funcCallPart(name = "myTool") {
  return { functionCall: { name, args: {} } }
}

function funcResponsePart(name = "myTool") {
  return { functionResponse: { name, response: { result: "ok" } } }
}

function toolResultMsg(...tools: string[]) {
  return {
    role: "user",
    parts: tools.map((t) => funcResponsePart(t)),
  }
}

// ---------------------------------------------------------------------------
// analyzeConversationState
// ---------------------------------------------------------------------------

describe("analyzeConversationState", () => {
  it("returns empty state for empty array", () => {
    const state = analyzeConversationState([])
    expect(state.inToolLoop).toBe(false)
    expect(state.turnStartIdx).toBe(-1)
    expect(state.lastModelIdx).toBe(-1)
  })

  it("detects single model message turn", () => {
    const contents = [userMsg("hello"), modelMsg([textPart("hi")])]
    const state = analyzeConversationState(contents)
    expect(state.lastModelIdx).toBe(1)
    expect(state.turnStartIdx).toBe(1)
    expect(state.inToolLoop).toBe(false)
    expect(state.turnHasThinking).toBe(false)
  })

  it("detects thinking in turn start", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([thinkingPart(), funcCallPart()]),
      toolResultMsg("myTool"),
    ]
    const state = analyzeConversationState(contents)
    expect(state.turnHasThinking).toBe(true)
    expect(state.inToolLoop).toBe(true)
  })

  it("detects tool loop (ends with tool result)", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([funcCallPart()]),
      toolResultMsg("myTool"),
    ]
    const state = analyzeConversationState(contents)
    expect(state.inToolLoop).toBe(true)
    // The last model message at index 1 has a functionCall part
    expect(state.lastModelHasToolCalls).toBe(true)
  })

  it("detects lastModelHasThinking and lastModelHasToolCalls", () => {
    const contents = [
      userMsg("start"),
      modelMsg([thinkingPart(), funcCallPart()]),
      toolResultMsg("tool1"),
      modelMsg([thinkingPart("second thinking"), funcCallPart("tool2")]),
      toolResultMsg("tool2"),
    ]
    const state = analyzeConversationState(contents)
    expect(state.lastModelHasThinking).toBe(true)
    expect(state.lastModelHasToolCalls).toBe(true)
    expect(state.inToolLoop).toBe(true)
    // turn started at the first model msg after last real user
    expect(state.turnStartIdx).toBe(1)
    expect(state.turnHasThinking).toBe(true)
  })

  it("handles multiple real user messages — uses last one", () => {
    const contents = [
      userMsg("first"),
      modelMsg([textPart("response1")]),
      userMsg("second"),
      modelMsg([thinkingPart(), textPart("response2")]),
    ]
    const state = analyzeConversationState(contents)
    expect(state.turnStartIdx).toBe(3)
    expect(state.turnHasThinking).toBe(true)
  })

  it("does not count tool-result messages as real user messages", () => {
    const contents = [
      userMsg("real user"),
      modelMsg([funcCallPart()]),
      toolResultMsg("tool"),
    ]
    const state = analyzeConversationState(contents)
    // turnStartIdx should be index 1 (first model after real user at index 0)
    expect(state.turnStartIdx).toBe(1)
    expect(state.inToolLoop).toBe(true)
  })

  it("supports Anthropic format (content array with type=thinking)", () => {
    const contents = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal thought" },
          { type: "text", text: "response" },
        ],
      },
    ]
    const state = analyzeConversationState(contents)
    expect(state.lastModelHasThinking).toBe(true)
  })

  it("returns correct state when no model messages at all", () => {
    const contents = [userMsg("hello")]
    const state = analyzeConversationState(contents)
    expect(state.lastModelIdx).toBe(-1)
    expect(state.inToolLoop).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// needsThinkingRecovery
// ---------------------------------------------------------------------------

describe("needsThinkingRecovery", () => {
  it("returns true when in tool loop without thinking", () => {
    expect(
      needsThinkingRecovery({
        inToolLoop: true,
        turnHasThinking: false,
        turnStartIdx: 1,
        lastModelIdx: 1,
        lastModelHasThinking: false,
        lastModelHasToolCalls: true,
      }),
    ).toBe(true)
  })

  it("returns false when not in tool loop", () => {
    expect(
      needsThinkingRecovery({
        inToolLoop: false,
        turnHasThinking: false,
        turnStartIdx: 1,
        lastModelIdx: 1,
        lastModelHasThinking: false,
        lastModelHasToolCalls: false,
      }),
    ).toBe(false)
  })

  it("returns false when turn has thinking (already OK)", () => {
    expect(
      needsThinkingRecovery({
        inToolLoop: true,
        turnHasThinking: true,
        turnStartIdx: 1,
        lastModelIdx: 1,
        lastModelHasThinking: true,
        lastModelHasToolCalls: true,
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// closeToolLoopForThinking
// ---------------------------------------------------------------------------

describe("closeToolLoopForThinking", () => {
  it("appends synthetic model + user messages", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([funcCallPart()]),
      toolResultMsg("tool"),
    ]
    const result = closeToolLoopForThinking(contents)

    // Original 3 + 2 synthetic = 5
    expect(result).toHaveLength(5)
    expect(result[3]).toMatchObject({ role: "model" })
    expect(result[4]).toMatchObject({ role: "user", parts: [{ text: "[Continue]" }] })
  })

  it("strips thinking blocks from all messages", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([thinkingPart("secret thought"), funcCallPart()]),
      toolResultMsg("tool"),
    ]
    const result = closeToolLoopForThinking(contents)

    // The model msg at index 1 should have thinking stripped
    const modelMsgResult = result[1] as { role: string; parts: object[] }
    const hasThinking = modelMsgResult.parts.some((p: object) => "thought" in p && (p as Record<string, unknown>).thought === true)
    expect(hasThinking).toBe(false)
  })

  it("uses correct text when 1 tool result", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([funcCallPart()]),
      toolResultMsg("tool"),
    ]
    const result = closeToolLoopForThinking(contents)
    const syntheticModel = result[3] as { parts: Array<{ text: string }> }
    expect(syntheticModel.parts[0]?.text).toBe("[Tool execution completed.]")
  })

  it("uses correct text when 0 tool results", () => {
    // Edge case: contents don't end with tool result (e.g., just regular user msg)
    const contents = [userMsg("hello"), modelMsg([textPart("response")])]
    const result = closeToolLoopForThinking(contents)
    const syntheticModel = result[2] as { parts: Array<{ text: string }> }
    expect(syntheticModel.parts[0]?.text).toBe("[Processing previous context.]")
  })

  it("uses count-based text when multiple tool results", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([funcCallPart("t1"), funcCallPart("t2"), funcCallPart("t3")]),
      {
        role: "user",
        parts: [funcResponsePart("t1"), funcResponsePart("t2"), funcResponsePart("t3")],
      },
    ]
    const result = closeToolLoopForThinking(contents)
    const syntheticModel = result[3] as { parts: Array<{ text: string }> }
    expect(syntheticModel.parts[0]?.text).toBe("[3 tool executions completed.]")
  })

  it("handles Anthropic-style content arrays for stripping thinking", () => {
    const contents = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: "response" },
        ],
      },
    ]
    const result = closeToolLoopForThinking(contents)
    const assistantMsg = result[1] as { content: Array<{ type: string }> }
    const hasThinking = assistantMsg.content?.some((b) => b.type === "thinking")
    expect(hasThinking).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// looksLikeCompactedThinkingTurn
// ---------------------------------------------------------------------------

describe("looksLikeCompactedThinkingTurn", () => {
  it("returns true for msg with functionCall but no thinking and no text before call", () => {
    const msg = modelMsg([funcCallPart()])
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(true)
  })

  it("returns false when thinking is present", () => {
    const msg = modelMsg([thinkingPart(), funcCallPart()])
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
  })

  it("returns false when text appears before functionCall", () => {
    const msg = modelMsg([textPart("I will call a tool"), funcCallPart()])
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
  })

  it("returns false when no functionCall at all", () => {
    const msg = modelMsg([textPart("just text")])
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
  })

  it("returns false for null or non-object", () => {
    expect(looksLikeCompactedThinkingTurn(null)).toBe(false)
    expect(looksLikeCompactedThinkingTurn("string")).toBe(false)
    expect(looksLikeCompactedThinkingTurn(undefined)).toBe(false)
  })

  it("returns false for message with empty parts", () => {
    expect(looksLikeCompactedThinkingTurn({ role: "model", parts: [] })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasPossibleCompactedThinking
// ---------------------------------------------------------------------------

describe("hasPossibleCompactedThinking", () => {
  it("returns true when a model message looks compacted", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([funcCallPart()]), // looks compacted
      toolResultMsg("tool"),
    ]
    expect(hasPossibleCompactedThinking(contents, 1)).toBe(true)
  })

  it("returns false when model message has thinking (not compacted)", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([thinkingPart(), funcCallPart()]),
    ]
    expect(hasPossibleCompactedThinking(contents, 1)).toBe(false)
  })

  it("returns false when turnStartIdx is negative", () => {
    const contents = [userMsg("hello")]
    expect(hasPossibleCompactedThinking(contents, -1)).toBe(false)
  })

  it("returns false for non-array input", () => {
    expect(hasPossibleCompactedThinking(null as unknown as unknown[], 0)).toBe(false)
  })

  it("scans from turnStartIdx only", () => {
    const contents = [
      modelMsg([funcCallPart()]), // idx 0 - compacted, but before turnStart
      userMsg("real user"),
      modelMsg([thinkingPart(), funcCallPart()]), // idx 2 - NOT compacted
    ]
    // Turn starts at index 2 - should not see index 0
    expect(hasPossibleCompactedThinking(contents, 2)).toBe(false)
  })
})
