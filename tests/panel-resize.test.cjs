const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'panel.js'), 'utf8');
const hooks = {};
const context = {
  window: {
    BiliSummary: { __testHooks: hooks },
  },
  console,
};

vm.runInNewContext(source, context, { filename: 'panel.js' });
assert.equal(typeof hooks.calculateLeftResizeGeometry, 'function');

const start = {
  startX: 660,
  startW: 520,
  startRight: 1180,
};

const enlarged = hooks.calculateLeftResizeGeometry(start, 560, 1200);
assert.deepEqual(
  { width: enlarged.width, left: enlarged.left, right: enlarged.left + enlarged.width },
  { width: 620, left: 560, right: 1180 },
  '向左拖动应向左扩展并保持右边界不变',
);

const narrowed = hooks.calculateLeftResizeGeometry(start, 760, 1200);
assert.deepEqual(
  { width: narrowed.width, left: narrowed.left, right: narrowed.left + narrowed.width },
  { width: 420, left: 760, right: 1180 },
  '向右拖动应向右收窄并保持右边界不变',
);

const minClamped = hooks.calculateLeftResizeGeometry(start, 1200, 1200);
assert.equal(minClamped.width, 320, '宽度不得小于 320px');
assert.equal(minClamped.left + minClamped.width, 1180, '最小宽度时右边界仍应不变');

const maxClamped = hooks.calculateLeftResizeGeometry(start, -1000, 1200);
assert.equal(maxClamped.width, 1080, '最大宽度应与 CSS 的 90vw 限制一致');
assert.equal(maxClamped.left, 100, '达到最大宽度时应继续保持原右边界');
assert.equal(maxClamped.left + maxClamped.width, 1180, '最大宽度时右边界仍应不变');

console.log('PASS: 左下角缩放保持右边界固定并正确移动左边界');
