import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { ApiClient } from '../api/client';
import { GuideMachine, type GuideSnapshot, type Replanned } from '../guide/machine';
import { Spotlight } from '../guide/spotlight';
import { watchPage } from '../guide/navigation';
import { watchTransitions } from '../guide/transitions';
import { scanAffordances, type ScanResult } from '../scan/affordances';
import type { ChatEvent, EscalationStatus, EscalationView, FeedbackRating, Step } from '../types';
import { VoicePlayer } from '../voice/player';
import { VoiceRecorder } from '../voice/recorder';
import { CallBar } from './CallBar';
import { Composer } from './Composer';
import { Launcher } from './Launcher';
import { MessageList } from './MessageList';
import { Panel } from './Panel';
import { CALL_OFF, callReducer, shouldListen } from './call';
import { newTurn, type Turn } from './model';
import { rememberCall, wasInCall } from './session';
import { advanceTowards, FIRST_STAGE, nextStage, STAGE_DWELL_MS, type WorkStage } from './status';

export type LanternApi = {
  open: () => void;
  close: () => void;
  ask: (question: string) => void;
};

export type AppProps = {
  client: ApiClient;
  shadow: ShadowRoot;
  host: HTMLElement;
  position: 'left' | 'right';
  register: (api: LanternApi) => void;
};

const TERMINAL = new Set<EscalationStatus>(['shipped', 'failed', 'rejected']);

const STATUSES: readonly string[] = [
  'queued', 'filing', 'inspecting', 'drafting', 'pr_open', 'awaiting_approval',
  'approved', 'rejected', 'merging', 'deploying', 'shipped', 'failed',
];

function toEscalationStatus(value: string): EscalationStatus {
  return STATUSES.includes(value) ? (value as EscalationStatus) : 'queued';
}

export function App({ client, shadow, host, position, register }: AppProps) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [guidingTurnId, setGuidingTurnId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [unread, setUnread] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  // The turn still waiting for its answer, and how far along the agent said it was.
  const [workingTurnId, setWorkingTurnId] = useState<string | null>(null);
  const [stage, setStage] = useState<WorkStage>(FIRST_STAGE);
  const [shownStage, setShownStage] = useState<WorkStage>(FIRST_STAGE);
  const [workingMs, setWorkingMs] = useState(0);

  const [call, dispatchCall] = useReducer(callReducer, CALL_OFF);
  const [transcript, setTranscript] = useState('');

  const scanRef = useRef<ScanResult | null>(null);
  const conversationRef = useRef<string | undefined>(undefined);
  const machineRef = useRef<GuideMachine | null>(null);
  const spotlightRef = useRef<Spotlight | null>(null);
  const guidedRef = useRef<{ turnId: string; question: string; turn: Turn } | null>(null);
  const counterRef = useRef(0);
  const messageScroll = useRef(-1);
  const callRef = useRef(call);
  callRef.current = call;

  const recorder = useMemo(() => new VoiceRecorder(), []);
  // The player has no idea a call exists; it only reports that a clip ended, and the call
  // machine decides what that means.
  const spokenRef = useRef<() => void>(() => undefined);
  const player = useMemo(() => new VoicePlayer(setSpeaking, () => spokenRef.current()), []);
  spokenRef.current = () => {
    if (callRef.current.active) dispatchCall({ type: 'spoke' });
  };

  const scan = useCallback(
    (question: string): ScanResult => scanAffordances({ question, exclude: host }),
    [host],
  );

  const patch = useCallback((id: string, update: (turn: Turn) => Turn) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? update(turn) : turn)));
  }, []);

  const stopGuidance = useCallback(() => {
    machineRef.current?.stop();
    spotlightRef.current?.hide();
    guidedRef.current = null;
    setGuidingTurnId(null);
  }, []);

  const onGuideChange = useCallback(
    (snapshot: GuideSnapshot) => {
      const spotlight = spotlightRef.current;
      if (!spotlight) return;
      if (snapshot.state === 'DONE' || snapshot.state === 'FAILED') {
        const walked = guidedRef.current?.turn;
        if (snapshot.state === 'DONE' && walked?.answer?.steps?.length) {
          void client.outcome({
            outcome: 'completed',
            question: walked.question,
            feature: walked.feature ?? null,
            answer: walked.answer.text,
            steps: walked.answer.steps,
            conversationId: conversationRef.current ?? null,
            messageId: walked.messageId ?? null,
          });
        }
        spotlight.hide();
        guidedRef.current = null;
        setGuidingTurnId(null);
        setOpen(true);
        setAnnouncement(snapshot.state === 'DONE' ? 'Guidance finished.' : snapshot.message ?? 'Guidance stopped.');
        return;
      }
      // Between steps there is nothing to point at, and a caption left hanging
      // over a control that has gone is worse than no caption.
      if (!snapshot.step || !snapshot.target) {
        spotlight.hide();
        return;
      }
      spotlight.show({
        target: snapshot.target,
        caption: snapshot.step.caption,
        index: snapshot.stepIndex,
        total: snapshot.total,
        isLast: snapshot.stepIndex === snapshot.total - 1,
        busy: snapshot.state !== 'SPOTLIGHTING',
      });
      if (snapshot.state === 'SPOTLIGHTING') {
        // A route change is said out loud: the count the user was given is no longer true.
        const note = snapshot.message ? `${snapshot.message} ` : '';
        setAnnouncement(`${note}Step ${snapshot.stepIndex + 1} of ${snapshot.total}. ${snapshot.step.caption}`);
      }
    },
    [client],
  );

  /**
   * Re-asks the agent for the steps that are left, against the page as it is now. Only reached
   * when a control is really missing; the answer says whether the route had to change.
   */
  const replan = useCallback(
    async (continueFrom: number): Promise<Replanned | null> => {
      const guided = guidedRef.current;
      if (!guided) return null;
      const fresh = scan(guided.question);
      scanRef.current = fresh;
      let steps: Step[] | null = null;
      let routeChanged = false;
      try {
        await client.ask({
          question: guided.question,
          page: fresh.page,
          conversationId: conversationRef.current,
          continueFrom,
          onEvent: (event) => {
            if (event.type !== 'answer') return;
            steps = event.steps;
            routeChanged = event.routeChanged === true;
          },
        });
      } catch {
        return null;
      }
      return steps ? { ...fresh, steps, routeChanged } : null;
    },
    [client, scan],
  );

  const ensureGuide = useCallback(() => {
    if (!spotlightRef.current) {
      spotlightRef.current = new Spotlight(shadow, {
        onNext: () => machineRef.current?.next(),
        onDone: () => machineRef.current?.next(),
        onStop: () => stopGuidance(),
        onLost: () => machineRef.current?.lost(),
      });
    }
    if (!machineRef.current) {
      machineRef.current = new GuideMachine({
        rescan: () => {
          const guided = guidedRef.current;
          const fresh = scan(guided?.question ?? '');
          scanRef.current = fresh;
          return fresh;
        },
        replan,
        onChange: onGuideChange,
        watch: (onPageChanged) => watchPage(onPageChanged, 300),
      });
    }
  }, [onGuideChange, replan, scan, shadow, stopGuidance]);

  const startGuidance = useCallback(
    (turn: Turn) => {
      const steps = turn.answer?.steps;
      const current = scanRef.current;
      if (!steps || steps.length === 0 || !current) return;
      ensureGuide();
      guidedRef.current = { turnId: turn.id, question: turn.question, turn };
      setGuidingTurnId(turn.id);
      // The caption carries the instruction from here, and a panel covering the
      // control the user must click is worse than no panel at all.
      setOpen(false);
      machineRef.current?.start(current, steps);
    },
    [ensureGuide],
  );

  const openRef = useRef(open);
  openRef.current = open;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      setOpen(true);
      setDraft('');
      setBusy(true);

      const id = `t${(counterRef.current += 1)}`;
      let turn = newTurn(id, text);
      setTurns((current) => [...current, turn]);
      setWorkingTurnId(id);
      setStage(FIRST_STAGE);
      setShownStage(FIRST_STAGE);
      setWorkingMs(0);

      const commit = (next: Turn) => {
        turn = next;
        patch(id, () => next);
      };

      const fresh = scan(text);
      scanRef.current = fresh;
      // Build the spotlight while the request is in flight, so the first step
      // appears the moment the answer lands rather than after it is set up.
      ensureGuide();

      try {
        await client.ask({
          question: text,
          page: fresh.page,
          conversationId: conversationRef.current,
          onEvent: (event) => {
            setStage((current) => nextStage(current, event));
            commit(applyEvent(turn, event, conversationRef));
            // The stream stays open past the answer while the agent files its
            // own bookkeeping. Everything the user sees happens on the answer,
            // not on the close.
            if (event.type !== 'answer') return;
            setWorkingTurnId(null);
            if (!openRef.current) setUnread(true);
            if (event.steps?.length) startGuidance(turn);
            // Only a call speaks. In text mode the answer is read, not heard.
            if (callRef.current.active) {
              const spoken = event.text;
              dispatchCall({ type: 'answered' });
              void player.play((signal) => client.speak(spoken, signal));
            } else {
              // Put the caret back where the next question is typed.
              setFocusToken((value) => value + 1);
            }
          },
        });
      } catch {
        commit({ ...turn, error: 'The support service is not reachable right now.' });
      } finally {
        setWorkingTurnId(null);
        setBusy(false);
        // A turn that produced no answer must not leave the call waiting on one.
        if (callRef.current.active && callRef.current.phase === 'thinking') {
          dispatchCall({ type: 'unheard' });
        }
      }
    },
    [busy, client, ensureGuide, patch, player, scan, startGuidance],
  );

  const report = useCallback(
    async (turn: Turn) => {
      const conversationId = conversationRef.current;
      if (!conversationId || !turn.messageId || turn.reporting || turn.escalationId) return;
      patch(turn.id, (current) => ({ ...current, reporting: true, reportBlocked: undefined }));
      try {
        const result = await client.escalate(conversationId, turn.messageId);
        if (!result.ok) {
          patch(turn.id, (current) => ({ ...current, reporting: false, reportBlocked: result.reason }));
          return;
        }
        const { escalationId, status } = result;
        patch(turn.id, (current) => ({
          ...current,
          reporting: false,
          escalationId,
          escalation: { id: escalationId, status: toEscalationStatus(status) },
        }));
        pollEscalation(client, escalationId, (view) => {
          patch(turn.id, (current) => {
            if (current.escalation?.status !== view.status) setElapsedSeconds(0);
            return { ...current, escalation: view };
          });
        });
      } catch {
        patch(turn.id, (current) => ({ ...current, reporting: false, reportBlocked: 'failed' }));
      }
    },
    [client, patch],
  );

  /** Records a thumbs up or down. Shown immediately, taken back only if the write failed. */
  const rate = useCallback(
    async (turn: Turn, rating: FeedbackRating) => {
      const messageId = turn.messageId;
      if (!messageId || turn.rating) return;
      patch(turn.id, (current) => ({ ...current, rating }));
      setAnnouncement('Thank you for the feedback.');
      const stored = await client.feedback(messageId, rating);
      if (!stored) patch(turn.id, (current) => ({ ...current, rating: undefined }));
    },
    [client, patch],
  );

  // A quiet elapsed counter, only while a report is still moving.
  useEffect(() => {
    const active = turns.some((turn) => turn.escalation && !TERMINAL.has(turn.escalation.status));
    if (!active) return;
    const timer = setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [turns]);

  // How long the turn in flight has taken, so the status line can admit when it is slow.
  useEffect(() => {
    if (!workingTurnId) return;
    const started = Date.now();
    const timer = setInterval(() => setWorkingMs(Date.now() - started), 500);
    return () => clearInterval(timer);
  }, [workingTurnId]);

  // The line walks towards whatever the events have already reported, one readable step at a time.
  useEffect(() => {
    if (!workingTurnId) return;
    const timer = setInterval(
      () => setShownStage((current) => advanceTowards(current, stageRef.current)),
      STAGE_DWELL_MS,
    );
    return () => clearInterval(timer);
  }, [workingTurnId]);

  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

  const endCall = useCallback(() => {
    dispatchCall({ type: 'end' });
    rememberCall(false);
    recorder.cancel();
    setRecording(false);
    player.stop();
    setTranscript('');
    setFocusToken((value) => value + 1);
  }, [player, recorder]);

  const startCall = useCallback(() => {
    if (!VoiceRecorder.supported) {
      setAnnouncement('This browser cannot use the microphone.');
      return;
    }
    setOpen(true);
    setTranscript('');
    dispatchCall({ type: 'start' });
    rememberCall(true);
    setAnnouncement('The call has started. Speak when you are ready.');
  }, []);

  /** Closing the panel is also hanging up: audio the user cannot see must not keep playing. */
  const closePanel = useCallback(() => {
    if (callRef.current.active) endCall();
    setOpen(false);
  }, [endCall]);

  // The call was on when this page was left, so pick it back up where it was. Only when the
  // microphone is already granted: a call that opens the panel and then cannot listen is worse
  // than one that quietly ends with the navigation.
  useEffect(() => {
    if (!wasInCall() || !VoiceRecorder.supported) return;
    let cancelled = false;
    void VoiceRecorder.alreadyAllowed().then((allowed) => {
      if (cancelled) return;
      if (!allowed) {
        rememberCall(false);
        return;
      }
      setOpen(true);
      dispatchCall({ type: 'start' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape stops guidance first, then closes the panel, even when focus is on the host page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (guidedRef.current) stopGuidance();
      else if (openRef.current) closePanel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closePanel, stopGuidance]);

  useEffect(() => {
    register({
      open: () => setOpen(true),
      close: () => setOpen(false),
      ask: (question: string) => void ask(question),
    });
  }, [ask, register]);

  useEffect(() => () => {
    machineRef.current?.dispose();
    spotlightRef.current?.destroy();
    player.stop();
    recorder.cancel();
  }, [player, recorder]);

  // The site graph learns from every visit: the page as scanned, and the moves the user makes.
  useEffect(() => {
    const watcher = watchTransitions(client, host);
    return () => watcher.dispose();
  }, [client, host]);

  /** Ends the turn: transcribe what was captured and ask it. */
  const finishRecording = useCallback(async () => {
    setRecording(false);
    let audio: Blob | null = null;
    try {
      audio = await recorder.stop();
    } catch {
      audio = null;
    }
    // Only now is the capture safely out of the recorder, so the call may move on.
    if (callRef.current.active) dispatchCall({ type: 'heard' });

    setTranscribing(true);
    try {
      if (!audio) {
        if (callRef.current.active) dispatchCall({ type: 'unheard' });
        return;
      }
      const text = await client.transcribe(audio);
      if (text) {
        // Show the words back before sending, so a mishearing is visible.
        setTranscript(text);
        setDraft(text);
        void ask(text);
      } else {
        setAnnouncement('I did not catch that. Try again.');
        if (callRef.current.active) dispatchCall({ type: 'unheard' });
      }
    } catch {
      setAnnouncement('The microphone is not available.');
      if (callRef.current.active) dispatchCall({ type: 'unheard' });
    } finally {
      setTranscribing(false);
    }
  }, [ask, client, recorder]);

  const finishRef = useRef(finishRecording);
  finishRef.current = finishRecording;

  // The microphone follows the call machine: it listens whenever the call says it should,
  // and it is released the moment that stops being true.
  useEffect(() => {
    if (!shouldListen(call)) return;
    let cancelled = false;
    void (async () => {
      try {
        await recorder.start(() => void finishRef.current());
        if (cancelled) recorder.cancel();
        else setRecording(true);
      } catch {
        setAnnouncement('Microphone access was declined.');
        dispatchCall({ type: 'end' });
        rememberCall(false);
      }
    })();
    return () => {
      cancelled = true;
      recorder.cancel();
      setRecording(false);
    };
  }, [call, recorder]);

  // One press starts listening. It ends on a pause in speech, or on a second
  // press, which is what people already expect from a phone keyboard.
  const toggleRecording = useCallback(async () => {
    if (recording) {
      await finishRecording();
      return;
    }
    try {
      await recorder.start(() => void finishRef.current());
      setRecording(true);
    } catch {
      setAnnouncement('Microphone access was declined.');
    }
  }, [finishRecording, recorder, recording]);

  // The call bar already says Listening or Thinking; the header only frames it.
  const subtitle = call.active
    ? 'On a call'
    : busy
      ? 'Working on it'
      : 'We can show you on this page';

  return (
    <div class="pl-root" data-position={position}>
      <div class="pl-sr" role="status" aria-live="polite">
        {announcement}
      </div>

      {open && (
        <Panel
          title="Support"
          subtitle={subtitle}
          speaking={speaking && !call.active}
          onCall={call.active || !VoiceRecorder.supported ? undefined : startCall}
          onStopSpeaking={() => player.stop()}
          onClose={closePanel}
          onEscape={() => (guidedRef.current ? stopGuidance() : closePanel())}
        >
          <MessageList
            turns={turns}
            workingTurnId={workingTurnId}
            stage={shownStage}
            workingMs={workingMs}
            guidingTurnId={guidingTurnId}
            elapsedSeconds={elapsedSeconds}
            scroll={messageScroll}
            onShowMe={startGuidance}
            onReport={(turn) => void report(turn)}
            onRate={(turn, rating) => void rate(turn, rating)}
          />
          {call.active ? (
            <CallBar
              state={call}
              transcript={transcript}
              onToggleMute={() => dispatchCall({ type: 'toggleMute' })}
              onEnd={endCall}
            />
          ) : (
            <Composer
              value={draft}
              busy={busy}
              voiceSupported={VoiceRecorder.supported}
              recording={recording}
              transcribing={transcribing}
              focusToken={focusToken}
              onInput={setDraft}
              onSubmit={() => void ask(draft)}
              onToggleRecording={() => void toggleRecording()}
            />
          )}
        </Panel>
      )}

      <Launcher open={open} unread={unread} onClick={() => (open ? closePanel() : setOpen(true))} />
    </div>
  );
}

function applyEvent(turn: Turn, event: ChatEvent, conversationRef: { current: string | undefined }): Turn {
  switch (event.type) {
    case 'conversation':
      conversationRef.current = event.conversationId;
      return { ...turn, messageId: event.messageId };
    case 'understanding':
      return { ...turn, feature: event.feature, memory: event.memory };
    case 'probe':
      return {
        ...turn,
        probes: {
          ...turn.probes,
          [event.probe]:
            event.status === 'running' ? { status: 'running' } : { status: 'done', result: event.result },
        },
      };
    case 'verdict':
      return { ...turn, verdict: event.verdict };
    case 'answer':
      return {
        ...turn,
        answer: {
          text: event.text,
          steps: event.steps,
          escalation: event.escalation,
          noted: event.noted,
          plan: event.plan,
          sources: event.sources,
        },
      };
    case 'error':
      return { ...turn, error: event.message };
  }
}

/** Polls the report until it stops moving. Calm on purpose: every three seconds. */
function pollEscalation(
  client: ApiClient,
  escalationId: string,
  onUpdate: (view: EscalationView) => void,
): void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const view = await client.escalation(escalationId);
      onUpdate(view);
      if (TERMINAL.has(view.status)) {
        stopped = true;
        return;
      }
    } catch {
      // Transient failure; try again on the next tick.
    }
    setTimeout(tick, 3000);
  };
  void tick();
}
