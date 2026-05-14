import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  load: (): Promise<string | null> => ipcRenderer.invoke('outline:load'),
  save: (json: string): Promise<void> => ipcRenderer.invoke('outline:save', json),
  onToggleShortcuts: (cb: () => void) => {
    ipcRenderer.on('toggle-shortcuts', cb);
  },
});
