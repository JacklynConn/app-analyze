const { app, BrowserWindow, Menu, shell, Notification, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#07090d',
    title: 'XAUUSD PULSE PRO — Gold Signal Scanner',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(__dirname, '../build/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Native desktop notification for new signals (works even when app is in background)
  ipcMain.on('notify-signal', (_e, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const template = [
    { label: 'File', submenu: [{ role: 'quit', label: 'Quit / ចេញ' }] },
    { label: 'View', submenu: [{ role: 'reload', label: 'Reload' }, { role: 'togglefullscreen', label: 'Fullscreen' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'DevTools' }] },
    { label: 'Help', submenu: [{ label: 'XAUUSD PULSE PRO v2.0 — Free forever, no KEY needed', click: () => shell.openExternal('https://github.com/JacklynConn/app-analyze') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
