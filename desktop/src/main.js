const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Menu, shell, session, desktopCapturer, ipcMain, systemPreferences, dialog,
} = require('electron');

const PROTOCOL = 'meetsphere';
const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.config.json'), 'utf8'));

let win = null;
let pendingLink = null; // meetsphere:// link received before the window existed

// ------------------------------------------------------------------ config
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } };
const writeConfig = (patch) => {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...patch }, null, 2)); } catch { /* read-only profile */ }
};

function normalizeUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  return u.origin;
}
const serverUrl = () => normalizeUrl(process.env.MEETSPHERE_URL) || normalizeUrl(readConfig().serverUrl) || normalizeUrl(bundled.serverUrl) || 'http://localhost:5000';
const serverOrigin = () => new URL(serverUrl()).origin;

// ------------------------------------------------------------------ window
function loadApp(pathname = '/') {
  win?.loadURL(`${serverUrl()}${pathname}`);
}
function showConnectPage(error = '') {
  win?.loadFile(path.join(__dirname, 'connect.html'), { query: { url: serverUrl(), error } });
}

function createWindow() {
  const b = readConfig().bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 800, x: b.x, y: b.y, minWidth: 900, minHeight: 600,
    title: 'MeetSphere', backgroundColor: '#0e1224', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', () => { if (!win.isMaximized() && !win.isMinimized()) writeConfig({ bounds: win.getBounds() }); });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) showConnectPage(desc); // -3 = aborted (normal during redirects)
  });
  // Links: stay inside the app for our own server and for Google/Firebase sign-in popups; everything else opens the browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAuthUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, parent: win } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file://') || new URL(url).origin === serverOrigin()) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  if (pendingLink) { handleLink(pendingLink); pendingLink = null; } else loadApp('/');
}

const isAuthUrl = (url) => {
  try {
    const h = new URL(url).hostname;
    return h === 'accounts.google.com' || h.endsWith('.firebaseapp.com') || h.endsWith('.google.com');
  } catch { return false; }
};

// ------------------------------------------------------------------ meetsphere:// links
function handleLink(link) {
  const m = /^meetsphere:\/\/(?:join|meeting)\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i.exec(String(link));
  if (!m || !CODE_RE.test(m[1].toLowerCase())) return;
  if (!win) { pendingLink = link; return; }
  if (win.isMinimized()) win.restore();
  win.focus();
  loadApp(`/meeting/${m[1].toLowerCase()}`);
}
const linkFromArgv = (argv) => argv.find((a) => a.startsWith(`${PROTOCOL}://`));

// ------------------------------------------------------------------ permissions + screen sharing
function setupSession() {
  const ses = session.defaultSession;
  // Google blocks sign-in from user agents that contain "Electron"; present as plain Chromium.
  ses.setUserAgent(ses.getUserAgent().replace(/\sElectron\/\S+/, '').replace(/\sMeetSphere\/\S+/i, ''));

  const allowed = new Set(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'notifications']);
  const fromOurServer = (origin) => origin === serverOrigin();
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && fromOurServer(new URL(details.requestingUrl || wc.getURL()).origin));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && fromOurServer(origin));

  // getDisplayMedia() (screen share): let the user pick a screen or window from a native menu.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; callback(v); } };
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return answer({});
      const menu = Menu.buildFromTemplate([
        { label: 'Share a screen or window', enabled: false },
        { type: 'separator' },
        ...sources.slice(0, 20).map((s) => ({ label: `${s.id.startsWith('screen') ? 'Screen: ' : ''}${s.name.slice(0, 70)}`, click: () => answer({ video: s }) })),
        { type: 'separator' },
        { label: 'Cancel', click: () => answer({}) },
      ]);
      menu.popup({ window: win, callback: () => setTimeout(() => answer({}), 300) });
    } catch { answer({}); }
  }, { useSystemPicker: true });
}

async function askMacMediaAccess() {
  if (process.platform !== 'darwin') return;
  for (const kind of ['microphone', 'camera']) {
    try { await systemPreferences.askForMediaAccess(kind); } catch { /* user denied */ }
  }
}

// ------------------------------------------------------------------ IPC (only our local connect page may change settings)
const fromLocalPage = (e) => !!e.senderFrame?.url.startsWith('file://');
ipcMain.handle('config:get', (e) => (fromLocalPage(e) ? { serverUrl: serverUrl(), defaultUrl: bundled.serverUrl, version: app.getVersion() } : null));
ipcMain.handle('config:set', (e, url) => {
  if (!fromLocalPage(e)) return { ok: false };
  const n = normalizeUrl(url);
  if (!n) return { ok: false, error: 'Enter a full address such as https://meet.example.com' };
  writeConfig({ serverUrl: n });
  loadApp('/');
  return { ok: true };
});
ipcMain.handle('app:retry', (e) => { if (fromLocalPage(e)) loadApp('/'); });

// ------------------------------------------------------------------ menu
function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'MeetSphere', submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+H', click: () => loadApp('/') },
      { label: 'Server settings…', click: () => showConnectPage() },
      { label: 'Open in browser', click: () => shell.openExternal(serverUrl()) },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'About MeetSphere', click: () => dialog.showMessageBox(win, { type: 'info', title: 'MeetSphere', message: `MeetSphere ${app.getVersion()}`, detail: `Connected to ${serverUrl()}\nElectron ${process.versions.electron}` }) }] },
  ]));
}

// ------------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = linkFromArgv(argv);
    if (link) handleLink(link);
    else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-url', (e, url) => { e.preventDefault(); handleLink(url); }); // macOS
  pendingLink = linkFromArgv(process.argv);

  app.whenReady().then(async () => {
    if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
    else app.setAsDefaultProtocolClient(PROTOCOL);
    setupSession();
    buildMenu();
    await askMacMediaAccess();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
