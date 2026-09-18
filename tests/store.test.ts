import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/main/store';

describe('durable meetings', () => {
  it('persists user edits and recovers interrupted processing on restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stt-test-'));
    try {
      let store = new Store(dir);
      const meeting = store.createMeeting({
        title: '腸管の検討',
        themeId: null,
        notes: '全層性壊死',
      });
      store.saveMeeting({ ...meeting, status: 'processing', stage: '文字起こし' });
      store.close();
      store = new Store(dir);
      expect(store.getMeeting(meeting.id)).toMatchObject({ title: '腸管の検討', status: 'error' });
      expect(store.getMeeting(meeting.id).context.notes).toBe('全層性壊死');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects identifiers that could escape the managed audio directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stt-test-'));
    const store = new Store(dir);
    try {
      expect(() => store.meetingDir('../../elsewhere')).toThrow();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('snapshots theme context so future theme edits cannot silently change the meeting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stt-test-'));
    const store = new Store(dir);
    try {
      store.saveTheme({
        id: '11111111-1111-4111-8111-111111111111',
        name: '医療',
        context: { notes: 'original', terms: [], documents: [] },
      });
      const m = store.createMeeting({
        title: 'test',
        themeId: '11111111-1111-4111-8111-111111111111',
        notes: '',
      });
      store.saveTheme({
        id: '11111111-1111-4111-8111-111111111111',
        name: '医療',
        context: { notes: 'changed', terms: [], documents: [] },
      });
      expect(store.getMeeting(m.id).themeContext.notes).toBe('original');
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
