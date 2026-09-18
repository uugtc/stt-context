import { useEffect, useState } from 'react';
import { FileText, Plus, Trash2, WandSparkles, Save } from 'lucide-react';
import type { ContextData } from '../shared/types';
import { useDraft } from './DraftContext';

interface Props {
  context: ContextData;
  owner: { type: 'meeting' | 'theme'; id: string };
  save: (context: ContextData) => Promise<void>;
  hasKey: boolean;
  disabled?: boolean;
  report: (error: unknown) => void;
}
export default function ContextEditor({ context, owner, save, hasKey, disabled, report }: Props) {
  const { register } = useDraft();
  const [draft, setDraft] = useState(context);
  const [dirty, setDirty] = useState(false);
  const [word, setWord] = useState('');
  const [reading, setReading] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(context);
  }, [context, dirty]);
  const change = (next: ContextData) => {
    setDraft(next);
    setDirty(true);
  };
  const persist = async () => {
    await save(draft);
    setDirty(false);
  };
  useEffect(
    () =>
      register(async () => {
        if (dirty) await persist();
      }),
    [register, dirty, draft, save],
  );
  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    try {
      if (dirty) await persist();
      await action();
    } catch (error) {
      report(error);
    } finally {
      setWorking(false);
    }
  };
  const locked = disabled || working;
  return (
    <div className="context-editor">
      <section className="editor-section">
        <div className="section-heading">
          <div>
            <h3>背景をひとこと</h3>
            <p>会議の目的や、知っておいてほしいこと。長い説明もそのままどうぞ。</p>
          </div>
        </div>
        <textarea
          aria-label="背景説明"
          placeholder="例：腸管の虚血・壊死について、医療機器のアイデアを検討する会議。"
          value={draft.notes}
          disabled={locked}
          onChange={(e) => change({ ...draft, notes: e.target.value })}
          rows={4}
        />
      </section>
      <section className="editor-section">
        <div className="section-heading">
          <div>
            <h3>
              大切な用語 <span className="count">{draft.terms.length}</span>
            </h3>
            <p>間違えてほしくない名前や専門用語。読み方は任意です。</p>
          </div>
        </div>
        <form
          className="term-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!word.trim()) return;
            change({
              ...draft,
              terms: [
                ...draft.terms.filter((t) => t.word !== word.trim()),
                { id: crypto.randomUUID(), word: word.trim(), reading: reading.trim() },
              ],
            });
            setWord('');
            setReading('');
          }}
        >
          <input
            aria-label="用語"
            placeholder="全層性"
            value={word}
            disabled={locked}
            onChange={(e) => setWord(e.target.value)}
            maxLength={150}
          />
          <input
            aria-label="読み方"
            placeholder="ぜんそうせい（任意）"
            value={reading}
            disabled={locked}
            onChange={(e) => setReading(e.target.value)}
            maxLength={200}
          />
          <button className="secondary" type="submit" disabled={locked || !word.trim()}>
            <Plus size={16} />
            追加
          </button>
        </form>
        {draft.terms.length > 0 && (
          <div className="terms">
            {draft.terms.map((term) => (
              <span className="term" key={term.id}>
                <strong>{term.word}</strong>
                {term.reading && <small>{term.reading}</small>}
                <button
                  aria-label={`${term.word}を削除`}
                  disabled={locked}
                  onClick={() =>
                    change({ ...draft, terms: draft.terms.filter((t) => t.id !== term.id) })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="editor-section">
        <div className="section-heading">
          <div>
            <h3>
              背景資料 <span className="count">{draft.documents.length}</span>
            </h3>
            <p>PDF・テキスト・Markdown。資料の文章を読み取り、認識の参考にします。</p>
          </div>
          <button
            className="secondary"
            disabled={locked}
            onClick={() => void run(() => window.desktop.addDocument(owner))}
          >
            <Plus size={16} />
            資料を追加
          </button>
        </div>
        {draft.documents.map((doc) => (
          <div className="document" key={doc.id}>
            <FileText size={20} />
            <div className="document-body">
              <strong>{doc.name}</strong>
              <small>
                {doc.status === 'analyzed'
                  ? `整理済み · ${doc.terms.length}語`
                  : `読み取り済み · ${doc.text.length.toLocaleString()}文字`}
              </small>
              {doc.digest && (
                <details>
                  <summary>背景と抽出された用語を見る</summary>
                  <p>{doc.digest}</p>
                  <div className="terms">
                    {doc.terms.map((term) => (
                      <span className="term" key={term.id}>
                        {term.word}
                        <button
                          aria-label={`${doc.name}の${term.word}を除外`}
                          disabled={locked}
                          onClick={() =>
                            change({
                              ...draft,
                              documents: draft.documents.map((d) =>
                                d.id === doc.id
                                  ? { ...d, terms: d.terms.filter((t) => t.id !== term.id) }
                                  : d,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
            <button
              className="icon-button"
              aria-label={`${doc.name}を外す`}
              disabled={locked}
              onClick={() =>
                change({ ...draft, documents: draft.documents.filter((d) => d.id !== doc.id) })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {draft.documents.some((d) => d.status === 'extracted') && (
          <button
            className="secondary"
            disabled={locked || !hasKey}
            onClick={() => void run(() => window.desktop.analyzeDocuments(owner))}
          >
            <WandSparkles size={16} />
            {working ? '資料を整理中…' : 'AIで背景と用語を整理'}{' '}
          </button>
        )}
        {draft.documents.length > 0 && !hasKey && (
          <p className="muted">AIでの整理には設定でAPIキーを登録してください。</p>
        )}
      </section>
      <div className="editor-footer">
        <span>{dirty ? '保存していない変更があります' : '背景情報はいつでも追加できます'}</span>
        <button
          className="primary"
          disabled={locked || !dirty}
          onClick={() => void run(async () => {})}
        >
          <Save size={16} />
          変更を保存
        </button>
      </div>
    </div>
  );
}
