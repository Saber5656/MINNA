import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  buildCollectiveLine,
  identityForClient,
  isAnswerOption,
  isClientId,
  isQuestionId,
  smileProgress,
  type AnswerOption,
  type Phase,
  type PublicState,
  type QuestionId,
} from "../../../lib/minna";

export const dynamic = "force-dynamic";

const LEGACY_SESSION_ID = "main";
const ACTIVE_MS = 12_000;
const HOLD_MS = 3_000;
const FINALE_MS = 20_000;
const AUDIENCE_ACTIONS = ["join", "heartbeat", "answer", "hold-start", "hold-stop", "firework"];
const HOST_ACTIONS = ["open-room", "configure-room", "tick", "next", "fire", "reset"];
const ANSWER_CONFIG = {
  "ai-thanks": { phase: "question-1", column: "answer_thanks", options: ["yes", "no"] },
  "current-state": { phase: "question-2", column: "answer_state", options: ["awake", "sleepy", "deploying"] },
  "room-wish": { phase: "question-3", column: "answer_wish", options: ["laugh", "wow", "connect"] },
  "team-role": { phase: "question-4", column: "answer_role", options: ["boke", "tsukkomi", "support"] },
  "final-energy": { phase: "question-5", column: "answer_energy", options: ["calm", "hot", "maximum"] },
} as const;

interface SessionRow {
  id: string;
  owner_id: string | null;
  target_count: number;
  phase: Phase;
  generation: number;
  collective_line: string | null;
  deadline_at: number | null;
  special: number;
  room_code: string | null;
}

interface ParticipantRow {
  public_id: string;
  color: string;
  answer_thanks: string | null;
  answer_state: string | null;
  answer_wish: string | null;
  answer_role: string | null;
  answer_energy: string | null;
  hold_completed: number;
  finale_eligible: number;
}

interface FireworkRow {
  id: number;
  x: number;
  y: number;
  color: string;
}

export async function GET(request: Request) {
  try {
    const roomCode = new URL(request.url).searchParams.get("room");
    const session = await sessionForRoomCode(roomCode);
    if (!session) return error("invalid-room", 403);
    return stateResponse(await currentState(session.id));
  } catch (cause) {
    return routeError(cause);
  }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutation(request)) return error("cross-site-request", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return error("json-required", 415);
    }
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action);

    if (AUDIENCE_ACTIONS.includes(action)) {
      const session = await sessionForRoomCode(payload.roomCode);
      if (!session) return error("invalid-room", 403);

      if (action === "join") {
        if (!isClientId(payload.clientId)) return error("invalid-client", 400);
        await joinParticipant(session, payload.clientId);
      } else if (action === "heartbeat") {
        if (!isClientId(payload.clientId)) return error("invalid-client", 400);
        await heartbeatParticipant(session, payload.clientId);
      } else if (action === "answer") {
        if (
          !isClientId(payload.clientId) ||
          !isQuestionId(payload.questionId) ||
          !isAnswerOption(payload.optionId)
        ) {
          return error("invalid-answer", 400);
        }
        await submitAnswer(session, payload.clientId, payload.questionId, payload.optionId);
      } else if (action === "hold-start" || action === "hold-stop") {
        if (!isClientId(payload.clientId)) return error("invalid-client", 400);
        await updateHold(session, payload.clientId, action === "hold-start");
        await advanceFinale(session.id);
      } else if (action === "firework") {
        if (!isClientId(payload.clientId)) return error("invalid-client", 400);
        await launchFirework(session, payload.clientId);
      }
      return stateResponse(await currentState(session.id));
    }

    if (HOST_ACTIONS.includes(action)) {
      const session = await hostSessionForRequest(request);
      if (action === "configure-room") {
        if (!isTargetCount(payload.targetCount)) return error("invalid-target-count", 400);
        await configureRoom(session.id, payload.targetCount);
      }
      if (action === "tick") await advanceFinale(session.id);
      if (["next", "fire", "reset"].includes(action)) await hostAction(session.id, action);
      const joinCode = await ensureRoomCode(session.id);
      return stateResponse({ ...(await currentState(session.id, true)), joinCode });
    }

    return error("unknown-action", 400);
  } catch (cause) {
    return routeError(cause);
  }
}

async function readSession(sessionId: string) {
  const session = await env.DB.prepare(
    `SELECT id, owner_id, target_count, phase, generation, collective_line, deadline_at, special, room_code
     FROM minna_sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first<SessionRow>();
  if (!session) throw new Error("Session state is unavailable");
  return session;
}

async function sessionForRoomCode(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return null;
  return env.DB.prepare(
    `SELECT id, owner_id, target_count, phase, generation, collective_line, deadline_at, special, room_code
     FROM minna_sessions WHERE room_code = ?`,
  )
    .bind(value)
    .first<SessionRow>();
}

async function hostSessionForRequest(request: Request) {
  if (isLocalRequest(request)) return ensureHostSession("local");
  const user = await getChatGPTUser();
  if (!user) throw new HostSignInRequiredError();
  return ensureHostSession(await ownerIdForEmail(user.email));
}

async function ensureHostSession(ownerId: string) {
  const existing = await env.DB.prepare(
    `SELECT id, owner_id, target_count, phase, generation, collective_line, deadline_at, special, room_code
     FROM minna_sessions WHERE owner_id = ?`,
  )
    .bind(ownerId)
    .first<SessionRow>();
  if (existing) return existing;

  const claimed = await env.DB.prepare(
    `UPDATE minna_sessions SET owner_id = ?, target_count = 0, phase = 'lobby',
     generation = generation + 1, collective_line = NULL, deadline_at = NULL,
     special = 0, room_code = ?, updated_at = ?
     WHERE id = ? AND owner_id IS NULL`,
  )
    .bind(ownerId, createRoomCode(), Date.now(), LEGACY_SESSION_ID)
    .run();
  if (claimed.meta.changes > 0) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM minna_participants WHERE session_id = ?").bind(LEGACY_SESSION_ID),
      env.DB.prepare("DELETE FROM minna_fireworks WHERE session_id = ?").bind(LEGACY_SESSION_ID),
    ]);
    return readSession(LEGACY_SESSION_ID);
  }

  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO minna_sessions
       (id, owner_id, target_count, phase, generation, special, room_code, updated_at)
     VALUES (?, ?, 0, 'lobby', 1, 0, ?, ?)`,
  )
    .bind(sessionId, ownerId, createRoomCode(), Date.now())
    .run();
  const created = await env.DB.prepare(
    `SELECT id, owner_id, target_count, phase, generation, collective_line, deadline_at, special, room_code
     FROM minna_sessions WHERE owner_id = ?`,
  )
    .bind(ownerId)
    .first<SessionRow>();
  if (!created) throw new Error("Host session could not be created");
  return created;
}

async function configureRoom(sessionId: string, targetCount: number) {
  const result = await env.DB.prepare(
    `UPDATE minna_sessions SET target_count = ?, updated_at = ?
     WHERE id = ? AND phase = 'lobby' AND ? >= (
       SELECT COUNT(*) FROM minna_participants
       WHERE session_id = minna_sessions.id AND generation = minna_sessions.generation
     )`,
  )
    .bind(targetCount, Date.now(), sessionId, targetCount)
    .run();
  if (result.meta.changes > 0) return;

  const session = await readSession(sessionId);
  const enrolled = await enrolledParticipantCount(session.id, session.generation);
  if (session.phase === "lobby" && targetCount < enrolled) {
    throw new RoomTargetTooSmallError();
  }
}

async function joinParticipant(session: SessionRow, clientId: string) {
  if (session.target_count < 1) throw new RoomNotConfiguredError();
  const identity = identityForClient(clientId);
  const now = Date.now();
  const refreshed = await env.DB.prepare(
    `UPDATE minna_participants SET
       public_id = ?, color = ?, last_seen = ?
     WHERE session_id = ? AND secret_id = ? AND generation = ?`,
  )
    .bind(
      identity.publicId,
      identity.color,
      now,
      session.id,
      clientId,
      session.generation,
    )
    .run();
  if (refreshed.meta.changes > 0) return;

  const rejoined = await env.DB.prepare(
    `UPDATE minna_participants SET
       public_id = ?, color = ?, answer_thanks = NULL, answer_state = NULL,
       answer_wish = NULL, answer_role = NULL, answer_energy = NULL,
       hold_started_at = NULL, hold_completed = 0, finale_eligible = 0,
       generation = ?, last_seen = ?
     WHERE session_id = ? AND secret_id = ? AND generation <> ?
       AND (SELECT COUNT(*) FROM minna_participants WHERE session_id = ? AND generation = ?)
         < (SELECT target_count FROM minna_sessions WHERE id = ?)`,
  )
    .bind(
      identity.publicId,
      identity.color,
      session.generation,
      now,
      session.id,
      clientId,
      session.generation,
      session.id,
      session.generation,
      session.id,
    )
    .run();
  if (rejoined.meta.changes > 0) return;

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO minna_participants
       (secret_id, session_id, public_id, color, generation, last_seen, hold_completed, finale_eligible)
     SELECT ?, ?, ?, ?, ?, ?, 0, 0
     WHERE (SELECT COUNT(*) FROM minna_participants WHERE session_id = ? AND generation = ?)
       < (SELECT target_count FROM minna_sessions WHERE id = ?)`,
  )
    .bind(
      clientId,
      session.id,
      identity.publicId,
      identity.color,
      session.generation,
      now,
      session.id,
      session.generation,
      session.id,
    )
    .run();
  if (inserted.meta.changes === 0) {
    const exists = await env.DB.prepare(
      `SELECT secret_id FROM minna_participants
       WHERE session_id = ? AND secret_id = ? AND generation = ?`,
    )
      .bind(session.id, clientId, session.generation)
      .first();
    if (!exists) throw new RoomFullError();
  }
}

async function heartbeatParticipant(session: SessionRow, clientId: string) {
  const result = await env.DB.prepare(
    `UPDATE minna_participants SET last_seen = ?
     WHERE session_id = ? AND secret_id = ? AND generation = ?`,
  )
    .bind(Date.now(), session.id, clientId, session.generation)
    .run();
  if (result.meta.changes === 0) await joinParticipant(session, clientId);
}

async function submitAnswer(
  session: SessionRow,
  clientId: string,
  questionId: QuestionId,
  optionId: AnswerOption,
) {
  const config = ANSWER_CONFIG[questionId];
  if (session.phase !== config.phase || !config.options.some((option) => option === optionId)) return;
  const column = config.column;
  await env.DB.prepare(
    `UPDATE minna_participants SET ${column} = ?, last_seen = ?
     WHERE session_id = ? AND secret_id = ? AND generation = ? AND ${column} IS NULL`,
  )
    .bind(optionId, Date.now(), session.id, clientId, session.generation)
    .run();
}

async function updateHold(session: SessionRow, clientId: string, starting: boolean) {
  if (session.phase !== "finale") return;
  const now = Date.now();
  if (starting) {
    await env.DB.prepare(
      `UPDATE minna_participants SET hold_started_at = COALESCE(hold_started_at, ?), last_seen = ?
       WHERE session_id = ? AND secret_id = ? AND generation = ?
       AND finale_eligible = 1 AND hold_completed = 0`,
    )
      .bind(now, now, session.id, clientId, session.generation)
      .run();
    return;
  }
  await env.DB.prepare(
    `UPDATE minna_participants SET
       hold_completed = CASE WHEN hold_started_at IS NOT NULL AND ? - hold_started_at >= ? THEN 1 ELSE hold_completed END,
       hold_started_at = NULL, last_seen = ?
     WHERE session_id = ? AND secret_id = ? AND generation = ? AND finale_eligible = 1`,
  )
    .bind(now, HOLD_MS, now, session.id, clientId, session.generation)
    .run();
}

async function launchFirework(session: SessionRow, clientId: string) {
  const now = Date.now();
  const participant = await env.DB.prepare(
    `SELECT color FROM minna_participants
     WHERE session_id = ? AND secret_id = ? AND generation = ? AND last_seen >= ?`,
  )
    .bind(session.id, clientId, session.generation, now - ACTIVE_MS)
    .first<{ color: string }>();
  if (!participant) throw new ParticipantRequiredError();

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM minna_fireworks
       WHERE session_id = ? AND generation = ? AND created_at < ?`,
    ).bind(session.id, session.generation, now - 15_000),
    env.DB.prepare(
      `INSERT INTO minna_fireworks (session_id, generation, client_id, x, y, color, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM minna_fireworks
         WHERE session_id = ? AND generation = ? AND client_id = ? AND created_at >= ?
       )`,
    ).bind(
      session.id,
      session.generation,
      clientId,
      randomBetween(0.12, 0.88),
      randomBetween(0.12, 0.7),
      participant.color,
      now,
      session.id,
      session.generation,
      clientId,
      now - 650,
    ),
  ]);
}

async function hostAction(sessionId: string, action: string) {
  const session = await readSession(sessionId);
  const now = Date.now();
  if (action === "reset") {
    const roomCode = createRoomCode();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE minna_sessions SET phase = 'lobby', generation = generation + 1,
         collective_line = NULL, deadline_at = NULL, special = 0, room_code = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(roomCode, now, session.id),
      env.DB.prepare("DELETE FROM minna_participants WHERE session_id = ?").bind(session.id),
      env.DB.prepare("DELETE FROM minna_fireworks WHERE session_id = ?").bind(session.id),
    ]);
    return;
  }
  if (action === "fire" && session.phase === "finale") {
    await completeFinale(session.id, false);
    return;
  }
  if (action !== "next" || session.target_count < 1) return;
  const next: Partial<Record<Phase, Phase>> = {
    lobby: "question-1",
    "question-1": "question-2",
    "question-2": "question-3",
    "question-3": "question-4",
    "question-4": "question-5",
    "question-5": "reveal",
    reveal: "finale",
  };
  const phase = next[session.phase];
  if (!phase) return;
  let collectiveLine = session.collective_line;
  if (phase === "reveal") {
    const rows = await participantRows(session.id, session.generation, false);
    collectiveLine = buildCollectiveLine(
      rows.map((row) => ({
        answerThanks: row.answer_thanks,
        answerState: row.answer_state,
        answerWish: row.answer_wish,
        answerRole: row.answer_role,
        answerEnergy: row.answer_energy,
      })),
    );
  }
  if (phase === "finale") {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE minna_participants SET finale_eligible = 0, hold_started_at = NULL, hold_completed = 0
         WHERE session_id = ? AND generation = ?`,
      ).bind(session.id, session.generation),
      env.DB.prepare(
        `UPDATE minna_participants SET finale_eligible = 1
         WHERE session_id = ? AND generation = ? AND last_seen >= ?`,
      ).bind(session.id, session.generation, now - ACTIVE_MS),
    ]);
  }
  await env.DB.prepare(
    `UPDATE minna_sessions SET phase = ?, collective_line = ?, deadline_at = ?, special = 0, updated_at = ?
     WHERE id = ?`,
  )
    .bind(phase, collectiveLine, phase === "finale" ? now + FINALE_MS : null, now, session.id)
    .run();
}

async function currentState(sessionId: string, includeFireworks = false): Promise<PublicState> {
  const session = await readSession(sessionId);
  const active = await participantRows(session.id, session.generation, true);
  const finale = await finaleProgress(session.id, session.generation);
  const answerCounts: Record<string, number> = {};
  for (const participant of active) {
    for (const [questionId, answer] of [
      ["ai-thanks", participant.answer_thanks],
      ["current-state", participant.answer_state],
      ["room-wish", participant.answer_wish],
      ["team-role", participant.answer_role],
      ["final-energy", participant.answer_energy],
    ] as const) {
      if (!answer) continue;
      const key = `${questionId}:${answer}`;
      answerCounts[key] = (answerCounts[key] ?? 0) + 1;
    }
  }
  return {
    phase: session.phase,
    generation: session.generation,
    targetCount: session.target_count,
    participantCount: active.length,
    participants: active.map((participant) => ({
      id: participant.public_id,
      color: participant.color,
      answeredCurrentQuestion: Boolean(answerForPhase(participant, session.phase)),
    })),
    fireworks: includeFireworks ? await fireworkRows(session.id, session.generation) : [],
    answerCounts,
    collectiveLine: session.collective_line,
    smile: smileProgress(session.target_count, active.length),
    finale: {
      denominator: finale.denominator,
      completed: finale.completed,
      progress: finale.denominator === 0 ? 0 : finale.completed / finale.denominator,
      special: Boolean(session.special),
      deadlineAt: session.deadline_at,
    },
  };
}

async function fireworkRows(sessionId: string, generation: number) {
  const result = await env.DB.prepare(
    `SELECT id, x, y, color FROM minna_fireworks
     WHERE session_id = ? AND generation = ? AND created_at >= ? ORDER BY id DESC LIMIT 80`,
  )
    .bind(sessionId, generation, Date.now() - 6_000)
    .all<FireworkRow>();
  return result.results.reverse();
}

async function participantRows(sessionId: string, generation: number, activeOnly: boolean) {
  const query = activeOnly
    ? `SELECT public_id, color, answer_thanks, answer_state, answer_wish, answer_role, answer_energy,
       hold_completed, finale_eligible FROM minna_participants
       WHERE session_id = ? AND generation = ? AND last_seen >= ? ORDER BY public_id`
    : `SELECT public_id, color, answer_thanks, answer_state, answer_wish, answer_role, answer_energy,
       hold_completed, finale_eligible FROM minna_participants
       WHERE session_id = ? AND generation = ? ORDER BY public_id`;
  const result = activeOnly
    ? await env.DB.prepare(query).bind(sessionId, generation, Date.now() - ACTIVE_MS).all<ParticipantRow>()
    : await env.DB.prepare(query).bind(sessionId, generation).all<ParticipantRow>();
  return result.results;
}

async function enrolledParticipantCount(sessionId: string, generation: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM minna_participants WHERE session_id = ? AND generation = ?`,
  )
    .bind(sessionId, generation)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function answerForPhase(participant: ParticipantRow, phase: Phase) {
  if (phase === "question-1") return participant.answer_thanks;
  if (phase === "question-2") return participant.answer_state;
  if (phase === "question-3") return participant.answer_wish;
  if (phase === "question-4") return participant.answer_role;
  if (phase === "question-5") return participant.answer_energy;
  return null;
}

async function finaleProgress(sessionId: string, generation: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS denominator,
     SUM(CASE WHEN hold_completed = 1 THEN 1 ELSE 0 END) AS completed
     FROM minna_participants
     WHERE session_id = ? AND generation = ? AND finale_eligible = 1`,
  )
    .bind(sessionId, generation)
    .first<{ denominator: number; completed: number | null }>();
  return { denominator: row?.denominator ?? 0, completed: row?.completed ?? 0 };
}

async function completeFinale(sessionId: string, special: boolean) {
  await env.DB.prepare(
    `UPDATE minna_sessions SET phase = 'complete', deadline_at = NULL, special = ?, updated_at = ?
     WHERE id = ? AND phase = 'finale'`,
  )
    .bind(special ? 1 : 0, Date.now(), sessionId)
    .run();
}

async function advanceFinale(sessionId: string) {
  const session = await readSession(sessionId);
  if (session.phase !== "finale") return;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE minna_participants SET hold_completed = 1, hold_started_at = NULL
     WHERE session_id = ? AND generation = ? AND finale_eligible = 1 AND hold_completed = 0
     AND hold_started_at IS NOT NULL AND ? - hold_started_at >= ?`,
  )
    .bind(session.id, session.generation, now, HOLD_MS)
    .run();
  const progress = await finaleProgress(session.id, session.generation);
  if (progress.denominator > 0 && progress.completed / progress.denominator >= 0.6) {
    await completeFinale(session.id, true);
  } else if (session.deadline_at !== null && now >= session.deadline_at) {
    await completeFinale(session.id, false);
  }
}

async function ensureRoomCode(sessionId: string) {
  const session = await readSession(sessionId);
  if (session.room_code && /^[0-9a-f]{64}$/.test(session.room_code)) return session.room_code;
  const candidate = createRoomCode();
  await env.DB.prepare(
    `UPDATE minna_sessions SET room_code = ?
     WHERE id = ? AND (room_code IS NULL OR length(room_code) <> 64)`,
  )
    .bind(candidate, sessionId)
    .run();
  return (await readSession(sessionId)).room_code ?? candidate;
}

async function ownerIdForEmail(email: string) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function createRoomCode() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

function isTargetCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 500;
}

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isTrustedMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

function randomBetween(min: number, max: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return min + ((values[0] ?? 0) / 0xffffffff) * (max - min);
}

function stateResponse(state: PublicState & { joinCode?: string }) {
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function routeError(cause: unknown) {
  if (cause instanceof HostSignInRequiredError) return error("host-sign-in-required", 401);
  if (cause instanceof RoomNotConfiguredError) return error("room-not-configured", 409);
  if (cause instanceof RoomTargetTooSmallError) return error("target-below-participants", 409);
  if (cause instanceof RoomFullError) return error("room-full", 429);
  if (cause instanceof ParticipantRequiredError) return error("participant-required", 403);
  const message = cause instanceof Error ? cause.message : "unexpected-error";
  console.error(cause);
  return error(message.includes("no such table") || message.includes("no such column") ? "database-not-ready" : "internal-error", 500);
}

class HostSignInRequiredError extends Error {}
class RoomNotConfiguredError extends Error {}
class RoomTargetTooSmallError extends Error {}
class RoomFullError extends Error {}
class ParticipantRequiredError extends Error {}
