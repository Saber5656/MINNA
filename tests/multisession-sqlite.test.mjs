import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function migrationFiles() {
  const migrationUrl = new URL("drizzle/", root);
  return (await readdir(migrationUrl))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
}

async function applyMigrations(db, files) {
  const migrationUrl = new URL("drizzle/", root);
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationUrl), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
}

async function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  await applyMigrations(db, await migrationFiles());
  return db;
}

test("applies every migration and enforces session-owned identity", async () => {
  const db = await migratedDatabase();
  const insertSession = db.prepare(
    `INSERT INTO minna_sessions
       (id, owner_id, target_count, phase, generation, special, room_code, updated_at)
     VALUES (?, ?, ?, 'lobby', 1, 0, ?, 0)`,
  );
  const roomA = "a".repeat(64);
  const roomB = "b".repeat(64);
  insertSession.run("room-a", "owner-a", 2, roomA);
  insertSession.run("room-b", "owner-b", 2, roomB);

  const insertParticipant = db.prepare(
    `INSERT INTO minna_participants
       (session_id, secret_id, public_id, color, generation, last_seen)
     VALUES (?, ?, ?, '#00e5ff', 1, 1)`,
  );
  insertParticipant.run("room-a", "shared-device", "A");
  insertParticipant.run("room-b", "shared-device", "B");

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM minna_participants").get().count, 2);
  assert.throws(() => insertParticipant.run("room-a", "shared-device", "duplicate"));
  assert.throws(() => insertSession.run("room-c", "owner-c", 2, roomA));
  assert.throws(() => insertSession.run("room-c", "owner-c", 501, "c".repeat(64)));
  db.close();
});

test("resetting one room leaves another room untouched", async () => {
  const db = await migratedDatabase();
  const insertSession = db.prepare(
    `INSERT INTO minna_sessions
       (id, owner_id, target_count, phase, generation, special, room_code, updated_at)
     VALUES (?, ?, 1, 'lobby', 1, 0, ?, 0)`,
  );
  insertSession.run("room-a", "owner-a", "a".repeat(64));
  insertSession.run("room-b", "owner-b", "b".repeat(64));

  const insertParticipant = db.prepare(
    `INSERT INTO minna_participants
       (session_id, secret_id, public_id, color, generation, last_seen)
     VALUES (?, ?, ?, '#ff6b35', 1, 1)`,
  );
  insertParticipant.run("room-a", "device-a", "A");
  insertParticipant.run("room-b", "device-b", "B");

  const insertFirework = db.prepare(
    `INSERT INTO minna_fireworks
       (session_id, generation, client_id, x, y, color, created_at)
     VALUES (?, 1, ?, 0.5, 0.5, '#ff6b35', 1)`,
  );
  insertFirework.run("room-a", "device-a");
  insertFirework.run("room-b", "device-b");

  db.prepare(
    `UPDATE minna_sessions SET generation = generation + 1, room_code = ? WHERE id = ?`,
  ).run("c".repeat(64), "room-a");
  db.prepare("DELETE FROM minna_participants WHERE session_id = ?").run("room-a");
  db.prepare("DELETE FROM minna_fireworks WHERE session_id = ?").run("room-a");

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM minna_participants WHERE session_id = 'room-a'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM minna_fireworks WHERE session_id = 'room-a'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM minna_participants WHERE session_id = 'room-b'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM minna_fireworks WHERE session_id = 'room-b'").get().count, 1);
  assert.equal(db.prepare("SELECT room_code FROM minna_sessions WHERE id = 'room-a'").get().room_code, "c".repeat(64));
  db.close();
});

test("upgrades populated legacy data without losing room state", async () => {
  const db = new DatabaseSync(":memory:");
  const files = await migrationFiles();
  await applyMigrations(db, files.slice(0, 5));

  db.prepare(
    `UPDATE minna_sessions SET phase = 'question-3', generation = 7,
     collective_line = 'legacy line', deadline_at = 12345, special = 1,
     room_code = ?, updated_at = 99 WHERE id = 'main'`,
  ).run("d".repeat(64));
  db.prepare(
    `INSERT INTO minna_participants
       (secret_id, public_id, color, generation, last_seen,
        answer_thanks, answer_state, answer_wish, answer_role, answer_energy,
        hold_started_at, hold_completed, finale_eligible)
     VALUES ('legacy-device', 'legacy-public', '#00e5ff', 7, 88,
       'yes', 'awake', 'connect', 'support', 'maximum', 77, 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO minna_fireworks
       (generation, client_id, x, y, color, created_at)
     VALUES (7, 'legacy-device', 0.25, 0.75, '#00e5ff', 66)`,
  ).run();

  await applyMigrations(db, files.slice(5));

  assert.deepEqual(
    { ...db.prepare(
      `SELECT id, owner_id, target_count, phase, generation, collective_line,
       deadline_at, special, room_code, updated_at FROM minna_sessions WHERE id = 'main'`,
    ).get() },
    {
      id: "main",
      owner_id: null,
      target_count: 0,
      phase: "question-3",
      generation: 7,
      collective_line: "legacy line",
      deadline_at: 12345,
      special: 1,
      room_code: "d".repeat(64),
      updated_at: 99,
    },
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT secret_id, session_id, public_id, color, generation, last_seen,
       answer_thanks, answer_state, answer_wish, answer_role, answer_energy,
       hold_started_at, hold_completed, finale_eligible
       FROM minna_participants WHERE secret_id = 'legacy-device'`,
    ).get() },
    {
      secret_id: "legacy-device",
      session_id: "main",
      public_id: "legacy-public",
      color: "#00e5ff",
      generation: 7,
      last_seen: 88,
      answer_thanks: "yes",
      answer_state: "awake",
      answer_wish: "connect",
      answer_role: "support",
      answer_energy: "maximum",
      hold_started_at: 77,
      hold_completed: 1,
      finale_eligible: 1,
    },
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT session_id, generation, client_id, x, y, color, created_at
       FROM minna_fireworks WHERE client_id = 'legacy-device'`,
    ).get() },
    {
      session_id: "main",
      generation: 7,
      client_id: "legacy-device",
      x: 0.25,
      y: 0.75,
      color: "#00e5ff",
      created_at: 66,
    },
  );
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();
});
