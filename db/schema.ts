import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const minnaSessions = sqliteTable(
  "minna_sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id"),
    targetCount: integer("target_count").notNull().default(0),
    phase: text("phase").notNull().default("lobby"),
    generation: integer("generation").notNull().default(1),
    collectiveLine: text("collective_line"),
    deadlineAt: integer("deadline_at"),
    special: integer("special", { mode: "boolean" }).notNull().default(false),
    roomCode: text("room_code"),
    contentJson: text("content_json"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("minna_sessions_owner_idx").on(table.ownerId),
    uniqueIndex("minna_sessions_room_code_idx").on(table.roomCode),
    check(
      "minna_sessions_target_count_check",
      sql`target_count >= 0 AND target_count <= 500`,
    ),
  ],
);

export const minnaParticipants = sqliteTable(
  "minna_participants",
  {
    secretId: text("secret_id").notNull(),
    sessionId: text("session_id").notNull().default("main"),
    publicId: text("public_id").notNull(),
    color: text("color").notNull(),
    generation: integer("generation").notNull(),
    lastSeen: integer("last_seen").notNull(),
    answerThanks: text("answer_thanks"),
    answerState: text("answer_state"),
    answerWish: text("answer_wish"),
    answerRole: text("answer_role"),
    answerEnergy: text("answer_energy"),
    holdStartedAt: integer("hold_started_at"),
    holdCompleted: integer("hold_completed", { mode: "boolean" }).notNull().default(false),
    finaleEligible: integer("finale_eligible", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.secretId] }),
    index("minna_session_generation_seen_idx").on(table.sessionId, table.generation, table.lastSeen),
  ],
);

export const minnaFireworks = sqliteTable(
  "minna_fireworks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull().default("main"),
    generation: integer("generation").notNull(),
    clientId: text("client_id").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    color: text("color").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("minna_fireworks_session_generation_created_idx").on(
      table.sessionId,
      table.generation,
      table.createdAt,
    ),
  ],
);
