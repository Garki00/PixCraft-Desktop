/* automation.js — 主进程端自动填色逻辑
 * 使用 Windows API (user32.dll via koffi)
 * 点击：GetCursorPos 存旧坐标 → SetCursorPos 移到目标 → SendInput DOWN/UP → SetCursorPos 还原
 * 滚轮：SetCursorPos 移到滚轮区 → SendInput WHEEL → SetCursorPos 还原
 * 坐标：AK_LAYOUT 基于 1920×1080，运行时通过 GetWindowRect 加窗口偏移转为屏幕坐标
 */

let _lib              = null;
let _GetCursorPos     = null;
let _SetCursorPos     = null;
let _SendInput        = null;
let _FindWindowW      = null;
let _SetFWin          = null;
let _GetSystemMetrics = null;
let _GetWindowRect    = null;
let _INPUT_SIZE       = 0;

function initWinAPI() {
  if (_lib) return true;
  try {
    const koffi = require('koffi');

    const POINT = koffi.struct('POINT_ak', { x: 'int32', y: 'int32' });
    const INPUT = koffi.struct('INPUT_ak', {
      type: 'uint32', _pad: 'uint32',
      dx: 'int32', dy: 'int32',
      mouseData: 'uint32', dwFlags: 'uint32',
      time: 'uint32', dwExtraInfo: 'uintptr'
    });
    _INPUT_SIZE = koffi.sizeof(INPUT);

    const lib = koffi.load('user32.dll');
    const RECT = koffi.struct('RECT_ak', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });

    _GetCursorPos     = lib.func('GetCursorPos',         'bool',   [koffi.out(koffi.pointer(POINT))]);
    _SetCursorPos     = lib.func('SetCursorPos',         'bool',   ['int32', 'int32']);
    _SendInput        = lib.func('SendInput',            'uint32', ['uint32', koffi.pointer(INPUT), 'int32']);
    _FindWindowW      = lib.func('FindWindowW',          'void *', ['str16', 'str16']);
    _SetFWin          = lib.func('SetForegroundWindow',  'bool',   ['void *']);
    _GetSystemMetrics = lib.func('GetSystemMetrics',     'int32',  ['int32']);
    _GetWindowRect    = lib.func('GetWindowRect',        'bool',   ['void *', koffi.out(koffi.pointer(RECT))]);

    _lib = lib;
    return true;
  } catch (e) {
    console.error('[winapi] 加载失败:', e.message);
    return false;
  }
}

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP   = 0x0004;
const MOUSEEVENTF_WHEEL    = 0x0800;
const MOUSEEVENTF_ABSOLUTE = 0x8000;

function makeInput(screenX, screenY, dwFlags, mouseData) {
  const SW = _GetSystemMetrics(0);
  const SH = _GetSystemMetrics(1);
  return {
    type: 0, _pad: 0,
    dx: Math.round(screenX * 65535 / (SW - 1)),
    dy: Math.round(screenY * 65535 / (SH - 1)),
    mouseData: mouseData >>> 0,
    dwFlags: dwFlags,
    time: 0,
    dwExtraInfo: BigInt(0)
  };
}

async function sendClick(screenX, screenY) {
  _SetCursorPos(screenX, screenY);
  await sleep(40);
  _SendInput(1, makeInput(0, 0, MOUSEEVENTF_LEFTDOWN, 0), _INPUT_SIZE);
  _SendInput(1, makeInput(0, 0, MOUSEEVENTF_LEFTUP,   0), _INPUT_SIZE);
}

// 滚轮：鼠标必须实际停在目标位置，WHEEL 事件才能被正确窗口接收
// 调用前需先 SetCursorPos 到目标，调用后由外部决定是否还原
function sendScrollStep(screenX, screenY, delta) {
  _SendInput(1, makeInput(screenX, screenY, MOUSEEVENTF_WHEEL | MOUSEEVENTF_ABSOLUTE, delta), _INPUT_SIZE);
}

/* ------------------------------------------------------------------ */

/* 明日方舟 1920×1080 布局常量 */
const AK_LAYOUT = {
  canvas: { left: 442, top: 180, width: 840, height: 840, columns: 24, rows: 24 },
  palette: {
    columns: [1484, 1589, 1694, 1799],
    topFirstY: 429,
    topRowSpacing: 105,
    bottomIndex24Y: 659,
    bottomRowSpacing: 105,
    scrollX: 1640,
    scrollY: 650
  }
};

function getPaletteCoord(paletteIndex, scrolled) {
  const p = AK_LAYOUT.palette;
  const col = paletteIndex % 4;
  const x = p.columns[col];
  let y;
  if (!scrolled) {
    const row = Math.floor(paletteIndex / 4);
    y = p.topFirstY + row * p.topRowSpacing;
  } else {
    const row = Math.floor((paletteIndex - 24) / 4);
    y = p.bottomIndex24Y + row * p.bottomRowSpacing;
  }
  return { x, y };
}

function getCellCoord(col, row) {
  const c = AK_LAYOUT.canvas;
  const cellW = c.width / c.columns;
  const cellH = c.height / c.rows;
  return {
    x: Math.round(c.left + col * cellW + cellW / 2),
    y: Math.round(c.top  + row * cellH + cellH / 2)
  };
}

let _stopFlag = false;
function stopFill() { _stopFlag = true; }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const PALETTE = [
  [34,34,34],[180,180,180],[234,231,223],[255,255,255],
  [211,47,54],[156,10,0],[214,12,74],[230,150,141],
  [254,152,117],[247,208,192],[252,239,234],[251,246,232],
  [220,210,200],[226,206,171],[213,99,34],[212,140,66],
  [242,153,0],[249,201,51],[252,228,153],[179,180,122],
  [194,218,114],[108,110,0],[170,139,82],[169,143,116],
  [170,146,40],[63,43,18],[116,73,31],[83,70,88],
  [42,36,70],[57,69,153],[90,69,157],[179,157,207],
  [182,188,223],[169,172,190],[99,171,185],[180,210,220],
  [145,216,230],[71,174,160],[182,211,200],[39,56,100]
];

async function startFill(params, progressCb) {
  _stopFlag = false;

  if (!initWinAPI()) {
    return { success: false, error: 'koffi 未能加载 user32.dll，请检查安装' };
  }

  const hwnd = _FindWindowW(null, '明日方舟');
  if (!hwnd) {
    return { success: false, error: '未找到明日方舟窗口，请确认游戏已启动' };
  }

  // 读取窗口实际屏幕位置，将布局坐标转为屏幕坐标
  const rectOut = [{}];
  _GetWindowRect(hwnd, rectOut);
  const winLeft = rectOut[0].left;
  const winTop  = rectOut[0].top;

  function toScreen(akX, akY) {
    return { x: akX + winLeft, y: akY + winTop };
  }

  const { labelGrid, skipWhite, interval } = params;
  const WHITE_INDEX = 3;
  const p = AK_LAYOUT.palette;
  const scrollPt = toScreen(p.scrollX, p.scrollY);

  // 激活游戏窗口
  _SetFWin(hwnd);
  await sleep(300);

  // 流程最前：上滚20次复位调色板（鼠标停在调色板区域再滚）
  const oldPt = [{}];
  _GetCursorPos(oldPt);
  _SetCursorPos(scrollPt.x, scrollPt.y);
  for (let s = 0; s < 20; s++) {
    sendScrollStep(scrollPt.x, scrollPt.y, 120);
    await sleep(50);
  }
  _SetCursorPos(oldPt[0].x, oldPt[0].y);
  await sleep(300);

  // 按调色板顺序建立分组
  const colorGroups = new Map();
  for (let pi = 0; pi < PALETTE.length; pi++) {
    if (skipWhite && pi === WHITE_INDEX) continue;
    const cells = [];
    for (let i = 0; i < labelGrid.length; i++) {
      if (labelGrid[i] === pi) cells.push(i);
    }
    if (cells.length > 0) colorGroups.set(pi, cells);
  }

  const totalCells = Array.from(colorGroups.values()).reduce((s, v) => s + v.length, 0);
  let filledCount = 0;
  let paletteScrolled = false;

  for (const [paletteIdx, cells] of colorGroups) {
    if (_stopFlag) break;

    const needsScroll = paletteIdx >= 24;

    if (needsScroll && !paletteScrolled) {
      const op = [{}]; _GetCursorPos(op);
      _SetCursorPos(scrollPt.x, scrollPt.y);
      for (let s = 0; s < 20; s++) {
        sendScrollStep(scrollPt.x, scrollPt.y, -120);
        await sleep(50);
      }
      _SetCursorPos(op[0].x, op[0].y);
      paletteScrolled = true;
      await sleep(300);
    } else if (!needsScroll && paletteScrolled) {
      const op = [{}]; _GetCursorPos(op);
      _SetCursorPos(scrollPt.x, scrollPt.y);
      for (let s = 0; s < 20; s++) {
        sendScrollStep(scrollPt.x, scrollPt.y, 120);
        await sleep(50);
      }
      _SetCursorPos(op[0].x, op[0].y);
      paletteScrolled = false;
      await sleep(300);
    }

    // 点击调色板色块
    _SetFWin(hwnd);
    const pc = getPaletteCoord(paletteIdx, paletteScrolled);
    const pcScreen = toScreen(pc.x, pc.y);
    await sendClick(pcScreen.x, pcScreen.y);
    await sleep(500);

    // 填充格子
    for (const cellIdx of cells) {
      if (_stopFlag) break;
      const col = cellIdx % 24;
      const row = Math.floor(cellIdx / 24);
      const cc  = getCellCoord(col, row);
      const ccScreen = toScreen(cc.x, cc.y);

      for (let click = 0; click < 3; click++) {
        await sendClick(ccScreen.x, ccScreen.y);
        await sleep(20);
      }

      filledCount++;
      progressCb({ filled: filledCount, total: totalCells, color: PALETTE[paletteIdx] });

      if (interval > 0) await sleep(interval);
    }
  }

  if (!_stopFlag) {
    progressCb({ filled: filledCount, total: totalCells, color: null, done: true });
  }
  return { success: true };
}

module.exports = { startFill, stopFill };
