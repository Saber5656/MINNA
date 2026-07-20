"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  ListChecks,
  Mouse,
  PartyPopper,
  QrCode,
  RotateCcw,
  Save,
  Sparkles,
  Users,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  defaultRoomContent,
  identityForClient,
  questionForPhase,
  type PublicFirework,
  type PublicState,
  type RoomContent,
} from "../lib/minna";
import { ParticleStage, type Arrival } from "./particle-stage";

const EMPTY_STATE: PublicState = {
  phase: "lobby",
  generation: 1,
  updatedAt: 0,
  targetCount: 0,
  participantCount: 0,
  participants: [],
  fireworks: [],
  answerCounts: {},
  collectiveLine: null,
  questions: defaultRoomContent().questions,
  finalePunchline: defaultRoomContent().finalePunchline,
  smile: { minimumDotCount: 32, dotCount: 32, filledDotCount: 0, complete: false },
  finale: { denominator: 0, completed: 0, progress: 0, special: false, deadlineAt: null },
};

export function MinnaApp({ mode }: { mode: "host" | "audience" }) {
  return mode === "host" ? <HostExperience /> : <AudienceExperience />;
}

function HostExperience() {
  const [state, setState] = useState(EMPTY_STATE);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [joinUrl, setJoinUrl] = useState("/join");
  const [qr, setQr] = useState("");
  const [connected, setConnected] = useState(true);
  const [controlLocked, setControlLocked] = useState(false);
  const [activeFireworks, setActiveFireworks] = useState<PublicFirework[]>([]);
  const [targetDraft, setTargetDraft] = useState("68");
  const [configuring, setConfiguring] = useState(false);
  const [configError, setConfigError] = useState("");
  const [contentOpen, setContentOpen] = useState(false);
  const [contentDraft, setContentDraft] = useState<RoomContent>(() => defaultRoomContent());
  const [contentSaving, setContentSaving] = useState(false);
  const [contentError, setContentError] = useState("");
  const previousRef = useRef<PublicState | null>(null);
  const roomCodeRef = useRef("");
  const seenFireworksRef = useRef(new Set<number>());
  const fireworkTimersRef = useRef<number[]>([]);

  const acceptState = useCallback((next: PublicState) => {
    const previous = previousRef.current;
    if (previous && isStaleState(previous, next)) return false;
    const previousMap = new Map(previous?.participants.map((item) => [item.id, item]) ?? []);
    for (const participant of next.participants) {
      const before = previousMap.get(participant.id);
      const newlyJoined = !before;
      const newlyAnswered = participant.answeredCurrentQuestion && !before?.answeredCurrentQuestion;
      if (newlyJoined || newlyAnswered) {
        setArrival({
          key: `${next.generation}-${next.phase}-${participant.id}-${Date.now()}`,
          participantId: participant.id,
          color: participant.color,
        });
      }
    }
    if (previous?.targetCount !== next.targetCount && next.targetCount > 0) {
      setTargetDraft(String(next.targetCount));
    }
    previousRef.current = next;
    setState(next);
    setConnected(true);
    return true;
  }, []);

  const acceptHostState = useCallback((next: PublicState & { joinCode?: string }) => {
    const previous = previousRef.current;
    if (!acceptState(next)) return;
    const finaleJustCompleted = previous?.phase !== "complete" && next.phase === "complete";
    const finaleFireworks: PublicFirework[] = finaleJustCompleted
      ? Array.from({ length: 14 }, (_, index) => ({
          id: -(Date.now() + index),
          x: 0.1 + ((index * 37) % 80) / 100,
          y: 0.12 + ((index * 23) % 52) / 100,
          color: ["#4fc3ff", "#f8d343", "#ff624d", "#a9e64d"][index % 4] ?? "#ffffff",
        }))
      : [];
    const incoming = [
      ...next.fireworks.filter((firework) => !seenFireworksRef.current.has(firework.id)),
      ...finaleFireworks,
    ];
    if (incoming.length > 0) {
      for (const firework of next.fireworks) seenFireworksRef.current.add(firework.id);
      setActiveFireworks((current) => [...current, ...incoming].slice(-80));
      for (const firework of incoming) {
        const timer = window.setTimeout(() => {
          setActiveFireworks((current) => current.filter((item) => item.id !== firework.id));
        }, 1_650);
        fireworkTimersRef.current.push(timer);
      }
    }
    if (!next.joinCode || next.joinCode === roomCodeRef.current) return;
    roomCodeRef.current = next.joinCode;
    const url = `${location.origin}/join?room=${next.joinCode}`;
    void QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#090b0d", light: "#f5f1e8" } })
      .then((dataUrl) => {
        setJoinUrl(url);
        setQr(dataUrl);
      });
  }, [acceptState]);

  useEffect(() => () => {
    for (const timer of fireworkTimersRef.current) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!contentOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContentOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [contentOpen]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await postHost("tick");
        if (active) acceptHostState(response);
      } catch {
        if (active) setConnected(false);
      }
    };
    void poll();
    const timer = window.setInterval(poll, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [acceptHostState]);

  const control = async (action: "next" | "fire" | "reset") => {
    try {
      acceptHostState(await postHost(action));
    } catch (error) {
      if (error instanceof HostAuthError && error.status === 401) {
        location.href = `/signin-with-chatgpt?return_to=${encodeURIComponent("/host")}`;
        return;
      }
      if (error instanceof HostAuthError && error.status === 403) setControlLocked(true);
      setConnected(false);
    }
  };

  const configureRoom = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetCount = Number.parseInt(targetDraft, 10);
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 500) return;
    setConfiguring(true);
    setConfigError("");
    try {
      acceptHostState(await postHost("configure-room", { targetCount }));
    } catch (error) {
      if (error instanceof HostAuthError && error.status === 401) {
        location.href = `/signin-with-chatgpt?return_to=${encodeURIComponent("/host")}`;
      } else if (error instanceof HostAuthError && error.code === "target-below-participants") {
        setConfigError("参加済み人数以上を入力してください");
      } else {
        setConnected(false);
      }
    } finally {
      setConfiguring(false);
    }
  };

  const targetMinimum = Math.max(1, state.participantCount);
  const parsedTargetDraft = Number.parseInt(targetDraft, 10);
  const previewTarget = Math.min(500, Math.max(targetMinimum, Number.isInteger(parsedTargetDraft) ? parsedTargetDraft : targetMinimum));
  const previewDotCount = Math.max(state.smile.minimumDotCount, previewTarget);
  const adjustTarget = (delta: number) => {
    setTargetDraft((current) => {
      const parsed = Number.parseInt(current, 10);
      const next = Math.min(500, Math.max(targetMinimum, (Number.isInteger(parsed) ? parsed : targetMinimum) + delta));
      return String(next);
    });
  };
  const normalizeTargetDraft = () => {
    const parsed = Number.parseInt(targetDraft, 10);
    setTargetDraft(String(Math.min(500, Math.max(targetMinimum, Number.isInteger(parsed) ? parsed : targetMinimum))));
  };
  const openContentSettings = () => {
    setContentDraft({
      questions: state.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option })),
      })),
      finalePunchline: state.finalePunchline,
    });
    setContentError("");
    setContentOpen(true);
  };
  const updateQuestionPrompt = (questionIndex: number, prompt: string) => {
    setContentDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => index === questionIndex ? { ...question, prompt } : question),
    }));
  };
  const updateOptionLabel = (questionIndex: number, optionIndex: number, label: string) => {
    setContentDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => index === questionIndex
        ? { ...question, options: question.options.map((option, innerIndex) => innerIndex === optionIndex ? { ...option, label } : option) }
        : question),
    }));
  };
  const saveContent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setContentSaving(true);
    setContentError("");
    try {
      acceptHostState(await postHost("configure-content", { content: contentDraft }));
      setContentOpen(false);
    } catch (error) {
      if (error instanceof HostAuthError && error.status === 401) {
        location.href = `/signin-with-chatgpt?return_to=${encodeURIComponent("/host")}`;
      } else {
        setContentError("入力内容を確認してください");
      }
    } finally {
      setContentSaving(false);
    }
  };

  const speak = () => {
    if (!state.collectiveLine) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(state.collectiveLine);
    utterance.lang = "ja-JP";
    utterance.rate = 1.04;
    speechSynthesis.speak(utterance);
  };

  const content = hostCopy(state);
  const question = questionForPhase(state.phase, state.questions);
  const answered = question
    ? state.participants.filter((participant) => participant.answeredCurrentQuestion).length
    : 0;
  const finalePercent = Math.round(state.finale.progress * 100);
  const copyText = question?.prompt ?? (state.phase === "reveal" ? state.collectiveLine ?? "" : state.phase === "complete" ? state.finalePunchline : "");

  return (
    <div className="host-shell" data-phase={state.phase}>
      <header className="host-header">
        <div className="wordmark">MINNA<span>.exe</span></div>
        <div className="connection-readout">
          <Users size={18} /><strong>{state.participantCount}</strong><span>/ {state.targetCount || "-"} JOINED</span>
        </div>
      </header>
      <main className="host-main">
        <ParticleStage
          participants={state.participants}
          arrival={arrival}
          dotCount={state.smile.dotCount}
          filledDotCount={state.smile.filledDotCount}
          faceCenter={state.phase === "lobby" ? 0.56 : 0.7}
          celebrate={state.smile.complete || (state.phase === "complete" && state.finale.special)}
        />
        <div className="fireworks-layer" aria-hidden="true">
          {activeFireworks.map((firework) => <FireworkBurst key={firework.id} firework={firework} />)}
        </div>
        <section className={`host-copy ${copyLengthClass(copyText)}`} aria-live="polite">
          <p className="phase-marker">{content.marker}</p>
          <h1>{content.title}</h1>
          <p className="host-subtitle">{content.subtitle}</p>
          {question && (
            <div className="answer-progress">
              <span>{answered} / {state.participantCount} ANSWERED</span>
              <div><i style={{ width: `${state.participantCount ? (answered / state.participantCount) * 100 : 0}%` }} /></div>
            </div>
          )}
        </section>

        {state.phase === "lobby" && (
          <aside className="join-panel">
            <form className="room-size-form" onSubmit={configureRoom}>
              <label htmlFor="room-size"><Users size={17} />会場人数</label>
              <div className="room-stepper-row">
                <div
                  className="room-number-control"
                  onWheel={(event) => {
                    event.preventDefault();
                    adjustTarget(event.deltaY < 0 ? 1 : -1);
                  }}
                >
                  <input
                    id="room-size"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={targetDraft}
                    onChange={(event) => setTargetDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
                    onBlur={normalizeTargetDraft}
                    aria-label="会場人数"
                  />
                  <div className="stepper-buttons">
                    <button type="button" onClick={() => adjustTarget(1)} aria-label="会場人数を1人増やす" title="1人増やす"><ChevronUp /></button>
                    <button type="button" onClick={() => adjustTarget(-1)} aria-label="会場人数を1人減らす" title="1人減らす"><ChevronDown /></button>
                  </div>
                </div>
                <button type="submit" disabled={configuring} aria-label="会場人数を設定" title="会場人数を設定"><Check /></button>
              </div>
              <div className="room-number-meta">
                <span>{previewDotCount} DOT SMILE</span>
                <span className="wheel-cue" title="マウスホイールでも変更できます" aria-label="マウスホイールでも人数を変更できます"><Mouse /><span>SCROLL</span><ChevronsUpDown /></span>
              </div>
              {configError && <p className="room-size-error" role="alert">{configError}</p>}
            </form>
            <button className="content-settings-trigger" type="button" onClick={openContentSettings}>
              <ListChecks /><span>質問と最後のオチ</span><ChevronRight />
            </button>
            {state.targetCount > 0 && (
              <>
                <div className="join-panel-title"><QrCode size={18} /><span>SCAN TO JOIN</span></div>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
                {qr ? <img className="join-qr" src={qr} alt="観客参加用QRコード" /> : <div className="qr-placeholder" />}
                <div className="join-url">{joinUrl}</div>
                <div className="join-steps">QR <span>→</span> 1 TAP <span>→</span> YOUR PARTICLE</div>
              </>
            )}
          </aside>
        )}

        {state.phase === "finale" && (
          <section className="finale-meter">
            <div className="meter-label"><span>ROOM ENERGY</span><strong>{finalePercent}%</strong></div>
            <div className="meter-track"><div className="meter-fill" style={{ width: `${finalePercent}%` }} /></div>
            <div className="meter-count">{state.finale.completed} / {state.finale.denominator} COMPLETE</div>
          </section>
        )}
      </main>
      {contentOpen && (
        <div className="host-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setContentOpen(false); }}>
          <form className="content-dialog" onSubmit={saveContent} role="dialog" aria-modal="true" aria-labelledby="content-dialog-title">
            <header>
              <div><p>ROOM CONTENT</p><h2 id="content-dialog-title">質問と最後のオチ</h2></div>
              <IconButton type="button" label="設定を閉じる" onClick={() => setContentOpen(false)}><X /></IconButton>
            </header>
            <div className="content-dialog-scroll">
              {contentDraft.questions.map((draftQuestion, questionIndex) => (
                <fieldset className="question-editor" key={draftQuestion.id}>
                  <legend>{draftQuestion.eyebrow}</legend>
                  <label>
                    <span>質問</span>
                    <textarea maxLength={80} value={draftQuestion.prompt} onChange={(event) => updateQuestionPrompt(questionIndex, event.target.value)} required />
                  </label>
                  <div className="option-edit-grid">
                    {draftQuestion.options.map((option, optionIndex) => (
                      <label key={option.id}>
                        <span>選択肢 {optionIndex + 1}</span>
                        <input maxLength={24} value={option.label} onChange={(event) => updateOptionLabel(questionIndex, optionIndex, event.target.value)} required />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <label className="punchline-editor">
                <span>FINAL PUNCHLINE</span>
                <textarea maxLength={120} value={contentDraft.finalePunchline} onChange={(event) => setContentDraft((current) => ({ ...current, finalePunchline: event.target.value }))} required />
              </label>
              {contentError && <p className="content-error" role="alert">{contentError}</p>}
            </div>
            <footer>
              <button type="button" className="dialog-cancel" onClick={() => setContentOpen(false)}>キャンセル</button>
              <button type="submit" className="dialog-save" disabled={contentSaving}><Save />保存</button>
            </footer>
          </form>
        </div>
      )}
      <footer className="host-controls">
        <div className="control-status"><span className={`status-dot ${connected && !controlLocked ? "" : "offline"}`} />{controlLocked ? "CONTROL LOCKED" : connected ? "LIVE" : "RECONNECTING"}</div>
        <div className="control-actions">
          <IconButton label="セリフを再生" disabled={!state.collectiveLine} onClick={speak}><Volume2 /></IconButton>
          <IconButton label="次へ進む" accent disabled={state.targetCount === 0 || state.phase === "finale" || state.phase === "complete"} onClick={() => void control("next")}><ArrowRight /></IconButton>
          <IconButton label="フィナーレを発火" hot disabled={state.phase !== "finale"} onClick={() => void control("fire")}><Zap /></IconButton>
          <IconButton label="最初からやり直す" onClick={() => void control("reset")}><RotateCcw /></IconButton>
        </div>
      </footer>
    </div>
  );
}

function AudienceExperience() {
  const [state, setState] = useState(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [fireworkSending, setFireworkSending] = useState(false);
  const [answered, setAnswered] = useState("");
  const [holdRatio, setHoldRatio] = useState(0);
  const clientId = useSyncExternalStore(noopSubscribe, getClientId, serverClientId);
  const roomCode = useSyncExternalStore(noopSubscribe, getRoomCode, serverRoomCode);
  const identity = useMemo(() => identityForClient(clientId), [clientId]);
  const phaseRef = useRef(state.phase);
  const previousRef = useRef<PublicState | null>(null);
  const holdStartedRef = useRef(0);
  const holdFrameRef = useRef(0);

  const acceptState = useCallback((next: PublicState) => {
    const previous = previousRef.current;
    if (previous && isStaleState(previous, next)) return;
    if (phaseRef.current !== next.phase) setAnswered("");
    phaseRef.current = next.phase;
    previousRef.current = next;
    setState(next);
    setConnected(true);
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    let active = true;
    const join = async () => {
      try {
        const next = await postAudience("join", clientId, roomCode);
        if (active) acceptState(next);
      } catch {
        if (active) setConnected(false);
      }
    };
    const poll = async () => {
      try {
        const response = await fetch(`/api/session?room=${encodeURIComponent(roomCode)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("sync failed");
        if (active) acceptState((await response.json()) as PublicState);
      } catch {
        if (active) setConnected(false);
      }
    };
    const heartbeat = async () => {
      try {
        await postAudience("heartbeat", clientId, roomCode);
      } catch {
        if (active) setConnected(false);
      }
    };
    void join();
    const pollTimer = window.setInterval(poll, 1_500);
    const heartbeatTimer = window.setInterval(heartbeat, 5_000);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      window.clearInterval(heartbeatTimer);
    };
  }, [acceptState, clientId, roomCode]);

  const answer = async (questionId: string, optionId: string) => {
    setSending(true);
    try {
      const next = await postAudience("answer", clientId, roomCode, { questionId, optionId });
      setAnswered(questionId);
      acceptState(next);
    } finally {
      setSending(false);
    }
  };

  const startHold = () => {
    holdStartedRef.current = performance.now();
    setHoldRatio(0.01);
    void postAudience("hold-start", clientId, roomCode);
    const draw = () => {
      const ratio = Math.min(1, (performance.now() - holdStartedRef.current) / 3_000);
      setHoldRatio(ratio);
      if (ratio < 1) holdFrameRef.current = requestAnimationFrame(draw);
    };
    holdFrameRef.current = requestAnimationFrame(draw);
  };
  const stopHold = () => {
    cancelAnimationFrame(holdFrameRef.current);
    void postAudience("hold-stop", clientId, roomCode).then(acceptState);
    setHoldRatio(0);
  };

  const launchFirework = async () => {
    if (!connected || fireworkSending) return;
    setFireworkSending(true);
    try {
      await postAudience("firework", clientId, roomCode);
    } catch {
      setConnected(false);
    } finally {
      window.setTimeout(() => setFireworkSending(false), 700);
    }
  };

  const question = questionForPhase(state.phase, state.questions);
  const self = state.participants.find((participant) => participant.id === identity.publicId);
  const alreadyAnswered = Boolean(question && (answered === question.id || self?.answeredCurrentQuestion));

  if (!roomCode) {
    return (
      <div className="audience-shell">
        <header className="audience-header"><div className="wordmark">MINNA<span>.exe</span></div></header>
        <main className="audience-main">
          <AudienceMessage eyebrow="INVITE REQUIRED" title={<>投影画面のQRを<br />読み取ってください。</>} text="このページは会場のQRから参加できます。" />
        </main>
        <footer className="audience-footer"><span className="status-dot offline" />WAITING FOR INVITE</footer>
      </div>
    );
  }

  return (
    <div className="audience-shell" data-phase={state.phase} style={{ "--personal": identity.color } as React.CSSProperties}>
      <header className="audience-header">
        <div className="wordmark">MINNA<span>.exe</span></div>
        <div className="personal-mark"><span className="personal-dot" />YOUR PARTICLE</div>
      </header>
      <main className="audience-main">
        {state.phase === "lobby" && <AudienceMessage eyebrow={state.smile.complete ? "SMILE COMPLETE" : "YOU ARE IN"} title={state.smile.complete ? <>全員集合。<br />ニッコリ完成。</> : <>あなたの粒を<br />受け取りました。</>} text={`${state.participantCount} / ${state.targetCount} JOINED`} orb />}
        {question && !alreadyAnswered && (
          <section className="audience-state question-state">
            <p className="audience-eyebrow">{question.eyebrow}</p>
            <h1 className={copyLengthClass(question.prompt)}>{question.prompt}</h1>
            <div className={`answer-grid ${question.options.length === 3 ? "three" : ""}`}>
              {question.options.map((option) => (
                <button className={copyLengthClass(option.label, 10, 18)} key={option.id} disabled={sending} onClick={() => void answer(question.id, option.id)}>{option.label}</button>
              ))}
            </div>
          </section>
        )}
        {question && alreadyAnswered && <AudienceMessage eyebrow="PARTICLE SENT" title={<>あなたの粒が<br />入りました。</>} text="大画面で同じ色を探してください。" launch />}
        {state.phase === "reveal" && <AudienceMessage eyebrow="MINNA.exe IS ALIVE" title={<>みんなで、<br />ひとりになりました。</>} text={state.collectiveLine ?? ""} orb />}
        {state.phase === "finale" && (
          <section className="audience-state finale-state">
            <p className="audience-eyebrow">FINAL SYNC</p>
            <h1>3秒、長押し。</h1>
            <button
              className={`hold-button ${holdRatio > 0 ? "holding" : ""}`}
              aria-label="長押ししてエネルギーを送る"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startHold(); }}
              onPointerUp={stopHold}
              onPointerCancel={stopHold}
            >
              <span className="hold-progress" style={{ transform: `scaleY(${holdRatio})` }} />
              <Sparkles /><strong>HOLD</strong>
            </button>
            <p>離すとリセットされます。</p>
          </section>
        )}
        {state.phase === "complete" && <AudienceMessage eyebrow={`MINNA-${state.participantCount}B / TRAINING COMPLETE`} title={<>この会場、<br />全員でひとりのAI。</>} text={state.finalePunchline} orb />}
      </main>
      <footer className="audience-footer">
        <div className="audience-connection"><span className={`status-dot ${connected ? "" : "offline"}`} />{connected ? "CONNECTED" : "RECONNECTING"}</div>
        <button
          className={`firework-button ${fireworkSending ? "launching" : ""}`}
          type="button"
          disabled={!connected || fireworkSending}
          onClick={() => void launchFirework()}
          aria-label="司会画面に花火を打ち上げる"
          title="花火を打ち上げる"
        >
          <PartyPopper />
          <span>花火</span>
        </button>
      </footer>
    </div>
  );
}

function FireworkBurst({ firework }: { firework: PublicFirework }) {
  return (
    <div
      className="firework-burst"
      style={{
        left: `${firework.x * 100}%`,
        top: `${firework.y * 100}%`,
        "--firework-color": firework.color,
      } as React.CSSProperties}
    >
      <span className="firework-flash" />
      <span className="firework-ring" />
      {Array.from({ length: 20 }, (_, index) => (
        <i
          key={index}
          style={{
            "--spark-angle": `${index * 18}deg`,
            "--spark-distance": `${72 + (index % 4) * 18}px`,
            "--spark-delay": `${(index % 3) * 24}ms`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function AudienceMessage({ eyebrow, title, text, orb, launch }: { eyebrow: string; title: React.ReactNode; text: string; orb?: boolean; launch?: boolean }) {
  return (
    <section className="audience-state message-state">
      {orb && <div className="personal-orb" />}
      {launch && <div className="particle-launch" />}
      <p className="audience-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

function IconButton({ label, children, accent, hot, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; accent?: boolean; hot?: boolean }) {
  return <button className={`icon-button ${accent ? "accent" : ""} ${hot ? "hot" : ""}`} aria-label={label} title={label} {...props}>{children}</button>;
}

function hostCopy(state: PublicState) {
  const question = questionForPhase(state.phase, state.questions);
  if (state.targetCount === 0) return { marker: "ROOM SETUP", title: <>会場人数を、<br />入力。</>, subtitle: "1〜500 PEOPLE" };
  if (state.phase === "lobby" && state.smile.complete) return { marker: "EVERYONE IS HERE", title: <>ニッコリ、<br />完成。</>, subtitle: `${state.participantCount} / ${state.targetCount} JOINED` };
  if (state.phase === "lobby") return { marker: "WAITING ROOM", title: <>会場を、<br />ひとりにする。</>, subtitle: `あと ${Math.max(0, state.targetCount - state.participantCount)} 人で完成` };
  if (question) return { marker: question.eyebrow, title: question.prompt, subtitle: "READY" };
  if (state.phase === "reveal") return { marker: "MINNA.exe IS ALIVE", title: state.collectiveLine ?? "MINNA.exe", subtitle: "WE ARE ONE ROOM" };
  if (state.phase === "finale") return { marker: "FINAL SYNC", title: "3秒、みんなで長押し。", subtitle: "顔にエネルギーを送ってください。" };
  return {
    marker: `MINNA-${state.participantCount}B / TRAINING COMPLETE`,
    title: <>この会場、<br />全員でひとりのAI。</>,
    subtitle: state.finalePunchline,
  };
}

const PHASE_ORDER: PublicState["phase"][] = [
  "lobby",
  "question-1",
  "question-2",
  "question-3",
  "question-4",
  "question-5",
  "reveal",
  "finale",
  "complete",
];

function isStaleState(previous: PublicState, next: PublicState) {
  if (next.generation !== previous.generation) return next.generation < previous.generation;
  if (next.updatedAt !== previous.updatedAt) return next.updatedAt < previous.updatedAt;
  return PHASE_ORDER.indexOf(next.phase) < PHASE_ORDER.indexOf(previous.phase);
}

function copyLengthClass(value: string, longAt = 32, extraLongAt = 60) {
  if (value.length > extraLongAt) return "copy-extra-long";
  if (value.length > longAt) return "copy-long";
  return "";
}

function getClientId() {
  const roomCode = getRoomCode();
  const storageKey = roomCode ? `minna-sites-client-id:${roomCode}` : "minna-sites-client-id";
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(storageKey, created);
  return created;
}

function noopSubscribe() {
  return () => undefined;
}

function serverClientId() {
  return "00000000-0000-4000-8000-000000000000";
}

function getRoomCode() {
  const fromUrl = new URLSearchParams(location.search).get("room");
  if (fromUrl && /^[0-9a-f]{64}$/.test(fromUrl)) {
    sessionStorage.setItem("minna-sites-room", fromUrl);
    return fromUrl;
  }
  const stored = sessionStorage.getItem("minna-sites-room");
  if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  sessionStorage.removeItem("minna-sites-room");
  return "";
}

function serverRoomCode() {
  return "";
}

async function postAudience(
  action: string,
  clientId: string,
  roomCode: string,
  extra: Record<string, string> = {},
) {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, clientId, roomCode, ...extra }),
  });
  if (!response.ok) throw new Error("Audience action failed");
  return response.json() as Promise<PublicState>;
}

async function postHost(action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "request-failed" })) as { error?: string };
    throw new HostAuthError(response.status, payload.error ?? "request-failed");
  }
  return response.json() as Promise<PublicState & { joinCode?: string }>;
}

class HostAuthError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Host request failed: ${status}`);
  }
}
