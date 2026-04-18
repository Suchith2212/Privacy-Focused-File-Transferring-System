// =============================================================================
// GhostDrop  ·  Assignment 4  ·  Shard Unit Tests
// tests/shardRouter.test.js
//
// Tests the routing logic WITHOUT needing a live MySQL connection.
// Uses Jest.  Run:  npx jest tests/shardRouter.test.js
// =============================================================================

"use strict";

// ── Stub out mysql2/promise so the config loads in test env ──────────────────
jest.mock("mysql2/promise", () => ({
  createPool: () => ({
    execute: jest.fn().mockResolvedValue([[],[]]),
    getConnection: jest.fn().mockResolvedValue({
      execute: jest.fn().mockResolvedValue([[],[]]),
      beginTransaction: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    }),
  }),
}));

const { getShard, getShardIndex, getAllShards } = require("../config/shardConfig");

// ─── 1. ROUTING FORMULA TESTS ────────────────────────────────────────────────

describe("getShard / getShardIndex — routing formula: parseInt(vaultId[0], 16) % 3", () => {
  const cases = [
    // [vaultId first char, expected shard index]
    ["0", 0], ["3", 0], ["6", 0], ["9", 0], ["c", 0], ["f", 0],
    ["1", 1], ["4", 1], ["7", 1], ["a", 1], ["d", 1],
    ["2", 2], ["5", 2], ["8", 2], ["b", 2], ["e", 2],
  ];

  test.each(cases)(
    "vault_id starting with '%s' → shard %i",
    (firstHex, expectedShard) => {
      const vaultId = `${firstHex}0000000-0000-4000-8000-000000000000`;
      expect(getShardIndex(vaultId)).toBe(expectedShard);
    }
  );
});

// ─── 2. DETERMINISM TEST ────────────────────────────────────────────────────

describe("getShard(vaultId) is deterministic", () => {
  test("same vaultId always returns same shard", () => {
    const vid = "7e2c1234-abcd-4000-8000-aabbccddeeff";
    const s1  = getShard(vid);
    const s2  = getShard(vid);
    const s3  = getShard(vid);
    expect(s1.id).toBe(s2.id);
    expect(s2.id).toBe(s3.id);
  });
});

// ─── 3. INVALID INPUT TESTS ─────────────────────────────────────────────────

describe("getShard throws on invalid input", () => {
  test("null vaultId → throws", () => {
    expect(() => getShard(null)).toThrow();
  });
  test("empty string → throws", () => {
    expect(() => getShard("")).toThrow();
  });
  test("too short string → throws", () => {
    expect(() => getShard("abc")).toThrow();
  });
});

// ─── 4. DISTRIBUTION BALANCE TEST ───────────────────────────────────────────

describe("Shard distribution — all 16 hex digits", () => {
  test("each shard receives approximately equal share (±12.5%)", () => {
    const counts = { 0: 0, 1: 0, 2: 0 };
    for (let i = 0; i < 16; i++) {
      const hex  = i.toString(16);
      const vid  = `${hex}0000000-0000-4000-8000-000000000000`;
      const idx  = getShardIndex(vid);
      counts[idx]++;
    }
    // Shard 0 gets 6 digits, shards 1 and 2 get 5 each
    expect(counts[0]).toBe(6);
    expect(counts[1]).toBe(5);
    expect(counts[2]).toBe(5);
    // All 16 digits accounted for
    expect(counts[0] + counts[1] + counts[2]).toBe(16);
  });
});

// ─── 5. getAllShards ─────────────────────────────────────────────────────────

describe("getAllShards()", () => {
  test("returns exactly 3 shards", () => {
    expect(getAllShards()).toHaveLength(3);
  });

  test("shard ids are 0, 1, 2", () => {
    const ids = getAllShards().map((s) => s.id);
    expect(ids).toEqual([0, 1, 2]);
  });

  test("each shard has a pool", () => {
    for (const shard of getAllShards()) {
      expect(shard.pool).not.toBeNull();
    }
  });
});

// ─── 6. CHILD ROW CO-LOCATION TEST ──────────────────────────────────────────

describe("Child rows must co-locate with parent vault", () => {
  test("file with same vault_id → same shard as vault", () => {
    const vaultId = "a1234567-0000-4000-8000-000000000000"; // a → shard_1
    const fileRow = { vaultId };  // file belongs to same vault

    const vaultShard = getShardIndex(vaultId);
    const fileShard  = getShardIndex(fileRow.vaultId);
    expect(fileShard).toBe(vaultShard);
  });

  test("inner_token with same vault_id → same shard", () => {
    const vaultId = "b9999999-0000-4000-8000-000000000000"; // b → shard_2
    expect(getShardIndex(vaultId)).toBe(2);

    // All child rows use vault_id for routing → same result
    expect(getShardIndex(vaultId)).toBe(2);
  });
});

// ─── 7. SHARD NAMING TEST ────────────────────────────────────────────────────

describe("Shard descriptor shape", () => {
  test("shards have id, name, dbName, hexRange", () => {
    for (const shard of getAllShards()) {
      expect(shard).toHaveProperty("id");
      expect(shard).toHaveProperty("name");
      expect(shard).toHaveProperty("dbName");
      expect(shard).toHaveProperty("hexRange");
    }
  });

  test("dbName is 'Dragon' on all shards (same DB, different physical servers)", () => {
    const dbNames = getAllShards().map((s) => s.dbName);
    // All 3 remote shards use the team database "Dragon"
    // Isolation is at the server level (different ports), not the database name level
    expect(dbNames).toEqual(["Dragon", "Dragon", "Dragon"]);
  });
});
