const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const automation = require('./automation');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register('F8', () => {
    automation.stopFill();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stop-shortcut');
    }
  });

  globalShortcut.register('F7', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('start-shortcut');
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* -------- IPC: 枚举窗口 -------- */
ipcMain.handle('list-windows', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'] });
    return sources.map(s => ({ id: s.id, name: s.name }));
  } catch (e) {
    return [];
  }
});

/* -------- IPC: 开始自动填色 -------- */
ipcMain.handle('start-fill', async (event, params) => {
  return automation.startFill(params, (progress) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fill-progress', progress);
    }
  });
});

/* -------- IPC: 停止自动填色 -------- */
ipcMain.handle('stop-fill', async () => {
  automation.stopFill();
});
