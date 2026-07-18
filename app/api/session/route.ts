import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  buildCollectiveLine,
  identityForClient,
  isAnswerOption,
  isClientId,
  isQuestionId,
  type AnswerOption,
  type Phase,
  type PublicState,
  type QuestionId,
} from "../../../lib/minna";

export const dynamic = "force-dynamic";

const SESSION_ID = "main";
const ACTIVE_MS = 12_000;
const HOLD_MS = 3_000;
const FINALE_MS = 20_000;
const ANSWER_CONFIG = {
  "ai-thanks": { phase: "question-1", column: "answer_thanks", options: ["yes", "no"] },
  "current-state": { phase: "question-2", column: "answer_state", options: ["awake", "sleepy", "deploying"] },
  "room-wish": { phase: "question-3", column: "answer_wish", options: ["laugh", "wow", "connect"] },
  "team-role": { phase: "question-4", column: "answer_role", options: ["boke", "tsukkomi", "support"] },
  "final-energy": { phase: "question-5", column: "answer_energy", options: ["calm", "hot", "maximum"] },
} as const;

interface SessionRow {
  id: string;
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
    void request;
    return stateResponse(await currentState());
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
    const action = payload.action;

    if (["join", "heartbeat", "answer", "hold-start", "hold-stop", "firework"].includes(String(action))) {
      if (!(await isValidRoomCode(payload.roomCode))) return error("invalid-room", 403);
    }

    if (action === "join") {
      if (!isClientId(payload.clientId)) return error("invalid-client", 400);
      await joinParticipant(payload.clientId);
      return stateResponse(await currentState());
    }

    if (action === "heartbeat") {
      if (!isClientId(payload.clientId)) return error("invalid-client", 400);
      await heartbeatParticipant(payload.clientId);
      return stateResponse(await currentState());
    }

    if (action === "answer") {
      if (
        !isClientId(payload.clientId) ||
        !isQuestionId(payload.questionId) ||
        !isAnswerOption(payload.optionId)
      ) {
        return error("invalid-answer", 400);
      }
      await submitAnswer(payload.clientId, payload.questionId, payload.optionId);
      return stateResponse(await currentState());
    }

    if (action === "hold-start" || action === "hold-stop") {
      if (!isClientId(payload.clientId)) return error("invalid-client", 400);
      await updateHold(payload.clientId, action === "hold-start");
      await advanceFinale();
      return stateResponse(await currentState());
    }

    if (action === "firework") {
      if (!isClientId(payload.clientId)) return error("invalid-client", 400);
      await launchFirework(payload.clientId);
      return stateResponse(await currentState());
    }

    if (["open-room", "tick", "next", "fire", "reset"].includes(String(action))) {
      const user = await getChatGPTUser();
      if (!isLocalRequest(request)) {
        const hostEmail = (env as unknown as { HOST_EMAIL?: string }).HOST_EMAIL;
        if (!user) return error("host-sign-in-required", 401);
        if (!hostEmail || user.email.toLowerCase() !== hostEmail.toLowerCase()) {
          return error("host-not-authorized", 403);
        }
      }
      const roomCode = await ensureRoomCode();
      if (action === "tick") await advanceFinale();
      if (["next", "fire", "reset"].includes(String(action))) await hostAction(String(action));
      return stateResponse({ ...(await currentState(true)), joinCode: roomCode });
    }

    return error("unknown-action", 400);
  } catch (cause) {
    return routeError(cause);
  }
}

async function readSession() {
  const session = await env.DB.prepare(
    `SELECT id, phase, generation, collective_line, deadline_at, special, room_code
     FROM minna_sessions WHERE id = ?`,
  )
    .bind(SESSION_ID)
    .first<SessionRow>();
  if (!session) throw new Error("Session state is unavailable");
  return session;
}

async function joinParticipant(clientId: string) {
  const session = await readSession();
  const identity = identityForClient(clientId);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE minna_participants SET
       public_id = ?, color = ?,
       answer_thanks = CASE WHEN generation <> ? THEN NULL ELSE answer_thanks END,
       answer_state = CASE WHEN generation <> ? THEN NULL ELSE answer_state END,
       answer_wish = CASE WHEN generation <> ? THEN NULL ELSE answer_wish END,
       answer_role = CASE WHEN generation <> ? THEN NULL ELSE answer_role END,
       answer_energy = CASE WHEN generation <> ? THEN NULL ELSE answer_energy END,
       hold_started_at = CASE WHEN generation <> ? THEN NULL ELSE hold_started_at END,
       hold_completed = CASE WHEN generation <> ? THEN 0 ELSE hold_completed END,
       finale_eligible = CASE WHEN generation <> ? THEN 0 ELSE finale_eligible END,
       generation = ?, last_seen = ?
     WHERE secret_id = ?`,
  )
    .bind(
      identity.publicId,
      identity.color,
      session.generation,
      session.generation,
      session.generation,
      session.generation,
      session.generation,
      session.generation,
      session.generation,
      session.generation,
      session.generation,
      now,
      clientId,
    )
    .run();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO minna_participants
       (secret_id, public_id, color, generation, last_seen, hold_completed, finale_eligible)
     SELECT ?, ?, ?, ?, ?, 0, 0
     WHERE (SELECT COUNT(*) FROM minna_participants WHERE generation = ?) < 500`,
  )
    .bind(clientId, identity.publicId, identity.color, session.generation, now, session.generation)
    .run();
  if (inserted.meta.changes === 0) {
    const exists = await env.DB.prepare(
      "SELECT secret_id FROM minna_participants WHERE secret_id = ? AND generation = ?",
    )
      .bind(clientId, session.generation)
      .first();
    if (!exists) throw new RoomFullError();
  }
}

async function heartbeatParticipant(clientId: string) {
  const session = await readSession();
  const result = await env.DB.prepare(
    "UPDATE minna_participants SET last_seen = ? WHERE secret_id = ? AND generation = ?",
  )
    .bind(Date.now(), clientId, session.generation)
    .run();
  if (result.meta.changes === 0) await joinParticipant(clientId);
}

async function submitAnswer(clientId: string, questionId: QuestionId, optionId: AnswerOption) {
  const session = await readSession();
  const config = ANSWER_CONFIG[questionId];
  if (session.phase !== config.phase || !config.options.some((option) => option === optionId)) return;
  const column = config.column;
  await env.DB.prepare(
    `UPDATE minna_participants SET ${column} = ?, last_seen = ?
     WHERE secret_id = ? AND generation = ? AND ${column} IS NULL`,
  )
    .bind(optionId, Date.now(), clientId, session.generation)
    .run();
}

async function updateHold(clientId: string, starting: boolean) {
  const session = await readSession();
  if (session.phase !== "finale") return;
  const now = Date.now();
  if (starting) {
    await env.DB.prepare(
      `UPDATE minna_participants SET hold_started_at = COALESCE(hold_started_at, ?), last_seen = ?
       WHERE secret_id = ? AND generation = ? AND finale_eligible = 1 AND hold_completed = 0`,
    )
      .bind(now, now, clientId, session.generation)
      .run();
    return;
  }
  await env.DB.prepare(
    `UPDATE minna_participants SET
       hold_completed = CASE WHEN hold_started_at IS NOT NULL AND ? - hold_started_at >= ? THEN 1 ELSE hold_completed END,
       hold_started_at = NULL,
       last_seen = ?
     WHERE secret_id = ? AND generation = ? AND finale_eligible = 1`,
  )
    .bind(now, HOLD_MS, now, clientId, session.generation)
    .run();
}

async function launchFirework(clientId: string) {
  const session = await readSession();
  const now = Date.now();
  const participant = await env.DB.prepare(
    `SELECT color FROM minna_participants
     WHERE secret_id = ? AND generation = ? AND last_seen >= ?`,
  )
    .bind(clientId, session.generation, now - ACTIVE_MS)
    .first<{ color: string }>();
  if (!participant) throw new ParticipantRequiredError();

  const x = randomBetween(0.12, 0.88);
  const y = randomBetween(0.12, 0.7);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM minna_fireworks WHERE created_at < ?").bind(now - 15_000),
    env.DB.prepare(
      `INSERT INTO minna_fireworks (generation, client_id, x, y, color, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM minna_fireworks WHERE client_id = ? AND created_at >= ?
       )`,
    ).bind(session.generation, clientId, x, y, participant.color, now, clientId, now - 650),
  ]);
}

async function hostAction(action: string) {
  const session = await readSession();
  const now = Date.now();
  if (action === "reset") {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE minna_sessions SET phase = 'lobby', generation = generation + 1,
         collective_line = NULL, deadline_at = NULL, special = 0, updated_at = ? WHERE id = ?`,
      ).bind(now, SESSION_ID),
      env.DB.prepare("DELETE FROM minna_participants"),
      env.DB.prepare("DELETE FROM minna_fireworks"),
    ]);
    return;
  }
  if (action === "fire" && session.phase === "finale") {
    await completeFinale(false);
    return;
  }
  if (action !== "next") return;
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
    const rows = await participantRows(session.generation, false);
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
        "UPDATE minna_participants SET finale_eligible = 0, hold_started_at = NULL, hold_completed = 0 WHERE generation = ?",
      ).bind(session.generation),
      env.DB.prepare(
        "UPDATE minna_participants SET finale_eligible = 1 WHERE generation = ? AND last_seen >= ?",
      ).bind(session.generation, now - ACTIVE_MS),
    ]);
  }
  await env.DB.prepare(
    `UPDATE minna_sessions SET phase = ?, collective_line = ?, deadline_at = ?, special = 0, updated_at = ?
     WHERE id = ?`,
  )
    .bind(phase, collectiveLine, phase === "finale" ? now + FINALE_MS : null, now, SESSION_ID)
    .run();
}

async function currentState(includeFireworks = false): Promise<PublicState> {
  const session = await readSession();
  const active = await participantRows(session.generation, true);
  const finale = await finaleProgress(session.generation);
  const answerCounts: Record<string, number> = {};
  for (const participant of active) {
    if (participant.answer_thanks) {
      const key = `ai-thanks:${participant.answer_thanks}`;
      answerCounts[key] = (answerCounts[key] ?? 0) + 1;
    }
    if (participant.answer_state) {
      const key = `current-state:${participant.answer_state}`;
      answerCounts[key] = (answerCounts[key] ?? 0) + 1;
    }
    if (participant.answer_wish) {
      const key = `room-wish:${participant.answer_wish}`;
      answerCounts[key] = (answerCounts[key] ?? 0) + 1;
    }
    if (participant.answer_role) {
      const key = `team-role:${participant.answer_role}`;
      answerCounts[key] = (answerCounts[key] ?? 0) + 1;
    }
    if (participant.answer_energy) {
      const key = `final-energy:${participant.answer_energy}`;
      answerCounts[key] = (answerCounts[key] ?? 0) + 1;
    }
  }
  return {
    phase: session.phase,
    generation: session.generation,
    participantCount: active.length,
    participants: active.map((participant) => ({
      id: participant.public_id,
      color: participant.color,
      answeredCurrentQuestion: Boolean(answerForPhase(participant, session.phase)),
    })),
    fireworks: includeFireworks ? await fireworkRows(session.generation) : [],
    answerCounts,
    collectiveLine: session.collective_line,
    finale: {
      denominator: finale.denominator,
      completed: finale.completed,
      progress: finale.denominator === 0 ? 0 : finale.completed / finale.denominator,
      special: Boolean(session.special),
      deadlineAt: session.deadline_at,
    },
  };
}

async function fireworkRows(generation: number) {
  const result = await env.DB.prepare(
    `SELECT id, x, y, color FROM minna_fireworks
     WHERE generation = ? AND created_at >= ? ORDER BY id DESC LIMIT 80`,
  )
    .bind(generation, Date.now() - 6_000)
    .all<FireworkRow>();
  return result.results.reverse();
}

async function participantRows(generation: number, activeOnly: boolean) {
  const query = activeOnly
    ? `SELECT public_id, color, answer_thanks, answer_state, answer_wish, answer_role, answer_energy,
       hold_completed, finale_eligible
       FROM minna_participants WHERE generation = ? AND last_seen >= ? ORDER BY public_id`
    : `SELECT public_id, color, answer_thanks, answer_state, answer_wish, answer_role, answer_energy,
       hold_completed, finale_eligible
       FROM minna_participants WHERE generation = ? ORDER BY public_id`;
  const result = activeOnly
    ? await env.DB.prepare(query).bind(generation, Date.now() - ACTIVE_MS).all<ParticipantRow>()
    : await env.DB.prepare(query).bind(generation).all<ParticipantRow>();
  return result.results;
}

function answerForPhase(participant: ParticipantRow, phase: Phase) {
  if (phase === "question-1") return participant.answer_thanks;
  if (phase === "question-2") return participant.answer_state;
  if (phase === "question-3") return participant.answer_wish;
  if (phase === "question-4") return participant.answer_role;
  if (phase === "question-5") return participant.answer_energy;
  return null;
}

async function finaleProgress(generation: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS denominator,
     SUM(CASE WHEN hold_completed = 1 THEN 1 ELSE 0 END) AS completed
     FROM minna_participants WHERE generation = ? AND finale_eligible = 1`,
  )
    .bind(generation)
    .first<{ denominator: number; completed: number | null }>();
  return { denominator: row?.denominator ?? 0, completed: row?.completed ?? 0 };
}

async function completeFinale(special: boolean) {
  await env.DB.prepare(
    `UPDATE minna_sessions SET phase = 'complete', deadline_at = NULL, special = ?, updated_at = ?
     WHERE id = ? AND phase = 'finale'`,
  )
    .bind(special ? 1 : 0, Date.now(), SESSION_ID)
    .run();
}

async function advanceFinale() {
  const session = await readSession();
  if (session.phase !== "finale") return;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE minna_participants SET hold_completed = 1, hold_started_at = NULL
     WHERE generation = ? AND finale_eligible = 1 AND hold_completed = 0
     AND hold_started_at IS NOT NULL AND ? - hold_started_at >= ?`,
  )
    .bind(session.generation, now, HOLD_MS)
    .run();
  const progress = await finaleProgress(session.generation);
  if (progress.denominator > 0 && progress.completed / progress.denominator >= 0.6) {
    await completeFinale(true);
  } else if (session.deadline_at !== null && now >= session.deadline_at) {
    await completeFinale(false);
  }
}

async function ensureRoomCode() {
  const session = await readSession();
  if (session.room_code && /^[0-9a-f]{64}$/.test(session.room_code)) {
    return session.room_code;
  }
  const candidate = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  await env.DB.prepare(
    `UPDATE minna_sessions SET room_code = ?
     WHERE id = ? AND (room_code IS NULL OR length(room_code) <> 64)`,
  )
    .bind(candidate, SESSION_ID)
    .run();
  return (await readSession()).room_code ?? candidate;
}

async function isValidRoomCode(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return false;
  const session = await readSession();
  return session.room_code === value;
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
  if (cause instanceof RoomFullError) return error("room-full", 429);
  if (cause instanceof ParticipantRequiredError) return error("participant-required", 403);
  const message = cause instanceof Error ? cause.message : "unexpected-error";
  console.error(cause);
  return error(message.includes("no such table") ? "database-not-ready" : "internal-error", 500);
}

class RoomFullError extends Error {}
class ParticipantRequiredError extends Error {}
