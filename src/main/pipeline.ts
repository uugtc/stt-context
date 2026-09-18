import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Media } from './media';
import type { AIProvider } from './openai';
import { buildContext } from '../shared/context';
import { coverSpeechGaps, groupSegments, normalizeSegments } from '../shared/segments';
import type { Meeting } from '../shared/types';
import { fingerprint } from './fingerprint';

export class Pipeline {
  private active = new Map<string, AbortController>();
  constructor(
    private store: Store,
    private ai: (transcriptionModel?: string) => AIProvider,
    private media: () => Media,
    private notify: () => void,
  ) {}
  busy(id: string): boolean {
    return this.active.has(id);
  }
  cancel(id: string): void {
    this.active.get(id)?.abort();
  }
  private save(meeting: Meeting) {
    this.store.saveMeeting(meeting);
    this.notify();
  }
  async run(id: string): Promise<void> {
    if (this.busy(id)) throw new Error('この会議は処理中です。');
    const media = this.media();
    const controller = new AbortController();
    const signal = controller.signal;
    let meeting = this.store.getMeeting(id);
    const ai = this.ai(meeting.processingModel || this.store.settings().transcriptionModel);
    if (!meeting.audioFile) throw new Error('音声を録音または取り込んでください。');
    if (meeting.status === 'recording') throw new Error('先に録音を停止してください。');
    const dir = this.store.meetingDir(id);
    if (!existsSync(join(dir, meeting.audioFile)))
      throw new Error('保存された音声が見つかりません。');
    this.active.set(id, controller);
    meeting = {
      ...meeting,
      status: 'processing',
      error: undefined,
      stage: '音声を準備中',
      processingModel: meeting.processingModel || this.store.settings().transcriptionModel,
    };
    this.save(meeting);
    try {
      const currentFingerprint = await fingerprint(join(dir, meeting.audioFile!), signal);
      if (meeting.audioFingerprint && meeting.audioFingerprint !== currentFingerprint) {
        throw new Error(
          '元の音声ファイルが変更されています。結果を混在させないため、新しい会議として取り込んでください。',
        );
      }
      meeting.audioFingerprint = currentFingerprint;
      if (!meeting.snapshot) {
        for (const context of [meeting.context, meeting.themeContext]) {
          for (const doc of context.documents) {
            if (doc.status === 'analyzed') continue;
            meeting.stage = `背景資料を整理中：${doc.name}`;
            this.save(meeting);
            const result = await ai.analyze(doc.text, signal);
            doc.digest = result.digest;
            doc.terms = result.words.map((term) => ({ ...term, id: randomUUID() }));
            doc.status = 'analyzed';
            this.save(meeting);
          }
        }
        // Long free-form notes are summarized for recognition; the user's input remains intact.
        const local = structuredClone(meeting.context);
        const theme = structuredClone(meeting.themeContext);
        for (const context of [local, theme])
          if (context.notes.length > 3000) {
            meeting.stage = '長い背景説明を整理中';
            this.save(meeting);
            const result = await ai.analyze(context.notes, signal);
            context.notes = result.digest;
            context.documents.push({
              id: randomUUID(),
              name: '背景説明からの抽出',
              text: '',
              digest: '',
              terms: result.words.map((t) => ({ ...t, id: randomUUID() })),
              status: 'analyzed',
            });
          }
        meeting.snapshot = buildContext(theme, local);
        this.save(meeting);
      }
      if (!meeting.parts.length) {
        meeting.parts = await media.prepare(join(dir, meeting.audioFile!), dir, signal);
        meeting.duration = meeting.parts.reduce((n, p) => n + p.duration, 0);
        this.save(meeting);
      }
      for (let p = 0; p < meeting.parts.length; p++) {
        signal.throwIfAborted();
        const part = meeting.parts[p];
        const file = join(dir, 'parts', part.name);
        if (!part.diarized) {
          meeting.stage = `話者を識別中 ${p + 1}/${meeting.parts.length}`;
          this.save(meeting);
          const raw = await ai.diarize(file, signal);
          const speech = await media.speechRanges(file, part.duration, part.offset, signal);
          const normalized = coverSpeechGaps(
            normalizeSegments(raw, part.offset, part.duration, p),
            speech,
            p,
          );
          const segments = groupSegments(normalized);
          if (p > 0)
            for (const s of segments)
              s.warning ||= '分割をまたぐ話者は別IDです。必要に応じて名前を統一してください。';
          meeting.segments.push(...segments);
          part.diarized = true;
          let speakerIndex = Object.keys(meeting.speakerNames).length;
          for (const s of segments)
            if (!meeting.speakerNames[s.speaker]) {
              meeting.speakerNames[s.speaker] = s.speaker.endsWith(':unknown')
                ? '話者不明'
                : `話者 ${++speakerIndex}`;
            }
          this.save(meeting);
        }
        const rows = meeting.segments.filter(
          (s) => s.start >= part.offset && s.start < part.offset + part.duration,
        );
        for (let n = 0; n < rows.length; n++) {
          const segment = rows[n];
          if (segment.refined || segment.edited) continue;
          signal.throwIfAborted();
          meeting.stage = `背景情報付きで文字起こし中 ${n + 1}/${rows.length}（区間 ${p + 1}）`;
          meeting.progress = Math.round(
            ((p + n / Math.max(1, rows.length)) / meeting.parts.length) * 90,
          );
          this.save(meeting);
          const clip = join(dir, 'work', `${segment.id}.m4a`);
          // Add a small margin only into gaps, never into another speaker's turn.
          const previous = rows[n - 1];
          const next = rows[n + 1];
          const start = Math.max(
            part.offset,
            segment.start - 0.12,
            previous?.end && previous.end <= segment.start ? previous.end : segment.start - 0.12,
          );
          const end = Math.min(
            part.offset + part.duration,
            segment.end + 0.12,
            next && next.start >= segment.end ? next.start : segment.end + 0.12,
          );
          await media.clip(file, clip, start - part.offset, end - part.offset, signal);
          segment.text = await ai.transcribe(clip, meeting.snapshot!, signal);
          segment.recognizedText = segment.text;
          segment.refined = true;
          this.save(meeting);
          rmSync(clip, { force: true });
        }
      }
      meeting.stage = '要約を作成中';
      meeting.progress = 95;
      this.save(meeting);
      meeting.summary = await ai.summarize(meeting.segments, meeting.speakerNames, signal);
      meeting.summaryStale = false;
      meeting.status = 'completed';
      meeting.stage = '完了';
      meeting.progress = 100;
      this.save(meeting);
    } catch (error) {
      meeting.status = 'error';
      meeting.error = signal.aborted
        ? '処理を中断しました。保存済みの結果から再開できます。'
        : safeError(error);
      meeting.stage = '処理を再開できます';
      this.save(meeting);
      throw error;
    } finally {
      this.active.delete(id);
      this.notify();
    }
  }
  async retranscribe(id: string, segmentId: string, hint: string): Promise<void> {
    await this.exclusive(id, '選択区間を再認識中', async (meeting, signal) => {
      const segment = meeting.segments.find((s) => s.id === segmentId);
      if (!segment || !meeting.audioFile) throw new Error('音声区間が見つかりません。');
      const dir = this.store.meetingDir(id);
      const clip = join(dir, 'work', 'retry.m4a');
      const context = buildContext(meeting.themeContext, {
        ...meeting.context,
        notes: hint + '\n' + meeting.context.notes,
      });
      await this.media().clip(
        join(dir, meeting.audioFile),
        clip,
        segment.start,
        segment.end,
        signal,
      );
      segment.candidate = await this.ai().transcribe(clip, context, signal);
      rmSync(clip, { force: true });
    });
  }
  async summarize(id: string): Promise<void> {
    await this.exclusive(id, '要約を更新中', async (meeting, signal) => {
      meeting.summary = await this.ai().summarize(meeting.segments, meeting.speakerNames, signal);
      meeting.summaryStale = false;
    });
  }
  private async exclusive(
    id: string,
    stage: string,
    operation: (meeting: Meeting, signal: AbortSignal) => Promise<void>,
  ) {
    if (this.busy(id)) throw new Error('この会議は処理中です。');
    const controller = new AbortController();
    this.active.set(id, controller);
    const meeting = this.store.getMeeting(id);
    const previous = meeting.status;
    try {
      meeting.status = 'processing';
      meeting.stage = stage;
      meeting.error = undefined;
      this.save(meeting);
      await operation(meeting, controller.signal);
      meeting.status = previous === 'error' ? 'ready' : previous;
      meeting.stage = '完了';
      this.save(meeting);
    } catch (error) {
      meeting.status = previous;
      meeting.error = safeError(error);
      this.save(meeting);
      throw error;
    } finally {
      this.active.delete(id);
      this.notify();
    }
  }
}
export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : '処理に失敗しました。';
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 600);
}
