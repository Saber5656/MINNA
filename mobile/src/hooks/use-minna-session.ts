import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { MinnaApiError, postAudience, readRoom } from '@/lib/api';
import { identityForClient, isStaleState, type PublicState } from '@/lib/minna';
import { runJoinGate } from '@/lib/session-gate';

type SessionStatus = 'connecting' | 'live' | 'offline';

export function useMinnaSession(roomCode: string) {
  const [state, setState] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<SessionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const previousRef = useRef<PublicState | null>(null);

  const acceptState = useCallback((next: PublicState) => {
    const previous = previousRef.current;
    if (previous && isStaleState(previous, next)) return;
    previousRef.current = next;
    setState(next);
    setStatus('live');
    setError(null);
  }, []);

  useEffect(() => {
    previousRef.current = null;
    let active = true;
    let appState: AppStateStatus = AppState.currentState;
    let connectionVersion = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      pollTimer = undefined;
      heartbeatTimer = undefined;
      reconnectTimer = undefined;
    };

    const isCurrent = (version: number) =>
      active && appState === 'active' && connectionVersion === version;

    const markFailure = (cause: unknown) => {
      if (!active) return;
      setStatus('offline');
      if (cause instanceof MinnaApiError && cause.code === 'invalid-room') {
        setError('会場コードを確認してください');
      } else if (cause instanceof MinnaApiError && cause.code === 'room-full') {
        setError('この会場は満員です');
      } else {
        setError('接続を再試行しています');
      }
    };

    const connect = async (id: string) => {
      const version = ++connectionVersion;
      clearTimers();
      setStatus('connecting');

      const poll = async () => {
        try {
          const next = await readRoom(roomCode);
          if (isCurrent(version)) acceptState(next);
        } catch (cause) {
          if (isCurrent(version)) markFailure(cause);
        } finally {
          if (isCurrent(version)) pollTimer = setTimeout(poll, 1_500);
        }
      };

      const heartbeat = async () => {
        try {
          const next = await postAudience('heartbeat', id, roomCode);
          if (isCurrent(version)) acceptState(next);
        } catch (cause) {
          if (isCurrent(version)) markFailure(cause);
        } finally {
          if (isCurrent(version)) heartbeatTimer = setTimeout(heartbeat, 5_000);
        }
      };

      await runJoinGate({
        join: () => postAudience('join', id, roomCode),
        accept: (joined) => {
          if (!isCurrent(version)) return false;
          acceptState(joined);
          return true;
        },
        onFailure: (cause) => {
          if (!isCurrent(version)) return;
          markFailure(cause);
          reconnectTimer = setTimeout(() => void connect(id), 2_000);
        },
        startSync: () => {
          if (!isCurrent(version)) return;
          pollTimer = setTimeout(poll, 1_500);
          heartbeatTimer = setTimeout(heartbeat, 5_000);
        },
      });
    };

    let id: string | null = null;
    const start = async () => {
      id = await getOrCreateClientId(roomCode);
      if (!active) return;
      setClientId(id);
      if (appState === 'active') await connect(id);
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;
      if (nextState !== 'active') {
        connectionVersion += 1;
        clearTimers();
        return;
      }
      if (!wasActive && id) void connect(id);
    });

    void start().catch(markFailure);
    return () => {
      active = false;
      connectionVersion += 1;
      clearTimers();
      subscription.remove();
    };
  }, [acceptState, roomCode]);

  const act = useCallback(
    async (
      action: 'answer' | 'hold-start' | 'hold-stop' | 'firework',
      extra: Record<string, string> = {},
    ) => {
      if (!clientId) throw new Error('session-not-ready');
      try {
        const next = await postAudience(action, clientId, roomCode, extra);
        acceptState(next);
        return next;
      } catch (cause) {
        setStatus('offline');
        throw cause;
      }
    },
    [acceptState, clientId, roomCode],
  );

  const identity = useMemo(
    () => (clientId ? identityForClient(clientId) : null),
    [clientId],
  );

  return { act, error, identity, state, status };
}

async function getOrCreateClientId(roomCode: string) {
  const key = `minna-mobile-client-id:${roomCode}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(key, created);
  return created;
}
