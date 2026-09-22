import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/main/store';
import { Pipeline } from '../src/main/pipeline';
import { describeError, logError, setLogFile } from '../src/main/log';
import type { AIProvider } from '../src/main/openai';
import type { Media } from '../src/main/media';

it('keeps the transport cause in the log when the UI only stores the message', () => {
  const cause = new Error('headers timed out');
  (cause as Error & { code: string }).code = 'UND_ERR_HEADERS_TIMEOUT';
  const error = new Error('Request timed out. sk-testsecret');
  error.cause = cause;
  expect(describeError(error)).toContain('UND_ERR_HEADERS_TIMEOUT');
  expect(describeError(error)).toContain('[redacted]');
  expect(describeError(error)).not.toContain('sk-testsecret');
  const dir = mkdtempSync(join(tmpdir(), 'stt-log-'));
  const file = join(dir, 'main.log');
  setLogFile(file);
  try {
    logError(error);
    expect(readFileSync(file, 'utf8')).toContain('UND_ERR_HEADERS_TIMEOUT');
  } finally {
    setLogFile(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('retries only unfinished transcription and preserves successfully saved segments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stt-pipeline-'));
  const store = new Store(dir);
  let count = 0;
  const ai: AIProvider = {
    diarize: async () => [
      { start: 0, end: 1, speaker: 'A', text: '絵師' },
      { start: 2, end: 3, speaker: 'B', text: 'はい' },
    ],
    transcribe: async () => {
      count++;
      if (count === 2) throw new Error('offline');
      return count === 1 ? '壊死' : 'はい';
    },
    summarize: async () => ({
      overview: '検討',
      topics: [],
      decisions: [],
      actions: [],
      questions: [],
    }),
    analyze: async () => ({ digest: '', words: [] }),
  };
  const media = {
    prepare: async () => [{ name: 'part-0000.m4a', duration: 3, offset: 0, diarized: false }],
    speechRanges: async () => [],
    clip: async () => {},
    available: async () => true,
  } as unknown as Media;
  try {
    const meeting = store.createMeeting({ title: 'test', themeId: null, notes: '壊死' });
    writeFileSync(join(store.meetingDir(meeting.id), 'source.wav'), 'fixture');
    store.saveMeeting({ ...meeting, audioFile: 'source.wav', status: 'ready' });
    const models: (string | undefined)[] = [];
    const pipeline = new Pipeline(
      store,
      (model) => {
        models.push(model);
        return ai;
      },
      () => media,
      () => {},
    );
    await expect(pipeline.run(meeting.id)).rejects.toThrow('offline');
    expect(store.getMeeting(meeting.id).segments[0].text).toBe('壊死');
    store.saveSettings({ ...store.settings(), transcriptionModel: 'gpt-4o-mini-transcribe' });
    await pipeline.run(meeting.id);
    expect(count).toBe(3);
    expect(models).toEqual(['gpt-4o-transcribe', 'gpt-4o-transcribe']);
    expect(store.getMeeting(meeting.id)).toMatchObject({
      status: 'completed',
      summary: { overview: '検討' },
    });
    writeFileSync(join(store.meetingDir(meeting.id), 'source.wav'), 'changed source');
    await expect(pipeline.run(meeting.id)).rejects.toThrow('元の音声ファイルが変更');
    expect(count).toBe(3);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
