import { linuxAvailable, listWindows, pollMouseButtons, stopInputMonitor }
  from '../src/linux.js';

if (process.platform !== 'linux') {
  console.log('SKIP: Linux only');
  process.exit(0);
}

if (!linuxAvailable()) throw new Error('DISPLAY, xprop, xdotool, and xinput are required');

const windows = listWindows(process.pid);
if (!windows.length) throw new Error('no EWMH normal windows found');
for (const w of windows) {
  if (![w.id, w.left, w.top, w.right, w.bottom].every(Number.isFinite)
      || w.right <= w.left || w.bottom <= w.top) {
    throw new Error(`invalid window geometry: ${JSON.stringify(w)}`);
  }
}

const buttons = pollMouseButtons();
stopInputMonitor();
if (typeof buttons.left !== 'boolean' || typeof buttons.right !== 'boolean') {
  throw new Error('invalid mouse-button state');
}

console.log(`PASS: X11 adapter found ${windows.length} normal windows`);
