import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Layers,
  Settings as SettingsIcon,
  Plus,
  Search,
  ArrowUpRight,
  Mic,
  BookOpen,
  X,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import type { AppState, Meeting } from '../shared/types';
import { formatTime } from '../shared/segments';
import { MeetingRecorder } from './recorder';
import MeetingView from './MeetingView';
import ThemesView from './ThemesView';
import SettingsView from './SettingsView';
import { useDraft } from './DraftContext';

export default function App() {
  const { flush } = useDraft();
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<'meetings' | 'themes' | 'settings'>('meetings');
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [themeId, setThemeId] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState({ mic: 0, system: 0 });
  const recorder = useRef<MeetingRecorder | null>(null);
  const started = useRef(0);
  const request = useRef(0);
  const report = useCallback(
    (error: unknown) =>
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(error),
      ),
    [],
  );
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const data = await window.desktop.state();
      if (current === request.current) setState(data);
    } catch (error) {
      report(error);
    }
  }, [report]);
  useEffect(() => {
    if (!window.desktop) return;
    void refresh();
    return window.desktop.onChange(() => void refresh());
  }, [refresh]);
  useEffect(() => {
    if (!recordingId) return;
    const interval = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => clearInterval(interval);
  }, [recordingId]);
  const stop = useCallback(async () => {
    if (!recorder.current) return;
    const current = recorder.current;
    recorder.current = null;
    try {
      await current.stop();
      if (recordingId && state?.settings.hasApiKey)
        await window.desktop.processMeeting(recordingId);
    } finally {
      setRecordingId(null);
      await refresh();
    }
  }, [recordingId, state?.settings.hasApiKey, refresh]);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const start = async (id: string, system: boolean) => {
    if (recorder.current) throw new Error('すでに録音しています。');
    const instance = new MeetingRecorder(
      window.desktop,
      id,
      (mic, system) => setLevels({ mic, system }),
      (message) => {
        report(new Error(message));
        void stopRef.current().catch(report);
      },
    );
    recorder.current = instance;
    try {
      await instance.start(system);
      started.current = Date.now();
      setElapsed(0);
      setRecordingId(id);
    } catch (error) {
      recorder.current = null;
      throw error;
    }
  };
  const go = async (next: typeof page) => {
    if (recordingId) return;
    try {
      await flush();
      setPage(next);
      setSelected(null);
    } catch (error) {
      report(error);
    }
  };
  const create = async () => {
    setCreating(true);
    try {
      await flush();
      const m = await window.desktop.createMeeting({
        title: title.trim() || `${new Date().toLocaleDateString('ja-JP')} の会議`,
        themeId: themeId || null,
        notes,
      });
      setSelected(m.id);
      setPage('meetings');
      setShowCreate(false);
      setTitle('');
      setNotes('');
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setCreating(false);
    }
  };
  if (!window.desktop)
    return (
      <div className="standalone-message">
        <h1>STT Context</h1>
        <p>このアプリはElectronで起動してください。</p>
        <code>npm run dev</code>
      </div>
    );
  if (!state)
    return (
      <div className="standalone-message">
        <span className="spinner" />
        <p>{error || 'ワークスペースを開いています…'}</p>
      </div>
    );
  const meeting = state.meetings.find((m) => m.id === selected);
  const filtered = state.meetings.filter((m) =>
    `${m.title} ${m.segments.map((s) => s.text).join(' ')}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="app-shell">
      <div className="titlebar" />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <span>
            context<span className="brand-sub">MEETING COMPANION</span>
          </span>
        </div>
        <button
          className="new-meeting"
          disabled={!!recordingId}
          onClick={() => setShowCreate(true)}
        >
          <Plus size={18} />
          新しい会議
        </button>
        <nav className="main-nav" aria-label="メインナビゲーション">
          <button
            className={page === 'meetings' ? 'active' : ''}
            disabled={!!recordingId}
            onClick={() => go('meetings')}
          >
            <AudioLines size={18} />
            会議<span>{state.meetings.length}</span>
          </button>
          <button
            className={page === 'themes' ? 'active' : ''}
            disabled={!!recordingId}
            onClick={() => go('themes')}
          >
            <Layers size={18} />
            テーマ
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span />
            このMacに保存
          </div>
          <button
            className={page === 'settings' ? 'active' : ''}
            disabled={!!recordingId}
            onClick={() => go('settings')}
          >
            <SettingsIcon size={17} />
            設定{!state.settings.hasApiKey && <span className="setup-dot" />}
          </button>
          <small>STT Context · 0.1.0</small>
        </div>
      </aside>
      <main>
        {page === 'settings' ? (
          <SettingsView settings={state.settings} report={report} />
        ) : page === 'themes' ? (
          <ThemesView themes={state.themes} hasKey={state.settings.hasApiKey} report={report} />
        ) : meeting ? (
          <MeetingView
            key={meeting.id}
            meeting={meeting}
            hasKey={state.settings.hasApiKey}
            report={report}
            back={() => void go('meetings')}
            start={start}
            stop={stop}
            levels={levels}
            elapsed={elapsed}
            recordingId={recordingId}
          />
        ) : (
          <div className="page">
            <div className="eyebrow">YOUR WORKSPACE</div>
            <div className="page-heading">
              <div>
                <h1>会話を、次の一歩に。</h1>
                <p className="page-lead">背景を知る文字起こしで、大切な言葉を残しましょう。</p>
              </div>
              <button className="primary" onClick={() => setShowCreate(true)}>
                <Plus size={17} />
                新しい会議
              </button>
            </div>
            {!state.settings.hasApiKey && (
              <button className="setup-banner" onClick={() => go('settings')}>
                <div className="setup-icon">
                  <BookOpen size={20} />
                </div>
                <div>
                  <strong>AIの準備をしましょう</strong>
                  <p>
                    APIキーを登録すると、文字起こしと要約が使えます。録音やテーマの準備は先に始められます。
                  </p>
                </div>
                <ArrowUpRight size={20} />
              </button>
            )}
            <div className="list-header">
              <h2>
                すべての会議 <span className="count">{state.meetings.length}</span>
              </h2>
              <div className="search">
                <Search size={16} />
                <input
                  aria-label="会議を検索"
                  placeholder="会議名・発言を検索"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {filtered.length ? (
              <div className="meeting-list">
                {filtered.map((m) => (
                  <button className="meeting-row" key={m.id} onClick={() => setSelected(m.id)}>
                    <div className={`meeting-icon ${m.status === 'completed' ? 'done' : ''}`}>
                      <AudioLines size={22} />
                    </div>
                    <div className="meeting-row-title">
                      <strong>{m.title}</strong>
                      <small>
                        {new Date(m.createdAt).toLocaleString('ja-JP', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {m.duration > 0 && ` · ${formatTime(m.duration)}`}
                        {m.themeId &&
                          ` · ${state.themes.find((t) => t.id === m.themeId)?.name || '保存済みテーマ'}`}
                      </small>
                    </div>
                    <span className={`status ${m.status}`}>{statusLabel(m)}</span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="welcome-empty">
                <div className="empty-wave">
                  <AudioLines size={42} />
                </div>
                <h2>{search ? '一致する会議がありません' : '最初の会話から、はじめよう。'}</h2>
                <p>
                  {search ? (
                    '別のキーワードで検索してみてください。'
                  ) : (
                    <>
                      会議を録音するか、音声ファイルを取り込むだけ。
                      <br />
                      資料や用語を添えると、あなたの分野に近づきます。
                    </>
                  )}
                </p>
                {!search && (
                  <button className="primary" onClick={() => setShowCreate(true)}>
                    <Mic size={17} />
                    会議を作成
                  </button>
                )}
              </div>
            )}
            {!state.meetings.length && (
              <div className="onboarding-steps">
                <div>
                  <span>01</span>
                  <strong>背景を添える</strong>
                  <p>
                    資料、専門用語、ひとこと。
                    <br />
                    必要なものだけ。
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <strong>会話を残す</strong>
                  <p>
                    会議を録音、または
                    <br />
                    音声ファイルを取り込み。
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <strong>要点をつかむ</strong>
                  <p>
                    話者別の文字起こしと、
                    <br />
                    根拠付きのまとめ。
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={19} />
          <span>{error}</span>
          <button aria-label="エラー表示を閉じる" onClick={() => setError('')}>
            <X size={17} />
          </button>
        </div>
      )}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => !creating && setShowCreate(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-meeting-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <div>
                <div className="eyebrow">NEW MEETING</div>
                <h2 id="new-meeting-title">新しい会議</h2>
              </div>
              <button
                className="icon-button"
                aria-label="閉じる"
                disabled={creating}
                onClick={() => setShowCreate(false)}
              >
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label>
                会議名
                <input
                  autoFocus
                  placeholder="例：バイオデザイン 定例ミーティング"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </label>
              <label>
                テーマ
                <select
                  aria-label="テーマ"
                  value={themeId}
                  onChange={(e) => setThemeId(e.target.value)}
                >
                  <option value="">テーマなし</option>
                  {state.themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                今回の背景（任意）
                <textarea
                  placeholder="今日はどんな話をしますか？"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <p className="muted">資料や用語は、作成後に追加できます。</p>
              <div className="modal-footer">
                <button
                  className="secondary"
                  type="button"
                  disabled={creating}
                  onClick={() => setShowCreate(false)}
                >
                  キャンセル
                </button>
                <button className="primary" disabled={creating}>
                  {creating ? '作成中…' : '会議を作成'}
                  <ChevronRight size={16} />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function statusLabel(m: Meeting): string {
  return {
    draft: '準備中',
    recording: '録音中',
    ready: '未処理',
    processing: '処理中',
    completed: '完了',
    error: '要確認',
  }[m.status];
}
