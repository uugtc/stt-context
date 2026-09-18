import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  desktopCapturer,
  safeStorage,
  protocol,
  net,
  systemPreferences,
  powerSaveBlocker,
} from 'electron';
import { join, basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { appendFile, copyFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store';
import { Media } from './media';
import { OpenAIProvider } from './openai';
import { Pipeline, safeError } from './pipeline';
import { readDocument } from './documents';
import { exportText } from './export';
import { applyCandidate, editSegment } from '../shared/segments';
import {
  contextSchema,
  idSchema,
  ownerSchema,
  settingsSchema,
  themeSchema,
} from '../shared/validation';
import type { ContextData, TrackName } from '../shared/types';

// Test runs get a separate profile, never the user's real recordings/settings.
if (process.env.STT_TEST_DATA) app.setPath('userData', resolve(process.env.STT_TEST_DATA));
app.setName('STT Context');
// ScreenCaptureKit permissions work consistently in dev and packaged builds.
app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'stt-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let win: BrowserWindow;
let store: Store;
let pipeline: Pipeline;
const recordings = new Map<
  string,
  { tracks: Set<TrackName>; queue: Promise<void>; blocker: number; failed?: string }
>();
const documentJobs = new Set<string>();
const notify = () => {
  if (win && !win.isDestroyed()) win.webContents.send('state-changed');
};
async function recoverRecordings() {
  for (const [id, recording] of recordings) {
    // Claim the session before awaiting pending file writes so recovery runs once.
    recordings.delete(id);
    await recording.queue.catch(() => {});
    const meeting = store.getMeeting(id);
    store.saveMeeting({
      ...meeting,
      status: 'error',
      stage: '録音が中断されました',
      duration: Math.max(
        0,
        (Date.now() - Date.parse(meeting.recordingStartedAt || meeting.createdAt)) / 1000,
      ),
      error:
        '録音画面が閉じられたため中断しました。保存済みの音声を再生して確認し、処理を開始できます。',
    });
    if (powerSaveBlocker.isStarted(recording.blocker)) powerSaveBlocker.stop(recording.blocker);
  }
  notify();
}
const keyFile = () => join(app.getPath('userData'), 'api-key.enc');
function getKey(): string {
  if (!existsSync(keyFile())) throw new Error('設定からOpenAI APIキーを登録してください。');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('キーチェーンを利用できません。');
  return safeStorage.decryptString(readFileSync(keyFile()));
}
function ai(transcriptionModel?: string) {
  const settings = store.settings();
  return new OpenAIProvider(
    getKey(),
    transcriptionModel || settings.transcriptionModel,
    settings.summaryModel,
  );
}
function idle(id: string) {
  if (pipeline.busy(id) || recordings.has(id) || documentJobs.has(id))
    throw new Error('処理または録音が終わってから操作してください。');
}
function ownerContext(owner: z.infer<typeof ownerSchema>): ContextData {
  return owner.type === 'meeting'
    ? store.getMeeting(owner.id).context
    : store.getTheme(owner.id).context;
}
function saveOwnerContext(owner: z.infer<typeof ownerSchema>, context: ContextData) {
  if (owner.type === 'meeting') store.saveMeeting({ ...store.getMeeting(owner.id), context });
  else store.saveTheme({ ...store.getTheme(owner.id), context });
  notify();
}
function register<T extends z.ZodTuple>(
  name: string,
  schema: T,
  handler: (...args: z.infer<T>) => unknown,
) {
  ipcMain.handle(name, async (event, ...args: unknown[]) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw new Error('許可されていない操作です。');
    try {
      return await handler(...schema.parse(args));
    } catch (error) {
      throw new Error(safeError(error));
    }
  });
}
function registerHandlers() {
  register('state', z.tuple([]), () => ({
    meetings: store.meetings(),
    themes: store.themes(),
    settings: {
      ...store.settings(),
      hasApiKey: existsSync(keyFile()),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    },
  }));
  register(
    'createMeeting',
    z.tuple([
      z.object({
        title: z.string().max(200),
        themeId: idSchema.nullable(),
        notes: z.string().max(100000),
      }),
    ]),
    (input) => {
      const meeting = store.createMeeting(input);
      notify();
      return meeting;
    },
  );
  register(
    'updateMeeting',
    z.tuple([
      idSchema,
      z.object({
        title: z.string().min(1).max(200).optional(),
        context: contextSchema.optional(),
        speakerNames: z.record(z.string(), z.string().min(1).max(100)).optional(),
      }),
    ]),
    (id, input) => {
      idle(id);
      const meeting = store.getMeeting(id);
      store.saveMeeting({
        ...meeting,
        ...input,
        summaryStale: input.speakerNames ? !!meeting.summary : meeting.summaryStale,
      });
      notify();
    },
  );
  register('deleteMeeting', z.tuple([idSchema, z.boolean()]), (id, deleteAudio) => {
    idle(id);
    store.getMeeting(id);
    if (deleteAudio) rmSync(store.meetingDir(id), { recursive: true, force: true });
    store.deleteMeeting(id);
    notify();
  });
  register('saveTheme', z.tuple([themeSchema]), (theme) => {
    if (documentJobs.has(theme.id)) throw new Error('資料を整理中です。');
    store.saveTheme(theme);
    notify();
  });
  register('deleteTheme', z.tuple([idSchema]), (id) => {
    if (documentJobs.has(id)) throw new Error('資料を整理中です。');
    store.deleteTheme(id);
    notify();
  });
  register('addDocument', z.tuple([ownerSchema]), async (owner) => {
    idle(owner.id);
    const selected = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '背景資料', extensions: ['pdf', 'txt', 'md', 'markdown'] }],
    });
    if (selected.canceled) return;
    const context = ownerContext(owner);
    if (context.documents.length + selected.filePaths.length > 30)
      throw new Error('資料は30件まで追加できます。');
    documentJobs.add(owner.id);
    try {
      for (const file of selected.filePaths) {
        if (statSync(file).size > 20 * 1024 * 1024)
          throw new Error('資料は20MB以内にしてください。');
        const doc = await readDocument(file);
        const dir = join(store.root, 'documents');
        mkdirSync(dir, { recursive: true });
        await copyFile(file, join(dir, doc.id + extname(file).toLowerCase()));
        context.documents.push(doc);
        saveOwnerContext(owner, context);
      }
    } finally {
      documentJobs.delete(owner.id);
    }
  });
  register('analyzeDocuments', z.tuple([ownerSchema]), async (owner) => {
    idle(owner.id);
    const provider = ai();
    const context = ownerContext(owner);
    documentJobs.add(owner.id);
    try {
      for (const doc of context.documents) {
        if (doc.status === 'analyzed') continue;
        const result = await provider.analyze(doc.text);
        doc.digest = result.digest;
        doc.terms = result.words.map((t) => ({ ...t, id: randomUUID() }));
        doc.status = 'analyzed';
        saveOwnerContext(owner, context);
      }
    } finally {
      documentJobs.delete(owner.id);
    }
  });
  register('importAudio', z.tuple([idSchema]), async (id) => {
    idle(id);
    const meeting = store.getMeeting(id);
    if (meeting.audioFile)
      throw new Error('既存の音声は置き換えられません。新しい会議に取り込んでください。');
    const selected = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: '音声', extensions: ['mp3', 'm4a', 'wav', 'webm', 'mp4', 'aac', 'flac', 'ogg'] },
      ],
    });
    if (selected.canceled) return false;
    const source = selected.filePaths[0];
    if (statSync(source).size > 2 * 1024 ** 3) throw new Error('音声は2GB以内にしてください。');
    const name = 'source' + extname(source).toLowerCase();
    await copyFile(source, join(store.meetingDir(id), name));
    store.saveMeeting({ ...meeting, audioFile: name, status: 'ready' });
    notify();
    return true;
  });
  register(
    'startRecording',
    z.tuple([
      idSchema,
      z
        .array(z.enum(['mixed', 'mic', 'system']))
        .min(1)
        .max(3),
    ]),
    async (id, tracks) => {
      idle(id);
      if (recordings.size) throw new Error('別の会議を録音中です。');
      const meeting = store.getMeeting(id);
      if (meeting.audioFile) throw new Error('この会議にはすでに音声があります。');
      if (!tracks.includes('mixed')) throw new Error('ミックス音声が必要です。');
      for (const track of tracks)
        await writeFile(join(store.meetingDir(id), `${track}.webm`), Buffer.alloc(0));
      recordings.set(id, {
        tracks: new Set(tracks),
        queue: Promise.resolve(),
        blocker: powerSaveBlocker.start('prevent-app-suspension'),
      });
      store.saveMeeting({
        ...meeting,
        audioFile: 'mixed.webm',
        status: 'recording',
        recordingStartedAt: new Date().toISOString(),
      });
      notify();
    },
  );
  register(
    'appendRecording',
    z.tuple([idSchema, z.enum(['mixed', 'mic', 'system']), z.instanceof(ArrayBuffer)]),
    async (id, track, data) => {
      const recording = recordings.get(id);
      if (!recording?.tracks.has(track)) throw new Error('録音セッションがありません。');
      if (data.byteLength > 8 * 1024 * 1024) throw new Error('録音バッファが大きすぎます。');
      recording.queue = recording.queue.then(() =>
        appendFile(join(store.meetingDir(id), `${track}.webm`), Buffer.from(data)),
      );
      try {
        await recording.queue;
      } catch (error) {
        recording.failed = safeError(error);
        throw error;
      }
    },
  );
  register('finishRecording', z.tuple([idSchema]), async (id) => {
    const recording = recordings.get(id);
    if (!recording) return;
    try {
      await recording.queue;
      const meeting = store.getMeeting(id);
      if (!statSync(join(store.meetingDir(id), 'mixed.webm')).size)
        throw new Error('音声が保存されていません。録音権限を確認してください。');
      const duration = Math.max(
        0,
        (Date.now() - Date.parse(meeting.recordingStartedAt || meeting.createdAt)) / 1000,
      );
      store.saveMeeting({ ...meeting, status: 'ready', duration });
    } catch (error) {
      store.saveMeeting({ ...store.getMeeting(id), status: 'error', error: safeError(error) });
      throw error;
    } finally {
      recordings.delete(id);
      powerSaveBlocker.stop(recording.blocker);
      notify();
    }
  });
  register('processMeeting', z.tuple([idSchema]), (id) => {
    idle(id);
    getKey();
    void pipeline.run(id).catch((error) => {
      const m = store.getMeeting(id);
      if (m.status !== 'error')
        store.saveMeeting({ ...m, status: 'error', error: safeError(error) });
      notify();
    });
  });
  register('cancelProcessing', z.tuple([idSchema]), (id) => pipeline.cancel(id));
  register(
    'editSegment',
    z.tuple([idSchema, z.string().max(100), z.string().max(50000), z.string().max(100)]),
    (id, segmentId, text, speaker) => {
      idle(id);
      const m = store.getMeeting(id);
      if (!m.segments.some((s) => s.id === segmentId)) throw new Error('発言が見つかりません。');
      m.segments = m.segments.map((s) => (s.id === segmentId ? editSegment(s, text, speaker) : s));
      m.summaryStale = !!m.summary;
      store.saveMeeting(m);
      notify();
    },
  );
  register(
    'retranscribe',
    z.tuple([idSchema, z.string().max(100), z.string().max(10000)]),
    (id, segmentId, hint) => {
      idle(id);
      return pipeline.retranscribe(id, segmentId, hint);
    },
  );
  register(
    'applyCandidate',
    z.tuple([idSchema, z.string().max(100), z.boolean()]),
    (id, segmentId, accept) => {
      idle(id);
      const m = store.getMeeting(id);
      m.segments = m.segments.map((s) => (s.id === segmentId ? applyCandidate(s, accept) : s));
      if (accept) m.summaryStale = !!m.summary;
      store.saveMeeting(m);
      notify();
    },
  );
  register('summarize', z.tuple([idSchema]), (id) => {
    idle(id);
    return pipeline.summarize(id);
  });
  register('exportMeeting', z.tuple([idSchema, z.enum(['md', 'txt'])]), async (id, format) => {
    const meeting = store.getMeeting(id);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${meeting.title.replace(/[/\\:]/g, '-')}.${format}`,
      filters: [{ name: format, extensions: [format] }],
    });
    if (result.filePath)
      await writeFile(result.filePath, exportText(meeting, format === 'md'), 'utf8');
  });
  register('saveSettings', z.tuple([settingsSchema]), (input) => {
    const { apiKey, ...settings } = input;
    if (apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('キーチェーンを利用できないためキーを保存できません。');
      writeFileSync(keyFile() + '.tmp', safeStorage.encryptString(apiKey.trim()), { mode: 0o600 });
      renameSync(keyFile() + '.tmp', keyFile());
    }
    store.saveSettings(settings);
    notify();
  });
  register('removeApiKey', z.tuple([]), () => {
    rmSync(keyFile(), { force: true });
    notify();
  });
  register('checkEnvironment', z.tuple([]), async () => ({
    ffmpeg: await new Media(store.settings().ffmpegPath).available(),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  }));
}

app
  .whenReady()
  .then(() => {
    store = new Store(app.getPath('userData'));
    pipeline = new Pipeline(store, ai, () => new Media(store.settings().ffmpegPath), notify);
    protocol.handle('stt-media', async (request) => {
      try {
        const url = new URL(request.url);
        const id = idSchema.parse(url.pathname.slice(1));
        if (url.hostname !== 'meeting') return new Response(null, { status: 404 });
        const m = store.getMeeting(id);
        if (!m.audioFile || basename(m.audioFile) !== m.audioFile)
          return new Response(null, { status: 404 });
        return net.fetch(pathToFileURL(join(store.meetingDir(id), m.audioFile)).toString(), {
          headers: request.headers,
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    const devURL = process.env.ELECTRON_RENDERER_URL;
    const trusted = (url: string) =>
      devURL
        ? url.startsWith(devURL + '/') || url === devURL
        : url.startsWith(pathToFileURL(join(__dirname, '../renderer/')).toString());
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, origin) =>
        contents === win?.webContents &&
        ['media', 'display-capture'].includes(permission) &&
        (origin === 'file://' || (!!devURL && origin === new URL(devURL).origin)),
    );
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(
        contents === win?.webContents &&
          trusted(contents.getURL()) &&
          ['media', 'display-capture'].includes(permission),
      ),
    );
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!win || request.frame !== win.webContents.mainFrame) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {});
      } catch {
        callback({});
      }
    });
    win = new BrowserWindow({
      width: 1240,
      height: 840,
      minWidth: 900,
      minHeight: 620,
      backgroundColor: '#f6f7f9',
      title: 'STT Context',
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('did-start-loading', () => {
      void recoverRecordings();
    });
    win.webContents.on('render-process-gone', () => {
      void recoverRecordings();
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!trusted(url)) event.preventDefault();
    });
    win.on('close', (event) => {
      if (recordings.size) {
        event.preventDefault();
        dialog.showMessageBoxSync(win, {
          type: 'info',
          message: '録音を停止してからウィンドウを閉じてください。',
          buttons: ['戻る'],
        });
      }
    });
    registerHandlers();
    if (devURL) void win.loadURL(devURL);
    else void win.loadFile(join(__dirname, '../renderer/index.html'));
  })
  .catch((error) => {
    console.error(safeError(error));
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  for (const m of store?.meetings() || []) pipeline.cancel(m.id);
});
