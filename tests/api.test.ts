import { it, expect } from 'vitest';
import OpenAI from 'openai';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenAIProvider } from '../src/main/openai';
import { buildContext } from '../src/shared/context';
import { emptyContext } from '../src/shared/types';

it('sends context to transcription but never to the incompatible diarization request', async () => {
  const forms: FormData[] = [];
  const client = new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const form = await request.formData();
      forms.push(form);
      return Response.json(
        form.get('model') === 'gpt-4o-transcribe-diarize'
          ? { text: '絵師', segments: [{ start: 0, end: 1, speaker: 'A', text: '絵師' }] }
          : { text: '壊死' },
      );
    },
  });
  const dir = mkdtempSync(join(tmpdir(), 'stt-api-'));
  const file = join(dir, 'audio.wav');
  writeFileSync(file, 'fake audio transport fixture');
  try {
    const ai = new OpenAIProvider('test-key', 'gpt-4o-transcribe', 'gpt-4.1-mini', client);
    const context = buildContext(emptyContext(), {
      ...emptyContext(),
      terms: [{ id: 'a', word: '壊死', reading: 'えし' }],
    });
    expect(await ai.diarize(file)).toMatchObject([{ speaker: 'A', text: '絵師' }]);
    expect(await ai.transcribe(file, context)).toBe('壊死');
    expect(forms[0].get('prompt')).toBeNull();
    expect(forms[0].get('response_format')).toBe('diarized_json');
    expect(forms[1].get('prompt')).toContain('壊死（えし）');
    expect(forms[1].get('file')).toBeInstanceOf(File);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('drops summary claims with nonexistent evidence instead of presenting them as grounded', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                overview: '検討',
                topics: [{ text: 'valid', evidence: ['s1'] }],
                decisions: [{ text: 'invented', evidence: ['missing'] }],
                actions: [],
                questions: [],
              }),
            },
          },
        ],
      });
    },
  });
  const ai = new OpenAIProvider('test-key', 'gpt-4o-transcribe', 'gpt-4.1-mini', client);
  const result = await ai.summarize(
    [
      {
        id: 's1',
        start: 0,
        end: 1,
        speaker: 'A',
        originalSpeaker: 'A',
        originalText: '検討する',
        text: '検討する',
        edited: false,
        refined: true,
      },
    ],
    {},
  );
  expect(result.decisions).toEqual([]);
  expect(result.topics[0].evidence).toEqual(['s1']);
  expect(requestBody?.reasoning_effort).toBe('none');
});
