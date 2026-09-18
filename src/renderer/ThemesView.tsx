import { useState } from 'react';
import { Plus, Layers, Trash2 } from 'lucide-react';
import { emptyContext, type Theme } from '../shared/types';
import ContextEditor from './ContextEditor';
import { useDraft } from './DraftContext';
export default function ThemesView({
  themes,
  hasKey,
  report,
}: {
  themes: Theme[];
  hasKey: boolean;
  report: (error: unknown) => void;
}) {
  const { flush } = useDraft();
  const [selected, setSelected] = useState<string | null>(themes[0]?.id || null);
  const [name, setName] = useState('');
  const theme = themes.find((t) => t.id === selected);
  const create = async () => {
    if (!name.trim()) return;
    const id = crypto.randomUUID();
    try {
      await flush();
      await window.desktop.saveTheme({ id, name: name.trim(), context: emptyContext() });
      setSelected(id);
      setName('');
    } catch (error) {
      report(error);
    }
  };
  return (
    <div className="page">
      <div className="eyebrow">YOUR CONTEXT</div>
      <h1>テーマ</h1>
      <p className="page-lead">何度も使う背景情報を、ひとまとめに。</p>
      <div className="theme-layout">
        <aside className="theme-list">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              aria-label="新しいテーマ名"
              placeholder="例：バイオデザイン"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
            <button className="secondary" disabled={!name.trim()}>
              <Plus size={16} />
              テーマを作る
            </button>
          </form>
          {themes.map((t) => (
            <button
              key={t.id}
              className={`theme-row ${selected === t.id ? 'selected' : ''}`}
              onClick={() =>
                void flush()
                  .then(() => setSelected(t.id))
                  .catch(report)
              }
            >
              <Layers size={16} />
              <span>
                {t.name}
                <small>
                  {t.context.terms.length}語 · {t.context.documents.length}資料
                </small>
              </span>
            </button>
          ))}
        </aside>
        <div className="theme-detail">
          {theme ? (
            <>
              <div className="section-heading">
                <h2>{theme.name}</h2>
                <button
                  className="icon-button"
                  aria-label="テーマを削除"
                  onClick={() => {
                    if (
                      confirm('テーマを削除しますか？ 過去の会議に保存された背景情報は残ります。')
                    )
                      void window.desktop.deleteTheme(theme.id).catch(report);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <ContextEditor
                key={theme.id}
                context={theme.context}
                owner={{ type: 'theme', id: theme.id }}
                save={(context) => window.desktop.saveTheme({ ...theme, context })}
                hasKey={hasKey}
                report={report}
              />
            </>
          ) : (
            <div className="empty-inline">
              <Layers size={28} />
              <h3>繰り返し使う知識をここに</h3>
              <p>テーマを作ると、次の会議から選ぶだけで背景情報を引き継げます。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
