import { useRef, useState } from 'react';
import {
  ArrowLeft,
  Mic,
  Square,
  Upload,
  Play,
  Download,
  Trash2,
  RefreshCw,
  Check,
  X,
  Pencil,
  BookOpen,
  FileText,
  AudioLines,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import type { Meeting, SummaryItem, ActionItem } from '../shared/types';
import { formatTime } from '../shared/segments';
import ContextEditor from './ContextEditor';
import { usePrompt } from './PromptDialog';
import { useDraft } from './DraftContext';

interface Props {
  meeting: Meeting;
  hasKey: boolean;
  report: (error: unknown) => void;
  back: () => void;
  start: (id: string, system: boolean) => Promise<void>;
  stop: () => Promise<void>;
  levels: { mic: number; system: number };
  elapsed: number;
  recordingId: string | null;
}
export default function MeetingView({
  meeting: m,
  hasKey,
  report,
  back,
  start,
  stop,
  levels,
  elapsed,
  recordingId,
}: Props) {
  const ask = usePrompt();
  const { flush } = useDraft();
  const [tab, setTab] = useState<'summary' | 'transcript' | 'context'>(
    m.audioFile ? 'summary' : 'context',
  );
  const [system, setSystem] = useState(true);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [retry, setRetry] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [highlight, setHighlight] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const recording = recordingId === m.id;
  const processing = m.status === 'processing';
  const locked = recording || processing || working;
  const run = async (action: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await flush();
      await action();
    } catch (error) {
      report(error);
    } finally {
      setWorking(false);
    }
  };
  const play = (id: string) => {
    const s = m.segments.find((s) => s.id === id);
    if (!s) return;
    setTab('transcript');
    setHighlight(id);
    if (audio.current) {
      audio.current.currentTime = s.start;
      void audio.current.play().catch(report);
    }
    setTimeout(
      () =>
        document
          .getElementById(`segment-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      80,
    );
  };
  const process = () => run(() => window.desktop.processMeeting(m.id));
  const importAudio = () =>
    run(async () => {
      if (await window.desktop.importAudio(m.id)) {
        setTab('summary');
        if (hasKey) await window.desktop.processMeeting(m.id);
      }
    });
  const rename = async (id: string) => {
    const value = await ask(
      'この話者の名前（別の話者と同じ名前を付けて統一できます）',
      m.speakerNames[id] || id,
    );
    if (value?.trim())
      void run(() =>
        window.desktop.updateMeeting(m.id, {
          speakerNames: { ...m.speakerNames, [id]: value.trim() },
        }),
      );
  };
  return (
    <div className="page meeting-page">
      <button className="back text-button" onClick={back} disabled={recording}>
        <ArrowLeft size={16} />
        会議一覧
      </button>
      <div className="meeting-header">
        <div>
          <div className="eyebrow">
            MEETING NOTES · {new Date(m.createdAt).toLocaleDateString('ja-JP')}
          </div>
          <h1>
            {m.title}
            <button
              className="icon-button"
              aria-label="会議名を変更"
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  const value = await ask('会議名', m.title);
                  if (value?.trim())
                    await window.desktop.updateMeeting(m.id, { title: value.trim() });
                })
              }
            >
              <Pencil size={16} />
            </button>
          </h1>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={!m.segments.length || recording}
            onClick={() => void run(() => window.desktop.exportMeeting(m.id, 'md'))}
          >
            <Download size={16} />
            書き出す
          </button>
          <button
            className="icon-button"
            aria-label="会議を削除"
            disabled={locked}
            onClick={() => {
              if (confirm('この会議と録音音声を削除しますか？ この操作は取り消せません。'))
                void run(async () => {
                  await window.desktop.deleteMeeting(m.id, true);
                  back();
                });
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      {!m.audioFile && (
        <div className="capture-panel">
          <div>
            <h3>準備ができたら、録音を。</h3>
            <p>背景情報は任意です。何も追加せず、そのまま始められます。</p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={system}
                onChange={(e) => setSystem(e.target.checked)}
                disabled={working}
              />
              マイクとMacのシステム音声を録音
            </label>
            <small>
              {system
                ? 'Mac全体の音声が対象です。通知や別のアプリの音も入るため、不要な音は止めてください。'
                : 'マイクのみ。対面の会議や音声メモ向けです。'}
            </small>
          </div>
          <div className="capture-buttons">
            <button
              className="primary"
              disabled={working || !!recordingId}
              onClick={() => void run(() => start(m.id, system))}
            >
              <Mic size={18} />
              録音を開始
            </button>
            <button
              className="secondary"
              disabled={working || !!recordingId}
              onClick={() => void importAudio()}
            >
              <Upload size={17} />
              音声を取り込む
            </button>
          </div>
        </div>
      )}
      {recording && (
        <div className="recording-panel">
          <div className="recording-clock">
            <span className="record-dot" />
            録音中 <strong>{formatTime(elapsed)}</strong>
          </div>
          <div className="meters">
            <Meter label="マイク" value={levels.mic} />
            {system && <Meter label="システム音声" value={levels.system} />}
          </div>
          <button className="stop" disabled={working} onClick={() => void run(stop)}>
            <Square size={15} fill="currentColor" />
            停止して保存
          </button>
        </div>
      )}
      {m.audioFile && !recording && (
        <div className="audio-bar">
          <AudioLines size={20} />
          <audio
            key={m.audioFile}
            ref={audio}
            controls
            preload="metadata"
            src={`stt-media://meeting/${m.id}`}
          />
          <span className="muted">元の音声</span>
        </div>
      )}
      {processing && (
        <div className="progress-panel">
          <div>
            <span className="spinner" />
            {m.stage}
          </div>
          <button
            className="text-button"
            onClick={() => void window.desktop.cancelProcessing(m.id)}
          >
            中断
          </button>
          <progress value={m.progress} max="100" />
        </div>
      )}
      {m.error && (
        <div className="notice error-notice">
          <AlertCircle size={18} />
          <div>{m.error}</div>
        </div>
      )}
      {!hasKey && (
        <div className="notice">
          <BookOpen size={18} />
          <div>
            録音・背景情報の準備はこのまま使えます。文字起こしと要約には、設定からOpenAI
            APIキーを登録してください。
          </div>
        </div>
      )}
      {m.audioFile && !processing && !recording && m.status !== 'completed' && (
        <div className="resume-row">
          <span className="muted">
            {m.segments.length
              ? '完了した区間を残して、続きから処理します。'
              : '保存した背景情報を使って、話者別の文字起こしを作ります。'}
          </span>
          <button className="primary" disabled={!hasKey || working} onClick={() => void process()}>
            <Play size={16} />
            {m.segments.length ? '処理を再開' : '文字起こし・要約を作成'}
          </button>
        </div>
      )}
      <nav className="tabs" aria-label="会議の表示">
        <button
          className={tab === 'summary' ? 'active' : ''}
          onClick={() => void run(async () => setTab('summary'))}
        >
          <FileText size={16} />
          要約
        </button>
        <button
          className={tab === 'transcript' ? 'active' : ''}
          onClick={() => void run(async () => setTab('transcript'))}
        >
          <AudioLines size={16} />
          文字起こし{m.segments.length > 0 && <span className="count">{m.segments.length}</span>}
        </button>
        <button
          className={tab === 'context' ? 'active' : ''}
          onClick={() => void run(async () => setTab('context'))}
        >
          <BookOpen size={16} />
          背景情報
        </button>
      </nav>
      {tab === 'summary' && (
        <div className="summary-content">
          {m.summary ? (
            <>
              <div className="section-heading">
                <h2>会議のまとめ</h2>
                <button
                  className="secondary"
                  disabled={locked || !hasKey}
                  onClick={() => void run(() => window.desktop.summarize(m.id))}
                >
                  <RefreshCw size={15} />
                  要約を更新
                </button>
              </div>
              {m.summaryStale && (
                <div className="notice">
                  文字起こしが変更されています。要約を更新すると変更が反映されます。
                </div>
              )}
              <p className="overview">{m.summary.overview}</p>
              <SummarySection title="主な論点" items={m.summary.topics} play={play} meeting={m} />
              <SummarySection
                title="決定事項"
                items={m.summary.decisions}
                play={play}
                meeting={m}
              />
              <SummarySection title="次の行動" items={m.summary.actions} play={play} meeting={m} />
              <SummarySection
                title="未決事項"
                items={m.summary.questions}
                play={play}
                meeting={m}
              />
            </>
          ) : (
            <div className="empty-inline">
              <FileText size={30} />
              <h3>{processing ? '会議を整理しています' : '会議のあとに、要点をここへ'}</h3>
              <p>
                {processing
                  ? '処理が完了した区間は「文字起こし」で確認できます。'
                  : '概要、決定事項、次の行動を、発言の根拠と一緒にまとめます。'}
              </p>
            </div>
          )}
        </div>
      )}
      {tab === 'transcript' && (
        <div className="transcript-content">
          {m.segments.length > 0 ? (
            <>
              <div className="section-heading">
                <p className="muted">
                  時刻をクリックして聞き直せます。話者名はクリックで変更できます。
                </p>
                <button
                  className="text-button"
                  onClick={() => void run(() => window.desktop.exportMeeting(m.id, 'txt'))}
                >
                  <Download size={15} />
                  テキスト保存
                </button>
              </div>
              {m.segments.map((s) => (
                <article
                  id={`segment-${s.id}`}
                  key={s.id}
                  className={`segment ${highlight === s.id ? 'highlighted' : ''}`}
                >
                  <div className="segment-meta">
                    <button className="time" onClick={() => play(s.id)}>
                      <Play size={12} />
                      {formatTime(s.start)}
                    </button>
                    <button className="speaker" disabled={locked} onClick={() => rename(s.speaker)}>
                      {m.speakerNames[s.speaker] || s.speaker}
                    </button>
                    {s.edited && <span className="badge">編集済み</span>}
                    {!s.refined && !s.edited && <span className="badge">認識中の下書き</span>}
                  </div>
                  {editing === s.id ? (
                    <div className="segment-edit">
                      <textarea
                        aria-label="発言の修正"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={4}
                      />
                      <select
                        aria-label="発言の話者"
                        value={speaker}
                        onChange={(e) => setSpeaker(e.target.value)}
                      >
                        {Object.entries(m.speakerNames).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <div className="actions">
                        <button className="secondary" onClick={() => setEditing(null)}>
                          キャンセル
                        </button>
                        <button
                          className="primary"
                          disabled={working}
                          onClick={() =>
                            void run(async () => {
                              await window.desktop.editSegment(m.id, s.id, text, speaker);
                              setEditing(null);
                            })
                          }
                        >
                          <Check size={15} />
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="segment-text">{s.text || '音声を認識しています…'}</p>
                  )}
                  {s.warning && <small className="segment-warning">{s.warning}</small>}
                  {(s.edited || s.revisions?.length) && (
                    <details className="transcript-history">
                      <summary>認識結果と編集前の内容</summary>
                      <p>
                        <strong>背景情報付きの認識結果</strong>
                        <br />
                        {s.recognizedText || s.originalText}
                      </p>
                      {s.revisions?.map((revision, index) => (
                        <p key={index}>
                          <small>
                            {new Date(revision.savedAt).toLocaleString('ja-JP')} の編集前
                          </small>
                          <br />
                          {revision.text}
                        </p>
                      ))}
                    </details>
                  )}
                  <div className="segment-tools">
                    <button
                      className="text-button"
                      disabled={locked}
                      onClick={() => {
                        setEditing(s.id);
                        setText(s.text);
                        setSpeaker(s.speaker);
                      }}
                    >
                      <Pencil size={13} />
                      修正
                    </button>
                    <button
                      className="text-button"
                      disabled={locked || !hasKey}
                      onClick={() => {
                        setRetry(retry === s.id ? null : s.id);
                        setHint('');
                      }}
                    >
                      <RefreshCw size={13} />
                      聞き直して再認識
                    </button>
                    {m.themeId && (
                      <button
                        className="text-button"
                        disabled={locked}
                        onClick={() =>
                          void run(async () => {
                            const word = await ask('次回の認識に使う用語');
                            if (!word?.trim()) return;
                            const reading = (await ask('読み方（任意）')) || '';
                            const state = await window.desktop.state();
                            const theme = state.themes.find((t) => t.id === m.themeId);
                            if (!theme) throw new Error('テーマが削除されています。');
                            await window.desktop.saveTheme({
                              ...theme,
                              context: {
                                ...theme.context,
                                terms: [
                                  ...theme.context.terms.filter((t) => t.word !== word.trim()),
                                  { id: crypto.randomUUID(), word: word.trim(), reading },
                                ],
                              },
                            });
                          })
                        }
                      >
                        <BookOpen size={13} />
                        テーマに用語を登録
                      </button>
                    )}
                  </div>
                  {retry === s.id && (
                    <div className="retry-form">
                      <input
                        aria-label="再認識のヒント"
                        placeholder="補足があれば入力（例：全層性壊死という用語）"
                        value={hint}
                        onChange={(e) => setHint(e.target.value)}
                      />
                      <button
                        className="secondary"
                        disabled={locked}
                        onClick={() =>
                          void run(async () => {
                            await window.desktop.retranscribe(m.id, s.id, hint);
                            setRetry(null);
                          })
                        }
                      >
                        再認識する
                      </button>
                    </div>
                  )}
                  {s.candidate !== undefined && (
                    <div className="candidate">
                      <strong>再認識の候補</strong>
                      <p>{s.candidate || '（発言を認識できませんでした）'}</p>
                      <div className="actions">
                        <button
                          className="secondary"
                          disabled={locked}
                          onClick={() =>
                            void run(() => window.desktop.applyCandidate(m.id, s.id, false))
                          }
                        >
                          <X size={14} />
                          見送る
                        </button>
                        <button
                          className="primary"
                          disabled={locked}
                          onClick={() =>
                            void run(() => window.desktop.applyCandidate(m.id, s.id, true))
                          }
                        >
                          <Check size={14} />
                          この内容を採用
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </>
          ) : (
            <div className="empty-inline">
              <AudioLines size={30} />
              <h3>発言を、話者ごとに</h3>
              <p>録音や音声ファイルの処理が始まると、ここに表示されます。</p>
            </div>
          )}
        </div>
      )}
      {tab === 'context' && (
        <>
          <ContextEditor
            context={m.context}
            owner={{ type: 'meeting', id: m.id }}
            save={(context) => window.desktop.updateMeeting(m.id, { context })}
            disabled={locked}
            hasKey={hasKey}
            report={report}
          />
          {(m.themeContext.notes ||
            m.themeContext.terms.length > 0 ||
            m.themeContext.documents.length > 0) && (
            <details className="context-details">
              <summary>テーマから引き継いだ背景情報</summary>
              <p>{m.themeContext.notes}</p>
              <div className="terms">
                {m.themeContext.terms.map((t) => (
                  <span className="term" key={t.id}>
                    {t.word} <small>{t.reading}</small>
                  </span>
                ))}
              </div>
              {m.themeContext.documents.map((d) => (
                <p key={d.id}>{d.name}</p>
              ))}
              <small>会議を作成した時点の内容です。今回の背景情報を優先します。</small>
            </details>
          )}
          {m.snapshot && (
            <details className="context-details">
              <summary>最初の認識に使用した背景情報</summary>
              {m.snapshot.truncated && (
                <p className="notice">
                  長さの上限に合わせて一部を省略しています。重要な言葉は用語として登録してください。
                </p>
              )}
              <pre>{m.snapshot.prompt}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <small>{label}</small>
      <div>
        <span style={{ width: `${Math.max(1, value * 100)}%` }} />
      </div>
    </div>
  );
}
function SummarySection({
  title,
  items,
  play,
  meeting,
}: {
  title: string;
  items: (SummaryItem | ActionItem)[];
  play: (id: string) => void;
  meeting: Meeting;
}) {
  if (!items.length) return null;
  return (
    <section className="summary-section">
      <h3>{title}</h3>
      {items.map((item, index) => (
        <div className="summary-item" key={index}>
          <ChevronRight size={15} />
          <div>
            <p>{item.text}</p>
            {'owner' in item && (
              <div className="action-detail">
                担当：{item.owner || '未指定'}
                <span>期限：{item.due || '未指定'}</span>
              </div>
            )}
            <div className="evidence">
              {item.evidence.map((id) => (
                <button key={id} onClick={() => play(id)}>
                  {formatTime(meeting.segments.find((s) => s.id === id)?.start || 0)} の発言
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
