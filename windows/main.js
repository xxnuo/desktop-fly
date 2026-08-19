// main.js — the Electron main process: the Windows/Linux counterpart of
// AppDelegate in main.swift. It owns the transparent click-through overlay,
// the brain panel, the tray menu, and the permission-free environment senses.
//
// AppKit -> Electron/Win32 mapping:
//   NSPanel .borderless + ignoresMouseEvents -> BrowserWindow transparent,
//                                               frame:false, setIgnoreMouseEvents
//   NSStatusItem                             -> Tray
//   NSEvent.mouseLocation                    -> screen.getCursorScreenPoint()
//   CGEventSource idle                       -> powerMonitor.getSystemIdleTime()
//   CGWindowListCopyWindowInfo               -> platform.listWindows
//   NSScreen.screens                         -> screen.getAllDisplays()

import { app, BrowserWindow, Tray, Menu, screen, ipcMain, powerMonitor, nativeImage }
  from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBrainData } from './src/data.js';
import { circadianActivity, ThermalTempo } from './src/environment.js';
import {
  LANGUAGE_MODES, createTranslator, normalizeLanguageMode, resolveLanguage,
} from './src/i18n.js';
import * as win32 from './src/win32.js';
import * as linux from './src/linux.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEBUG = !!process.env.DESKTOPFLY_DEBUG;
const platform = process.platform === 'linux' ? linux : win32;
const platformName = process.platform === 'linux' ? 'linux/X11' : 'Windows';

let overlay = null;
let brain = null;
let tray = null;
let desktop = null;          // union of every display, in DIP
let paused = false;
let brainVisible = true;
let mouseTimer = null;
let windowTimer = null;
let typingLevel = 0;
let prevCursor = null;
let mouseMovedAt = 0;
const thermal = new ThermalTempo();

let brainData = null;
let dataInfo = null;
let languageMode = 'auto';
let languageFile = null;
let activeLanguage = 'en';
let translate = createTranslator(activeLanguage);

function t(key, values) { return translate(key, values); }

function systemLocales() {
  try {
    const preferred = typeof app.getPreferredSystemLanguages === 'function'
      ? app.getPreferredSystemLanguages() : [];
    const locale = typeof app.getLocale === 'function' ? app.getLocale() : '';
    return [...preferred, locale];
  } catch {
    return [];
  }
}

function updateLanguage() {
  activeLanguage = resolveLanguage(languageMode, systemLocales());
  translate = createTranslator(activeLanguage);
}

function loadLanguageMode() {
  languageFile = path.join(app.getPath('userData'), 'language.json');
  try {
    const saved = JSON.parse(fs.readFileSync(languageFile, 'utf8'));
    languageMode = normalizeLanguageMode(saved.mode);
  } catch {
    languageMode = 'auto';
  }
  updateLanguage();
}

function saveLanguageMode() {
  try {
    fs.mkdirSync(path.dirname(languageFile), { recursive: true });
    fs.writeFileSync(languageFile, `${JSON.stringify({ mode: languageMode })}\n`);
  } catch {
    // A read-only profile should not prevent the tray menu from working.
  }
}

function setLanguageMode(mode) {
  if (!LANGUAGE_MODES.includes(mode)) return;
  languageMode = mode;
  saveLanguageMode();
  updateLanguage();
  if (tray) {
    tray.setToolTip(t('trayTip'));
    refreshTray();
  }
  if (brain && !brain.isDestroyed()) {
    brain.setTitle(t('brainTitle'));
    send(brain, 'language', activeLanguage);
  }
}

function dataInfoLabel() {
  return dataInfo ? t('dataInfo', dataInfo) : t('noData');
}

// The overlay spans every display, so the fly can walk and fly from one
// monitor to the next the way it crosses any other part of the desktop.
// macOS pins the fly to one NSScreen and hops on a menu command; here the
// whole virtual desktop is one scene.
function virtualBounds() {
  const all = screen.getAllDisplays();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of all) {
    x0 = Math.min(x0, d.bounds.x); y0 = Math.min(y0, d.bounds.y);
    x1 = Math.max(x1, d.bounds.x + d.bounds.width);
    y1 = Math.max(y1, d.bounds.y + d.bounds.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// scene coordinates: origin at the center of the virtual desktop, +Y up
function toScene(x, y) {
  return {
    x: x - (desktop.x + desktop.width / 2),
    y: (desktop.y + desktop.height / 2) - y,
  };
}

// each display as a scene-space rect, so the fly never targets the dead
// corners of a non-rectangular multi-monitor layout
function screenRects() {
  return screen.getAllDisplays().map((d) => {
    const tl = toScene(d.bounds.x, d.bounds.y);
    const br = toScene(d.bounds.x + d.bounds.width, d.bounds.y + d.bounds.height);
    return { id: d.id, x0: tl.x, x1: br.x, y0: br.y, y1: tl.y };
  });
}

function createOverlay(b) {
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    transparent: true,
    frame: false,
    // resizable/movable must stay true: Windows clamps a fixed-size window to
    // one monitor's work area, which would cut the overlay down to a single
    // display while the scene still believes it spans the whole desktop.
    // (enableLargerThanScreen is macOS-only and does not help here.)
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  // Windows applies its own clamp at creation time; re-assert the full
  // virtual-desktop rect afterwards, then verify (see checkOverlayFit).
  win.setMinimumSize(1, 1);
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setIgnoreMouseEvents(true);                       // clicks pass through to the desktop
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pipeConsole(win, 'overlay');
  win.loadFile(path.join(HERE, 'renderer', 'overlay.html'));
  return win;
}

function createBrain(d) {
  const W = 340, H = 300;
  const win = new BrowserWindow({
    x: d.workArea.x + d.workArea.width - W - 18,
    y: d.workArea.y + d.workArea.height - H - 18,
    width: W,
    height: H,
    title: t('brainTitle'),
    backgroundColor: '#080a10',
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  win.setMenu(null);
  win.on('close', (e) => {           // closing hides, like orderOut on the NSPanel
    if (!app.isQuitting) { e.preventDefault(); win.hide(); brainVisible = false; }
  });
  pipeConsole(win, 'brain');
  win.loadFile(path.join(HERE, 'renderer', 'brain.html'));
  return win;
}

// Renderer errors are invisible in a windowless tray app; surface them.
function pipeConsole(win, tag) {
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (DEBUG || level >= 2) {
      process.stderr.write(`[${tag}] ${message} (${source}:${line})
`);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    process.stderr.write(`[${tag}] load failed: ${desc} (${code})
`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    process.stderr.write(`[${tag}] renderer gone: ${details.reason}
`);
  });
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function buildTrayMenu() {
  const multi = screen.getAllDisplays().length > 1;
  return Menu.buildFromTemplate([
    { label: t('appName'), enabled: false },
    { label: dataInfoLabel(), enabled: false },
    { type: 'separator' },
    {
      label: paused ? t('resume') : t('pause'),
      click: () => { paused = !paused; send(overlay, 'cmd', { name: 'pause', value: paused }); refreshTray(); },
    },
    {
      label: t('showBrain'),
      click: () => {
        if (!brain) return;
        brainVisible = !brainVisible;
        if (brainVisible) brain.show(); else brain.hide();
      },
    },
    { label: t('escapeTest'), click: () => send(overlay, 'cmd', { name: 'escapeTest' }) },
    {
      // Same electrode as clicking the cluster in the brain window, without
      // having to aim at a rotating point cloud.
      label: t('stimulate'),
      submenu: [
        ['groom', 'groom'],
        ['walk', 'walk'],
        ['backward', 'backward'],
        ['escape', 'escape'],
        ['wings', 'wings'],
        ['tap', 'tap'],
        ['steerLeft', 'steerLeft'],
        ['steerRight', 'steerRight'],
      ].map(([key, group]) => ({
        label: t(key),
        click: () => send(overlay, 'cmd', { name: 'stim', group }),
      })),
    },
    ...(multi ? [{ label: t('nextDisplay'), click: sendFlyToNextDisplay }] : []),
    { label: t('addFly'), click: () => send(overlay, 'cmd', { name: 'addFly' }) },
    { label: t('removeFly'), click: () => send(overlay, 'cmd', { name: 'removeFly' }) },
    { label: t('scare'), click: () => send(overlay, 'cmd', { name: 'scareAll' }) },
    {
      label: t('language'),
      submenu: [
        ['auto', 'languageAuto'],
        ['zh', 'languageZh'],
        ['en', 'languageEn'],
      ].map(([mode, key]) => ({
        label: t(key),
        type: 'radio',
        checked: languageMode === mode,
        click: () => setLanguageMode(mode),
      })),
    },
    { type: 'separator' },
    { label: t('quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() { if (tray) tray.setContextMenu(buildTrayMenu()); }

// The fly crosses monitors on its own now; this just gives it a nudge.
function sendFlyToNextDisplay() {
  send(overlay, 'cmd', { name: 'flyToNextDisplay' });
}

// A display was plugged in or unplugged: resize the overlay to the new
// virtual desktop and tell the scene about it.
function refitDesktop() {
  const want = virtualBounds();
  if (overlay && !overlay.isDestroyed()) {
    overlay.setBounds({ x: want.x, y: want.y, width: want.width, height: want.height });
  }
  publishGeometry();
  placeBrain();
  refreshTray();
}

// The window manager gets the final say on the overlay's rect, so the scene is
// always told the size the window actually has. Anything else and the fly
// walks into coordinates that are not on screen — it simply vanishes.
function publishGeometry() {
  if (!overlay || overlay.isDestroyed()) return;
  const b = overlay.getBounds();
  const want = virtualBounds();
  if (DEBUG && (b.width !== want.width || b.height !== want.height)) {
    process.stderr.write(`overlay bounds adjusted by ${platformName}: wanted ${want.width}x${want.height}, `
      + `got ${b.width}x${b.height}
`);
  }
  desktop = b;
  send(overlay, 'retarget', { width: b.width, height: b.height, screens: screenRects() });
}

function placeBrain() {
  if (!brain || brain.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const [W, H] = brain.getSize();
  brain.setPosition(d.workArea.x + d.workArea.width - W - 18,
                    d.workArea.y + d.workArea.height - H - 18);
}

function screenPointToDip(point) {
  if (process.platform === 'win32' && screen.screenToDipPoint) {
    return screen.screenToDipPoint(point);
  }
  if (process.platform !== 'linux') return point;
  // X11 tools report physical pixels while Electron normally exposes DIP.
  // At scaleFactor 1 this is a no-op; for scaled displays convert relative to
  // the display origin without affecting the virtual-desktop coordinates.
  const display = screen.getDisplayNearestPoint(point);
  const scale = display?.scaleFactor || 1;
  if (scale === 1) return point;
  return {
    x: display.bounds.x + (point.x - display.bounds.x * scale) / scale,
    y: display.bounds.y + (point.y - display.bounds.y * scale) / scale,
  };
}

// ---- environment senses ----

// 30 Hz: cursor, taps, typing, circadian hour, idleness, thermal tempo
function pollAmbient() {
  const cursor = screen.getCursorScreenPoint();
  const scene = toScene(cursor.x, cursor.y);

  const now = Date.now();
  const moved = prevCursor && Math.hypot(cursor.x - prevCursor.x, cursor.y - prevCursor.y) > 1.5;
  if (moved) mouseMovedAt = now;
  prevCursor = cursor;

  const buttons = platform.pollMouseButtons();
  if (buttons.left || buttons.right) {
    mouseMovedAt = now;
    // a global click = a tap on the fly's substrate -> sensory pathway
    send(overlay, 'tap', scene);
  }

  const idle = powerMonitor.getSystemIdleTime();   // seconds
  // typing = substrate vibration (when, never what). The system idle timer
  // says "someone touched an input device"; if the cursor did not move and no
  // button went down, that input was the keyboard.
  const typingNow = (idle < 1 && now - mouseMovedAt > 400) ? 1 : 0;
  typingLevel += (typingNow - typingLevel) * 0.15;

  const t = new Date();
  const h = t.getHours() + t.getMinutes() / 60;
  const sleepy = (idle > 600 && (h >= 22 || h < 6)) || idle > 1800;

  send(overlay, 'ambient', {
    mouse: scene,
    typing: typingLevel,
    sleepy,
    tempo: thermal.poll(),
    activity: circadianActivity(h),
  });
}

// ~1.4 Hz: window terrain and new-window looms
function pollWindows() {
  const W = desktop.width, H = desktop.height;
  const ledges = [];
  const newWindows = [];

  for (const w of platform.listWindows(process.pid)) {
    // Platform backends report physical pixels; Electron's geometry is in DIP.
    const tlp = screenPointToDip({ x: w.left, y: w.top });
    const brp = screenPointToDip({ x: w.right, y: w.bottom });
    const tl = toScene(tlp.x, tlp.y);
    const br = toScene(brp.x, brp.y);

    const topY = tl.y;
    const x0 = Math.max(tl.x, -W / 2 + 15);
    const x1 = Math.min(br.x, W / 2 - 15);
    if (topY < H / 2 - 8 && topY > -H / 2 + 8 && x1 - x0 > 100 && ledges.length < 12) {
      ledges.push({ y: topY, x0, x1, id: w.id });
    }
    newWindows.push({
      id: w.id,
      center: { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 },
      size: Math.max(br.x - tl.x, tl.y - br.y),
    });
  }
  if (DEBUG) {
    process.stderr.write(`terrain: ${newWindows.length} windows on display, `
      + `${ledges.length} walkable ledges`
      + (ledges.length ? ` [${ledges.map((l) => Math.round(l.y)).join(', ')}]` : '') + '\n');
  }
  send(overlay, 'terrain', { ledges, windows: newWindows });
}

// ---- app lifecycle ----

app.setAppUserModelId('com.desktopfly.windows');
// A transparent, always-on-top overlay does not need to steal focus.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(() => {
  loadLanguageMode();
  brainData = loadBrainData();
  if (brainData) {
    dataInfo = {
      points: brainData.points.points.length,
      neurons: brainData.circuit.neurons.length,
      edges: brainData.circuit.edges.length,
    };
  }
  if (!platform.linuxAvailable?.() && !platform.win32Available?.()) {
    process.stderr.write(`${platformName}: some desktop senses are unavailable\n`);
  }

  desktop = virtualBounds();
  overlay = createOverlay(desktop);
  overlay.webContents.once('did-finish-load', publishGeometry);
  overlay.on('resize', publishGeometry);
  overlay.on('move', publishGeometry);
  if (brainData) brain = createBrain(screen.getPrimaryDisplay());

  tray = new Tray(nativeImage.createFromPath(path.join(HERE, 'assets', 'tray.png')));
  tray.setToolTip(t('trayTip'));
  refreshTray();

  mouseTimer = setInterval(pollAmbient, 1000 / 30);
  windowTimer = setInterval(pollWindows, 700);

  // a monitor came or went: the virtual desktop changed shape
  screen.on('display-removed', refitDesktop);
  screen.on('display-added', refitDesktop);
  screen.on('display-metrics-changed', refitDesktop);
});

ipcMain.handle('brain-data', () => brainData);
ipcMain.handle('language', () => activeLanguage);
ipcMain.on('spikes', (_e, list) => send(brain, 'spikes', list));
ipcMain.on('stimulate', (_e, req) => send(overlay, 'stimulate', req));

app.on('window-all-closed', () => { /* tray-only app: stay alive */ });
app.on('before-quit', () => {
  app.isQuitting = true;
  clearInterval(mouseTimer);
  clearInterval(windowTimer);
  linux.stopInputMonitor();
});
