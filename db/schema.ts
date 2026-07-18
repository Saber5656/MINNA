import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const minnaSessions = sqliteTable("minna_sessions", {
  id: text("id").primaryKey(),
  phase: text("phase").notNull().default("lobby"),
  generation: integer("generation").notNull().default(1),
  collectiveLine: text("collective_line"),
  deadlineAt: integer("deadline_at"),
  special: integer("special", { mode: "boolean" }).notNull().default(false),
  roomCode: text("room_code"),
  updatedAt: integer("updated_at").notNull(),
});

export const minnaParticipants = sqliteTable(
  "minna_participants",
  {
    secretId: text("secret_id").primaryKey(),
    publicId: text("public_id").notNull(),
    color: text("color").notNull(),
    generation: integer("generation").notNull(),
    lastSeen: integer("last_seen").notNull(),
    answerThanks: text("answer_thanks"),
    answerState: text("answer_state"),
    holdStartedAt: integer("hold_started_at"),
    holdCompleted: integer("hold_completed", { mode: "boolean" }).notNull().default(false),
    finaleEligible: integer("finale_eligible", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("minna_generation_seen_idx").on(table.generation, table.lastSeen)],
);
