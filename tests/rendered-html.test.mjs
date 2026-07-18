import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the audience and host product instead of the starter", async () => {
  const [client, layout, join, host, packageJson] = await Promise.all([
    readFile(new URL("app/minna-client.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/join/page.tsx", root), "utf8"),
    readFile(new URL("app/host/page.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(client, /会場を、/);
  assert.match(client, /YOUR PARTICLE/);
  assert.match(client, /hold-start/);
  assert.match(join, /mode="audience"/);
  assert.match(host, /mode="host"/);
  assert.match(host, /chatGPTSignInPath/);
  assert.match(layout, /MINNA\.exe/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(`${client}${layout}${packageJson}`, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("declares the shared database and migration", async () => {
  const [hosting, migration, route] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("drizzle/0000_curvy_sunfire.sql", root), "utf8"),
    readFile(new URL("app/api/session/route.ts", root), "utf8"),
  ]);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `minna_sessions`/);
  assert.match(migration, /CREATE TABLE `minna_participants`/);
  assert.match(route, /special/);
  assert.match(route, /HOLD_MS = 3_000/);
  assert.match(route, /FINALE_MS = 20_000/);
});
