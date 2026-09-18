import type { DesktopAPI, TrackName } from '../shared/types';
export class MeetingRecorder {
  private streams: MediaStream[] = [];
  private recorders: MediaRecorder[] = [];
  private context?: AudioContext;
  private queue: Promise<void> = Promise.resolve();
  private interval?: ReturnType<typeof setInterval>;
  private stopping = false;
  private started = false;
  private error?: Error;
  constructor(
    private api: DesktopAPI,
    private id: string,
    private onLevels: (mic: number, system: number) => void,
    private onInterruption: (message: string) => void,
  ) {}
  async start(systemAudio: boolean) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.streams.push(mic);
      let system: MediaStream | undefined;
      if (systemAudio) {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 320, height: 240, frameRate: 1 },
          audio: true,
        });
        this.streams.push(display);
        if (!display.getAudioTracks().length)
          throw new Error(
            '相手側の音声を取得できませんでした。システム設定の画面・システムオーディオ録音の権限を確認してください。',
          );
        system = new MediaStream(display.getAudioTracks());
      }
      this.context = new AudioContext();
      await this.context.resume();
      const destination = this.context.createMediaStreamDestination();
      const micNode = this.context.createMediaStreamSource(mic);
      const micAnalyser = this.context.createAnalyser();
      micAnalyser.fftSize = 256;
      micNode.connect(micAnalyser);
      const micGain = this.context.createGain();
      micGain.gain.value = system ? 0.5 : 1;
      micNode.connect(micGain);
      micGain.connect(destination);
      let systemAnalyser: AnalyserNode | undefined;
      if (system) {
        const node = this.context.createMediaStreamSource(system);
        systemAnalyser = this.context.createAnalyser();
        systemAnalyser.fftSize = 256;
        node.connect(systemAnalyser);
        const gain = this.context.createGain();
        gain.gain.value = 0.5;
        node.connect(gain);
        gain.connect(destination);
      }
      const tracks: [TrackName, MediaStream][] = [
        ['mixed', destination.stream],
        ['mic', mic],
      ];
      if (system) tracks.push(['system', system]);
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error('この環境ではWebM音声録音を利用できません。');
      await this.api.startRecording(
        this.id,
        tracks.map(([name]) => name),
      );
      this.started = true;
      for (const [track, stream] of tracks) {
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96000 });
        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          this.queue = this.queue
            .then(async () =>
              this.api.appendRecording(this.id, track, await event.data.arrayBuffer()),
            )
            .catch((error) => {
              this.error = error instanceof Error ? error : new Error('録音の保存に失敗しました。');
              if (!this.stopping)
                this.onInterruption('録音を保存できません。停止して空き容量を確認してください。');
            });
        };
        recorder.onerror = () => {
          if (!this.stopping)
            this.onInterruption('録音中にエラーが発生しました。保存済みの音声を確認してください。');
        };
        this.recorders.push(recorder);
        recorder.start(1000);
      }
      for (const stream of this.streams)
        for (const track of stream.getTracks())
          track.addEventListener('ended', () => {
            if (!this.stopping) this.onInterruption('音声入力が切断されました。録音を停止します。');
          });
      const level = (node?: AnalyserNode) => {
        if (!node) return 0;
        const data = new Uint8Array(node.fftSize);
        node.getByteTimeDomainData(data);
        return Math.min(
          1,
          Math.sqrt(data.reduce((n, x) => n + ((x - 128) / 128) ** 2, 0) / data.length) * 5,
        );
      };
      this.interval = setInterval(
        () => this.onLevels(level(micAnalyser), level(systemAnalyser)),
        150,
      );
    } catch (error) {
      this.cleanup();
      if (this.started) await this.api.finishRecording(this.id).catch(() => {});
      throw error;
    }
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    try {
      await Promise.all(
        this.recorders.map(
          (recorder) =>
            new Promise<void>((resolve) => {
              if (recorder.state === 'inactive') return resolve();
              recorder.addEventListener('stop', () => resolve(), { once: true });
              recorder.stop();
            }),
        ),
      );
      await this.queue;
      await this.api.finishRecording(this.id);
      if (this.error) throw this.error;
    } finally {
      this.cleanup();
    }
  }
  private cleanup() {
    this.stopping = true;
    clearInterval(this.interval);
    for (const stream of this.streams) for (const track of stream.getTracks()) track.stop();
    void this.context?.close();
    this.onLevels(0, 0);
  }
}
