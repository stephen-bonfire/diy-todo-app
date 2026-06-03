import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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

function resolveAsset(...parts: string[]): string {
  // In dev: <root>/build/...   In packaged app: <resources>/build/...
  const devPath = path.join(__dirname, '..', ...parts);
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.resourcesPath, ...parts);
}

function showAndFocus(win: BrowserWindow) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    icon: resolveAsset('build', 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => { mainWindow = null; });

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

function ensureWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  return mainWindow!;
}

function buildTray() {
  // Use a Template image — macOS auto-tints it for light/dark menu bar.
  const trayIconPath = resolveAsset('build', 'tray.png');
  const img = nativeImage.createFromPath(trayIconPath);
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Todo List');

  const showApp = () => {
    const win = ensureWindow();
    showAndFocus(win);
  };

  tray.on('click', showApp);

  const menu = Menu.buildFromTemplate([
    { label: 'Open Todo List', click: showApp },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

app.whenReady().then(() => {
  buildMenu();
  buildTray();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  const win = ensureWindow();
  showAndFocus(win);
});
