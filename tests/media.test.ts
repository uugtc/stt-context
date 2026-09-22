import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Media } from '../src/main/media';

it('converts audio, produces bounded chunks and clips by source time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stt-media-'));
  try {
    const media = new Media('');
    const input = join(dir, 'source.wav');
    await media.run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-y', input]);
    const parts = await media.prepare(input, dir);
    expect(parts).toHaveLength(1);
    expect(parts[0].duration).toBeGreaterThan(1.8);
    await media.clip(input, join(dir, 'clip.m4a'), 0.5, 1.5);
    expect(await media.duration(join(dir, 'clip.m4a'))).toBeCloseTo(1, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('pads clips shorter than the transcription minimum with silence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stt-short-'));
  try {
    const media = new Media('');
    const input = join(dir, 'source.wav');
    await media.run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', input]);
    const output = join(dir, 'short.m4a');
    await media.clip(input, output, 0, 0.05, undefined, 0.25);
    expect(await media.duration(output)).toBeGreaterThanOrEqual(0.1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('uses exact source offsets rather than accumulating codec padding across chunks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stt-chunks-'));
  try {
    const media = new Media('');
    const source = join(dir, 'source.wav');
    await media.run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-y', source]);
    const parts = await media.prepare(source, dir, undefined, 0.75);
    expect(parts.map((p) => [p.offset, p.duration])).toEqual([
      [0, 0.75],
      [0.75, 0.75],
      [1.5, 0.5],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
