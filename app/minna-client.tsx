"use client";

import {
  ArrowRight,
  PartyPopper,
  QrCode,
  RotateCcw,
  Sparkles,
  Users,
  Volume2,
  Zap,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { identityForClient, questionForPhase, type PublicFirework, type PublicState } from "../lib/minna";
import { ParticleStage, type Arrival } from "./particle-stage";

const EMPTY_STATE: PublicState = {
  phase: "lobby",
  generation: 1,
  participantCount: 0,
  participants: [],
  fireworks: [],
  answerCounts: {},
  collectiveLine: null,
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
  const previousRef = useRef<PublicState | null>(null);
  const roomCodeRef = useRef("");
  const seenFireworksRef = useRef(new Set<number>());
  const fireworkTimersRef = useRef<number[]>([]);

  const acceptState = useCallback((next: PublicState) => {
    const previous = previousRef.current;
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
    previousRef.current = next;
    setState(next);
    setConnected(true);
  }, []);

  const acceptHostState = useCallback((next: PublicState & { joinCode?: string }) => {
    const incoming = next.fireworks.filter((firework) => !seenFireworksRef.current.has(firework.id));
    if (incoming.length > 0) {
      for (const firework of incoming) seenFireworksRef.current.add(firework.id);
      setActiveFireworks((current) => [...current, ...incoming].slice(-80));
      for (const firework of incoming) {
        const timer = window.setTimeout(() => {
          setActiveFireworks((current) => current.filter((item) => item.id !== firework.id));
        }, 1_650);
        fireworkTimersRef.current.push(timer);
      }
    }
    acceptState(next);
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

  const speak = () => {
    if (!state.collectiveLine) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(state.collectiveLine);
    utterance.lang = "ja-JP";
    utterance.rate = 1.04;
    speechSynthesis.speak(utterance);
  };

  const content = hostCopy(state);
  const question = questionForPhase(state.phase);
  const answered = question
    ? state.participants.filter((participant) => participant.answeredCurrentQuestion).length
    : 0;
  const finalePercent = Math.round(state.finale.progress * 100);

  return (
    <div className="host-shell" data-phase={state.phase}>
      <header className="host-header">
        <div className="wordmark">MINNA<span>.exe</span></div>
        <div className="connection-readout">
          <Users size={18} /><strong>{state.participantCount}</strong><span>CONNECTED</span>
        </div>
      </header>
      <main className="host-main">
        <ParticleStage
          participants={state.participants}
          arrival={arrival}
          faceCenter={state.phase === "lobby" ? 0.56 : 0.7}
          celebrate={state.phase === "complete" && state.finale.special}
        />
        <div className="fireworks-layer" aria-hidden="true">
          {activeFireworks.map((firework) => <FireworkBurst key={firework.id} firework={firework} />)}
        </div>
        <section className="host-copy" aria-live="polite">
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
            <div className="join-panel-title"><QrCode size={18} /><span>SCAN TO JOIN</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            {qr ? <img className="join-qr" src={qr} alt="観客参加用QRコード" /> : <div className="qr-placeholder" />}
            <div className="join-url">{joinUrl}</div>
            <div className="join-steps">QR <span>→</span> 1 TAP <span>→</span> YOUR PARTICLE</div>
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
      <footer className="host-controls">
        <div className="control-status"><span className={`status-dot ${connected && !controlLocked ? "" : "offline"}`} />{controlLocked ? "CONTROL LOCKED" : connected ? "LIVE" : "RECONNECTING"}</div>
        <div className="control-actions">
          <IconButton label="セリフを再生" disabled={!state.collectiveLine} onClick={speak}><Volume2 /></IconButton>
          <IconButton label="次へ進む" accent disabled={state.phase === "finale" || state.phase === "complete"} onClick={() => void control("next")}><ArrowRight /></IconButton>
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
  const holdStartedRef = useRef(0);
  const holdFrameRef = useRef(0);

  const acceptState = useCallback((next: PublicState) => {
    if (phaseRef.current !== next.phase) setAnswered("");
    phaseRef.current = next.phase;
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
        const response = await fetch("/api/session", { cache: "no-store" });
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

  const question = questionForPhase(state.phase);
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
    <div className="audience-shell" style={{ "--personal": identity.color } as React.CSSProperties}>
      <header className="audience-header">
        <div className="wordmark">MINNA<span>.exe</span></div>
        <div className="personal-mark"><span className="personal-dot" />YOUR PARTICLE</div>
      </header>
      <main className="audience-main">
        {state.phase === "lobby" && <AudienceMessage eyebrow="YOU ARE IN" title={<>あなたの粒を<br />受け取りました。</>} text="投影画面の合図を待ってください。" orb />}
        {question && !alreadyAnswered && (
          <section className="audience-state question-state">
            <p className="audience-eyebrow">{question.eyebrow}</p>
            <h1>{question.prompt}</h1>
            <div className={`answer-grid ${question.options.length === 3 ? "three" : ""}`}>
              {question.options.map((option) => (
                <button key={option.id} disabled={sending} onClick={() => void answer(question.id, option.id)}>{option.label}</button>
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
        {state.phase === "complete" && <AudienceMessage eyebrow={state.finale.special ? "SPECIAL SYNC" : "MINNA COMPLETE"} title={<>集まってくれて、<br />ありがとう。</>} text="あなたの粒は、顔の中に残っています。" orb />}
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
  const question = questionForPhase(state.phase);
  if (state.phase === "lobby") return { marker: "WAITING ROOM", title: <>会場を、<br />ひとりにする。</>, subtitle: "今から皆さん全員を、ひとりのAI芸人にします。" };
  if (question) return { marker: question.eyebrow, title: question.prompt, subtitle: "READY" };
  if (state.phase === "reveal") return { marker: "MINNA.exe IS ALIVE", title: state.collectiveLine ?? "MINNA.exe", subtitle: "WE ARE ONE ROOM" };
  if (state.phase === "finale") return { marker: "FINAL SYNC", title: "3秒、みんなで長押し。", subtitle: "顔にエネルギーを送ってください。" };
  return { marker: state.finale.special ? "SPECIAL FINALE" : "MINNA COMPLETE", title: "集まってくれて、ありがとう。", subtitle: "AIを使ったのではなく、会場全員がAIになりました。" };
}

function getClientId() {
  const existing = sessionStorage.getItem("minna-sites-client-id");
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem("minna-sites-client-id", created);
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

async function postHost(action: string) {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) throw new HostAuthError(response.status);
  return response.json() as Promise<PublicState & { joinCode?: string }>;
}

class HostAuthError extends Error {
  constructor(readonly status: number) {
    super(`Host request failed: ${status}`);
  }
}
