"use client";

import { useEffect, useRef } from "react";
import {
  makeSmileTargets,
  smileTargetIndex,
  type PublicParticipant,
} from "../lib/minna";

export interface Arrival {
  key: string;
  participantId: string;
  color: string;
}

interface FlyingParticle {
  key: string;
  color: string;
  participantId: string;
  startedAt: number;
}

export function ParticleStage({
  participants,
  arrival,
  faceCenter = 0.7,
  celebrate = false,
}: {
  participants: PublicParticipant[];
  arrival: Arrival | null;
  faceCenter?: number;
  celebrate?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const participantsRef = useRef(participants);
  const flyingRef = useRef<FlyingParticle[]>([]);
  const celebrateRef = useRef(false);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    if (!arrival) return;
    flyingRef.current.push({ ...arrival, startedAt: performance.now() });
  }, [arrival]);

  useEffect(() => {
    celebrateRef.current = celebrate;
  }, [celebrate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(box.width * scale));
      canvas.height = Math.max(1, Math.floor(box.height * scale));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (time: number) => {
      const width = canvas.width;
      const height = canvas.height;
      const targets = makeSmileTargets(width, height, faceCenter);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(245,241,232,.08)";
      for (const target of targets) {
        context.beginPath();
        context.arc(target.x, target.y, Math.max(2, width / 700), 0, Math.PI * 2);
        context.fill();
      }

      const current = participantsRef.current;
      const targetFor = (id: string) => {
        const index = current.findIndex((item) => item.id === id);
        return targets[smileTargetIndex(Math.max(0, index), current.length)] ?? {
          x: width * faceCenter,
          y: height * 0.48,
        };
      };
      current.forEach((participant) => {
        const target = targetFor(participant.id);
        context.shadowColor = participant.color;
        context.shadowBlur = celebrateRef.current ? 28 : 14;
        context.fillStyle = participant.color;
        context.beginPath();
        context.arc(target.x, target.y, Math.max(6, width / 260), 0, Math.PI * 2);
        context.fill();
      });
      context.shadowBlur = 0;

      flyingRef.current = flyingRef.current.filter((particle, index) => {
        const progress = Math.min(1, (time - particle.startedAt) / 1_400);
        const eased = 1 - Math.pow(1 - progress, 3);
        const target = targetFor(particle.participantId);
        const edge = index % 4;
        const from = edge === 0
          ? { x: 0, y: height * 0.5 }
          : edge === 1
            ? { x: width, y: height * 0.5 }
            : edge === 2
              ? { x: width * faceCenter, y: 0 }
              : { x: width * faceCenter, y: height };
        const x = from.x + (target.x - from.x) * eased;
        const y = from.y + (target.y - from.y) * eased;
        context.shadowColor = particle.color;
        context.shadowBlur = 30;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(x, y, Math.max(8, width / 220) * (1.8 - progress * 0.8), 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        return progress < 1;
      });

      if (celebrateRef.current) {
        current.forEach((participant, index) => {
          const angle = time / 700 + index * 1.7;
          context.fillStyle = participant.color;
          context.fillRect(
            width * faceCenter + Math.cos(angle) * width * 0.34,
            height * 0.48 + Math.sin(angle) * height * 0.38,
            10,
            6,
          );
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [faceCenter]);

  return <canvas ref={canvasRef} className="particle-stage" aria-label="参加者の粒子で作る集合人格" />;
}
