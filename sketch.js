/*******************************
 * Ripple Morph Grid — fullscreen (Web Editor)
 * - 默认正方形
 * - 长按触发涟漪；被波及格子执行一圈：□→○→△→□，完成后停在正方形
 * - 松手：停止扩散，但已触发的会走完一圈
 *******************************/

// ===== 网格与外观 =====
const COLS = 6;
const ROWS = 8;
const GAP  = 16;           // 格间距（像素）
const N          = 120;    // 轮廓采样点数（72~120）
const SW_MAIN    = 3.0;    // 线宽
const BASE_ALPHA = 230;    // 线条不透明度

// ===== 形变节奏（0.3s 变形 + 1.5s 停留）=====
const HALF_MS = 300;       // 变形时长
const HOLD_MS = 1500;      // 停留时长

// ===== 涟漪（长按触发）=====
const LONGPRESS_MS         = 350;   // 长按阈值
const WAVE_SPEED_PX_PER_MS = 0.8;   // 波速：像素/毫秒
const ACTIVATION_BAND      = 40;    // 触发带宽：|d-R|<=band 视为命中

// ===== 网格排布（运行时计算）=====
let tileDiam, rTile, sScale, marginX, marginY;

// ===== 轮廓缓存 =====
let triX = new Float32Array(N), triY = new Float32Array(N);
let sqrX = new Float32Array(N), sqrY = new Float32Array(N);
let cirX = new Float32Array(N), cirY = new Float32Array(N);
let rBase = 120;

// 每格本地状态：-1 未触发；>=0 进行中（记录开始毫秒）；-2 已完成一圈（停在□）
let startMs = [];

// 涟漪控制
let isPointerDown = false;
let downAtMs = 0;
let rippleActive = false;
let rippleStartMs = 0;
let rippleOrigin = { x: 0, y: 0 }; // 涟漪圆心（像素坐标）

// 指针追踪
let lastPointer = { x: 0, y: 0 };

function setup() {
  createCanvas(windowWidth, windowHeight);
  smooth();
  strokeJoin(ROUND);
  strokeCap(ROUND);
  noFill();

  buildTrianglePoints(triX, triY, N, rBase);
  buildSquarePoints (sqrX, sqrY, N, rBase);
  buildCirclePoints (cirX, cirY, N, rBase);

  initTileStates();
  computeGridLayout();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  computeGridLayout();
}

function initTileStates() {
  startMs = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
}

function resetTileStates() {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) startMs[y][x] = -1;
}

function computeGridLayout() {
  const tileDiamX = (width  - GAP * (COLS - 1)) / COLS;
  const tileDiamY = (height - GAP * (ROWS - 1)) / ROWS;
  tileDiam = Math.min(tileDiamX, tileDiamY);

  // 安全半径（考虑正方形对角线，留一点边）
  rTile  = (tileDiam / (2.0 * 1.4142 * 0.95)) * 0.95;
  sScale = rTile / rBase;

  const usedW = COLS * tileDiam + (COLS - 1) * GAP;
  const usedH = ROWS * tileDiam + (ROWS - 1) * GAP;
  marginX = (width  - usedW) * 0.5;
  marginY = (height - usedH) * 0.5;
}

function draw() {
  background(0);

  // 长按成立 -> 开始一轮新涟漪
  if (isPointerDown && !rippleActive) {
    const held = millis() - downAtMs;
    if (held >= LONGPRESS_MS) {
      const hit = hitTile(lastPointer.x, lastPointer.y);
      if (hit) {
        rippleActive  = true;
        rippleStartMs = millis();
        rippleOrigin  = tileCenter(hit.ix, hit.iy);
        resetTileStates(); // 新一轮，清空所有格子状态
      }
    }
  }

  // 当前波半径
  let R = 0;
  if (rippleActive) R = (millis() - rippleStartMs) * WAVE_SPEED_PX_PER_MS;

  // 网格绘制
  for (let iy = 0; iy < ROWS; iy++) {
    for (let ix = 0; ix < COLS; ix++) {
      const c = tileCenter(ix, iy);

      // 未触发的格子：当波前经过时启动本地形变
      if (rippleActive && startMs[iy][ix] < 0) {
        const d = dist(c.x, c.y, rippleOrigin.x, rippleOrigin.y);
        if (Math.abs(d - R) <= ACTIVATION_BAND) {
          startMs[iy][ix] = millis(); // 本地计时起点
        }
      }

      // 绘制该格
      push();
      translate(c.x, c.y);
      stroke(255, BASE_ALPHA);
      strokeWeight(SW_MAIN);

      const ms0 = startMs[iy][ix];
      if (ms0 === -1 || ms0 === -2) {
        // 未触发 或 已完成：都画正方形
        drawShape(sqrX, sqrY);
      } else {
        // 进行中：执行单圈 □→○→△→□
        const elapsed = millis() - ms0;
        const { stage, k, done } = morphStageAndK_OneCycle(elapsed);
        if (done) {
          startMs[iy][ix] = -2;   // 标记已完成
          drawShape(sqrX, sqrY);  // 收尾停在□
        } else {
          drawMorphedShape_OneCycle(stage, k, sScale);
        }
      }
      pop();
    }
  }
}

/* ======== 形变：单圈 □→○→△→□ ======== */
// 每段 seg = 0.3s 变形 + 1.5s 停留；三段总时长 total = 3*seg
function morphStageAndK_OneCycle(elapsedMs) {
  const seg   = HALF_MS + HOLD_MS;
  const total = 3 * seg;
  if (elapsedMs >= total) return { done: true };
  const p     = elapsedMs % total;
  const stage = Math.floor(p / seg);        // 0,1,2
  const pin   = p - stage * seg;
  const k     = (pin < HALF_MS) ? easeInOutCubic(pin / HALF_MS) : 1.0;
  // 0: □->○, 1: ○->△, 2: △->□
  return { stage, k, done: false };
}

function drawMorphedShape_OneCycle(stage, k, scale) {
  let ax, ay, bx, by;
  if      (stage === 0) { ax = sqrX; ay = sqrY; bx = cirX; by = cirY; } // □->○
  else if (stage === 1) { ax = cirX; ay = cirY; bx = triX; by = triY; } // ○->△
  else                  { ax = triX; ay = triY; bx = sqrX; by = sqrY; } // △->□

  beginShape();
  for (let i = 0; i < N; i++) {
    const x = lerp(ax[i], bx[i], k) * scale;
    const y = lerp(ay[i], by[i], k) * scale;
    vertex(x, y);
  }
  endShape(CLOSE);
}

/* ======== 形状构建 / 工具 ======== */
function drawShape(xs, ys) {
  beginShape();
  for (let i = 0; i < N; i++) vertex(xs[i] * sScale, ys[i] * sScale);
  endShape(CLOSE);
}

function tileCenter(ix, iy) {
  const cx = marginX + tileDiam * (ix + 0.5) + GAP * ix;
  const cy = marginY + tileDiam * (iy + 0.5) + GAP * iy;
  return { x: cx, y: cy };
}

function hitTile(px, py) {
  const gx = px - marginX;
  const gy = py - marginY;
  if (gx < 0 || gy < 0) return null;

  const cellW = tileDiam + GAP;
  const cellH = tileDiam + GAP;

  const ix = Math.floor(gx / cellW);
  const iy = Math.floor(gy / cellH);
  if (ix < 0 || ix >= COLS || iy < 0 || iy >= ROWS) return null;

  const localX = gx - ix * cellW;
  const localY = gy - iy * cellH;
  if (localX <= tileDiam && localY <= tileDiam) return { ix, iy };
  return null;
}

function buildTrianglePoints(outX, outY, n, radius) {
  const poly = [];
  for (let i = 0; i < 3; i++) {
    const ang = -HALF_PI + TWO_PI * i / 3.0;
    poly.push({ x: radius * Math.cos(ang), y: radius * Math.sin(ang) });
  }
  poly.push({ ...poly[0] });
  resampleToArrays(poly, n, outX, outY);
}
function buildSquarePoints(outX, outY, n, radius) {
  const s = radius * 1.4142 * 0.95;
  const poly = [
    { x: -s, y: -s },
    { x:  s, y: -s },
    { x:  s, y:  s },
    { x: -s, y:  s },
    { x: -s, y: -s }
  ];
  resampleToArrays(poly, n, outX, outY);
}
function buildCirclePoints(outX, outY, n, radius) {
  for (let i = 0; i < n; i++) {
    const a = TWO_PI * i / n;
    outX[i] = radius * Math.cos(a);
    outY[i] = radius * Math.sin(a);
  }
}

// 均匀重采样到 n 点
function resampleToArrays(src, n, outX, outY) {
  let per = 0;
  for (let i = 0; i < src.length - 1; i++) per += vdist(src[i], src[i + 1]);
  const step = per / n;

  let d = 0, seg = 0;
  let a = { ...src[0] }, b = { ...src[1] };

  for (let i = 0; i < n; i++) {
    const target = i * step;
    while (seg < src.length - 2 && d + vdist(a, b) < target) {
      d += vdist(a, b);
      seg++;
      a = { ...src[seg] };
      b = { ...src[seg + 1] };
    }
    const remain = target - d;
    const L = vdist(a, b);
    const tt = (L === 0) ? 0 : (remain / L);
    const p = vlerp(a, b, tt);
    outX[i] = p.x; outY[i] = p.y;
  }
}

function vdist(p, q) {
  const dx = p.x - q.x, dy = p.y - q.y;
  return Math.hypot(dx, dy);
}
function vlerp(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// 与参考一致的 easing
function easeInOutCubic(x) {
  return (x < 0.5) ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2.0;
}

/* ======== 输入（鼠标 + 触摸） ======== */
function mousePressed() {
  isPointerDown = true;
  downAtMs = millis();
  lastPointer = { x: mouseX, y: mouseY };
}
function mouseDragged() {
  lastPointer = { x: mouseX, y: mouseY };
}
function mouseReleased() {
  isPointerDown = false;
  rippleActive = false; // 停止扩散；已触发的继续走完
}

function touchStarted() {
  isPointerDown = true;
  downAtMs = millis();
  const t = touches && touches.length ? touches[0] : { x: mouseX, y: mouseY };
  lastPointer = { x: t.x, y: t.y };
  return false;
}
function touchMoved() {
  const t = touches && touches.length ? touches[0] : { x: mouseX, y: mouseY };
  lastPointer = { x: t.x, y: t.y };
  return false;
}
function touchEnded() {
  isPointerDown = false;
  rippleActive = false; // 同上
  return false;
}