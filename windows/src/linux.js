// linux.js — the Linux half of Environment.swift.
//
// Electron already supplies the cursor, displays and idle timer. X11 is only
// needed for the two senses Electron does not expose: top-level window frames
// and clicks that land outside the brain window. The adapter deliberately
// uses the standard EWMH/X11 command-line tools, so there is no native addon
// to compile or ABI to keep in sync with Electron.

import { execFileSync, spawn } from 'node:child_process';

const X11 = process.platform === 'linux' && !!process.env.DISPLAY;
const commandCache = new Map();
let inputProcess = null;
let inputBuffer = '';
let pendingLeft = false;
let pendingRight = false;
let inputButtonPress = false;

function commandAvailable(command) {
  if (commandCache.has(command)) return commandCache.get(command);
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
    commandCache.set(command, true);
  } catch {
    commandCache.set(command, false);
  }
  return commandCache.get(command);
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return '';
  }
}

export function linuxAvailable() {
  return windowSenseAvailable() && commandAvailable('xinput');
}

function windowIds() {
  for (const name of ['_NET_CLIENT_LIST_STACKING', '_NET_CLIENT_LIST']) {
    const text = run('xprop', ['-root', name]);
    const match = text.match(/#\s*(.*)$/m) || text.match(/=\s*(.*)$/m);
    const ids = match?.[1].match(/0x[0-9a-f]+/gi) || [];
    if (ids.length) return [...new Set(ids.map((id) => id.toLowerCase()))];
  }
  return [];
}

function windowSenseAvailable() {
  return X11 && commandAvailable('xprop') && commandAvailable('xdotool');
}

function property(text, name) {
  const line = text.split('\n').find((entry) => entry.startsWith(`${name}(`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

function geometry(id) {
  const vars = {};
  for (const line of run('xdotool', ['getwindowgeometry', '--shell', id]).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) vars[line.slice(0, i)] = Number(line.slice(i + 1));
  }
  if (![vars.X, vars.Y, vars.WIDTH, vars.HEIGHT].every(Number.isFinite)) return null;
  return {
    left: vars.X,
    top: vars.Y,
    right: vars.X + vars.WIDTH,
    bottom: vars.Y + vars.HEIGHT,
  };
}

// EWMH normal windows, excluding hidden/iconic windows and this process.
// Coordinates are X11 root pixels; main.js converts them to Electron DIP.
export function listWindows(ownPid) {
  if (!windowSenseAvailable()) return [];
  const out = [];
  for (const id of windowIds()) {
    const props = run('xprop', ['-id', id, '_NET_WM_PID', '_NET_WM_WINDOW_TYPE',
      '_NET_WM_STATE', 'WM_STATE']);
    const pid = Number(property(props, '_NET_WM_PID').match(/\d+/)?.[0] || 0);
    const type = property(props, '_NET_WM_WINDOW_TYPE');
    const state = property(props, '_NET_WM_STATE');
    const wmState = property(props, 'WM_STATE');
    if (pid === ownPid || !type.includes('_NET_WM_WINDOW_TYPE_NORMAL')) continue;
    if (state.includes('_NET_WM_STATE_HIDDEN') || /Iconic/i.test(`${wmState}\n${props}`)) continue;
    const rect = geometry(id);
    if (!rect || rect.right - rect.left < 160 || rect.bottom - rect.top < 60) continue;
    out.push({ id: Number.parseInt(id, 16), ...rect });
  }
  return out;
}

function startInputMonitor() {
  if (inputProcess || !X11 || !commandAvailable('xinput')) return;
  try {
    inputProcess = spawn('xinput', ['test-xi2', '--root'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    inputProcess.stdout.setEncoding('utf8');
    inputProcess.stdout.on('data', (chunk) => {
      inputBuffer += chunk;
      const lines = inputBuffer.split('\n');
      inputBuffer = lines.pop() || '';
      for (const line of lines) {
        if (/EVENT type\s+4\s+\(ButtonPress\)/.test(line)) {
          inputButtonPress = true;
          continue;
        }
        if (!inputButtonPress) continue;
        const detail = line.match(/^\s*detail:\s*(\d+)/);
        if (!detail) continue;
        if (detail[1] === '1') pendingLeft = true;
        if (detail[1] === '3') pendingRight = true;
        inputButtonPress = false;
      }
    });
    inputProcess.on('error', () => { inputProcess = null; inputBuffer = ''; });
    inputProcess.on('exit', () => {
      inputProcess = null;
      inputBuffer = '';
      inputButtonPress = false;
    });
    inputProcess.unref();
  } catch {
    inputProcess = null;
  }
}

// Returns button-down edges from a single long-lived XI2 monitor.
export function pollMouseButtons() {
  if (!X11) return { left: false, right: false };
  startInputMonitor();
  const result = { left: pendingLeft, right: pendingRight };
  pendingLeft = false;
  pendingRight = false;
  return result;
}

export function stopInputMonitor() {
  if (inputProcess) inputProcess.kill();
  inputProcess = null;
  inputBuffer = '';
  inputButtonPress = false;
  pendingLeft = false;
  pendingRight = false;
}

process.once('exit', stopInputMonitor);
