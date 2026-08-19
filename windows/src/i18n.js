const MESSAGES = {
  en: {
    appName: 'Desktop Fly',
    noData: 'no data — run etl.py',
    dataInfo: 'FlyWire v783 · {points} somas · circuit {neurons}n/{edges}e',
    pause: 'Pause',
    resume: 'Resume',
    showBrain: 'Show/Hide Brain',
    escapeTest: 'Escape Test (loom)',
    stimulate: 'Stimulate Neurons',
    groom: 'Grooming — DNg11',
    walk: 'Walk forward — DNp09',
    backward: 'Backward walk — MDN',
    escape: 'Escape takeoff — giant fiber DNp01',
    wings: 'Raise wings — DNp02/04/11',
    tap: 'Startle — sensory (tap)',
    steerLeft: 'Steer left — DNa left',
    steerRight: 'Steer right — DNa right',
    nextDisplay: 'Send Fly to Next Display',
    addFly: 'Add Fly',
    removeFly: 'Remove Fly',
    scare: 'Scare Flies',
    quit: 'Quit',
    language: 'Language',
    languageAuto: 'Auto',
    languageZh: '中文',
    languageEn: 'English',
    brainTitle: 'Fly Brain — FlyWire v783 (click = stimulate)',
    brainLooming: 'Looming detectors (LC4/LPLC2)',
    brainGiantFiber: 'Giant Fiber (DNp01) — escape!',
    brainSteering: 'Steering neurons (DNa01/02)',
    brainWalking: 'Walking command (DNp09)',
    brainGrooming: 'Grooming command (DNg11)',
    brainEscapeWing: 'Escape-wing DNs (DNp02/04/11)',
    brainMoonwalker: 'Moonwalker neurons (MDN)',
    brainNeurons: '{type} neurons',
    brainTypeAscending: 'ascending',
    brainTypeCentral: 'central',
    brainTypeDescending: 'descending',
    brainTypeOptic: 'optic',
    brainTypeSensory: 'sensory',
    brainTypeVisualCentrifugal: 'visual centrifugal',
    brainTypeVisualProjection: 'visual projection',
    sideLeft: 'left',
    sideRight: 'right',
    trayTip: 'Desktop Fly',
  },
  zh: {
    appName: '桌面果蝇',
    noData: '无数据 — 请先运行 etl.py',
    dataInfo: 'FlyWire v783 · {points} 个神经元 · 回路 {neurons} 个神经元/{edges} 条连接',
    pause: '暂停',
    resume: '继续',
    showBrain: '显示/隐藏大脑',
    escapeTest: '逃逸测试（接近刺激）',
    stimulate: '刺激神经元',
    groom: '梳理 — DNg11',
    walk: '向前行走 — DNp09',
    backward: '向后行走 — MDN',
    escape: '逃逸起飞 — 巨大纤维 DNp01',
    wings: '抬翅 — DNp02/04/11',
    tap: '惊吓 — 感觉神经元（触碰）',
    steerLeft: '向左转 — 左侧 DNa',
    steerRight: '向右转 — 右侧 DNa',
    nextDisplay: '将果蝇移至下一显示器',
    addFly: '添加果蝇',
    removeFly: '移除果蝇',
    scare: '惊吓果蝇',
    quit: '退出',
    language: '语言',
    languageAuto: '自动',
    languageZh: '中文',
    languageEn: 'English',
    brainTitle: '果蝇大脑 — FlyWire v783（点击可刺激）',
    brainLooming: '逼近探测神经元（LC4/LPLC2）',
    brainGiantFiber: '巨纤维（DNp01）— 逃逸！',
    brainSteering: '转向神经元（DNa01/02）',
    brainWalking: '行走指令（DNp09）',
    brainGrooming: '梳理指令（DNg11）',
    brainEscapeWing: '逃逸展翅下行神经元（DNp02/04/11）',
    brainMoonwalker: '倒行神经元（MDN）',
    brainNeurons: '{type}神经元',
    brainTypeAscending: '上行',
    brainTypeCentral: '中枢',
    brainTypeDescending: '下行',
    brainTypeOptic: '视叶',
    brainTypeSensory: '感觉',
    brainTypeVisualCentrifugal: '视觉离心',
    brainTypeVisualProjection: '视觉投射',
    sideLeft: '左',
    sideRight: '右',
    trayTip: '桌面果蝇',
  },
};

export const LANGUAGE_MODES = ['auto', 'zh', 'en'];

export function normalizeLanguageMode(mode) {
  return LANGUAGE_MODES.includes(mode) ? mode : 'auto';
}

export function resolveLanguage(mode, locales = []) {
  const selected = normalizeLanguageMode(mode);
  if (selected !== 'auto') return selected;
  const values = Array.isArray(locales) ? locales : [locales];
  for (const locale of values) {
    const value = String(locale || '');
    if (/^zh(?:[-_]|$)/i.test(value)) return 'zh';
    if (/^en(?:[-_]|$)/i.test(value)) return 'en';
  }
  return 'en';
}

export function createTranslator(mode, locales) {
  const messages = MESSAGES[resolveLanguage(mode, locales)];
  return (key, values = {}) => String(messages[key] || MESSAGES.en[key] || key)
    .replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? `{${name}}`));
}
