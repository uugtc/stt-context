import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultSettings, emptyContext, type Meeting, type Theme } from '../shared/types';

export class Store {
  private db: DatabaseSync;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, 'context.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))',
    );
    for (const meeting of this.meetings()) {
      if (meeting.status === 'processing' || meeting.status === 'recording') {
        const wasRecording = meeting.status === 'recording';
        this.saveMeeting({
          ...meeting,
          status: 'error',
          error: wasRecording
            ? '録音が中断されました。保存済みの音声から処理を再開できます。'
            : '前回の処理が中断されました。再開できます。',
          stage: '中断',
        });
      }
    }
  }
  private put(kind: string, id: string, data: unknown) {
    this.db
      .prepare(
        'INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(kind, id, JSON.stringify(data));
  }
  private get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? (JSON.parse(row.data as string) as T) : undefined;
  }
  private list<T>(kind: string): T[] {
    return this.db
      .prepare('SELECT data FROM records WHERE kind=?')
      .all(kind)
      .map((r) => JSON.parse(r.data as string) as T);
  }
  meetings(): Meeting[] {
    return this.list<Meeting>('meeting').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  themes(): Theme[] {
    return this.list<Theme>('theme');
  }
  getMeeting(id: string): Meeting {
    const value = this.get<Meeting>('meeting', id);
    if (!value) throw new Error('会議が見つかりません。');
    return value;
  }
  getTheme(id: string): Theme {
    const value = this.get<Theme>('theme', id);
    if (!value) throw new Error('テーマが見つかりません。');
    return value;
  }
  createMeeting(input: { title: string; themeId: string | null; notes: string }): Meeting {
    const meeting: Meeting = {
      id: randomUUID(),
      title: input.title.trim() || '新しい会議',
      themeId: input.themeId,
      createdAt: new Date().toISOString(),
      context: { ...emptyContext(), notes: input.notes },
      themeContext: input.themeId
        ? structuredClone(this.getTheme(input.themeId).context)
        : emptyContext(),
      status: 'draft',
      stage: '',
      progress: 0,
      duration: 0,
      segments: [],
      speakerNames: {},
      summaryStale: false,
      parts: [],
    };
    this.saveMeeting(meeting);
    return meeting;
  }
  saveMeeting(meeting: Meeting): void {
    this.put('meeting', meeting.id, meeting);
  }
  saveTheme(theme: Theme): void {
    this.put('theme', theme.id, theme);
  }
  deleteMeeting(id: string): void {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('meeting', id);
  }
  deleteTheme(id: string): void {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('theme', id);
  }
  meetingDir(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('不正な会議IDです。');
    const path = join(this.root, 'meetings', id);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return path;
  }
  settings(): typeof defaultSettings {
    return { ...defaultSettings, ...this.get('settings', 'default') };
  }
  saveSettings(settings: typeof defaultSettings): void {
    this.put('settings', 'default', settings);
  }
  close(): void {
    this.db.close();
  }
}
