import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MIN_SMILE_DOT_COUNT,
  QUESTIONS,
  buildCollectiveLine,
  defaultRoomContent,
  isRoomAnswerOption,
  makeSmileTargets,
  previousPresentationPhase,
  questionForPhase,
  roomContentFromJson,
  roomContentForAudience,
  roomContentFromUnknown,
  smileProgress,
} from "../lib/minna.ts";

const root = new URL("../", import.meta.url);

test("ships the audience and host product instead of the starter", async () => {
  const [client, layout, styles, join, host, packageJson] = await Promise.all([
    readFile(new URL("app/minna-client.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/join/page.tsx", root), "utf8"),
    readFile(new URL("app/host/page.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(client, /会場を、/);
  assert.match(client, /YOUR PARTICLE/);
  assert.match(client, /hold-start/);
  assert.match(client, /configure-content/);
  assert.match(client, /選択肢を追加/);
  assert.match(client, /ひとつ前に戻る/);
  assert.match(client, /controlPendingRef\.current/);
  assert.match(client, /expectedPhase: state\.phase/);
  assert.match(client, /FINAL PUNCHLINE/);
  assert.match(client, /Mouse/);
  assert.match(client, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(join, /mode="audience"/);
  assert.match(host, /mode="host"/);
  assert.match(host, /chatGPTSignInPath/);
  assert.match(layout, /MINNA\.exe/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(styles, /backdrop-filter: blur\(24px\) saturate\(145%\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /grid-template-rows: calc\(64px \+ env\(safe-area-inset-top\)\)/);
  assert.match(styles, /\.stepper-buttons \{ display: grid; grid-template-columns: repeat\(2, 44px\)/);
  assert.match(styles, /\.stepper-buttons button \{ width: 44px; min-width: 44px; min-height: 56px/);
  assert.match(styles, /prefers-reduced-transparency/);
  assert.match(styles, /\.answer-grid button, \.hold-button \{ background: #24262c; \}/);
  assert.match(styles, /button:focus-visible/);
  assert.match(styles, /\.answer-grid button \{ min-height: 84px/);
  assert.doesNotMatch(`${client}${layout}${packageJson}`, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("declares the shared database and migration", async () => {
  const [hosting, migration, answersMigration, sessionsMigration, constraintsMigration, contentMigration, route] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("drizzle/0000_curvy_sunfire.sql", root), "utf8"),
    readFile(new URL("drizzle/0003_ancient_jimmy_woo.sql", root), "utf8"),
    readFile(new URL("drizzle/0005_first_maginty.sql", root), "utf8"),
    readFile(new URL("drizzle/0006_safe_speedball.sql", root), "utf8"),
    readFile(new URL("drizzle/0007_amazing_kinsey_walden.sql", root), "utf8"),
    readFile(new URL("app/api/session/route.ts", root), "utf8"),
  ]);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `minna_sessions`/);
  assert.match(migration, /CREATE TABLE `minna_participants`/);
  assert.match(answersMigration, /ADD `answer_wish`/);
  assert.match(answersMigration, /ADD `answer_role`/);
  assert.match(answersMigration, /ADD `answer_energy`/);
  assert.match(sessionsMigration, /ADD `session_id`/);
  assert.match(sessionsMigration, /ADD `target_count`/);
  assert.match(sessionsMigration, /minna_sessions_owner_idx/);
  assert.match(constraintsMigration, /PRIMARY KEY\(`session_id`, `secret_id`\)/);
  assert.match(constraintsMigration, /minna_sessions_target_count_check/);
  assert.match(constraintsMigration, /minna_sessions_room_code_idx/);
  assert.match(contentMigration, /ADD `content_json` text/);
  assert.match(route, /special/);
  assert.match(route, /HOLD_MS = 3_000/);
  assert.match(route, /FINALE_MS = 20_000/);
  assert.ok((route.match(/crypto\.randomUUID\(\)/g)?.length ?? 0) >= 2);
  assert.ok(route.includes('!/^[0-9a-f]{64}$/.test(value)'));
  assert.doesNotMatch(route, /generation = \?\) < 500/);
  assert.match(route, /target-below-participants/);
  assert.match(route, /MAX_JSON_BODY_BYTES = 16_384/);
  assert.match(route, /request\.body\.getReader\(\)/);
  assert.match(route, /receivedBytes \+= value\.byteLength/);
  assert.match(route, /receivedBytes > MAX_JSON_BODY_BYTES/);
  assert.match(route, /await reader\.cancel\(\)/);
  assert.match(route, /UPDATE minna_sessions SET content_json = \?, updated_at = \? WHERE id = \? AND phase = 'lobby'/);
  assert.match(route, /\.bind\(JSON\.stringify\(content\), Date\.now\(\), sessionId\)/);
  assert.match(route, /if \(result\.meta\.changes === 0\) throw new RoomContentLockedError\(\)/);
  assert.match(route, /isRoomAnswerOption\(content, session\.phase, questionId, optionId\)/);
  assert.match(route, /action === "back"/);
  assert.match(route, /previousPresentationPhase\(session\.phase\)/);
  assert.match(route, /expectedPhase !== session\.phase/);
  assert.match(route, /WHERE id = \? AND phase = \?/);
  assert.match(route, /SELECT 1 FROM minna_sessions WHERE id = \? AND phase = \? AND updated_at = \?/);
  assert.match(route, /special = 0, room_code = \?, updated_at = \?/);
  const resetBlock = route.slice(
    route.indexOf('if (action === "reset")'),
    route.indexOf('if (action === "fire"', route.indexOf('if (action === "reset")')),
  );
  assert.match(resetBlock, /DELETE FROM minna_participants WHERE session_id = \?[^]*?bind\(session\.id\)/);
  assert.match(resetBlock, /DELETE FROM minna_fireworks WHERE session_id = \?[^]*?bind\(session\.id\)/);
});

test("validates host-authored questions and finale punchline", () => {
  const defaults = defaultRoomContent();
  const candidate = {
    questions: defaults.questions.map((question, index) => ({
      ...question,
      prompt: index === 0 ? "  今日いちばん使ったAIは？  " : question.prompt,
      options: question.options.map((option, optionIndex) => ({
        ...option,
        label: index === 0 && optionIndex === 0 ? "  ChatGPT  " : option.label,
      })),
    })),
    finalePunchline: "  次のアップデートは、会場全員です。  ",
  };
  const parsed = roomContentFromUnknown(candidate);
  assert.ok(parsed);
  assert.equal(questionForPhase("question-1", parsed.questions)?.prompt, "今日いちばん使ったAIは？");
  assert.equal(parsed.questions[0]?.options[0]?.label, "ChatGPT");
  assert.equal(parsed.finalePunchline, "次のアップデートは、会場全員です。");
  assert.deepEqual(roomContentFromJson(JSON.stringify(candidate)), parsed);
  assert.equal(roomContentFromUnknown({ ...candidate, finalePunchline: " " }), null);
  assert.equal(roomContentFromUnknown({ ...candidate, questions: candidate.questions.slice(1) }), null);
  assert.equal(roomContentFromUnknown({
    ...candidate,
    questions: candidate.questions.map((question, index) => index === 0
      ? { ...question, prompt: `${" ".repeat(80)}x` }
      : question),
  }), null);
  assert.deepEqual(roomContentFromJson("{"), defaults);
  assert.deepEqual(roomContentFromJson(JSON.stringify({ ...candidate, questions: [{ id: "wrong" }] })), defaults);

  const hidden = roomContentForAudience(parsed, "question-2");
  assert.equal(hidden.questions[0]?.prompt, defaults.questions[0]?.prompt);
  assert.equal(hidden.questions[1]?.prompt, parsed.questions[1]?.prompt);
  assert.equal(hidden.questions[2]?.prompt, defaults.questions[2]?.prompt);
  assert.equal(hidden.finalePunchline, "");
  assert.equal(roomContentForAudience(parsed, "complete").finalePunchline, parsed.finalePunchline);

  const fourOptions = {
    ...candidate,
    questions: candidate.questions.map((question, index) => index === 0
      ? {
          ...question,
          options: [
            ...question.options,
            { id: "custom-ai-thanks-three", label: "Copilot" },
            { id: "custom-ai-thanks-four", label: "Gemini" },
          ],
        }
      : question),
  };
  const parsedFourOptions = roomContentFromUnknown(fourOptions);
  assert.equal(parsedFourOptions?.questions[0]?.options.length, 4);
  assert.equal(parsedFourOptions?.questions[0]?.options[2]?.label, "Copilot");

  const twoOptions = {
    ...candidate,
    questions: candidate.questions.map((question, index) => index === 1
      ? { ...question, options: question.options.slice(0, 2) }
      : question),
  };
  assert.equal(roomContentFromUnknown(twoOptions)?.questions[1]?.options.length, 2);
  assert.equal(roomContentFromUnknown({
    ...candidate,
    questions: candidate.questions.map((question, index) => index === 1
      ? { ...question, options: question.options.slice(0, 1) }
      : question),
  }), null);
  assert.equal(roomContentFromUnknown({
    ...fourOptions,
    questions: fourOptions.questions.map((question, index) => index === 0
      ? { ...question, options: [...question.options, { id: "custom-ai-thanks-five", label: "Claude" }] }
      : question),
  }), null);
  assert.equal(roomContentFromUnknown({
    ...candidate,
    questions: candidate.questions.map((question, index) => index === 0
      ? { ...question, options: [question.options[0], question.options[0]] }
      : question),
  }), null);
  assert.equal(roomContentFromUnknown({
    ...candidate,
    questions: candidate.questions.map((question, index) => index === 0
      ? { ...question, options: [{ id: "NOT SAFE", label: "A" }, question.options[1]] }
      : question),
  }), null);
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

test("supports custom option majorities and reversible presentation phases", () => {
  const content = defaultRoomContent();
  content.questions[0] = {
    ...content.questions[0],
    options: [...content.questions[0].options, { id: "custom-ai-thanks-four", label: "Copilot" }],
  };
  const line = buildCollectiveLine(
    Array.from({ length: 5 }, () => ({
      answerThanks: "custom-ai-thanks-four",
      answerState: "awake",
      answerWish: "connect",
      answerRole: "tsukkomi",
      answerEnergy: "maximum",
    })),
    content.questions,
  );
  assert.match(line, /「Copilot」/);
  assert.match(line, /「覚醒」/);

  const roomA = { ...content, questions: content.questions.map((question) => ({ ...question })) };
  const roomB = defaultRoomContent();
  assert.equal(isRoomAnswerOption(roomA, "question-1", "ai-thanks", "custom-ai-thanks-four"), true);
  assert.equal(isRoomAnswerOption(roomB, "question-1", "ai-thanks", "custom-ai-thanks-four"), false);
  assert.equal(isRoomAnswerOption(roomA, "question-2", "ai-thanks", "custom-ai-thanks-four"), false);

  const relabeled = defaultRoomContent();
  relabeled.questions[0] = {
    ...relabeled.questions[0],
    prompt: "いちばん好きな動物は？",
    options: relabeled.questions[0].options.map((option, index) => ({
      ...option,
      label: index === 0 ? "犬" : "猫",
    })),
  };
  const relabeledLine = buildCollectiveLine(
    Array.from({ length: 5 }, () => ({
      answerThanks: "yes",
      answerState: "awake",
      answerWish: "connect",
      answerRole: "tsukkomi",
      answerEnergy: "maximum",
    })),
    relabeled.questions,
  );
  assert.match(relabeledLine, /「犬」/);
  assert.doesNotMatch(relabeledLine, /AIにありがとう/);

  assert.equal(previousPresentationPhase("question-1"), null);
  assert.equal(previousPresentationPhase("question-3"), "question-2");
  assert.equal(previousPresentationPhase("reveal"), "question-5");
  assert.equal(previousPresentationPhase("finale"), "reveal");
  assert.equal(previousPresentationPhase("complete"), null);
});

test("keeps a recognizable 32-dot minimum and scales with room size", () => {
  assert.equal(MIN_SMILE_DOT_COUNT, 32);
  assert.equal(makeSmileTargets(1_000, 700, 0.5, 8).length, 32);
  assert.equal(makeSmileTargets(1_000, 700, 0.5, 68).length, 68);
  assert.equal(makeSmileTargets(1_000, 700, 0.5, 240).length, 240);

  assert.deepEqual(smileProgress(12, 6), {
    minimumDotCount: 32,
    dotCount: 32,
    filledDotCount: 16,
    complete: false,
  });
  assert.deepEqual(smileProgress(12, 12), {
    minimumDotCount: 32,
    dotCount: 32,
    filledDotCount: 32,
    complete: true,
  });
  assert.deepEqual(smileProgress(80, 40), {
    minimumDotCount: 32,
    dotCount: 80,
    filledDotCount: 40,
    complete: false,
  });
});
