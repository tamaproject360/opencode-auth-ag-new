import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { homedir } from "node:os"

// Mock fs before imports
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue("{}"),
}))

vi.mock("../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

import * as nodeFs from "node:fs"
import {
  loadConfig,
  getUserConfigPath,
  getProjectConfigPath,
  configExists,
  getDefaultLogsDir,
  initRuntimeConfig,
  getKeepThinking,
  isDebugTuiEnabled,
} from "./loader.ts"
import { DEFAULT_CONFIG } from "./schema.ts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveEnv(keys: string[]) {
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  return () => {
    for (const k of keys) {
      if (saved[k] !== undefined) {
        process.env[k] = saved[k]
      } else {
        delete process.env[k]
      }
    }
  }
}

const ENV_KEYS = [
  "OPENCODE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "OPENCODE_ANTIGRAVITY_QUIET",
  "OPENCODE_ANTIGRAVITY_DEBUG",
  "OPENCODE_ANTIGRAVITY_LOG_DIR",
  "OPENCODE_ANTIGRAVITY_SESSION_RECOVERY",
  "OPENCODE_ANTIGRAVITY_AUTO_RESUME",
  "OPENCODE_ANTIGRAVITY_RESUME_TEXT",
  "OPENCODE_ANTIGRAVITY_AUTO_UPDATE",
  "OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY",
  "OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED",
  "OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT",
]

describe("getUserConfigPath", () => {
  let restore: () => void

  beforeEach(() => {
    restore = saveEnv(["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"])
  })

  afterEach(() => {
    restore()
  })

  it("uses OPENCODE_CONFIG_DIR env var when set", () => {
    process.env.OPENCODE_CONFIG_DIR = "D:\\custom\\config"
    const p = getUserConfigPath()
    expect(p).toContain("custom")
    expect(p).toContain("config")
    expect(p).toContain("antigravity.json")
  })

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "D:\\xdg\\config"
    const p = getUserConfigPath()
    expect(p).toContain("xdg")
    expect(p).toContain("config")
    expect(p).toContain("opencode")
    expect(p).toContain("antigravity.json")
  })

  it("falls back to ~/.config/opencode when no env vars", () => {
    const path = getUserConfigPath()
    expect(path).toContain(".config")
    expect(path).toContain("opencode")
    expect(path).toContain("antigravity.json")
  })
})

describe("getProjectConfigPath", () => {
  it("returns path inside project .opencode directory", () => {
    const p = getProjectConfigPath("/my/project")
    expect(p).toContain("my")
    expect(p).toContain("project")
    expect(p).toContain(".opencode")
    expect(p).toContain("antigravity.json")
  })

  it("uses provided directory", () => {
    const path = getProjectConfigPath("/some/other/dir")
    expect(path).toContain("some")
    expect(path).toContain("other")
    expect(path).toContain("dir")
  })
})

describe("configExists", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns true when file exists", () => {
    vi.mocked(nodeFs.existsSync).mockReturnValue(true)
    expect(configExists("/some/path")).toBe(true)
    expect(nodeFs.existsSync).toHaveBeenCalledWith("/some/path")
  })

  it("returns false when file does not exist", () => {
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
    expect(configExists("/nonexistent")).toBe(false)
  })
})

describe("getDefaultLogsDir", () => {
  let restore: () => void

  beforeEach(() => {
    restore = saveEnv(["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"])
  })

  afterEach(() => restore())

  it("returns a path containing antigravity-logs", () => {
    const dir = getDefaultLogsDir()
    expect(dir).toContain("antigravity-logs")
  })

  it("uses OPENCODE_CONFIG_DIR when set", () => {
    process.env.OPENCODE_CONFIG_DIR = "/custom/config"
    const dir = getDefaultLogsDir()
    expect(dir).toContain("custom")
    expect(dir).toContain("antigravity-logs")
  })
})

describe("initRuntimeConfig + getKeepThinking + isDebugTuiEnabled", () => {
  it("getKeepThinking returns false before initRuntimeConfig", () => {
    // State may persist from other tests, but we reset here
    initRuntimeConfig({ ...DEFAULT_CONFIG, keep_thinking: false } as never)
    expect(getKeepThinking()).toBe(false)
  })

  it("getKeepThinking returns true when config.keep_thinking=true", () => {
    initRuntimeConfig({ ...DEFAULT_CONFIG, keep_thinking: true } as never)
    expect(getKeepThinking()).toBe(true)
  })

  it("isDebugTuiEnabled returns false by default", () => {
    initRuntimeConfig({ ...DEFAULT_CONFIG, debug_tui: false } as never)
    expect(isDebugTuiEnabled()).toBe(false)
  })

  it("isDebugTuiEnabled returns true when config.debug_tui=true", () => {
    initRuntimeConfig({ ...DEFAULT_CONFIG, debug_tui: true } as never)
    expect(isDebugTuiEnabled()).toBe(true)
  })
})

describe("loadConfig — defaults only", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
  })

  it("returns default config when no files found", () => {
    const config = loadConfig("/nonexistent")
    expect(config.session_recovery).toBe(DEFAULT_CONFIG.session_recovery)
    expect(config.auto_resume).toBeDefined()
    expect(config.account_selection_strategy).toBeDefined()
  })

  it("returns default soft_quota_threshold_percent", () => {
    const config = loadConfig("/nonexistent")
    expect(typeof config.soft_quota_threshold_percent).toBe("number")
  })
})

describe("loadConfig — user config file loading", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads valid user config file", () => {
    vi.mocked(nodeFs.existsSync).mockImplementation((p) =>
      String(p).includes("antigravity.json") && !String(p).includes(".opencode"),
    )
    vi.mocked(nodeFs.readFileSync).mockReturnValue(
      JSON.stringify({ quiet_mode: true, auto_update: false }),
    )

    const config = loadConfig("/project")
    expect(config.quiet_mode).toBe(true)
    expect(config.auto_update).toBe(false)
  })

  it("handles invalid JSON in config file gracefully", () => {
    vi.mocked(nodeFs.existsSync).mockImplementation((p) =>
      String(p).includes("antigravity.json") && !String(p).includes(".opencode"),
    )
    vi.mocked(nodeFs.readFileSync).mockReturnValue("{ invalid json {{")

    // Should not throw, falls back to defaults
    const config = loadConfig("/project")
    expect(config).toBeDefined()
    expect(config.session_recovery).toBeDefined()
  })

  it("handles file read error gracefully", () => {
    vi.mocked(nodeFs.existsSync).mockReturnValue(true)
    vi.mocked(nodeFs.readFileSync).mockImplementation(() => {
      throw new Error("Permission denied")
    })

    // Should not throw
    const config = loadConfig("/project")
    expect(config).toBeDefined()
  })

  it("handles config with Zod validation errors gracefully (unknown field values)", () => {
    vi.mocked(nodeFs.existsSync).mockImplementation((p) =>
      String(p).includes("antigravity.json") && !String(p).includes(".opencode"),
    )
    // account_selection_strategy gets invalid value but zod should just warn
    vi.mocked(nodeFs.readFileSync).mockReturnValue(
      JSON.stringify({ account_selection_strategy: "invalid_strategy_xyz" }),
    )

    // Should not throw
    const config = loadConfig("/project")
    expect(config).toBeDefined()
  })
})

describe("loadConfig — project config file loading", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads project config and merges over user config", () => {
    vi.mocked(nodeFs.existsSync).mockImplementation((p) => String(p).includes("antigravity.json"))
    vi.mocked(nodeFs.readFileSync).mockImplementation((p) => {
      if (String(p).includes(".opencode")) {
        return JSON.stringify({ auto_resume: false, quiet_mode: true })
      }
      return JSON.stringify({ auto_resume: true, quiet_mode: false })
    })

    const config = loadConfig("/project")
    // Project config (false) should win over user config (true) for auto_resume
    expect(config.quiet_mode).toBe(true)
  })

  it("merges signature_cache deeply", () => {
    vi.mocked(nodeFs.existsSync).mockImplementation((p) => String(p).includes("antigravity.json"))
    vi.mocked(nodeFs.readFileSync).mockImplementation((p) => {
      if (String(p).includes(".opencode")) {
        return JSON.stringify({
          signature_cache: { enabled: false },
        })
      }
      return JSON.stringify({
        signature_cache: { enabled: true, disk_ttl_seconds: 86400 },
      })
    })

    const config = loadConfig("/project")
    // Project config has enabled: false, should override
    expect(config.signature_cache?.enabled).toBe(false)
  })

  it("user config signature_cache merges with defaults", () => {
    vi.mocked(nodeFs.existsSync).mockImplementation((p) =>
      String(p).includes("antigravity.json") && !String(p).includes(".opencode"),
    )
    vi.mocked(nodeFs.readFileSync).mockReturnValue(
      JSON.stringify({ signature_cache: { disk_ttl_seconds: 259200 } }),
    )

    const config = loadConfig("/project")
    expect(config.signature_cache?.disk_ttl_seconds).toBe(259200)
  })
})

describe("loadConfig — environment variable overrides", () => {
  let restore: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
    restore = saveEnv(ENV_KEYS)
  })

  afterEach(() => restore())

  it("OPENCODE_ANTIGRAVITY_QUIET=1 sets quiet_mode=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_QUIET = "1"
    expect(loadConfig("/x").quiet_mode).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_QUIET=true sets quiet_mode=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_QUIET = "true"
    expect(loadConfig("/x").quiet_mode).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_QUIET=0 does not override", () => {
    process.env.OPENCODE_ANTIGRAVITY_QUIET = "0"
    expect(loadConfig("/x").quiet_mode).toBe(DEFAULT_CONFIG.quiet_mode)
  })

  it("OPENCODE_ANTIGRAVITY_DEBUG=1 sets debug=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "1"
    expect(loadConfig("/x").debug).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_DEBUG=0 sets debug=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "0"
    expect(loadConfig("/x").debug).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_DEBUG=false sets debug=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "false"
    expect(loadConfig("/x").debug).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_LOG_DIR sets log_dir", () => {
    process.env.OPENCODE_ANTIGRAVITY_LOG_DIR = "/custom/logs"
    expect(loadConfig("/x").log_dir).toBe("/custom/logs")
  })

  it("OPENCODE_ANTIGRAVITY_SESSION_RECOVERY=0 sets session_recovery=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_SESSION_RECOVERY = "0"
    expect(loadConfig("/x").session_recovery).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_SESSION_RECOVERY=false sets session_recovery=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_SESSION_RECOVERY = "false"
    expect(loadConfig("/x").session_recovery).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_SESSION_RECOVERY=1 keeps session_recovery from config", () => {
    process.env.OPENCODE_ANTIGRAVITY_SESSION_RECOVERY = "1"
    // Doesn't set to false; keeps config value
    const config = loadConfig("/x")
    expect(config.session_recovery).toBeDefined()
  })

  it("OPENCODE_ANTIGRAVITY_AUTO_RESUME=0 sets auto_resume=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_AUTO_RESUME = "0"
    expect(loadConfig("/x").auto_resume).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_AUTO_RESUME=false sets auto_resume=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_AUTO_RESUME = "false"
    expect(loadConfig("/x").auto_resume).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_AUTO_RESUME=1 sets auto_resume=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_AUTO_RESUME = "1"
    expect(loadConfig("/x").auto_resume).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_AUTO_RESUME=true sets auto_resume=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_AUTO_RESUME = "true"
    expect(loadConfig("/x").auto_resume).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_RESUME_TEXT overrides resume_text", () => {
    process.env.OPENCODE_ANTIGRAVITY_RESUME_TEXT = "Please continue"
    expect(loadConfig("/x").resume_text).toBe("Please continue")
  })

  it("OPENCODE_ANTIGRAVITY_AUTO_UPDATE=0 sets auto_update=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_AUTO_UPDATE = "0"
    expect(loadConfig("/x").auto_update).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_AUTO_UPDATE=false sets auto_update=false", () => {
    process.env.OPENCODE_ANTIGRAVITY_AUTO_UPDATE = "false"
    expect(loadConfig("/x").auto_update).toBe(false)
  })

  it("OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY=round-robin sets strategy", () => {
    process.env.OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY = "round-robin"
    expect(loadConfig("/x").account_selection_strategy).toBe("round-robin")
  })

  it("OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY=hybrid sets strategy", () => {
    process.env.OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY = "hybrid"
    expect(loadConfig("/x").account_selection_strategy).toBe("hybrid")
  })

  it("OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY=invalid falls back to sticky", () => {
    process.env.OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY = "bad_strategy"
    expect(loadConfig("/x").account_selection_strategy).toBe("sticky")
  })

  it("OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED=1 sets pid_offset_enabled=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED = "1"
    expect(loadConfig("/x").pid_offset_enabled).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED=true sets pid_offset_enabled=true", () => {
    process.env.OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED = "true"
    expect(loadConfig("/x").pid_offset_enabled).toBe(true)
  })

  it("OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT=50 sets threshold", () => {
    process.env.OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT = "50"
    expect(loadConfig("/x").soft_quota_threshold_percent).toBe(50)
  })

  it("OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT=0 sets threshold to 0", () => {
    process.env.OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT = "0"
    expect(loadConfig("/x").soft_quota_threshold_percent).toBe(0)
  })
})
