# STT Context Implementation Plan

**Goal:** 背景情報付きの会議録音・文字起こし・要約を行うローカルMacアプリの初版。
**Architecture:** Electron mainで保存/外部API/FFmpegを扱い、限定preload経由でReactへ公開。録音はrendererのMediaRecorder、復旧可能なローカル保存と段階的処理。
**Tech Stack:** TypeScript、Electron、React、Vite、SQLite、OpenAI、FFmpeg。
**Spec:** ../specs/2026-09-17-stt-context-design.md
**Execution:** 同一セッションで順に実行。空の作業フォルダのためworktree不要。ユーザー指定に従いgit init/commitはしない。

## 制約
- macOS 15以降、フルXcodeを前提にしない。
- APIキーはmainのみ、safeStorageで保護。資料の命令はデータとして扱う。
- UIの読みやすさと実際に使える操作を優先。録音内容/資料を開発ログに出さない。
- 明示的なAPI設定までは外部へ音声や資料を送らない。

## Tasks
- [x] 1. 設定・モデル・文脈作成とテスト
  - package.json、electron.vite.config.ts、src/shared/{types,context,segments}.ts、tests/core.test.ts。
  - 文脈優先度/長さ、無効な区間、話者ID、再認識と手動修正の保護を先にテスト。
- [x] 2. 保存・音声変換・APIジョブ
  - src/main/{store,media,openai,pipeline}.ts、tests/{store,pipeline,media}.test.ts。
  - DBはnode:sqliteでJSONレコードとメタデータを永続化、ファイル操作はmainが所有するIDでのみ指定。
  - 元音声→上限内の圧縮分割→話者識別→区間音声再認識→根拠付き要約。完了段階と入力のhashを保持し再開。
  - 危険箇所: 範囲は0<=start<end<=durationを検査。話者ラベルは分割ごと名前空間を付け誤統合を防ぐ。区間再認識はcandidate保存のみ。
  - 外部APIはテストでtransportを差し替え、保存/変換/ジョブ制御は実行する。
- [x] 3. Electronと録音
  - src/main/index.ts、src/preload/index.ts、src/renderer/recorder.ts。
  - IPC入力検証、ナビゲーション制限、録音開始/追記/停止の所有権、独立トラック/ミックス、メーター、切断検知。
  - 権限なしで静かに失敗しない。停止後に録音バッファの書き込み完了を待つ。
- [x] 4. UIと編集
  - src/renderer/{App,MeetingView,ThemesView,SettingsView}.tsx、styles.css。
  - 会議一覧、作成/取り込み、テーマ資料/語彙管理、録音メーター、根拠付き要約、編集/話者名/再認識候補/書出し。
  - サンプル表示は明示的なデモのみ。実データの初期状態に架空会議を混ぜない。
- [x] 5. 結合検証・配布用ビルド・README
  - tests/Electron smoke、README.md、.gitignore、build設定。
  - npm test、型検査、ビルド、Electronの画面を確認。テストは一時userDataで実行。
  - APIキーや録音権限で未実施の項目はREADME/最終回答で区別。精度比較用のサンプル評価手順を残す。

## 検証結果（2026-09-18）

- 自動テスト15件、型検査、整形チェック、プロダクションビルドが成功。
- 配布用 .app の生成成功（Apple Silicon、署名/公証なし）。
- 開発用Electronと生成した .app の両方で人工音声による結合テスト成功。
- 音声分割の累積時刻ずれ、再開時のモデル変更、編集履歴欠落、録音中のrenderer再読み込みからの復旧、背景の保存忘れを修正して再検証。
- 別担当のレビューは利用上限で実行できず、同一担当が再点検と回帰テストを実施。
- 実API・実マイク/システム音声・実会議の精度比較は未実施。キーはアプリ設定でユーザーが登録し、その後確認する。
