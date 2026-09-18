import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/types';
const invoke =
  (name: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(name, ...args);
const api: DesktopAPI = {
  state: invoke('state'),
  createMeeting: invoke('createMeeting'),
  updateMeeting: invoke('updateMeeting'),
  deleteMeeting: invoke('deleteMeeting'),
  saveTheme: invoke('saveTheme'),
  deleteTheme: invoke('deleteTheme'),
  addDocument: invoke('addDocument'),
  analyzeDocuments: invoke('analyzeDocuments'),
  importAudio: invoke('importAudio'),
  startRecording: invoke('startRecording'),
  appendRecording: invoke('appendRecording'),
  finishRecording: invoke('finishRecording'),
  processMeeting: invoke('processMeeting'),
  cancelProcessing: invoke('cancelProcessing'),
  editSegment: invoke('editSegment'),
  retranscribe: invoke('retranscribe'),
  applyCandidate: invoke('applyCandidate'),
  summarize: invoke('summarize'),
  exportMeeting: invoke('exportMeeting'),
  saveSettings: invoke('saveSettings'),
  removeApiKey: invoke('removeApiKey'),
  checkEnvironment: invoke('checkEnvironment'),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('state-changed', listener);
    return () => ipcRenderer.removeListener('state-changed', listener);
  },
};
contextBridge.exposeInMainWorld('desktop', api);
