import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTranslator, resolveLanguage } from '../src/i18n.js';

assert.equal(resolveLanguage('auto', ['zh-CN']), 'zh');
assert.equal(resolveLanguage('auto', ['en-US']), 'en');
assert.equal(resolveLanguage('auto', ['en-US', 'zh-CN']), 'en');
assert.equal(resolveLanguage('auto', ['fr-FR', 'zh-CN']), 'zh');
assert.equal(resolveLanguage('zh', ['en-US']), 'zh');
assert.equal(resolveLanguage('invalid', ['zh-CN']), 'zh');

const zh = createTranslator('zh');
const en = createTranslator('en');
assert.equal(zh('pause'), '暂停');
assert.equal(en('pause'), 'Pause');
assert.match(zh('dataInfo', { points: 1, neurons: 2, edges: 3 }), /1 个神经元/);
assert.match(en('dataInfo', { points: 1, neurons: 2, edges: 3 }), /1 somas/);
assert.equal(zh('brainLooming'), '逼近探测神经元（LC4/LPLC2）');
assert.equal(en('brainNeurons', { type: 'central' }), 'central neurons');
assert.equal(zh('brainNeurons', { type: zh('brainTypeCentral') }), '中枢神经元');
assert.equal(zh('sideLeft'), '左');

const brainKeys = [
  'noData', 'brainTitle', 'brainLooming', 'brainGiantFiber', 'brainSteering', 'brainWalking',
  'brainGrooming', 'brainEscapeWing', 'brainMoonwalker', 'brainTypeAscending',
  'brainTypeCentral', 'brainTypeDescending', 'brainTypeOptic', 'brainTypeSensory',
  'brainTypeVisualCentrifugal', 'brainTypeVisualProjection', 'brainNeurons', 'sideLeft', 'sideRight',
];
const brainSource = fs.readFileSync(new URL('../renderer/brain.js', import.meta.url), 'utf8');
for (const key of brainKeys) {
  assert.notEqual(en(key), key);
  assert.notEqual(zh(key), en(key));
  assert.ok(brainSource.includes(`'${key}'`), `brain renderer does not use ${key}`);
}

console.log('PASS: i18n auto-detection and translations');
