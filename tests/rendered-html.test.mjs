import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FACE_TARGET_COUNT,
  QUESTIONS,
  buildCollectiveLine,
  makeSmileTargets,
  questionForPhase,
  smileTargetIndex,
} from "../lib/minna.ts";

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
  assert.match(client, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(join, /mode="audience"/);
  assert.match(host, /mode="host"/);
  assert.match(host, /chatGPTSignInPath/);
  assert.match(layout, /MINNA\.exe/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(`${client}${layout}${packageJson}`, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("declares the shared database and migration", async () => {
  const [hosting, migration, answersMigration, route] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("drizzle/0000_curvy_sunfire.sql", root), "utf8"),
    readFile(new URL("drizzle/0003_ancient_jimmy_woo.sql", root), "utf8"),
    readFile(new URL("app/api/session/route.ts", root), "utf8"),
  ]);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `minna_sessions`/);
  assert.match(migration, /CREATE TABLE `minna_participants`/);
  assert.match(answersMigration, /ADD `answer_wish`/);
  assert.match(answersMigration, /ADD `answer_role`/);
  assert.match(answersMigration, /ADD `answer_energy`/);
  assert.match(route, /special/);
  assert.match(route, /HOLD_MS = 3_000/);
  assert.match(route, /FINALE_MS = 20_000/);
  assert.equal(route.match(/crypto\.randomUUID\(\)/g)?.length, 2);
  assert.ok(route.includes('!/^[0-9a-f]{64}$/.test(value)'));
});

test("runs five audience questions through the collective reveal", () => {
  assert.equal(QUESTIONS.length, 5);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((number) => questionForPhase(`question-${number}`)?.id),
    ["ai-thanks", "current-state", "room-wish", "team-role", "final-energy"],
  );
  const line = buildCollectiveLine(
    Array.from({ length: 5 }, () => ({
      answerThanks: "yes",
      answerState: "awake",
      answerWish: "connect",
      answerRole: "tsukkomi",
      answerEnergy: "maximum",
    })),
  );
  assert.match(line, /100%/);
  assert.match(line, /目的は一体感/);
  assert.match(line, /ツッコミ/);
  assert.match(line, /限界突破/);
});

test("fills every smile slot exactly once at 68 participants", () => {
  const targets = makeSmileTargets(1_000, 700, 0.5);
  assert.equal(FACE_TARGET_COUNT, 68);
  assert.equal(targets.length, FACE_TARGET_COUNT);
  assert.equal(new Set(targets.map(({ x, y }) => `${x.toFixed(4)}:${y.toFixed(4)}`)).size, 68);

  const occupied = Array.from({ length: 68 }, (_, index) => smileTargetIndex(index, 68));
  assert.equal(new Set(occupied).size, 68);
  assert.deepEqual(occupied, Array.from({ length: 68 }, (_, index) => index));
});
