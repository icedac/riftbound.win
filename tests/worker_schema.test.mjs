import assert from "node:assert/strict";
import test from "node:test";

import worker from "../public/_worker.js";

class FakeD1Statement {
  bind() {
    return this;
  }

  async run() {
    return { success: true };
  }

  async all() {
    return { results: [] };
  }

  async first() {
    return null;
  }
}

class FakeD1Database {
  constructor() {
    this.statements = [];
  }

  async exec() {
    throw new Error("D1 exec should not be used for schema setup");
  }

  prepare(sql) {
    this.statements.push(sql);
    return new FakeD1Statement();
  }
}

test("worker initializes D1 schema with single prepared statements", async () => {
  const db = new FakeD1Database();
  const request = new Request("https://riftbound.kr/api/me");

  const response = await worker.fetch(request, {
    DB: db,
    ASSETS: { fetch: () => new Response("asset") },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: null, providers: [], configured: true });
  assert.ok(db.statements.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS users")));
  assert.ok(db.statements.every((sql) => !sql.includes(";\n")));
});
