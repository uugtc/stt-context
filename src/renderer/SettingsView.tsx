import { useState } from 'react';
import { Check, KeyRound, ShieldCheck, Wrench } from 'lucide-react';
import type { Settings } from '../shared/types';
export default function SettingsView({
  settings,
  report,
}: {
  settings: Settings;
  report: (error: unknown) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(settings.transcriptionModel);
  const [summaryModel, setSummaryModel] = useState(settings.summaryModel);
  const [ffmpeg, setFfmpeg] = useState(settings.ffmpegPath);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ ffmpeg: boolean; microphone: string; screen: string }>();
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page narrow">
      <div className="eyebrow">PREFERENCES</div>
      <h1>設定</h1>
      <p className="page-lead">録音はこのMacに。AI処理はあなたのAPIキーで。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await window.desktop.saveSettings({
              apiKey: apiKey || undefined,
              transcriptionModel: model,
              summaryModel,
              ffmpegPath: ffmpeg,
            });
            setApiKey('');
            setSaved(true);
          });
        }}
      >
        <section className="settings-section">
          <h3>
            <KeyRound size={18} />
            OpenAI API
          </h3>
          <p>
            文字起こしでは音声と背景情報、資料整理では抽出文章、要約では文字起こしをOpenAIへ送信します。API利用料金は別途かかります。
          </p>
          <label>
            APIキー {settings.hasApiKey && <span className="success">登録済み</span>}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
              }}
              placeholder={settings.hasApiKey ? '変更するときだけ入力' : 'sk-…'}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="small">
            <ShieldCheck size={14} />
            キーはmacOSのキーチェーンに基づく暗号化で保存し、画面には読み戻しません。
          </p>
          {!settings.encryptionAvailable && (
            <p className="error-inline">暗号化を利用できません。APIキーは保存できません。</p>
          )}
          <label>
            音声認識モデル
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="gpt-4o-transcribe">GPT-4o Transcribe（標準）</option>
              <option value="gpt-4o-mini-transcribe">GPT-4o Mini Transcribe</option>
              <option value="gpt-transcribe">GPT Transcribe（利用可能な場合）</option>
            </select>
          </label>
          <label>
            要約・資料整理モデル
            <input
              value={summaryModel}
              onChange={(e) => setSummaryModel(e.target.value)}
              required
              pattern="[a-zA-Z0-9._-]+"
            />
          </label>
        </section>
        <section className="settings-section">
          <h3>
            <Wrench size={18} />
            音声の処理
          </h3>
          <p>音声の分割・変換にFFmpegを使用します。通常のHomebrewの場所から自動検出します。</p>
          <label>
            FFmpegの実行ファイル（任意）
            <input
              value={ffmpeg}
              onChange={(e) => setFfmpeg(e.target.value)}
              placeholder="自動検出 /opt/homebrew/bin/ffmpeg"
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void run(async () => setCheck(await window.desktop.checkEnvironment()))}
          >
            保存済みの設定を確認
          </button>
          {check && (
            <dl className="diagnostics">
              <dt>FFmpeg</dt>
              <dd>{check.ffmpeg ? '利用できます' : '見つかりません'}</dd>
              <dt>マイク権限</dt>
              <dd>{permissionLabel(check.microphone)}</dd>
              <dt>画面・音声取得</dt>
              <dd>{permissionLabel(check.screen)}</dd>
            </dl>
          )}
        </section>
        <div className="editor-footer">
          <span>
            {saved && (
              <>
                <Check size={15} />
                保存しました
              </>
            )}
          </span>
          <button className="primary" disabled={busy}>
            設定を保存
          </button>
        </div>
      </form>
      {settings.hasApiKey && (
        <button
          className="text-button danger"
          disabled={busy}
          onClick={() => void run(() => window.desktop.removeApiKey())}
        >
          保存済みAPIキーを削除
        </button>
      )}
    </div>
  );
}
function permissionLabel(value: string) {
  return (
    (
      {
        granted: '許可済み',
        denied: '未許可（システム設定で変更）',
        'not-determined': '録音開始時に確認',
        restricted: '制限されています',
        unknown: '未確認',
      } as Record<string, string>
    )[value] || value
  );
}
