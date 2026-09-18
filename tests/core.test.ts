import { describe, it, expect } from 'vitest';
import { buildContext } from '../src/shared/context';
import {
  normalizeSegments,
  editSegment,
  applyCandidate,
  coverSpeechGaps,
} from '../src/shared/segments';
import { emptyContext, type Segment } from '../src/shared/types';

describe('context precedence and bounded input', () => {
  it('keeps the meeting reading ahead of a conflicting theme reading', () => {
    const theme = { ...emptyContext(), terms: [{ id: 'a', word: '全層性', reading: 'wrong' }] };
    const local = {
      ...emptyContext(),
      terms: [{ id: 'b', word: '全層性', reading: 'ぜんそうせい' }],
    };
    const result = buildContext(theme, local);
    expect(result.terms).toHaveLength(1);
    expect(result.prompt).toContain('ぜんそうせい');
    expect(result.prompt).not.toContain('wrong');
  });
  it('retains explicit terms when background exceeds the budget', () => {
    const context = {
      ...emptyContext(),
      notes: '資料'.repeat(10000),
      terms: [{ id: 'x', word: '壊死', reading: 'えし' }],
    };
    const result = buildContext(emptyContext(), context, 500);
    expect(result.prompt.length).toBeLessThanOrEqual(500);
    expect(result.prompt).toContain('壊死');
    expect(result.truncated).toBe(true);
  });
});
const segment: Segment = {
  id: 's',
  start: 0,
  end: 2,
  speaker: 'A',
  originalSpeaker: 'A',
  originalText: '絵師',
  text: '絵師',
  refined: true,
  edited: false,
};
describe('transcript integrity', () => {
  it('rejects invalid ranges and scopes speaker IDs by chunk', () => {
    const rows = normalizeSegments(
      [
        { start: 0, end: 2, speaker: 'A', text: 'はい' },
        { start: 4, end: 3, speaker: 'B', text: 'bad' },
      ],
      10,
      5,
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ start: 10, end: 12, speaker: 'p2:A' });
  });
  it('preserves raw text and requires explicit acceptance of a new candidate', () => {
    const edited = editSegment(segment, '壊死', 'B');
    expect(edited).toMatchObject({ originalText: '絵師', text: '壊死', edited: true });
    expect(applyCandidate({ ...edited, candidate: '壊死です' }, false).text).toBe('壊死');
    expect(applyCandidate({ ...edited, candidate: '壊死です' }, true).text).toBe('壊死です');
    expect(applyCandidate({ ...edited, candidate: '壊死です' }, true).revisions?.at(-1)?.text).toBe(
      '壊死',
    );
  });
  it('keeps uncovered audible ranges for unknown-speaker transcription', () => {
    const rows = coverSpeechGaps([segment], [{ start: 0, end: 5 }], 0);
    expect(rows.some((s) => s.start === 2 && s.end === 5 && s.speaker.includes('unknown'))).toBe(
      true,
    );
  });
});
