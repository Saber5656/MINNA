export type Phase =
  | 'lobby'
  | 'question-1'
  | 'question-2'
  | 'question-3'
  | 'question-4'
  | 'question-5'
  | 'reveal'
  | 'finale'
  | 'complete';

export interface PublicQuestion {
  id: string;
  eyebrow: string;
  prompt: string;
  options: readonly { id: string; label: string }[];
}

export interface PublicParticipant {
  id: string;
  color: string;
  answeredCurrentQuestion: boolean;
}

export interface PublicState {
  phase: Phase;
  generation: number;
  updatedAt: number;
  targetCount: number;
  participantCount: number;
  participants: PublicParticipant[];
  fireworks: { id: number; x: number; y: number; color: string }[];
  answerCounts: Record<string, number>;
  collectiveLine: string | null;
  questions: PublicQuestion[];
  finalePunchline: string;
  smile: {
    minimumDotCount: number;
    dotCount: number;
    filledDotCount: number;
    complete: boolean;
  };
  finale: {
    denominator: number;
    completed: number;
    progress: number;
    special: boolean;
    deadlineAt: number | null;
  };
}

const ROOM_CODE = /^[0-9a-f]{64}$/i;
const PHASE_ORDER: Phase[] = [
  'lobby',
  'question-1',
  'question-2',
  'question-3',
  'question-4',
  'question-5',
  'reveal',
  'finale',
  'complete',
];

export function parseRoomCode(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (ROOM_CODE.test(trimmed)) return trimmed.toLowerCase();

  try {
    const room = new URL(trimmed).searchParams.get('room');
    return room && ROOM_CODE.test(room) ? room.toLowerCase() : null;
  } catch {
    const match = trimmed.match(/[?&]room=([0-9a-f]{64})(?:&|$)/i);
    return match?.[1]?.toLowerCase() ?? null;
  }
}

export function questionForPhase(state: PublicState | null) {
  if (!state?.phase.startsWith('question-')) return null;
  const index = Number(state.phase.slice(-1)) - 1;
  return Number.isInteger(index) ? state.questions[index] ?? null : null;
}

export function isStaleState(previous: PublicState, next: PublicState) {
  if (next.generation !== previous.generation) return next.generation < previous.generation;
  if (next.updatedAt !== previous.updatedAt) return next.updatedAt < previous.updatedAt;
  return PHASE_ORDER.indexOf(next.phase) < PHASE_ORDER.indexOf(previous.phase);
}

export function identityForClient(clientId: string) {
  let hash = 2166136261;
  for (let index = 0; index < clientId.length; index += 1) {
    hash ^= clientId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  const palette = [
    '#ff6b6b', '#ffd447', '#47e2ae', '#4cc9ff', '#c58cff', '#ff72bd',
    '#8bdf65', '#ff9558', '#4de2e8', '#899bff', '#ff8da1', '#c9df55',
  ];
  const suffix = Number.parseInt(clientId.slice(-2), 16);
  return {
    publicId: `particle-${unsigned.toString(36)}`,
    color: palette[suffix % palette.length] ?? palette[unsigned % palette.length],
  };
}
