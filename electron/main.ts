import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const DEV_URL = process.env.ELECTRON_RENDERER_URL;

function dataFile(): string {
  return path.join(app.getPath('userData'), 'outline.json');
}

ipcMain.handle('outline:load', async () => {
  try {
    const raw = await fs.promises.readFile(dataFile(), 'utf8');
    return raw;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
});

ipcMain.handle('outline:save', async (_e, json: string) => {
  const file = dataFile();
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, json, 'utf8');
  await fs.promises.rename(tmp, file);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Catch Cmd+\ at the lowest level — fires before any renderer keydown listener
  // or menu accelerator, so layout/focus/key-eating issues don't matter.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!input.meta) return;
    if (input.code === 'Slash' || input.key === '/') {
      event.preventDefault();
      win.webContents.send('toggle-shortcuts');
    }
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            win?.webContents.send('toggle-shortcuts');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
