export const QUESTIONS = [
  {
    id: "ai-thanks",
    eyebrow: "QUESTION 01",
    prompt: "AIに「ありがとう」と言ったことがある？",
    options: [
      { id: "yes", label: "ある" },
      { id: "no", label: "まだない" },
    ],
  },
  {
    id: "current-state",
    eyebrow: "QUESTION 02",
    prompt: "いまの自分に一番近いのは？",
    options: [
      { id: "awake", label: "覚醒" },
      { id: "sleepy", label: "眠い" },
      { id: "deploying", label: "デプロイ中" },
    ],
  },
  {
    id: "room-wish",
    eyebrow: "QUESTION 03",
    prompt: "この3分で、いちばん起きてほしいのは？",
    options: [
      { id: "laugh", label: "爆笑" },
      { id: "wow", label: "鳥肌" },
      { id: "connect", label: "一体感" },
    ],
  },
  {
    id: "team-role",
    eyebrow: "QUESTION 04",
    prompt: "いまの自分は、どの役割？",
    options: [
      { id: "boke", label: "ボケ" },
      { id: "tsukkomi", label: "ツッコミ" },
      { id: "support", label: "見守る人" },
    ],
  },
  {
    id: "final-energy",
    eyebrow: "QUESTION 05",
    prompt: "MINNA.exeに送る熱量は？",
    options: [
      { id: "calm", label: "30%" },
      { id: "hot", label: "80%" },
      { id: "maximum", label: "限界突破" },
    ],
  },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export type AnswerOption = (typeof QUESTIONS)[number]["options"][number]["id"];
export type Phase =
  | "lobby"
  | "question-1"
  | "question-2"
  | "question-3"
  | "question-4"
  | "question-5"
  | "reveal"
  | "finale"
  | "complete";

export interface PublicParticipant {
  id: string;
  color: string;
  answeredCurrentQuestion: boolean;
}

export interface PublicFirework {
  id: number;
  x: number;
  y: number;
  color: string;
}

export interface PublicState {
  phase: Phase;
  generation: number;
  participantCount: number;
  participants: PublicParticipant[];
  fireworks: PublicFirework[];
  answerCounts: Record<string, number>;
  collectiveLine: string | null;
  finale: {
    denominator: number;
    completed: number;
    progress: number;
    special: boolean;
    deadlineAt: number | null;
  };
}

export function questionForPhase(phase: Phase) {
  const index = QUESTION_PHASES.indexOf(phase as (typeof QUESTION_PHASES)[number]);
  return index < 0 ? null : QUESTIONS[index];
}

export function isQuestionId(value: unknown): value is QuestionId {
  return QUESTIONS.some((question) => question.id === value);
}

export function isAnswerOption(value: unknown): value is AnswerOption {
  return QUESTIONS.some((question) =>
    question.options.some((option) => option.id === value),
  );
}

export function isClientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function identityForClient(clientId: string) {
  const value = hash(clientId);
  const palette = [
    "hsl(6 88% 64%)",
    "hsl(47 92% 58%)",
    "hsl(163 70% 53%)",
    "hsl(202 90% 64%)",
    "hsl(276 82% 70%)",
    "hsl(326 86% 67%)",
    "hsl(102 62% 58%)",
    "hsl(24 94% 62%)",
    "hsl(185 78% 55%)",
    "hsl(232 86% 72%)",
    "hsl(350 86% 72%)",
    "hsl(72 76% 58%)",
  ] as const;
  const suffix = Number.parseInt(clientId.slice(-2), 16);
  return {
    publicId: `particle-${value.toString(36)}`,
    color: palette[suffix % palette.length] ?? palette[value % palette.length],
  };
}

export function buildCollectiveLine(
  participants: Array<{
    answerThanks: string | null;
    answerState: string | null;
    answerWish: string | null;
    answerRole: string | null;
    answerEnergy: string | null;
  }>,
) {
  const thanks = participants.map((item) => item.answerThanks).filter(Boolean);
  const states = participants.map((item) => item.answerState).filter(Boolean);
  const wishes = participants.map((item) => item.answerWish).filter(Boolean);
  const roles = participants.map((item) => item.answerRole).filter(Boolean);
  const energies = participants.map((item) => item.answerEnergy).filter(Boolean);
  if ([thanks, states, wishes, roles, energies].some((answers) => answers.length < 5)) {
    return "私はMINNA.exe。少人数でも、全員分の色でできています。集まってくれて、ありがとう。";
  }
  const percent = Math.round(
    (thanks.filter((answer) => answer === "yes").length / thanks.length) * 100,
  );
  const sleepy = states.filter((answer) => answer === "sleepy").length;
  const deploying = states.filter((answer) => answer === "deploying").length;
  const awake = states.filter((answer) => answer === "awake").length;
  const callback =
    sleepy >= deploying && sleepy >= awake
      ? "AIにはお礼を言うのに、自分は寝かせません。"
      : deploying >= awake
        ? "お礼より先に、まずデプロイします。"
        : "今日は目だけでなく、会場まで覚醒しています。";
  const wish = majority(wishes);
  const role = majority(roles);
  const energy = majority(energies);
  const wishLine = {
    laugh: "目的は爆笑",
    wow: "目的は鳥肌",
    connect: "目的は一体感",
  }[wish] ?? "目的は一体感";
  const roleLine = {
    boke: "ボケが主導権を握り",
    tsukkomi: "ツッコミが全体を支え",
    support: "見守る人がいちばん強く",
  }[role] ?? "全員が役割を持ち";
  const energyLine = {
    calm: "熱量30%の省エネ運転です。",
    hot: "熱量80%、まだ伸びしろがあります。",
    maximum: "熱量は限界突破。もう誰にも停止できません。",
  }[energy] ?? "熱量は限界突破です。";
  return `私はMINNA.exe。${percent}%がAIにありがとうと言う、礼儀正しい人格です。${callback}${wishLine}、${roleLine}、${energyLine}`;
}

export const FACE_TARGET_COUNT = 68;

export function makeSmileTargets(width: number, height: number, centerRatio: number) {
  const points: Array<{ x: number; y: number }> = [];
  const centerX = width * centerRatio;
  const centerY = height * 0.48;
  const radius = Math.min(width, height) * 0.32;
  addArc(points, centerX, centerY, radius, 0, Math.PI * 2, 36, false);
  addArc(points, centerX - radius * 0.35, centerY - radius * 0.18, radius * 0.1, 0, Math.PI * 2, 8, false);
  addArc(points, centerX + radius * 0.35, centerY - radius * 0.18, radius * 0.1, 0, Math.PI * 2, 8, false);
  addArc(points, centerX, centerY + radius * 0.08, radius * 0.48, Math.PI * 0.15, Math.PI * 0.85, 16, true);
  return points;
}

export function smileTargetIndex(participantIndex: number, participantCount: number) {
  if (participantCount <= 0) return 0;
  if (participantCount >= FACE_TARGET_COUNT) return participantIndex % FACE_TARGET_COUNT;
  return Math.floor((participantIndex * FACE_TARGET_COUNT) / participantCount);
}

const QUESTION_PHASES = [
  "question-1",
  "question-2",
  "question-3",
  "question-4",
  "question-5",
] as const;

function majority(answers: string[]) {
  const counts = new Map<string, number>();
  for (const answer of answers) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function addArc(
  points: Array<{ x: number; y: number }>,
  centerX: number,
  centerY: number,
  radius: number,
  start: number,
  end: number,
  count: number,
  includeEnd: boolean,
) {
  const denominator = includeEnd ? Math.max(1, count - 1) : count;
  for (let index = 0; index < count; index += 1) {
    const angle = start + ((end - start) * index) / denominator;
    points.push({ x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
  }
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
