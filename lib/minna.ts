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
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export type AnswerOption = (typeof QUESTIONS)[number]["options"][number]["id"];
export type Phase =
  | "lobby"
  | "question-1"
  | "question-2"
  | "reveal"
  | "finale"
  | "complete";

export interface PublicParticipant {
  id: string;
  color: string;
  answeredCurrentQuestion: boolean;
}

export interface PublicState {
  phase: Phase;
  generation: number;
  participantCount: number;
  participants: PublicParticipant[];
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
  if (phase === "question-1") return QUESTIONS[0];
  if (phase === "question-2") return QUESTIONS[1];
  return null;
}

export function isQuestionId(value: unknown): value is QuestionId {
  return value === "ai-thanks" || value === "current-state";
}

export function isAnswerOption(value: unknown): value is AnswerOption {
  return ["yes", "no", "awake", "sleepy", "deploying"].includes(String(value));
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
  participants: Array<{ answerThanks: string | null; answerState: string | null }>,
) {
  const thanks = participants.map((item) => item.answerThanks).filter(Boolean);
  const states = participants.map((item) => item.answerState).filter(Boolean);
  if (thanks.length < 5 || states.length < 5) {
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
  return `私はMINNA.exe。${percent}%がAIにありがとうと言う、礼儀正しい人格です。${callback}`;
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
