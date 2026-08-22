import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassPanel } from '@/components/glass-panel';
import { SmileMark } from '@/components/smile-mark';
import { useMinnaSession } from '@/hooks/use-minna-session';
import { incomingRoomDecision } from '@/lib/deep-link';
import { HoldAttemptGate } from '@/lib/hold-attempt';
import { parseRoomCode, questionForPhase, type PublicQuestion, type PublicState } from '@/lib/minna';

const STORED_ROOM_KEY = 'minna-mobile-room';

export default function MinnaApp() {
  const incomingUrl = Linking.useURL();
  const [roomInput, setRoomInput] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [initialUrl] = useState(incomingUrl);
  const consumedUrlRef = useRef(initialUrl);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const fromLink = parseRoomCode(initialUrl);
        const stored = parseRoomCode(await AsyncStorage.getItem(STORED_ROOM_KEY));
        const next = fromLink ?? stored;
        if (!active) return;
        if (next) {
          setRoomInput(next);
          setRoomCode(next);
        }
      } catch {
        if (active) setEntryError('保存済みの会場を読み込めませんでした');
      } finally {
        if (active) setHydrated(true);
      }
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, [initialUrl]);

  useEffect(() => {
    if (!hydrated) return;
    const decision = incomingRoomDecision(incomingUrl, consumedUrlRef.current, roomCode);
    consumedUrlRef.current = decision.consumedUrl;
    if (decision.action === 'ignore' || !decision.roomCode) return;
    const fromLink = decision.roomCode;
    const activate = () => {
      void AsyncStorage.setItem(STORED_ROOM_KEY, fromLink).then(() => {
        setRoomInput(fromLink);
        setRoomCode(fromLink);
        setEntryError(null);
      });
    };
    if (decision.action === 'activate') {
      activate();
      return;
    }
    Alert.alert('別の会場へ移動', '新しい会場コードを受け取りました。移動しますか？', [
      { text: 'このまま', style: 'cancel' },
      { text: '移動', onPress: activate },
    ]);
  }, [hydrated, incomingUrl, roomCode]);

  const enterRoom = useCallback(() => {
    const parsed = parseRoomCode(roomInput);
    if (!parsed) {
      setEntryError('URLまたは64桁の会場コードを確認してください');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    setEntryError(null);
    setRoomInput(parsed);
    setRoomCode(parsed);
    void AsyncStorage.setItem(STORED_ROOM_KEY, parsed);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }, [roomInput]);

  const leaveRoom = useCallback(() => {
    Alert.alert('会場から退出', '別の会場コードを入力しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          setRoomCode(null);
          setRoomInput('');
          setEntryError(null);
          void AsyncStorage.removeItem(STORED_ROOM_KEY);
        },
      },
    ]);
  }, []);

  return (
    <LinearGradient colors={['#050609', '#101722', '#20101f', '#07191a']} style={styles.background}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {!roomCode ? (
          <EntryScreen
            error={entryError}
            hydrated={hydrated}
            onChange={setRoomInput}
            onSubmit={enterRoom}
            value={roomInput}
          />
        ) : (
          <ConnectedSession key={roomCode} onLeave={leaveRoom} roomCode={roomCode} />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

function ConnectedSession({ onLeave, roomCode }: { onLeave: () => void; roomCode: string }) {
  const session = useMinnaSession(roomCode);
  return <SessionScreen onLeave={onLeave} {...session} />;
}

function EntryScreen({
  error,
  hydrated,
  onChange,
  onSubmit,
  value,
}: {
  error: string | null;
  hydrated: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.entryScreen}
    >
      <BrandHeader />
      <ScrollView
        contentContainerStyle={styles.entryContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SmileMark color="#4de2e8" dotCount={32} filledDotCount={6} size={180} />
        <View style={styles.entryCopy}>
          <Text style={styles.eyebrow}>MINNA MOBILE</Text>
          <Text style={styles.entryTitle}>会場コードで参加</Text>
        </View>
        <GlassPanel style={styles.roomPanel}>
          <View style={styles.inputLabelRow}>
            <Ionicons color="#8f9aa8" name="key-outline" size={18} />
            <Text style={styles.inputLabel}>会場コード</Text>
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={hydrated}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            placeholder="URLまたはコードを貼り付け"
            placeholderTextColor="#65707e"
            returnKeyType="go"
            selectionColor="#4de2e8"
            style={styles.roomInput}
            value={value}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            accessibilityLabel="会場に参加"
            disabled={!hydrated}
            onPress={onSubmit}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>参加する</Text>
            <Ionicons color="#071012" name="arrow-forward" size={22} />
          </Pressable>
        </GlassPanel>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SessionScreen({
  act,
  error,
  identity,
  onLeave,
  state,
  status,
}: ReturnType<typeof useMinnaSession> & { onLeave: () => void }) {
  const [sendingAnswer, setSendingAnswer] = useState(false);
  const [answerSentFor, setAnswerSentFor] = useState<string | null>(null);
  const [fireworkSending, setFireworkSending] = useState(false);
  const [holdComplete, setHoldComplete] = useState(false);
  const [holdProgress] = useState(() => new Animated.Value(0));
  const [holdGate] = useState(() => new HoldAttemptGate());
  const holdActiveRef = useRef(false);
  const holdCompleteRef = useRef(false);
  const holdStartPromiseRef = useRef<Promise<void> | null>(null);
  const phase = state?.phase;

  const finishHoldAttempt = useCallback((started: Promise<void>) => {
    const sendStop = () => act('hold-stop').then(() => undefined).catch(() => undefined);
    // A timed-out start may still have mutated the server, so stop now, retry, and stop once more after it settles.
    void holdGate.finish(started, sendStop);
  }, [act, holdGate]);

  const stopHold = useCallback(() => {
    if (!holdActiveRef.current && !holdStartPromiseRef.current) return;
    holdActiveRef.current = false;
    holdProgress.stopAnimation();
    const started = holdStartPromiseRef.current;
    holdStartPromiseRef.current = null;
    if (started) finishHoldAttempt(started);
    if (!holdCompleteRef.current) holdProgress.setValue(0);
  }, [finishHoldAttempt, holdProgress]);

  useEffect(() => {
    stopHold();
    const frame = requestAnimationFrame(() => {
      setAnswerSentFor(null);
      setHoldComplete(false);
      holdCompleteRef.current = false;
      holdActiveRef.current = false;
      holdProgress.setValue(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [holdProgress, phase, stopHold]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') stopHold();
    });
    return () => {
      subscription.remove();
      stopHold();
    };
  }, [stopHold]);

  const question = questionForPhase(state);
  const self = state?.participants.find((participant) => participant.id === identity?.publicId);
  const alreadyAnswered = Boolean(
    question && (answerSentFor === question.id || self?.answeredCurrentQuestion),
  );

  const answer = async (current: PublicQuestion, optionId: string) => {
    if (sendingAnswer) return;
    setSendingAnswer(true);
    try {
      await act('answer', { optionId, questionId: current.id });
      setAnswerSentFor(current.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setSendingAnswer(false);
    }
  };

  const launchFirework = async () => {
    if (status !== 'live' || fireworkSending) return;
    setFireworkSending(true);
    try {
      await act('firework');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setTimeout(() => setFireworkSending(false), 650);
    }
  };

  const startHold = () => {
    if (status !== 'live' || holdCompleteRef.current || !holdGate.begin()) return;
    holdActiveRef.current = true;
    holdProgress.setValue(0);
    const started = act('hold-start').then(() => undefined);
    holdStartPromiseRef.current = started;
    void started
      .then(() => {
        if (!holdActiveRef.current) return;
        Animated.timing(holdProgress, {
          duration: 3_000,
          toValue: 1,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished || !holdActiveRef.current) return;
          holdCompleteRef.current = true;
          setHoldComplete(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        });
      })
      .catch(() => {
        if (holdStartPromiseRef.current !== started) return;
        holdActiveRef.current = false;
        holdStartPromiseRef.current = null;
        holdProgress.setValue(0);
        finishHoldAttempt(started);
      });
  };

  return (
    <View style={styles.sessionScreen}>
      <GlassPanel style={styles.sessionHeader}>
        <Brand compact />
        <ConnectionStatus status={status} />
        <Pressable
          accessibilityLabel="会場から退出"
          hitSlop={8}
          onPress={onLeave}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons color="#dce3ea" name="exit-outline" size={23} />
        </Pressable>
      </GlassPanel>

      <ScrollView
        contentContainerStyle={styles.sessionContent}
        showsVerticalScrollIndicator={false}
      >
        {status === 'connecting' && !state ? <LoadingState /> : null}
        {state ? (
          <PhaseContent
            alreadyAnswered={alreadyAnswered}
            holdComplete={holdComplete}
            holdProgress={holdProgress}
            identityColor={identity?.color ?? '#4de2e8'}
            onAnswer={answer}
            onHoldEnd={stopHold}
            onHoldStart={startHold}
            question={question}
            sendingAnswer={sendingAnswer}
            state={state}
          />
        ) : null}
        {error ? <Text style={styles.sessionError}>{error}</Text> : null}
      </ScrollView>

      <GlassPanel style={styles.sessionFooter}>
        <View style={styles.footerCount}>
          <Text style={styles.footerCountValue}>{state?.participantCount ?? 0}</Text>
          <Text style={styles.footerCountLabel}>JOINED</Text>
        </View>
        <Pressable
          accessibilityLabel="司会画面に花火を打ち上げる"
          disabled={status !== 'live' || fireworkSending}
          onPress={launchFirework}
          style={({ pressed }) => [
            styles.fireworkButton,
            status !== 'live' && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons color="#071012" name="sparkles" size={21} />
          <Text style={styles.fireworkText}>{fireworkSending ? '発射中' : '花火'}</Text>
        </Pressable>
      </GlassPanel>
    </View>
  );
}

function PhaseContent({
  alreadyAnswered,
  holdComplete,
  holdProgress,
  identityColor,
  onAnswer,
  onHoldEnd,
  onHoldStart,
  question,
  sendingAnswer,
  state,
}: {
  alreadyAnswered: boolean;
  holdComplete: boolean;
  holdProgress: Animated.Value;
  identityColor: string;
  onAnswer: (question: PublicQuestion, optionId: string) => void;
  onHoldEnd: () => void;
  onHoldStart: () => void;
  question: PublicQuestion | null;
  sendingAnswer: boolean;
  state: PublicState;
}) {
  if (state.phase === 'lobby') {
    return (
      <View style={styles.phaseCenter}>
        <SmileMark
          color={identityColor}
          dotCount={state.smile.dotCount}
          filledDotCount={state.smile.filledDotCount}
        />
        <Text style={styles.eyebrow}>{state.smile.complete ? 'SMILE COMPLETE' : 'YOU ARE IN'}</Text>
        <Text style={styles.phaseTitle}>
          {state.smile.complete ? '全員集合。\nニッコリ完成。' : 'あなたの粒を\n受け取りました。'}
        </Text>
        <Text style={styles.phaseMeta}>{state.participantCount} / {state.targetCount} JOINED</Text>
      </View>
    );
  }

  if (question && !alreadyAnswered) {
    return (
      <View style={styles.questionState}>
        <Text style={styles.eyebrow}>{question.eyebrow}</Text>
        <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={4} style={styles.questionTitle}>
          {question.prompt}
        </Text>
        <View style={styles.answerGrid}>
          {question.options.map((option) => (
            <Pressable
              accessibilityRole="button"
              disabled={sendingAnswer}
              key={option.id}
              onPress={() => onAnswer(question, option.id)}
              style={({ pressed }) => [styles.answerPressable, pressed && styles.pressed]}
            >
              <GlassPanel interactive style={styles.answerButton}>
                <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={2} style={styles.answerText}>
                  {option.label}
                </Text>
                <Ionicons color="#8e9aa7" name="arrow-forward-circle-outline" size={22} />
              </GlassPanel>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  if (question && alreadyAnswered) {
    return (
      <MessageState
        color={identityColor}
        eyebrow="PARTICLE SENT"
        icon="checkmark"
        meta="大画面で同じ色を探してください"
        title={'あなたの粒が\n入りました。'}
      />
    );
  }

  if (state.phase === 'reveal') {
    return (
      <MessageState
        color={identityColor}
        eyebrow="MINNA.exe IS ALIVE"
        icon="people"
        meta={state.collectiveLine ?? ''}
        title={'みんなで、\nひとりになりました。'}
      />
    );
  }

  if (state.phase === 'finale') {
    return (
      <View style={styles.phaseCenter}>
        <Text style={styles.eyebrow}>FINAL SYNC</Text>
        <Text style={styles.phaseTitle}>3秒、長押し。</Text>
        <Pressable
          accessibilityLabel="3秒長押ししてエネルギーを送る"
          accessibilityState={{ disabled: holdComplete }}
          onPressIn={onHoldStart}
          onPressOut={onHoldEnd}
          style={({ pressed }) => [styles.holdPressable, pressed && styles.holdPressed]}
        >
          <GlassPanel interactive style={styles.holdButton}>
            <Animated.View
              style={[
                styles.holdFill,
                { backgroundColor: identityColor, transform: [{ scaleY: holdProgress }] },
              ]}
            />
            <Ionicons color="#ffffff" name={holdComplete ? 'checkmark' : 'finger-print'} size={42} />
            <Text style={styles.holdText}>{holdComplete ? 'SYNCED' : 'HOLD'}</Text>
          </GlassPanel>
        </Pressable>
        <Text style={styles.phaseMeta}>{Math.round(state.finale.progress * 100)}% SYNCED</Text>
      </View>
    );
  }

  return (
    <MessageState
      color={identityColor}
      eyebrow={`MINNA-${state.participantCount}B / COMPLETE`}
      icon="sparkles"
      meta={state.finalePunchline}
      title={'この会場、\n全員でひとりのAI。'}
    />
  );
}

function MessageState({
  color,
  eyebrow,
  icon,
  meta,
  title,
}: {
  color: string;
  eyebrow: string;
  icon: keyof typeof Ionicons.glyphMap;
  meta: string;
  title: string;
}) {
  return (
    <View style={styles.phaseCenter}>
      <View style={[styles.messageIcon, { backgroundColor: color }]}>
        <Ionicons color="#071012" name={icon} size={38} />
      </View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.phaseTitle}>{title}</Text>
      <Text style={styles.messageMeta}>{meta}</Text>
    </View>
  );
}

function LoadingState() {
  return (
    <View style={styles.phaseCenter}>
      <Ionicons color="#4de2e8" name="radio-outline" size={48} />
      <Text style={styles.phaseTitle}>会場に接続中</Text>
    </View>
  );
}

function BrandHeader() {
  return (
    <View style={styles.brandHeader}>
      <Brand />
      <Text style={styles.mobileLabel}>MOBILE</Text>
    </View>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Text style={[styles.brand, compact && styles.brandCompact]}>
      MINNA<Text style={styles.brandSuffix}>.exe</Text>
    </Text>
  );
}

function ConnectionStatus({ status }: { status: ReturnType<typeof useMinnaSession>['status'] }) {
  const live = status === 'live';
  return (
    <View style={styles.connectionStatus}>
      <View style={[styles.statusDot, !live && styles.statusOffline]} />
      <Text style={styles.statusText}>{live ? 'LIVE' : status === 'connecting' ? 'JOINING' : 'RETRY'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  safeArea: { flex: 1 },
  entryScreen: { flex: 1 },
  brandHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 24,
  },
  brand: { color: '#f7f7f2', fontSize: 23, fontWeight: '900' },
  brandCompact: { fontSize: 19 },
  brandSuffix: { color: '#4de2e8' },
  mobileLabel: { color: '#9ca5af', fontSize: 11, fontWeight: '800' },
  entryContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  entryCopy: { alignItems: 'center', marginBottom: 22, marginTop: 8 },
  eyebrow: { color: '#67e9e7', fontSize: 12, fontWeight: '900' },
  entryTitle: { color: '#f7f7f2', fontSize: 30, fontWeight: '900', marginTop: 8 },
  roomPanel: { borderRadius: 8, maxWidth: 520, padding: 18, width: '100%' },
  inputLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 9 },
  inputLabel: { color: '#aeb7c0', fontSize: 13, fontWeight: '800' },
  roomInput: {
    backgroundColor: 'rgba(4,6,10,0.56)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 6,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  errorText: { color: '#ff8da1', fontSize: 13, marginTop: 9 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#4de2e8',
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: '#071012', fontSize: 16, fontWeight: '900', marginRight: 8 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  sessionScreen: { flex: 1, paddingHorizontal: 12 },
  sessionHeader: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 16,
  },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
  connectionStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginLeft: 'auto',
    marginRight: 5,
  },
  statusDot: { backgroundColor: '#47e2ae', borderRadius: 99, height: 8, width: 8 },
  statusOffline: { backgroundColor: '#ff9558' },
  statusText: { color: '#aeb7c0', fontSize: 10, fontWeight: '900' },
  sessionContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 22,
  },
  phaseCenter: { alignItems: 'center', justifyContent: 'center', minHeight: 410 },
  phaseTitle: {
    color: '#f7f7f2',
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 39,
    marginTop: 10,
    textAlign: 'center',
  },
  phaseMeta: { color: '#9ca5af', fontSize: 13, fontWeight: '800', marginTop: 16 },
  questionState: { justifyContent: 'center', minHeight: 410 },
  questionTitle: {
    color: '#f7f7f2',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 38,
    marginBottom: 28,
    marginTop: 10,
  },
  answerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  answerPressable: { minWidth: '47%', flexBasis: '47%', flexGrow: 1 },
  answerButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 70,
    paddingHorizontal: 16,
  },
  answerText: { color: '#ffffff', flex: 1, fontSize: 17, fontWeight: '800', marginRight: 8 },
  messageIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 82,
    justifyContent: 'center',
    marginBottom: 22,
    width: 82,
  },
  messageMeta: {
    color: '#aeb7c0',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 20,
    maxWidth: 520,
    textAlign: 'center',
  },
  holdPressable: { height: 176, marginTop: 30, width: 176 },
  holdPressed: { transform: [{ scale: 0.97 }] },
  holdButton: {
    alignItems: 'center',
    borderRadius: 88,
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  holdFill: {
    bottom: 0,
    height: '100%',
    left: 0,
    opacity: 0.52,
    position: 'absolute',
    right: 0,
    transformOrigin: 'bottom',
  },
  holdText: { color: '#ffffff', fontSize: 17, fontWeight: '900', marginTop: 7 },
  sessionError: { color: '#ffb16e', fontSize: 13, textAlign: 'center' },
  sessionFooter: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 70,
    paddingHorizontal: 16,
  },
  footerCount: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  footerCountValue: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  footerCountLabel: { color: '#8f9aa8', fontSize: 10, fontWeight: '900' },
  fireworkButton: {
    alignItems: 'center',
    backgroundColor: '#ffd447',
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 116,
    paddingHorizontal: 18,
  },
  fireworkText: { color: '#071012', fontSize: 15, fontWeight: '900', marginLeft: 7 },
  disabled: { opacity: 0.42 },
});
