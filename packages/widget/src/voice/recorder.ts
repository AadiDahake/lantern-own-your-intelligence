/** Microphone capture for the composer. Off until the user turns voice on. */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  static get supported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }

  /**
   * Whether the microphone is already granted for this origin.
   *
   * Only used to decide if a call may pick itself back up after a page load: asking for the
   * microphone with no click behind it would either be refused or pop a prompt nobody asked for.
   * Browsers that cannot answer count as no.
   */
  static async alreadyAllowed(): Promise<boolean> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return status.state === 'granted';
    } catch {
      return false;
    }
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  private audio: AudioContext | null = null;
  private silenceTimer: number | null = null;

  /**
   * Starts listening. `onSilence` fires once the speaker has clearly stopped,
   * which is how a phone keyboard behaves: you talk, you pause, it submits.
   */
  async start(onSilence?: () => void): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, pickOptions());
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.recorder.start(250);
    if (onSilence) this.watchForSilence(onSilence);
  }

  /** Ends the turn after a pause, but only once speech has actually started. */
  private watchForSilence(onSilence: () => void): void {
    if (!this.stream) return;
    type WindowWithLegacyAudio = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WindowWithLegacyAudio).webkitAudioContext;
    if (!Ctor) return;
    this.audio = new Ctor();
    const source = this.audio.createMediaStreamSource(this.stream);
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let heardSpeech = false;
    let quietSince = 0;

    const tick = (): void => {
      if (!this.recording) return;
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      const speaking = peak > 6;
      const now = Date.now();
      if (speaking) {
        heardSpeech = true;
        quietSince = 0;
      } else if (heardSpeech) {
        if (quietSince === 0) quietSince = now;
        else if (now - quietSince > 2600) {
          onSilence();
          return;
        }
      }
      this.silenceTimer = window.setTimeout(tick, 120);
    };
    tick();
  }

  /** Resolves with the recorded audio, or null when nothing was captured. */
  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.release();
      return null;
    }
    const audio = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })),
        { once: true },
      );
      recorder.stop();
    });
    this.release();
    return audio.size > 0 ? audio : null;
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private release(): void {
    if (this.silenceTimer !== null) window.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

function pickOptions(): MediaRecorderOptions {
  for (const mimeType of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported?.(mimeType)) return { mimeType };
  }
  return {};
}
