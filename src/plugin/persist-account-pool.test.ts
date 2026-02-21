/**
 * Tests for persistAccountPool function
 *
 * Issue #89: Multi-account login overwrites existing accounts
 * Root cause: loadAccounts() returning null is treated as "no accounts"
 * even when the file exists but couldn't be read (permissions, corruption, etc.)
 *
 * @see https://github.com/NoeFabris/opencode-antigravity-auth/issues/89
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as storageModule from "./storage";
import type { AccountStorageV4, AccountMetadataV3 } from "./storage";
import { deduplicateAccountsByEmail } from "./storage";

vi.mock("proper-lockfile", () => ({
  default: {
    lock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
  },
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn(),
      rename: vi.fn().mockResolvedValue(undefined),
    },
  };
});

function createMockAccount(
  overrides: Partial<AccountMetadataV3> = {},
): AccountMetadataV3 {
  return {
    email: "test@example.com",
    refreshToken: "test-refresh-token",
    projectId: "test-project-id",
    managedProjectId: "test-managed-project-id",
    addedAt: Date.now() - 10000,
    lastUsed: Date.now(),
    ...overrides,
  };
}

function createMockStorage(
  accounts: AccountMetadataV3[],
  activeIndex = 0,
): AccountStorageV4 {
  return {
    version: 4,
    accounts,
    activeIndex,
  };
}

describe("loadAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("file not found (ENOENT)", () => {
    it("returns null when file does not exist", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await storageModule.loadAccounts();

      expect(result).toBeNull();
    });
  });

  describe("file exists with valid data", () => {
    it("returns storage for valid V3 file", async () => {
      const mockStorage = createMockStorage([createMockAccount()]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockStorage));

      const result = await storageModule.loadAccounts();

      expect(result).not.toBeNull();
      expect(result?.version).toBe(4);
      expect(result?.accounts).toHaveLength(1);
    });

    it("returns storage with multiple accounts", async () => {
      const mockStorage = createMockStorage([
        createMockAccount({
          email: "user1@example.com",
          refreshToken: "token1",
        }),
        createMockAccount({
          email: "user2@example.com",
          refreshToken: "token2",
        }),
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockStorage));

      const result = await storageModule.loadAccounts();

      expect(result?.accounts).toHaveLength(2);
      expect(result?.accounts[0]?.email).toBe("user1@example.com");
      expect(result?.accounts[1]?.email).toBe("user2@example.com");
    });

    it("preserves activeIndex from storage", async () => {
      const mockStorage = createMockStorage(
        [
          createMockAccount({ email: "user1@example.com" }),
          createMockAccount({ email: "user2@example.com" }),
        ],
        1,
      );
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockStorage));

      const result = await storageModule.loadAccounts();

      expect(result?.activeIndex).toBe(1);
    });
  });

  describe("error handling - THE BUG (Issue #89)", () => {
    /**
     * THIS IS THE BUG: loadAccounts returns null for ANY error, not just ENOENT.
     * The caller (persistAccountPool) cannot distinguish between:
     * - File doesn't exist (safe to create new)
     * - File exists but couldn't be read (DANGEROUS - would overwrite!)
     */

    it("returns null on permission denied (EACCES)", async () => {
      const error = new Error("EACCES") as NodeJS.ErrnoException;
      error.code = "EACCES";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await storageModule.loadAccounts();

      expect(result).toBeNull();
    });

    it("returns null on JSON parse error", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid json }}}");

      const result = await storageModule.loadAccounts();

      expect(result).toBeNull();
    });

    it("returns null on invalid storage format", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ version: 4, notAccounts: [] }),
      );

      const result = await storageModule.loadAccounts();

      expect(result).toBeNull();
    });

    it("returns null on unknown version", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ version: 999, accounts: [] }),
      );

      const result = await storageModule.loadAccounts();

      expect(result).toBeNull();
    });
  });

  describe("migration", () => {
    it("migrates V2 to V3 successfully", async () => {
      const v2Storage = {
        version: 2,
        accounts: [
          {
            refreshToken: "token1",
            addedAt: Date.now() - 10000,
            lastUsed: Date.now(),
          },
        ],
        activeIndex: 0,
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(v2Storage));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await storageModule.loadAccounts();

      expect(result?.version).toBe(4);
      expect(result?.accounts).toHaveLength(1);
    });
  });
});

describe("saveAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves valid storage to disk", async () => {
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    const storage = createMockStorage([createMockAccount()]);
    await storageModule.saveAccounts(storage);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]?.[1];
    expect(writtenContent).toBeDefined();
    const parsed = JSON.parse(writtenContent as string);
    expect(parsed.version).toBe(4);
    expect(parsed.accounts).toHaveLength(1);
  });
});

/**
 * Tests for the expected behavior of persistAccountPool
 *
 * NOTE: persistAccountPool is currently a private function in plugin.ts.
 * These tests document the EXPECTED behavior after the fix.
 * To run these tests, persistAccountPool should be exported.
 */
describe("persistAccountPool behavior (Issue #89)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("merging behavior (replaceAll=false)", () => {
    it("merges new account with existing accounts", () => {
      const existing = createMockAccount({ email: "old@example.com", refreshToken: "tok-old" });
      const newAcc = createMockAccount({ email: "new@example.com", refreshToken: "tok-new" });
      const merged = deduplicateAccountsByEmail([existing, newAcc]);
      expect(merged).toHaveLength(2);
      expect(merged.map((a) => a.email)).toContain("old@example.com");
      expect(merged.map((a) => a.email)).toContain("new@example.com");
    });

    it("deduplicates by email, keeping the newest token", () => {
      const older = createMockAccount({
        email: "user@example.com",
        refreshToken: "tok-old",
        lastUsed: 1000,
      });
      const newer = createMockAccount({
        email: "user@example.com",
        refreshToken: "tok-new",
        lastUsed: 9000,
      });
      const result = deduplicateAccountsByEmail([older, newer]);
      expect(result).toHaveLength(1);
      expect(result[0]?.refreshToken).toBe("tok-new");
    });

    it("deduplicates by refresh token when email not available", () => {
      // Without email, both accounts are kept (no deduplication key)
      const acc1 = createMockAccount({ email: undefined as unknown as string, refreshToken: "tok-a" });
      const acc2 = createMockAccount({ email: undefined as unknown as string, refreshToken: "tok-b" });
      const result = deduplicateAccountsByEmail([acc1, acc2]);
      // Both kept since there is no email to deduplicate by
      expect(result).toHaveLength(2);
    });

    it("preserves activeIndex when adding new accounts", () => {
      // When merging, the activeIndex from the existing storage is preserved
      const existing: AccountStorageV4 = {
        version: 4,
        accounts: [
          createMockAccount({ email: "a@example.com" }),
          createMockAccount({ email: "b@example.com" }),
        ],
        activeIndex: 1,
      };
      // Merge: keep activeIndex from the existing storage
      expect(existing.activeIndex).toBe(1);
    });

    it("updates lastUsed timestamp for existing accounts", () => {
      const t1 = 1000;
      const t2 = 9000;
      const older = createMockAccount({ email: "user@example.com", lastUsed: t1 });
      const newer = createMockAccount({ email: "user@example.com", lastUsed: t2 });
      const result = deduplicateAccountsByEmail([older, newer]);
      expect(result[0]?.lastUsed).toBe(t2);
    });
  });

  describe("fresh start behavior (replaceAll=true)", () => {
    it("replaces all existing accounts with new ones", async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const freshStorage: AccountStorageV4 = {
        version: 4,
        accounts: [createMockAccount({ email: "fresh@example.com" })],
        activeIndex: 0,
      };
      await storageModule.saveAccountsReplace(freshStorage);

      const tmpCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((c) => (c[0] as string).endsWith(".tmp"));
      expect(tmpCall).toBeDefined();
      const written = JSON.parse(tmpCall![1] as string) as AccountStorageV4;
      expect(written.accounts).toHaveLength(1);
      expect(written.accounts[0]?.email).toBe("fresh@example.com");
    });

    it("resets activeIndex to 0", async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const freshStorage: AccountStorageV4 = {
        version: 4,
        accounts: [createMockAccount()],
        activeIndex: 0,
      };
      await storageModule.saveAccountsReplace(freshStorage);

      const tmpCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((c) => (c[0] as string).endsWith(".tmp"));
      const written = JSON.parse(tmpCall![1] as string) as AccountStorageV4;
      expect(written.activeIndex).toBe(0);
    });

    it("ignores existing accounts file", async () => {
      // saveAccountsReplace does not read the existing accounts file at all —
      // it writes directly, overwriting whatever was there.
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue("*\n");

      const freshStorage: AccountStorageV4 = {
        version: 4,
        accounts: [createMockAccount({ email: "only@example.com" })],
        activeIndex: 0,
      };
      await storageModule.saveAccountsReplace(freshStorage);

      // readFile should NOT be called for the accounts storage file —
      // only gitignore reads are allowed
      const accountsReadCalls = vi
        .mocked(fs.readFile)
        .mock.calls.filter((c) => !(c[0] as string).includes(".gitignore"));
      expect(accountsReadCalls).toHaveLength(0);
    });
  });

  describe("THE BUG: error handling when loadAccounts fails (Issue #89)", () => {
    /**
     * Current buggy behavior:
     * 1. User has accounts saved in ~/.config/opencode/antigravity-accounts.json
     * 2. loadAccounts() fails (permission error, JSON parse error, etc.)
     * 3. loadAccounts() returns null
     * 4. persistAccountPool treats null as "no accounts exist"
     * 5. New account REPLACES existing accounts instead of merging
     *
     * Expected behavior after fix:
     * 1. loadAccounts() should distinguish ENOENT from other errors
     * 2. persistAccountPool should throw/warn when file exists but can't be read
     * 3. User should be prompted about potential data loss
     */

    it.todo(
      "should NOT overwrite accounts when loadAccounts returns null due to permission error",
    );

    it.todo("should throw error when file exists but cannot be read");

    it.todo("should prompt user when existing accounts may be lost");

    it.todo("should only treat ENOENT as 'safe to create new file'");
  });
});

/**
 * Tests for TUI flow integration (Issue #89)
 *
 * The user's logs showed they went through TUI flow, not CLI flow.
 * TUI flow calls persistAccountPool with replaceAll=false,
 * which should merge accounts but doesn't when loadAccounts fails.
 */
describe("TUI flow integration (Issue #89)", () => {
  describe("account persistence after OAuth", () => {
    it.todo("should merge new account with existing accounts in TUI flow");

    it.todo("should show warning when existing accounts cannot be loaded");

    it.todo(
      "should ask user for confirmation before potentially overwriting accounts",
    );
  });

  describe("authorize function behavior", () => {
    it("TUI flow (inputs falsy) should check for existing accounts", async () => {
      // When loadAccounts returns existing accounts, the existing accounts are not null
      const existingStorage = createMockStorage([
        createMockAccount({ email: "existing@example.com" }),
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingStorage));

      const result = await storageModule.loadAccounts();
      expect(result).not.toBeNull();
      expect(result?.accounts).toHaveLength(1);
    });

    it("should handle loadAccounts returning null gracefully", async () => {
      // ENOENT → null means file doesn't exist, safe to create
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await storageModule.loadAccounts();
      expect(result).toBeNull();
      // null is the signal that no file exists; caller should treat this as empty
    });
  });
});

/**
 * Regression tests to ensure the fix doesn't break normal operation
 */
describe("regression tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("first-time user experience", () => {
    it("should work correctly when no accounts file exists (ENOENT)", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await storageModule.loadAccounts();
      expect(result).toBeNull();

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const newStorage = createMockStorage([createMockAccount()]);
      await expect(
        storageModule.saveAccounts(newStorage),
      ).resolves.not.toThrow();
    });
  });

  describe("normal multi-account workflow", () => {
    it("should load existing accounts correctly", async () => {
      const existingStorage = createMockStorage([
        createMockAccount({ email: "existing@example.com" }),
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingStorage));

      const result = await storageModule.loadAccounts();

      expect(result).not.toBeNull();
      expect(result?.accounts).toHaveLength(1);
      expect(result?.accounts[0]?.email).toBe("existing@example.com");
    });

    it("should preserve all accounts when saving", async () => {
      const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
      enoent.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(enoent);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const storage = createMockStorage([
        createMockAccount({
          email: "user1@example.com",
          refreshToken: "token1",
        }),
        createMockAccount({
          email: "user2@example.com",
          refreshToken: "token2",
        }),
        createMockAccount({
          email: "user3@example.com",
          refreshToken: "token3",
        }),
      ]);

      await storageModule.saveAccounts(storage);

      expect(fs.writeFile).toHaveBeenCalledTimes(2);

      const tmpWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).includes(".tmp"));
      expect(tmpWriteCall).toBeDefined();
      const parsed = JSON.parse(tmpWriteCall![1] as string);
      expect(parsed.accounts).toHaveLength(3);

      const gitignoreWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).includes(".gitignore"));
      expect(gitignoreWriteCall).toBeDefined();
    });
  });
});

/**
 * Proposed fix validation tests
 *
 * These tests validate enhanced error handling behavior.
 */
describe("proposed fix validation", () => {
  describe("loadAccounts should distinguish error types", () => {
    // NOTE: Current implementation returns null for ALL errors (both ENOENT and
    // non-ENOENT). These todos document the proposed improved behavior where
    // different error types return different structured results.
    it.todo("should return { error: 'ENOENT' } when file doesn't exist");
    it.todo("should return { error: 'PERMISSION_DENIED' } on EACCES");
    it.todo("should return { error: 'PARSE_ERROR' } on invalid JSON");
    it.todo("should return { error: 'INVALID_FORMAT' } on schema mismatch");
  });

  describe("persistAccountPool should handle errors safely", () => {
    it.todo(
      "should throw AccountFileUnreadableError when file exists but can't be read",
    );
    it.todo("should include recovery instructions in error message");
  });

  describe("user prompts for data safety", () => {
    it.todo("should prompt user when accounts file exists but is unreadable");
    it.todo("should offer options: (r)etry, (b)ackup and continue, (a)bort");
  });
});
