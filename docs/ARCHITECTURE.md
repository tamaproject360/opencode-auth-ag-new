# Architecture Guide

**Last Updated:** February 2026

This document explains how the Antigravity plugin works, including the request/response flow, Claude-specific handling, and session recovery.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  OpenCode ──▶ Plugin ──▶ Antigravity API ──▶ Claude/Gemini      │
│     │           │              │                   │            │
│     │           │              │                   └─ Model     │
│     │           │              └─ Google's gateway (Gemini fmt) │
│     │           └─ THIS PLUGIN (auth, transform, recovery)      │
│     └─ AI coding assistant                                      │
└─────────────────────────────────────────────────────────────────┘
```

The plugin intercepts requests to `generativelanguage.googleapis.com`, transforms them for the Antigravity API, and handles authentication, rate limits, and error recovery.

---

## Module Structure

```
src/
├── index.ts                       # Public exports (plugin + oauth)
├── plugin.ts                      # Main entry, fetch interceptor (4900+ lines)
├── constants.ts                   # Endpoints, headers, API config, system prompts
├── shims.d.ts                     # TypeScript ambient type shims
├── antigravity/
│   └── oauth.ts                   # OAuth PKCE token exchange & project provisioning
├── hooks/
│   └── auto-update-checker/       # NPM update checker (session.created hook)
│       ├── index.ts
│       ├── checker.ts
│       ├── cache.ts
│       ├── constants.ts           # PACKAGE_NAME, NPM_REGISTRY_URL, cache paths
│       ├── types.ts
│       └── index.test.ts
└── plugin/
    ├── auth.ts                    # Token validation & refresh
    ├── request.ts                 # Request transformation (core logic, 1800+ lines)
    ├── request-helpers.ts         # Schema cleaning, thinking filters (2800+ lines)
    ├── thinking-recovery.ts       # Turn boundary detection & loop recovery
    ├── recovery.ts                # Session recovery (tool_result_missing)
    ├── quota.ts                   # Quota checking (Antigravity + Gemini CLI APIs)
    ├── cache.ts                   # In-memory auth & signature caching
    ├── accounts.ts                # Multi-account management & load balancing (1574 lines)
    ├── storage.ts                 # Persistent storage schemas (Zod, atomic writes)
    ├── fingerprint.ts             # Per-account device fingerprint generation
    ├── project.ts                 # Managed project context resolution
    ├── debug.ts                   # File-based debug logging
    ├── token.ts                   # OAuth token refresh with invalid_grant detection
    ├── rotation.ts                # HealthScoreTracker, TokenBucketTracker, hybrid selection
    ├── proxy.ts                   # Undici ProxyAgent configuration (env vars)
    ├── server.ts                  # OAuth callback HTTP server (port 51121)
    ├── search.ts                  # Google Search grounding (separate API call)
    ├── errors.ts                  # Custom error classes with metadata
    ├── types.ts                   # Shared TypeScript types
    ├── image-saver.ts             # Save inline base64 images to disk
    ├── cli.ts                     # Interactive CLI prompts & login menu
    ├── version.ts                 # Antigravity version fetcher (currently disabled)
    ├── logger.ts                  # Structured logger factory (createLogger)
    ├── refresh-queue.ts           # Proactive token refresh queue
    ├── cache/
    │   ├── index.ts
    │   └── signature-cache.ts     # Disk-based thinking signature persistence
    ├── config/
    │   ├── index.ts
    │   ├── schema.ts              # Zod config schema (40+ options)
    │   ├── loader.ts              # Config file loading & env var overrides
    │   ├── models.ts              # OPENCODE_MODEL_DEFINITIONS (all models)
    │   └── updater.ts             # Writes model defs to opencode.json/jsonc
    ├── core/
    │   └── streaming/
    │       ├── index.ts
    │       ├── transformer.ts     # Real-time SSE processing & signature caching
    │       └── types.ts           # ThoughtBuffer, SignatureStore types
    ├── recovery/
    │   ├── index.ts
    │   ├── storage.ts             # OpenCode session filesystem reader
    │   ├── types.ts               # Recovery payload types
    │   └── constants.ts           # Recovery error type constants
    ├── stores/
    │   └── signature-store.ts     # In-memory thought buffer store
    ├── transform/
    │   ├── index.ts
    │   ├── claude.ts              # Claude VALIDATED mode, tool normalization
    │   ├── gemini.ts              # Gemini schema conversion, image generation config
    │   ├── model-resolver.ts      # Model name resolution (antigravity- prefix, aliases)
    │   ├── cross-model-sanitizer.ts # Strip signatures on model switch
    │   └── types.ts               # Transform types
    └── ui/
        ├── ansi.ts                # ANSI color/style helpers
        ├── auth-menu.ts           # Interactive auth menu (account list, quota badges)
        ├── confirm.ts             # Yes/no confirmation prompt
        └── select.ts              # Full-featured terminal select menu
```

---

## Request Flow

### 1. Interception (`plugin.ts`)

```typescript
fetch() intercepted → isGenerativeLanguageRequest() → prepareAntigravityRequest()
```

- Account selection (sticky/round-robin/hybrid, rate-limit aware)
- Token refresh if expired
- Endpoint fallback (daily → autopush → prod)
- Context overflow guard (Claude: ~200k token pre-flight check)

### 2. Request Transformation (`request.ts` + `transform/`)

| Step | What Happens |
|------|--------------|
| Model resolution | `transform/model-resolver.ts` resolves antigravity- prefix, aliases |
| Cross-model sanitize | `transform/cross-model-sanitizer.ts` strips signatures on model switch |
| Thinking config | Add `thinkingConfig` / `thinkingLevel` for thinking models |
| Thinking strip | Remove ALL thinking blocks (Claude) |
| Tool normalization | `transform/claude.ts` or `transform/gemini.ts` converts tool formats |
| Schema cleaning | 7-phase pipeline removes unsupported JSON Schema fields |
| ID assignment | Assign IDs to tool calls (FIFO matching) |
| Wrap request | `{ project, model, request: {...} }` |

### 3. Response Transformation (`core/streaming/transformer.ts`)

| Step | What Happens |
|------|--------------|
| SSE streaming | Real-time line-by-line TransformStream |
| Signature caching | Cache `thoughtSignature` to disk via `cache/signature-cache.ts` |
| Image saving | Inline base64 images saved to disk via `image-saver.ts` |
| Format transform | `thought: true` → `type: "reasoning"` |
| Envelope unwrap | Extract inner `response` object |
| usageMetadata | Synthetic injection if missing |

---

## Claude-Specific Handling

### Why Special Handling?

Claude through Antigravity requires:
1. **Gemini format** - `contents[].parts[]` not `messages[].content[]`
2. **Thinking signatures** - Multi-turn needs signed blocks or errors
3. **Schema restrictions** - Rejects `const`, `$ref`, `$defs`, etc.
4. **Tool validation** - `VALIDATED` mode requires proper schemas

### Thinking Block Strategy (v2.0)

**Problem:** OpenCode stores thinking blocks, but may corrupt signatures.

**Solution:** Strip ALL thinking blocks from outgoing requests.

```
Turn 1 Response: { thought: true, text: "...", thoughtSignature: "abc" }
                 ↓ (stored by OpenCode, possibly corrupted)
Turn 2 Request:  Plugin STRIPS all thinking blocks
                 ↓
Claude API:      Generates fresh thinking
```

**Why this works:**
- Zero signature errors (impossible to have invalid signatures)
- Same quality (Claude sees full conversation, re-thinks fresh)
- Simpler code (no complex validation/restoration)

### Thinking Injection for Tool Use

Claude API requires thinking before `tool_use` blocks. The plugin:

1. Caches signed thinking from responses (`lastSignedThinkingBySessionKey`)
2. On subsequent requests, injects cached thinking before tool_use
3. Only injects for the **first** assistant message of a turn (not every message)

**Turn boundary detection** (`thinking-recovery.ts`):
```typescript
// A "turn" starts after a real user message (not tool_result)
// Only inject thinking into first assistant message after that
```

---

## Session Recovery

### Tool Result Missing Error

When a tool execution is interrupted (ESC, timeout, crash):

```
Error: tool_use ids were found without tool_result blocks immediately after
```

**Recovery flow** (`recovery.ts`):

1. Detect error via `session.error` event
2. Fetch session messages via `client.session.messages()`
3. Extract `tool_use` IDs from failed message
4. Inject synthetic `tool_result` blocks:
   ```typescript
   { type: "tool_result", tool_use_id: id, content: "Operation cancelled" }
   ```
5. Send via `client.session.prompt()`
6. Optionally auto-resume with "continue"

### Thinking Block Order Error

```
Error: Expected thinking but found text
```

**Recovery** (`thinking-recovery.ts`):

1. Detect conversation is in tool loop without thinking at turn start
2. Close the corrupted turn with synthetic messages
3. Start fresh turn where Claude can generate new thinking

### Context Overflow Guard (v1.6.0)

When token count estimate exceeds ~200k for Claude:

1. Pre-flight check in `request.ts` (`checkContextOverflow()`)
2. Returns synthetic error response without making API call
3. Triggers auto-compact via OpenCode `/compact` command
4. Shows toast notification to user

---

## Schema Cleaning

Claude rejects unsupported JSON Schema features. The plugin uses an **allowlist approach** with a 7-phase pipeline in `request-helpers.ts`:

| Phase | What It Does |
|-------|-------------|
| 1. refs→hints | Convert `$ref`/`$defs` to description hints |
| 2. const→enum | Convert `const: "val"` → `enum: ["val"]` |
| 3. enum hints | Add enum values to descriptions |
| 4. additionalProperties | Remove or convert to hints |
| 5. constraints→description | Move `minimum`/`maximum`/`pattern` to description |
| 6. mergeAllOf / flattenAnyOf | Flatten complex compositions |
| 7. removeUnsupported | Strip remaining unsupported fields |

**Kept:** `type`, `properties`, `required`, `description`, `enum`, `items`

**Removed:** `const`, `$ref`, `$defs`, `default`, `examples`, `additionalProperties`, `$schema`, `title`

---

## Multi-Account Load Balancing

### How It Works

1. **Sticky selection** - Same account until rate limited (preserves cache)
2. **Per-model-family** - Claude/Gemini rate limits tracked separately
3. **Dual quota (Gemini)** - Antigravity + Gemini CLI headers
4. **Automatic failover** - On 429, switch to next available account
5. **Soft quota threshold** - Lock accounts before hitting hard quota (default 70%)

### Selection Strategies (`rotation.ts`)

| Strategy | Algorithm |
|----------|-----------|
| `sticky` | Same account until rate-limited |
| `round-robin` | Rotate on every request |
| `hybrid` | `HealthScoreTracker` + `TokenBucketTracker` + LRU with stickiness bonus |

### Account Storage

Location: `~/.config/opencode/antigravity-accounts.json`

Format: Schema V4 (auto-migrates from V1/V2/V3). File-locked via `proper-lockfile`. Atomic writes via temp + rename.

Contains OAuth refresh tokens — treat as sensitive (permissions: 0600).

---

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENCODE_ANTIGRAVITY_DEBUG` | `1` or `2` for debug logging |
| `OPENCODE_ANTIGRAVITY_QUIET` | Suppress toast notifications |
| `HTTPS_PROXY` / `HTTP_PROXY` | Corporate proxy support |
| `OPENCODE_CONFIG_DIR` | Custom config directory |

### Config File

Location: `~/.config/opencode/antigravity.json`

```json
{
  "session_recovery": true,
  "auto_resume": true,
  "resume_text": "continue",
  "keep_thinking": false
}
```

See [CONFIGURATION.md](./CONFIGURATION.md) for all 40+ options.

---

## Key Functions Reference

### `plugin.ts`

| Function | Purpose |
|----------|---------|
| `AntigravityCLIOAuthPlugin` | Main plugin export (fetch interceptor) |
| `isGenerativeLanguageRequest()` | Detect interceptable requests |
| `prepareAntigravityRequest()` | Orchestrate account selection + transform |

### `request.ts`

| Function | Purpose |
|----------|---------|
| `prepareAntigravityRequest()` | Main request transformation |
| `transformAntigravityResponse()` | SSE streaming, format conversion |
| `ensureThinkingBeforeToolUseInContents()` | Inject cached thinking |
| `checkContextOverflow()` | Pre-flight token count guard |

### `request-helpers.ts`

| Function | Purpose |
|----------|---------|
| `deepFilterThinkingBlocks()` | Recursive thinking block removal |
| `cleanJSONSchemaForAntigravity()` | 7-phase schema sanitization |
| `transformThinkingParts()` | `thought` → `reasoning` format |
| `fixToolPairing()` | FIFO tool ID assignment & orphan recovery |

### `thinking-recovery.ts`

| Function | Purpose |
|----------|---------|
| `analyzeConversationState()` | Detect turn boundaries, tool loops |
| `needsThinkingRecovery()` | Check if recovery needed |
| `closeToolLoopForThinking()` | Inject synthetic messages |

### `recovery.ts`

| Function | Purpose |
|----------|---------|
| `handleSessionRecovery()` | Main recovery orchestration |
| `createSessionRecoveryHook()` | Hook factory for plugin |

### `transform/model-resolver.ts`

| Function | Purpose |
|----------|---------|
| `resolveModelName()` | Normalize model names, handle antigravity- prefix |
| `isClaudeModel()` | Detect Claude routing path |
| `isGeminiThinkingModel()` | Detect Gemini 3 thinking level models |

### `accounts.ts`

| Function | Purpose |
|----------|---------|
| `AccountManager` | Core class: account selection, rate limit tracking |
| `selectAccount()` | Pick best account via configured strategy |
| `markRateLimited()` | Record 429 with reset time |
| `checkSoftQuota()` | Enforce quota threshold locking |

---

## Debugging

### Enable Logging

```bash
export OPENCODE_ANTIGRAVITY_DEBUG=2  # Verbose
```

### Log Location

`~/.config/opencode/antigravity-logs/`

### What To Check

1. Is `isClaudeModel` true for Claude models?
2. Are thinking blocks being stripped?
3. Are tool schemas being cleaned?
4. Is session recovery triggering?
5. Is context overflow guard firing prematurely?

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid signature` | Corrupted thinking block | Plugin strips all thinking (auto-fixed) |
| `Unknown field: const` | Schema uses `const` | Plugin auto-converts to `enum` |
| `tool_use without tool_result` | Interrupted execution | Session recovery injects results |
| `Expected thinking but found text` | Turn started without thinking | Thinking recovery closes turn |
| `429 Too Many Requests` | Rate limited | Plugin auto-rotates accounts |
| Context overflow | >200k tokens | Auto-compact triggered |

---

## See Also

- [ANTIGRAVITY_API_SPEC.md](./ANTIGRAVITY_API_SPEC.md) - API reference
- [CONFIGURATION.md](./CONFIGURATION.md) - All config options
- [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md) - Account management
- [README.md](../README.md) - Installation & usage (Bahasa Indonesia)
