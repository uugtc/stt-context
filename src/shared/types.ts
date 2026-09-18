export interface Term {
  id: string;
  word: string;
  reading: string;
}
export interface ReferenceDocument {
  id: string;
  name: string;
  text: string;
  digest: string;
  terms: Term[];
  status: 'extracted' | 'analyzed';
}
export interface ContextData {
  notes: string;
  terms: Term[];
  documents: ReferenceDocument[];
}
export interface Theme {
  id: string;
  name: string;
  context: ContextData;
}
export interface ContextSnapshot {
  prompt: string;
  terms: Term[];
  createdAt: string;
  truncated: boolean;
}
export interface Segment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  originalSpeaker: string;
  originalText: string;
  text: string;
  refined: boolean;
  edited: boolean;
  candidate?: string;
  warning?: string;
  recognizedText?: string;
  revisions?: { text: string; speaker: string; savedAt: string }[];
}
export interface SummaryItem {
  text: string;
  evidence: string[];
}
export interface ActionItem extends SummaryItem {
  owner: string | null;
  due: string | null;
}
export interface Summary {
  overview: string;
  topics: SummaryItem[];
  decisions: SummaryItem[];
  actions: ActionItem[];
  questions: SummaryItem[];
}
export type MeetingStatus = 'draft' | 'recording' | 'ready' | 'processing' | 'completed' | 'error';
export interface AudioPart {
  name: string;
  offset: number;
  duration: number;
  diarized: boolean;
}
export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  themeId: string | null;
  context: ContextData;
  themeContext: ContextData;
  status: MeetingStatus;
  stage: string;
  progress: number;
  error?: string;
  audioFile?: string;
  audioFingerprint?: string;
  duration: number;
  segments: Segment[];
  speakerNames: Record<string, string>;
  summary?: Summary;
  summaryStale: boolean;
  snapshot?: ContextSnapshot;
  parts: AudioPart[];
  processingModel?: string;
  recordingStartedAt?: string;
}
export interface Settings {
  transcriptionModel: string;
  summaryModel: string;
  ffmpegPath: string;
  hasApiKey: boolean;
  encryptionAvailable: boolean;
}
export interface AppState {
  meetings: Meeting[];
  themes: Theme[];
  settings: Settings;
}
export type TrackName = 'mixed' | 'mic' | 'system';
export interface DesktopAPI {
  state(): Promise<AppState>;
  createMeeting(input: { title: string; themeId: string | null; notes: string }): Promise<Meeting>;
  updateMeeting(
    id: string,
    input: { title?: string; context?: ContextData; speakerNames?: Record<string, string> },
  ): Promise<void>;
  deleteMeeting(id: string, deleteAudio: boolean): Promise<void>;
  saveTheme(theme: Theme): Promise<void>;
  deleteTheme(id: string): Promise<void>;
  addDocument(owner: { type: 'meeting' | 'theme'; id: string }): Promise<void>;
  analyzeDocuments(owner: { type: 'meeting' | 'theme'; id: string }): Promise<void>;
  importAudio(id: string): Promise<boolean>;
  startRecording(id: string, tracks: TrackName[]): Promise<void>;
  appendRecording(id: string, track: TrackName, data: ArrayBuffer): Promise<void>;
  finishRecording(id: string): Promise<void>;
  processMeeting(id: string): Promise<void>;
  cancelProcessing(id: string): Promise<void>;
  editSegment(id: string, segmentId: string, text: string, speaker: string): Promise<void>;
  retranscribe(id: string, segmentId: string, hint: string): Promise<void>;
  applyCandidate(id: string, segmentId: string, accept: boolean): Promise<void>;
  summarize(id: string): Promise<void>;
  exportMeeting(id: string, format: 'md' | 'txt'): Promise<void>;
  saveSettings(input: {
    apiKey?: string;
    transcriptionModel: string;
    summaryModel: string;
    ffmpegPath: string;
  }): Promise<void>;
  removeApiKey(): Promise<void>;
  checkEnvironment(): Promise<{ ffmpeg: boolean; microphone: string; screen: string }>;
  onChange(callback: () => void): () => void;
}
export const emptyContext = (): ContextData => ({ notes: '', terms: [], documents: [] });
export const defaultSettings = {
  transcriptionModel: 'gpt-4o-transcribe',
  summaryModel: 'gpt-5.6-luna',
  ffmpegPath: '',
};
