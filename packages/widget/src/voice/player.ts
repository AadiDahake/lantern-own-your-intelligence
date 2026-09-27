/**
 * Plays the mp3 that /api/speak streams back. Uses MediaSource so the first
 * words start before the whole clip has arrived, and falls back to buffering.
 */
export class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private objectUrl: string | null = null;

  /**
   * `onFinished` fires once per `play`, when the clip ends or when it could not play at all.
   * A call listens for it to know when it is its turn to listen again, so it must never be
   * skipped on a failure: a silent hang is worse than a missing sentence.
   */
  constructor(
    private readonly onStateChange: (speaking: boolean) => void,
    private readonly onFinished: () => void = () => undefined,
  ) {}

  /**
   * Identifies the clip that is playing. Every callback checks it before reporting, so a clip
   * that was superseded or deliberately stopped cannot announce an ending that already passed.
   */
  private token = 0;

  get speaking(): boolean {
    return Boolean(this.audio && !this.audio.paused && !this.audio.ended);
  }

  async play(fetchAudio: (signal: AbortSignal) => Promise<Response>): Promise<void> {
    this.stop();
    const token = (this.token += 1);
    const finish = () => {
      if (token !== this.token) return;
      this.token += 1;
      this.onFinished();
    };
    const controller = new AbortController();
    this.abort = controller;
    try {
      const response = await fetchAudio(controller.signal);
      if (!response.body) {
        finish();
        return;
      }
      const audio = new Audio();
      this.audio = audio;
      audio.addEventListener('ended', () => {
        this.onStateChange(false);
        finish();
      });
      audio.addEventListener('error', () => finish());
      audio.addEventListener('pause', () => this.onStateChange(this.speaking));

      if (canStream()) await this.playStreaming(audio, response.body, controller.signal, finish);
      else await this.playBuffered(audio, response, finish);
      this.onStateChange(true);
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        this.onStateChange(false);
        finish();
      }
    }
  }

  /** Silences whatever is playing. Deliberate, so it reports no ending. */
  stop(): void {
    this.token += 1;
    this.abort?.abort();
    this.abort = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.onStateChange(false);
  }

  private async playStreaming(
    audio: HTMLAudioElement,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    onBlocked: () => void,
  ): Promise<void> {
    const media = new MediaSource();
    this.objectUrl = URL.createObjectURL(media);
    audio.src = this.objectUrl;
    await new Promise<void>((resolve) => media.addEventListener('sourceopen', () => resolve(), { once: true }));
    const buffer = media.addSourceBuffer('audio/mpeg');
    const reader = body.getReader();
    let started = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      await appendChunk(buffer, value);
      if (!started) {
        started = true;
        // A browser that refuses to autoplay would otherwise leave a caller waiting
        // for a clip that never ends.
        void audio.play().catch(onBlocked);
      }
    }
    if (media.readyState === 'open') media.endOfStream();
    if (!started) void audio.play().catch(onBlocked);
  }

  private async playBuffered(audio: HTMLAudioElement, response: Response, onBlocked: () => void): Promise<void> {
    const blob = await response.blob();
    this.objectUrl = URL.createObjectURL(blob);
    audio.src = this.objectUrl;
    await audio.play().catch(onBlocked);
  }
}

function canStream(): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function' &&
    MediaSource.isTypeSupported('audio/mpeg')
  );
}

function appendChunk(buffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      buffer.removeEventListener('updateend', done);
      resolve();
    };
    buffer.addEventListener('updateend', done);
    buffer.addEventListener('error', reject, { once: true });
    try {
      buffer.appendBuffer(chunk as unknown as BufferSource);
    } catch (error) {
      reject(error as Error);
    }
  });
}
