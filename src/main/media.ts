import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AudioPart } from '../shared/types';

export class Media {
  readonly binary: string;
  constructor(configured: string) {
    this.binary =
      configured ||
      ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(existsSync) ||
      'ffmpeg';
  }
  run(args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, ['-hide_banner', '-nostdin', ...args], {
        signal,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-120000);
      });
      child.on('error', (error) =>
        reject(
          error.message.includes('ENOENT')
            ? new Error('FFmpegが見つかりません。設定で実行ファイルを指定してください。')
            : error,
        ),
      );
      child.on('close', (code) =>
        code === 0
          ? resolve(stderr)
          : reject(
              new Error(
                `音声変換に失敗しました (${code})。ファイル形式またはFFmpegを確認してください。`,
              ),
            ),
      );
    });
  }
  async available(): Promise<boolean> {
    try {
      await this.run(['-version']);
      return true;
    } catch {
      return false;
    }
  }
  async duration(file: string, signal?: AbortSignal): Promise<number> {
    const log = await this.run(['-i', file, '-t', '0.001', '-f', 'null', '-'], signal);
    const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
    if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    // MediaRecorder WebM does not necessarily write a Duration header.
    const full = await this.run(['-i', file, '-f', 'null', '-'], signal);
    const times = [...full.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = times.at(-1);
    if (!last) throw new Error('音声の長さを取得できませんでした。');
    return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  }
  async prepare(
    source: string,
    dir: string,
    signal?: AbortSignal,
    chunkSeconds = 900,
  ): Promise<AudioPart[]> {
    if (!(chunkSeconds > 0 && chunkSeconds <= 900)) throw new Error('不正な分割時間です。');
    const output = join(dir, 'parts');
    mkdirSync(output, { recursive: true });
    for (const name of readdirSync(output).filter((x) => /^part-\d+\.m4a$/.test(x)))
      rmSync(join(output, name));
    const total = await this.duration(source, signal);
    if (!(total > 0)) throw new Error('音声が空です。');
    const parts: AudioPart[] = [];
    // Encode each part from exact source timestamps. AAC padding must not accumulate
    // into the source-time offsets used for playback and subsequent re-recognition.
    for (let offset = 0; offset < total; offset += chunkSeconds) {
      signal?.throwIfAborted();
      const duration = Math.min(chunkSeconds, total - offset);
      const name = `part-${String(parts.length).padStart(4, '0')}.m4a`;
      await this.clip(source, join(output, name), offset, offset + duration, signal);
      parts.push({ name, duration, offset, diarized: false });
    }
    return parts;
  }
  async clip(
    source: string,
    output: string,
    start: number,
    end: number,
    signal?: AbortSignal,
    minimumSeconds = 0,
  ): Promise<void> {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
      throw new Error('不正な音声区間です。');
    if (!(minimumSeconds >= 0)) throw new Error('不正な音声区間です。');
    const length = end - start;
    // Output -t would trim the silence back off. Input -t keeps the slice inside this turn.
    const pad = minimumSeconds > length;
    mkdirSync(dirname(output), { recursive: true });
    await this.run(
      [
        '-y',
        '-ss',
        String(start),
        ...(pad ? ['-t', String(length)] : []),
        '-i',
        source,
        ...(pad ? [] : ['-t', String(length)]),
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        ...(pad ? ['-af', `apad=whole_dur=${minimumSeconds}`] : []),
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        output,
      ],
      signal,
    );
  }
  async speechRanges(
    source: string,
    duration: number,
    offset: number,
    signal?: AbortSignal,
  ): Promise<{ start: number; end: number }[]> {
    const log = await this.run(
      ['-i', source, '-af', 'silencedetect=noise=-42dB:d=0.6', '-f', 'null', '-'],
      signal,
    );
    const ranges: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const m of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
      const time = Math.min(duration, Number(m[2]));
      if (m[1] === 'start' && time > cursor)
        ranges.push({ start: cursor + offset, end: time + offset });
      cursor = time;
    }
    const lastEvent = [...log.matchAll(/silence_(start|end):/g)].at(-1)?.[1];
    if (lastEvent !== 'start' && cursor < duration)
      ranges.push({ start: cursor + offset, end: duration + offset });
    return ranges;
  }
}
