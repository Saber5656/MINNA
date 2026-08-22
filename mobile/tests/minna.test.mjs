import assert from 'node:assert/strict';
import test from 'node:test';

import { incomingRoomDecision } from '../src/lib/deep-link.ts';
import { HoldAttemptGate } from '../src/lib/hold-attempt.ts';
import { isStaleState, parseRoomCode, questionForPhase } from '../src/lib/minna.ts';
import { runJoinGate } from '../src/lib/session-gate.ts';
import { makeSmileTargets } from '../src/lib/smile.ts';

const room = 'a'.repeat(64);

test('parseRoomCode accepts raw codes and join URLs', () => {
  assert.equal(parseRoomCode(room.toUpperCase()), room);
  assert.equal(parseRoomCode(`https://example.com/join?room=${room}`), room);
  assert.equal(parseRoomCode(`minna://join?room=${room}`), room);
});

test('parseRoomCode rejects malformed values', () => {
  assert.equal(parseRoomCode('short-code'), null);
  assert.equal(parseRoomCode('https://example.com/join'), null);
  assert.equal(parseRoomCode(null), null);
});

test('questionForPhase selects host-authored questions by phase', () => {
  const state = fixture({
    phase: 'question-2',
    questions: [
      { id: 'one', eyebrow: '01', prompt: 'one?', options: [] },
      { id: 'two', eyebrow: '02', prompt: 'two?', options: [] },
    ],
  });
  assert.equal(questionForPhase(state)?.id, 'two');
  assert.equal(questionForPhase(fixture({ phase: 'lobby' })), null);
});

test('isStaleState rejects older updates without blocking forward phases', () => {
  const previous = fixture({ generation: 3, phase: 'question-2', updatedAt: 200 });
  assert.equal(isStaleState(previous, fixture({ generation: 3, phase: 'question-1', updatedAt: 100 })), true);
  assert.equal(isStaleState(previous, fixture({ generation: 3, phase: 'question-3', updatedAt: 200 })), false);
  assert.equal(isStaleState(previous, fixture({ generation: 4, phase: 'lobby', updatedAt: 1 })), false);
});

test('makeSmileTargets keeps the exact crowd size and draws an upward smile', () => {
  const points = makeSmileTargets(68);
  assert.equal(points.length, 68);
  const mouthCount = Math.max(8, Math.floor(68 * 0.24));
  const mouth = points.slice(-mouthCount);
  const center = mouth[Math.floor(mouth.length / 2)];
  assert.ok(center.y > mouth[0].y);
  assert.ok(center.y > mouth[mouth.length - 1].y);
});

test('runJoinGate starts polling only after a successful accepted join', async () => {
  let failures = 0;
  let syncStarts = 0;
  const rejected = await runJoinGate({
    join: async () => {
      throw new Error('offline');
    },
    accept: () => true,
    onFailure: () => {
      failures += 1;
    },
    startSync: () => {
      syncStarts += 1;
    },
  });

  assert.equal(rejected, false);
  assert.equal(failures, 1);
  assert.equal(syncStarts, 0);

  const accepted = await runJoinGate({
    join: async () => ({ ok: true }),
    accept: () => true,
    onFailure: () => {
      failures += 1;
    },
    startSync: () => {
      syncStarts += 1;
    },
  });

  assert.equal(accepted, true);
  assert.equal(syncStarts, 1);
});

test('HoldAttemptGate blocks rapid re-presses and retries hold-stop after start settles', async () => {
  const callbacks = new Map();
  const scheduler = {
    clear: () => undefined,
    set: (callback, delay) => {
      callbacks.set(delay, callback);
      return delay;
    },
  };
  let resolveStart;
  const started = new Promise((resolve) => {
    resolveStart = resolve;
  });
  let stopCount = 0;
  const gate = new HoldAttemptGate();

  assert.equal(gate.begin(), true);
  assert.equal(gate.begin(), false);
  const finishing = gate.finish(started, async () => {
    stopCount += 1;
  }, scheduler);
  await Promise.resolve();
  assert.equal(stopCount, 1);

  callbacks.get(750)();
  callbacks.get(2_500)();
  await Promise.resolve();
  assert.equal(stopCount, 3);

  resolveStart();
  await finishing;
  assert.equal(stopCount, 4);
  assert.equal(gate.begin(), true);
});

test('incomingRoomDecision consumes a room link before the user accepts it', () => {
  const currentRoom = 'a'.repeat(64);
  const nextRoom = 'b'.repeat(64);
  const incomingUrl = `minna://join?room=${nextRoom}`;
  const first = incomingRoomDecision(incomingUrl, null, currentRoom);

  assert.equal(first.action, 'confirm');
  assert.equal(first.roomCode, nextRoom);
  assert.equal(first.consumedUrl, incomingUrl);

  const afterCancel = incomingRoomDecision(incomingUrl, first.consumedUrl, null);
  assert.equal(afterCancel.action, 'ignore');
});

function fixture(overrides = {}) {
  return {
    answerCounts: {},
    collectiveLine: null,
    finale: { completed: 0, deadlineAt: null, denominator: 0, progress: 0, special: false },
    finalePunchline: '',
    fireworks: [],
    generation: 1,
    participantCount: 0,
    participants: [],
    phase: 'lobby',
    questions: [],
    smile: { complete: false, dotCount: 32, filledDotCount: 0, minimumDotCount: 32 },
    targetCount: 0,
    updatedAt: 1,
    ...overrides,
  };
}
