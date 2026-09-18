import type { Segment } from './types';
export interface RawSegment {
  start: number;
  end: number;
  speaker?: string;
  text: string;
}
export function normalizeSegments(
  raw: RawSegment[],
  offset: number,
  duration: number,
  part: number,
): Segment[] {
  return raw
    .filter(
      (s) =>
        Number.isFinite(s.start) &&
        Number.isFinite(s.end) &&
        s.start >= 0 &&
        s.end > s.start &&
        s.start < duration,
    )
    .map((s, i) => ({
      id: `p${part}-s${i}`,
      start: s.start + offset,
      end: Math.min(s.end, duration) + offset,
      speaker: `p${part}:${s.speaker || 'unknown'}`,
      originalSpeaker: `p${part}:${s.speaker || 'unknown'}`,
      originalText: s.text,
      text: s.text,
      refined: false,
      edited: false,
    }))
    .sort((a, b) => a.start - b.start);
}
export function editSegment(segment: Segment, text: string, speaker: string): Segment {
  const revisions = [
    ...(segment.revisions || []),
    { text: segment.text, speaker: segment.speaker, savedAt: new Date().toISOString() },
  ];
  return { ...segment, text, speaker, edited: true, revisions };
}
export function applyCandidate(segment: Segment, accept: boolean): Segment {
  const { candidate, ...rest } = segment;
  return accept && candidate !== undefined
    ? { ...editSegment(rest, candidate, rest.speaker), refined: true }
    : rest;
}
export function coverSpeechGaps(
  segments: Segment[],
  speech: { start: number; end: number }[],
  part: number,
): Segment[] {
  const result = [...segments];
  for (const range of speech) {
    let cursor = range.start;
    const occupied = segments
      .filter((s) => s.end > range.start && s.start < range.end)
      .sort((a, b) => a.start - b.start);
    for (const interval of [...occupied, { start: range.end, end: range.end }]) {
      const end = Math.min(interval.start, range.end);
      if (end - cursor > 0.5)
        result.push({
          id: `p${part}-gap${result.length}`,
          start: cursor,
          end,
          speaker: `p${part}:unknown`,
          originalSpeaker: `p${part}:unknown`,
          text: '',
          originalText: '',
          refined: false,
          edited: false,
          warning: '話者を特定できなかった区間',
        });
      cursor = Math.max(cursor, interval.end);
    }
  }
  return result.sort((a, b) => a.start - b.start);
}
export function groupSegments(segments: Segment[]): Segment[] {
  const grouped: Segment[] = [];
  for (const segment of segments) {
    const last = grouped.at(-1);
    if (
      last &&
      last.speaker === segment.speaker &&
      segment.start >= last.end &&
      segment.start - last.end < 0.7 &&
      segment.end - last.start < 75 &&
      !last.warning &&
      !segment.warning
    ) {
      last.end = segment.end;
      last.originalText += '\n' + segment.originalText;
      last.text = last.originalText;
    } else grouped.push({ ...segment });
  }
  return grouped;
}
export function formatTime(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}
