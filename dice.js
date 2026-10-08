(function (root) {
  'use strict';
  // Dice and cube nets: turning, rolling, folding and the sums asked about stacked dice.
  // Turns are renamings of the six direction names (never cross products), so a die can not come
  // out mirrored by a sign slip. The one place with vectors is the net fold, where every cell keeps
  // R = N × U (checked below), the same hand as the renderer's upright text frame.
  const node = typeof module !== 'undefined' && module.exports;
  const G = node ? require('./geometry.js') : root.SolidGeometry;
  const R = node ? require('./render.js') : root.SolidRender;
  const { DIR_NAMES: DIRS, DIR_VEC, OPPOSITE, DIR_KO } = G;
  const fail = (text) => { throw new Error(text); };

  // --- Turns ---------------------------------------------------------------------------------
  // A turn maps "the face that was at d" to "where it is now".
  const IDENTITY = Object.freeze(Object.fromEntries(DIRS.map((d) => [d, d])));
  const turn = (pairs) => Object.freeze({ ...IDENTITY, ...pairs });
  const inverse = (t) => Object.freeze(Object.fromEntries(DIRS.map((d) => [t[d], d])));
  const MOVES = {
    right: turn({ top: 'right', right: 'bottom', bottom: 'left', left: 'top' }),   // tip over to +X
    front: turn({ top: 'front', front: 'bottom', bottom: 'back', back: 'top' }),   // tip over to +Y (toward the viewer)
    cw: turn({ front: 'left', left: 'back', back: 'right', right: 'front' })       // spin in place, clockwise seen from above
  };
  MOVES.left = inverse(MOVES.right); MOVES.back = inverse(MOVES.front); MOVES.ccw = inverse(MOVES.cw);
  const STEP = { right: [1, 0, 0], left: [-1, 0, 0], front: [0, 1, 0], back: [0, -1, 0], cw: [0, 0, 0], ccw: [0, 0, 0] };
  // 동·서·남·북 read a top-down map: north = back (away from the viewer), south = front.
  const MOVE_ALIASES = { 오: 'right', 오른쪽: 'right', 왼: 'left', 왼쪽: 'left', 앞: 'front', 앞쪽: 'front', 뒤: 'back', 뒤쪽: 'back',
    동: 'right', 동쪽: 'right', 서: 'left', 서쪽: 'left', 남: 'front', 남쪽: 'front', 북: 'back', 북쪽: 'back', 시계: 'cw', 반시계: 'ccw' };
  const moveName = (m) => MOVES[m] ? m : MOVE_ALIASES[m] || fail('굴리는 방향은 right, left, front, back(오·왼·앞·뒤, 동·서·남·북) 또는 제자리 돌리기 cw, ccw입니다: ' + m);
  const compose = (a, b) => Object.freeze(Object.fromEntries(DIRS.map((d) => [d, b[a[d]]]))); // a, then b
  const turnKey = (t) => DIRS.map((d) => t[d]).join(',');

  // The 24 ways to set a cube down, found by turning (exactly 24 — tested).
  const ORIENTATIONS = (() => {
    const seen = new Map([[turnKey(IDENTITY), IDENTITY]]), queue = [IDENTITY];
    while (queue.length) {
      const t = queue.shift();
      for (const g of [MOVES.right, MOVES.front, MOVES.cw]) {
        const next = compose(t, g), k = turnKey(next);
        if (!seen.has(k)) { seen.set(k, next); queue.push(next); }
      }
    }
    return [...seen.values()];
  })();

  // Faces are {dir: {kind, pips|text, up}}. Turning moves each face and its "up" together.
  function apply(faces, t) {
    const result = {};
    for (const d of DIRS) result[t[d]] = { ...faces[d], up: t[faces[d].up] };
    return result;
  }
  const roll = (faces, move) => apply(faces, MOVES[moveName(move)]);
  // The mirror image (left and right exchanged): the same numbers turning the other way round a corner.
  const SWAP = { ...IDENTITY, left: 'right', right: 'left' };
  function mirror(faces) {
    const result = {};
    for (const d of DIRS) result[SWAP[d]] = { ...faces[d], up: SWAP[faces[d].up] };
    return result;
  }
  const same = (a, b) => DIRS.every((d) => G.sameContent(a[d], b[d]));

  // --- Which way 1-2-3 go round their corner ---------------------------------------------------
  // On a die with opposite faces summing to s, take the three smallest values a<b<c from different
  // pairs. Seen from outside the corner they share, a→b→c is counter-clockwise ("ccw", the usual
  // Western die: top 1, front 2, right 3) or clockwise ("cw").
  function chirality(faces) {
    const v = Object.fromEntries(DIRS.map((d) => [d, G.faceValue(faces[d])]));
    if (DIRS.some((d) => !Number.isFinite(v[d]))) return null;
    const s = v.top + v.bottom;
    if (v.front + v.back !== s || v.left + v.right !== s) return null;
    const small = DIRS.filter((d) => v[d] < v[OPPOSITE[d]]).sort((a, b) => v[a] - v[b]);
    if (small.length !== 3 || v[small[0]] === v[small[1]] || v[small[1]] === v[small[2]]) return null;
    // Turn the die so that a is on top and b in front; then c is right (ccw) or left (cw).
    const t = ORIENTATIONS.find((o) => o[small[0]] === 'top' && o[small[1]] === 'front');
    return t[small[2]] === 'right' ? 'ccw' : 'cw';
  }

  // --- Building a die from a shorthand ----------------------------------------------------------
  // {standard: {top: 1, front: 2, right: 3}} (opposite faces sum to 7), or {sum: 21, values: [...]}
  // for other dice. With only two faces given the hand is unknown: chirality "ccw"|"cw" picks one,
  // otherwise the ccw die is kept and marked mirror (both hands are counted by the solver).
  function standardDie(spec, where = 'standard') {
    if (!spec || typeof spec !== 'object') fail(where + '는 {top: 1, front: 2, right: 3}처럼 보이는 면의 수입니다.');
    const given = {}, options = {};
    for (const [k, v] of Object.entries(spec)) {
      if (['sum', 'values', 'chirality', 'as'].includes(k)) { options[k] = v; continue; }
      const d = G.dirName(k);
      if (!d) fail(where + '의 "' + k + '"는 방향 이름이 아닙니다.');
      if (!Number.isInteger(v)) fail(where + '.' + d + '는 수입니다.');
      given[d] = v;
    }
    const sum = options.sum ?? 7, values = options.values ?? (sum === 7 ? [1, 2, 3, 4, 5, 6] : null);
    const as = options.as ?? (sum === 7 && (values || []).every((x) => x >= 1 && x <= 6) ? 'pips' : 'text');
    if (!['pips', 'text'].includes(as)) fail(where + '.as는 pips(눈) 또는 text(숫자 글자)입니다.');
    const face = (n) => as === 'pips' ? { kind: 'pips', pips: n } : { kind: 'text', text: String(n) };
    const filled = { ...given };
    for (const d of Object.keys(given)) {
      const o = OPPOSITE[d];
      if (filled[o] !== undefined && filled[o] !== sum - given[d]) fail(where + ': ' + d + '와 ' + o + '는 마주 보는 면이라 합이 ' + sum + '이어야 합니다.');
      filled[o] = sum - given[d];
    }
    const known = Object.keys(filled).length;
    if (known < 4) fail(where + ': 서로 마주 보지 않는 두 면 이상을 주세요(예: top과 front). 한 면만으로는 놓인 모양이 정해지지 않습니다.');
    let faces, hand = null;
    if (known === 6) faces = filled;
    else {
      if (!values) fail(where + ': 마주 보는 면의 합이 ' + sum + '인 주사위는 values(여섯 수)나 세 면(위·앞·오른쪽 등)을 모두 주세요.');
      const pairs = [], rest = [...values].sort((a, b) => a - b);
      while (rest.length) {
        const a = rest.shift(), i = rest.indexOf(sum - a);
        if (i < 0) fail(where + '.values ' + JSON.stringify(values) + '는 합이 ' + sum + '인 세 쌍으로 나뉘지 않습니다.');
        rest.splice(i, 1); pairs.push(a);
      }
      const base = { top: pairs[0], front: pairs[1], right: pairs[2], bottom: sum - pairs[0], back: sum - pairs[1], left: sum - pairs[2] };
      hand = options.chirality ?? 'any';
      if (!['ccw', 'cw', 'any'].includes(hand)) fail(where + '.chirality는 ccw(1·2·3 반시계, 보통 주사위), cw 또는 any입니다.');
      const start = hand === 'cw' ? { ...base, left: base.right, right: base.left } : base;
      const asFaces = (m) => Object.fromEntries(DIRS.map((d) => [d, { kind: 'text', text: String(m[d]), up: G.DEFAULT_UP[d] }]));
      const match = ORIENTATIONS.map((t) => apply(asFaces(start), t)).find((f) => Object.entries(filled).every(([d, n]) => f[d].text === String(n)));
      if (!match) fail(where + ': 주어진 면 ' + JSON.stringify(given) + '이 이 주사위에서 나올 수 없습니다.');
      faces = Object.fromEntries(DIRS.map((d) => [d, Number(match[d].text)]));
    }
    const result = Object.fromEntries(DIRS.map((d) => [d, { ...face(faces[d]), up: G.DEFAULT_UP[d] }]));
    return { faces: result, mirror: known < 6 && hand === 'any' };
  }

  // --- Nets ------------------------------------------------------------------------------------
  // cells: [{at: [col, row], pips|text|face, rot: 0|90|180|270}], row 0 at the top as printed.
  // The net lies printed side up and the base cell becomes the top face; the flaps fold down, so
  // the print ends up outside. Frame of a cell: N (its face), R (paper right), U (paper up).
  const neg = (v) => v.map((x) => -x || 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map((x) => x || 0);
  const vecEq = (a, b) => a.every((x, i) => x === b[i]);
  const NET_STEPS = [
    { dc: 1, dr: 0, next: ({ N, R: Rt, U }) => ({ N: Rt, R: neg(N), U }) },   // paper right
    { dc: -1, dr: 0, next: ({ N, R: Rt, U }) => ({ N: neg(Rt), R: N, U }) },  // paper left
    { dc: 0, dr: -1, next: ({ N, R: Rt, U }) => ({ N: U, R: Rt, U: neg(N) }) }, // paper up (row - 1)
    { dc: 0, dr: 1, next: ({ N, R: Rt, U }) => ({ N: neg(U), R: Rt, U: N }) }  // paper down (row + 1)
  ];
  const ROT_AXES = (f) => [f.U, f.R, neg(f.U), neg(f.R)];
  const START_FRAME = Object.freeze({ N: [0, 0, 1], R: [1, 0, 0], U: [0, -1, 0] });
  function netCells(cells, where = 'net.cells') {
    if (!Array.isArray(cells) || cells.length !== 6) fail(where + '는 칸 6개입니다 (net-invalid).');
    const index = new Map();
    return cells.map((c, i) => {
      const w = where + '[' + i + ']';
      if (Array.isArray(c) && c.length === 2) c = { at: c }; // [열, 행] alone is a cell too
      if (!c || typeof c !== 'object' || !Array.isArray(c.at) || c.at.length !== 2 || !c.at.every(Number.isInteger)) fail(w + '.at은 [열, 행] 정수입니다 (행 0이 맨 위).');
      const k = c.at.join(',');
      if (index.has(k)) fail(w + '.at ' + k + '이 겹칩니다 (net-invalid).');
      index.set(k, i);
      const rot = c.rot ?? 0;
      if (![0, 90, 180, 270].includes(rot)) fail(w + '.rot은 0, 90, 180, 270(종이에서 시계 방향으로 돌린 각)입니다.');
      const bodies = ['pips', 'text', 'face'].filter((n) => c[n] !== undefined);
      if (bodies.length > 1) fail(w + '에는 pips, text, face 중 하나만 씁니다.');
      const raw = c.pips !== undefined ? c.pips : c.text !== undefined ? String(c.text) : c.face !== undefined ? c.face : null;
      if (c.pips !== undefined && typeof c.pips !== 'number') fail(w + '.pips는 눈의 수입니다.');
      const content = G.normalizeFace(raw, 'top', w);
      if (content.lines) fail(w + ': 칸의 선은 face 안이 아니라 cells[' + i + '].lines에 씁니다 (종이에 인쇄된 대로).');
      const lines = c.lines !== undefined ? G.normalizeLines(c.lines, w + '.lines') : [];
      return { at: [...c.at], rot, content, ...(c.shade ? { shade: true } : {}), ...(lines.length ? { lines } : {}) };
    });
  }
  // Cell lines are written as printed (x right, y down on the paper); on the folded face they are
  // kept as the face is read upright, so they turn with the face like its number. A cell turned
  // clockwise by rot is read upright after turning its paper back counter-clockwise.
  const turnBack = ([x, y]) => [y, 1 - x], turnOn = ([x, y]) => [1 - y, x];
  const turnLines = (lines, rot, step) => lines.map((l) => l.map((q) => { let p = q; for (let k = 0; k < rot / 90; k++) p = step(p); return p.map((v) => Number(v.toFixed(9))); }));
  // Spread frames over the net from one cell; a valid cube net reaches six different faces.
  function spread(cells, start, frame) {
    const index = new Map(cells.map((c, i) => [c.at.join(','), i])), frames = new Array(cells.length);
    frames[start] = frame;
    const queue = [start]; let edges = 0;
    while (queue.length) {
      const i = queue.shift();
      for (const s of NET_STEPS) {
        const j = index.get([cells[i].at[0] + s.dc, cells[i].at[1] + s.dr].join(','));
        if (j === undefined) continue;
        if (i < j) edges++;
        const f = s.next(frames[i]);
        if (frames[j]) { if (!vecEq(frames[j].N, f.N) || !vecEq(frames[j].U, f.U)) fail('전개도가 접히지 않습니다: 칸이 서로 겹칩니다 (net-invalid).'); continue; }
        frames[j] = f; queue.push(j);
      }
    }
    if (frames.some((f) => !f)) fail('전개도의 칸이 모두 이어져 있지 않습니다 (net-invalid).');
    const dirs = frames.map((f) => G.dirOf(f.N));
    if (new Set(dirs).size !== 6 || edges !== 5) fail('전개도를 접으면 면이 겹칩니다(2×2 덩어리나 한 줄에 5칸 등). 정육면체 전개도가 아닙니다 (net-invalid).');
    return { frames, dirs };
  }
  // Fold: the base cell (default the first) on top, its paper-up toward the back.
  function foldNet(net) {
    const cells = netCells(net.cells);
    let base = net.base ?? 0;
    if (Array.isArray(base)) base = cells.findIndex((c) => c.at[0] === base[0] && c.at[1] === base[1]);
    if (!Number.isInteger(base) || base < 0 || base >= 6) fail('net.base는 윗면이 될 칸의 번호(0~5) 또는 [열, 행]입니다.');
    const { frames, dirs } = spread(cells, base, START_FRAME);
    const faces = {};
    cells.forEach((c, i) => { faces[dirs[i]] = { ...c.content, up: G.dirOf(ROT_AXES(frames[i])[c.rot / 90]), ...(c.lines ? { lines: turnLines(c.lines, c.rot, turnBack) } : {}) }; });
    return { faces, cells: cells.map((c, i) => ({ at: c.at, dir: dirs[i], rot: c.rot })) };
  }
  // Unfold a die onto a net shape. One cell is given: which face lies there (dir or content) and
  // how it is turned (rot); every other cell's face and turn follow.
  function unfoldNet(faces, shape, anchor) {
    const cells = netCells(shape.map((c) => ({ at: c.at })), 'shape');
    const a = cells.findIndex((c) => anchor && Array.isArray(anchor.at) && c.at[0] === anchor.at[0] && c.at[1] === anchor.at[1]);
    if (a < 0) fail('anchor.at은 모양에 있는 칸 [열, 행]입니다.');
    let dir = anchor.dir !== undefined ? G.dirName(anchor.dir) : null;
    if (!dir) {
      const content = G.normalizeFace(typeof anchor.face === 'number' && anchor.face > 12 ? String(anchor.face) : anchor.face ?? null, 'top', 'anchor.face');
      const hits = DIRS.filter((d) => G.faceText(faces[d]) === G.faceText(content));
      if (hits.length !== 1) fail('anchor.face에 맞는 면이 ' + hits.length + '개입니다. anchor.dir로 방향을 정하세요.');
      dir = hits[0];
    }
    const rot = anchor.rot ?? 0, N = DIR_VEC[dir], up = DIR_VEC[faces[dir].up];
    const U = DIRS.map((d) => DIR_VEC[d]).find((u) => Math.abs(u[0] * N[0] + u[1] * N[1] + u[2] * N[2]) === 0 && vecEq(ROT_AXES({ N, U: u, R: cross(N, u) })[rot / 90], up));
    const { frames, dirs } = spread(cells, a, { N, U, R: cross(N, U) });
    return cells.map((c, i) => {
      const k = ROT_AXES(frames[i]).findIndex((v) => vecEq(v, DIR_VEC[faces[dirs[i]].up])), face = faces[dirs[i]];
      return { at: c.at, dir: dirs[i], rot: k * 90, content: face, ...(face.lines ? { lines: turnLines(face.lines, k * 90, turnOn) } : {}) };
    });
  }
  // A net as a flat picture (solidlab-diagram): squares, pips as black dots, turned texts, shaded
  // cells and lines drawn in cells. Cell lines use [x, y] inside the cell, x to the right and y down
  // from its top-left corner, as the printed page is read. Cells marked blank stay empty unless the
  // answer picture is asked for.
  function netDiagram(net, options = {}) {
    const cells = netCells(net.cells);
    if (!options.anyShape) foldNet(net);
    const points = [], items = [], ids = new Map();
    const round = (v) => Number(v.toFixed(6));
    const P = (x, y) => {
      const k = round(x) + ',' + round(y);
      if (!ids.has(k)) { const id = 'p' + (points.length + 1); ids.set(k, id); points.push({ id, at: [round(x), round(y)], show: false }); }
      return ids.get(k);
    };
    const turned = (v, deg) => { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c]; };
    net.cells.forEach((raw, i) => {
      const c = cells[i], [col, row] = c.at, x0 = col, y0 = -row;
      items.push({ type: 'polygon', id: 'cell' + (i + 1), points: [P(x0, y0), P(x0 + 1, y0), P(x0 + 1, y0 - 1), P(x0, y0 - 1)], ...(c.shade ? { fill: 'mid' } : {}) });
      const center = [x0 + .5, y0 - .5], up = turned([0, 1], c.rot), right = turned([1, 0], c.rot);
      const at = (u, v) => [center[0] + (u - .5) * right[0] + (v - .5) * up[0], center[1] + (u - .5) * right[1] + (v - .5) * up[1]];
      if (!(raw.blank && !options.answers)) {
        if (c.content.kind === 'pips') G.PIPS[c.content.pips].forEach(([u, v], j) => {
          const [x, y] = at(u, v), id = 'pip' + (i + 1) + '_' + (j + 1);
          points.push({ id, at: [round(x), round(y)], show: false });
          items.push({ type: 'circle', id, center: id, r: G.pipRadius(c.content.pips), fill: 'dark' });
        });
        else if (c.content.kind === 'text') {
          const n = [...c.content.text].length;
          items.push({ type: 'text', id: 'text' + (i + 1), at: center, text: c.content.text, height: n === 1 ? .5 : n === 2 ? .4 : .3, ...(c.rot ? { rotate: c.rot } : {}) });
        }
      }
      // answerLines: the lines are what the student draws, so only the answer picture has them.
      if (!(net.answerLines && !options.answers)) (c.lines || []).forEach((l, j) => {
        items.push({ type: 'segment', id: 'line' + (i + 1) + '_' + (j + 1), a: P(x0 + l[0][0], y0 - l[0][1]), b: P(x0 + l[1][0], y0 - l[1][1]) });
      });
    });
    return { format: 'solidlab-diagram', version: 1, unit: 1, unitLabel: '', points, items };
  }

  // --- Box nets -----------------------------------------------------------------------------------
  // A box (cuboid) unfolds along the same 11 layouts as a cube. The base cell becomes the top with
  // its paper right +X and paper up the back, so size [w, h, d] makes the base cell w wide and h
  // tall on the paper (d is the edge standing up from it); every other cell's width and height are
  // the box lengths along its own R and U. Cells are placed edge to edge along the fold.
  const CUBE_NETS = (() => {
    const keyOf = (cells) => cells.map((c) => c.join(',')).sort().join(';');
    const norm = (cells) => { const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1])); return cells.map(([x, y]) => [x - mx, y - my]); };
    let shapes = new Map([['0,0', [[0, 0]]]]);
    for (let n = 1; n < 6; n++) {
      const next = new Map();
      for (const cells of shapes.values()) for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (cells.some((q) => q[0] === x + dx && q[1] === y + dy)) continue;
        const m = norm([...cells, [x + dx, y + dy]]); next.set(keyOf(m), m);
      }
      shapes = next;
    }
    return [...shapes.values()].filter((cells) => { try { spread(netCells(cells.map((at) => ({ at }))), 0, START_FRAME); return true; } catch { return false; } })
      .map((cells) => cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  })();
  const HANGUL_NAMES = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  const AXIS_OF = (v) => v.findIndex((x) => x !== 0);
  const rnd = (v) => Math.round(v * 1e6) / 1e6;
  function checkSize(size, where = 'size') {
    if (!Array.isArray(size) || size.length !== 3 || !size.every((v) => Number.isFinite(v) && v > 0 && v <= 10000)) fail(where + '는 [기준 칸의 가로, 기준 칸의 세로, 나머지 모서리] 세 길이입니다. 예: [3, 2, 1]');
    return size.map(Number);
  }
  // Where every cell lies on the paper, which edges are cut (outline) or folded, the corners named
  // ㄱ, ㄴ, … clockwise from the top left, and where each paper point goes on the box.
  function boxLayout(net) {
    const size = checkSize(net.size), cells = netCells(net.cells);
    let base = net.base ?? 0;
    if (Array.isArray(base)) base = cells.findIndex((c) => c.at[0] === base[0] && c.at[1] === base[1]);
    if (!Number.isInteger(base) || base < 0 || base >= 6) fail('base는 기준 칸(윗면이 될 칸)의 [열, 행]입니다.');
    const { frames, dirs } = spread(cells, base, START_FRAME);
    const rects = cells.map((c, i) => ({ i, at: c.at, dir: dirs[i], f: frames[i], w: size[AXIS_OF(frames[i].R)], h: size[AXIS_OF(frames[i].U)] }));
    const placed = new Set([base]), queue = [base];
    rects[base].x = 0; rects[base].y = 0;
    while (queue.length) {
      const r = rects[queue.shift()];
      for (const s of rects) {
        if (placed.has(s.i)) continue;
        const dc = s.at[0] - r.at[0], dr = s.at[1] - r.at[1];
        if (Math.abs(dc) + Math.abs(dr) !== 1) continue;
        s.x = dc === 1 ? r.x + r.w : dc === -1 ? r.x - s.w : r.x; s.y = dr === 1 ? r.y + r.h : dr === -1 ? r.y - s.h : r.y;
        placed.add(s.i); queue.push(s.i);
      }
    }
    for (const a of rects) for (const b of rects) if (a.i < b.i && a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9) fail('이 크기로는 전개도의 칸 [' + a.at + ']와 [' + b.at + ']가 종이 위에서 겹칩니다 (net-overlap). 다른 모양을 고르세요.');
    const mx = Math.min(...rects.map((r) => r.x)), my = Math.min(...rects.map((r) => r.y));
    for (const r of rects) { r.x = rnd(r.x - mx); r.y = rnd(r.y - my); }
    // Paper point inside a cell → point on the box (box centred at the origin).
    const to3d = (r, px, py) => { const { N, R: Rt, U } = r.f, e = size[AXIS_OF(N)]; return [0, 1, 2].map((k) => rnd(N[k] * e / 2 + (px - r.x - r.w / 2) * Rt[k] + (r.h / 2 - (py - r.y)) * U[k])); };
    const pkey = (p) => p[0] + ',' + p[1], points = new Map();
    const corners = (r) => [[r.x, r.y], [rnd(r.x + r.w), r.y], [rnd(r.x + r.w), rnd(r.y + r.h)], [r.x, rnd(r.y + r.h)]];
    for (const r of rects) for (const p of corners(r)) if (!points.has(pkey(p))) points.set(pkey(p), { at: p, cell: r.i });
    // Sides split at every corner lying on them; a piece drawn by two cells is a fold.
    const pieces = new Map();
    for (const r of rects) {
      const c = corners(r);
      for (let k = 0; k < 4; k++) {
        const a = c[k], b = c[(k + 1) % 4], horizontal = a[1] === b[1];
        const on = [...points.values()].map((q) => q.at).filter((q) => horizontal ? q[1] === a[1] && q[0] > Math.min(a[0], b[0]) && q[0] < Math.max(a[0], b[0]) : q[0] === a[0] && q[1] > Math.min(a[1], b[1]) && q[1] < Math.max(a[1], b[1]));
        const seq = [a, ...on, b].sort((p, q) => horizontal ? (p[0] - q[0]) * (b[0] - a[0]) : (p[1] - q[1]) * (b[1] - a[1]));
        for (let j = 0; j + 1 < seq.length; j++) {
          const key = [pkey(seq[j]), pkey(seq[j + 1])].sort().join('|');
          if (!pieces.has(key)) pieces.set(key, { a: seq[j], b: seq[j + 1], cells: [] });
          pieces.get(key).cells.push(r.i);
        }
      }
    }
    const outline = [...pieces.values()].filter((p) => p.cells.length === 1), folds = [...pieces.values()].filter((p) => p.cells.length > 1);
    // Names: walk the outline clockwise (as printed) from the top-left corner.
    const nbr = new Map();
    for (const p of outline) for (const [u, v] of [[p.a, p.b], [p.b, p.a]]) { if (!nbr.has(pkey(u))) nbr.set(pkey(u), []); nbr.get(pkey(u)).push(v); }
    const start = [...points.values()].map((q) => q.at).sort((p, q) => p[1] - q[1] || p[0] - q[0])[0];
    const order = [start];
    let prev = null, cur = start;
    for (let guard = 0; guard < 200; guard++) {
      const options = (nbr.get(pkey(cur)) || []).filter((q) => !prev || pkey(q) !== pkey(prev));
      const next = prev ? options[0] : options.sort((p, q) => (q[1] === cur[1]) - (p[1] === cur[1]) || q[0] - p[0])[0];
      if (!next || pkey(next) === pkey(start)) break;
      order.push(next); prev = cur; cur = next;
    }
    for (const q of points.values()) if (!order.some((p) => pkey(p) === pkey(q.at))) order.push(q.at);
    const names = net.names && Array.isArray(net.names) ? net.names : HANGUL_NAMES;
    const nameOf = new Map(order.map((p, k) => [pkey(p), k < names.length ? names[k] : names[k % names.length] + "'".repeat(Math.floor(k / names.length))]));
    // Each point's place on the box, found through a cell it belongs to.
    const where3d = (p) => { const r = rects.find((s) => p[0] >= s.x - 1e-9 && p[0] <= s.x + s.w + 1e-9 && p[1] >= s.y - 1e-9 && p[1] <= s.y + s.h + 1e-9); return to3d(r, p[0], p[1]); };
    const vertices = order.map((p) => ({ name: nameOf.get(pkey(p)), at: p, box: where3d(p) }));
    const groupKey = (v) => v.join(',');
    const meets = new Map();
    for (const v of vertices) { const k = groupKey(v.box); if (!meets.has(k)) meets.set(k, []); meets.get(k).push(v.name); }
    const edgeOf = (p) => [nameOf.get(pkey(p.a)), nameOf.get(pkey(p.b))];
    const glued = new Map();
    for (const p of outline) {
      const k = [groupKey(where3d(p.a)), groupKey(where3d(p.b))].sort().join('|');
      if (!glued.has(k)) glued.set(k, []);
      glued.get(k).push(p);
    }
    const len = (p) => rnd(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]));
    // The pieces of one glued pair, written so that the points that meet are in the same order.
    const pairs = [...glued.values()].filter((g) => g.length === 2).map(([p, q]) => {
      const [a, b] = edgeOf(p), [c, d] = edgeOf(q), same = groupKey(where3d(p.a)) === groupKey(where3d(q.a));
      return { edges: [a + b, same ? c + d : d + c], length: len(p) };
    });
    const width = Math.max(...rects.map((r) => r.x + r.w)), height = Math.max(...rects.map((r) => r.y + r.h));
    const opposite = rects.map((r) => ({ cell: r.at, dir: r.dir, other: rects.find((s) => s.dir === OPPOSITE[r.dir]).at }));
    return { size, base, cells, rects, outline, folds, vertices, nameOf: (p) => nameOf.get(pkey(p)), meets: [...meets.values()].filter((g) => g.length > 1), pairs, opposite,
      perimeter: rnd(outline.reduce((m, p) => m + len(p), 0)), area: rnd(rects.reduce((m, r) => m + r.w * r.h, 0)), volume: rnd(size[0] * size[1] * size[2]), width: rnd(width), height: rnd(height) };
  }
  // Same net up to turning or flipping the paper (the cells' sizes, not their contents).
  function boxShapeKey(rects) {
    const forms = [];
    for (const [sx, sy, swap] of [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1]]) {
      const rs = rects.map(({ x, y, w, h }) => { let [x0, y0, x1, y1] = [x * sx, y * sy, (x + w) * sx, (y + h) * sy]; if (swap) [x0, y0, x1, y1] = [y0, x0, y1, x1]; return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]; });
      const mx = Math.min(...rs.map((r) => r[0])), my = Math.min(...rs.map((r) => r[1]));
      forms.push(rs.map((r) => [rnd(r[0] - mx), rnd(r[1] - my), rnd(r[2]), rnd(r[3])].join(',')).sort().join(';'));
    }
    return forms.sort()[0];
  }
  // Every different net of a box w × h × d (11 for a cube, 29 with two equal edges, 54 otherwise),
  // each as a design {size, cells, base} that net/boxLayout read; numbered from 1 in a fixed order.
  function boxNets(dims) {
    const box = checkSize(dims, '상자 크기'), found = new Map();
    for (const layout of CUBE_NETS) for (let base = 0; base < 6; base++) for (const size of [[box[0], box[1], box[2]], [box[1], box[0], box[2]], [box[0], box[2], box[1]], [box[2], box[0], box[1]], [box[1], box[2], box[0]], [box[2], box[1], box[0]]]) {
      let lay;
      try { lay = boxLayout({ size, base, cells: layout.map((at) => ({ at })) }); } catch { continue; }
      const key = boxShapeKey(lay.rects);
      // Prefer the drawing that is wider than tall, then the smaller base index.
      const score = (lay.height > lay.width ? 1 : 0) * 1000 + base;
      if (!found.has(key) || found.get(key).score > score) found.set(key, { key, score, design: { size, base: [...layout[base]], cells: layout.map((at) => ({ at: [...at] })) }, perimeter: lay.perimeter, width: lay.width, height: lay.height });
    }
    return [...found.values()].sort((a, b) => a.perimeter - b.perimeter || a.key.localeCompare(b.key)).map((s, k) => ({ id: k + 1, ...s }));
  }
  // Which of the box's nets this is (its number in boxNets), or null.
  function boxShapeId(net) {
    const lay = boxLayout(net), key = boxShapeKey(lay.rects), list = boxNets(lay.size), hit = list.find((s) => s.key === key);
    return hit ? { id: hit.id, total: list.length } : null;
  }
  // A few lines of text that show a net's cells and their sizes, for choosing without a picture.
  function boxSketch(design) {
    const lay = boxLayout(design);
    const cols = Math.max(...lay.rects.map((r) => r.at[0])) + 1, rows = Math.max(...lay.rects.map((r) => r.at[1])) + 1;
    const label = (r) => rnd(r.w) + '×' + rnd(r.h), wide = Math.max(...lay.rects.map((r) => label(r).length)) + 2;
    const lines = [];
    for (let row = 0; row < rows; row++) {
      let line = '';
      for (let col = 0; col < cols; col++) { const r = lay.rects.find((s) => s.at[0] === col && s.at[1] === row); line += (r ? '[' + label(r) + ']' : '').padEnd(wide + 2, ' '); }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  // The picture of a box net: cut edges solid, folds dashed (as in textbooks), corner names, the
  // lengths of the three edges once each (or as asked), and what is printed in the cells.
  function boxDiagram(net, options = {}) {
    const lay = boxLayout(net), unitLabel = net.unitLabel ?? 'cm';
    const points = [], ids = new Map(), items = [];
    // A corner's name goes toward the empty side: away from the cells around it (math angle, y up).
    const inside = (x, y) => lay.rects.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
    const away = (p) => { let vx = 0, vy = 0; for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (!inside(p[0] + dx * 1e-3, p[1] + dy * 1e-3)) { vx += dx; vy += dy; } return Math.round(Math.atan2(-vy, vx) * 180 / Math.PI); };
    const P = (p) => { const k = p[0] + ',' + p[1]; if (!ids.has(k)) { const id = 'p' + (points.length + 1), name = lay.nameOf(p); ids.set(k, id); points.push({ id, at: [p[0], -p[1]], show: false, ...(net.names && name ? { label: name, labelAt: away(p) } : {}) }); } return ids.get(k); };
    lay.vertices.forEach((v) => P(v.at));
    const byName = new Map(lay.vertices.map((v) => [v.name, v.at]));
    lay.rects.forEach((r, i) => { const raw = net.cells[i]; if (raw.shade) items.push({ type: 'polygon', id: 'shade' + (i + 1), points: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map((p) => P(p.map(rnd))), fill: 'mid', stroke: false }); });
    lay.outline.forEach((p, k) => items.push({ type: 'segment', id: 'cut' + (k + 1), a: P(p.a), b: P(p.b) }));
    if (net.folds !== 'none') lay.folds.forEach((p, k) => items.push({ type: 'segment', id: 'fold' + (k + 1), a: P(p.a), b: P(p.b), ...(net.folds === 'solid' ? {} : { dash: true }) }));
    lay.rects.forEach((r, i) => {
      const raw = net.cells[i], c = lay.cells[i], cx = r.x + r.w / 2, cy = r.y + r.h / 2, s = Math.min(r.w, r.h);
      if (!(raw.blank && !options.answers)) {
        if (c.content.kind === 'text') { const n = [...c.content.text].length; items.push({ type: 'text', id: 'text' + (i + 1), at: [rnd(cx), rnd(-cy)], text: c.content.text, height: rnd(s * (n === 1 ? .45 : n === 2 ? .36 : .27)), ...(c.rot ? { rotate: c.rot } : {}) }); }
        else if (c.content.kind === 'pips') fail('직육면체 전개도의 칸에는 눈(pips) 대신 글자(text)를 씁니다.');
      }
      if (!(net.answerLines && !options.answers)) (c.lines || []).forEach((l, j) => items.push({ type: 'segment', id: 'line' + (i + 1) + '_' + (j + 1), a: P(l[0].map((v, k) => rnd(k ? r.y + v * r.h : r.x + v * r.w))), b: P(l[1].map((v, k) => rnd(k ? r.y + v * r.h : r.x + v * r.w))) }));
    });
    // Lengths: "auto" puts each box length once on an outer cut edge; or a list like ["ㄱㄴ", {edge: "ㄷㄹ", label: "㉠", question: true}].
    let dims = net.dims ?? 'auto';
    if (dims === 'auto') {
      const outer = (p) => { const hor = p.a[1] === p.b[1], v = hor ? p.a[1] : p.a[0]; return hor ? (v === rnd(lay.height) ? 0 : v === 0 ? 2 : 4) : (v === 0 ? 1 : v === rnd(lay.width) ? 3 : 5); };
      const chosen = [];
      for (const L of [...new Set(lay.size)]) {
        const best = lay.outline.filter((p) => Math.abs(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) - L) < 1e-6).sort((p, q) => outer(p) - outer(q))[0];
        if (best) chosen.push({ edge: lay.nameOf(best.a) + lay.nameOf(best.b) });
      }
      dims = chosen;
    } else if (dims === 'none') dims = [];
    if (!Array.isArray(dims)) fail('dims는 "auto", "none" 또는 ["ㄱㄴ", {"edge": "ㄷㄹ", "label": "㉠", "question": true}] 목록입니다.');
    dims.forEach((d, k) => {
      const e = typeof d === 'string' ? { edge: d } : d, names = [...String(e.edge || '')];
      const a = byName.get(names[0]), b = byName.get(names.slice(1).join(''));
      if (names.length < 2 || !a || !b) fail('dims[' + k + '] "' + e.edge + '": 두 꼭짓점 이름(예: "ㄱㄴ")으로 적습니다. 있는 이름: ' + lay.vertices.map((v) => v.name).join(''));
      const length = rnd(Math.hypot(b[0] - a[0], b[1] - a[1]));
      items.push({ type: 'dim', id: 'dim' + (k + 1), a: P(a), b: P(b), style: e.style ?? net.dimStyle ?? 'text', ...(e.label !== undefined ? { label: e.label } : {}), ...(e.question ? { question: true, value: length + (unitLabel ? ' ' + unitLabel : '') } : {}) });
    });
    return { format: 'solidlab-diagram', version: 1, unit: 1, unitLabel, points, items };
  }
  // Questions about a box net, answered from the layout: perimeter, area, volume, which points meet
  // a point, which edge meets an edge, which cell is opposite a cell.
  function boxAnswers(net) {
    const lay = boxLayout(net);
    return (net.asks || []).map((a, k) => {
      const id = a.id ?? 'q' + (k + 1);
      try {
        let value;
        if (a.find === 'perimeter') value = lay.perimeter;
        else if (a.find === 'area') value = lay.area;
        else if (a.find === 'volume') value = lay.volume;
        else if (a.find && a.find.meets !== undefined) {
          const g = lay.meets.find((m) => m.includes(a.find.meets)) || (lay.vertices.some((v) => v.name === a.find.meets) ? [a.find.meets] : null);
          if (!g) fail('꼭짓점 "' + a.find.meets + '"가 없습니다.');
          value = g.filter((n) => n !== a.find.meets);
        } else if (a.find && a.find.edge !== undefined) {
          const e = String(a.find.edge), pair = lay.pairs.find((p) => p.edges.some((x) => x === e || [...x].reverse().join('') === e));
          if (!pair) fail('선분 "' + e + '"는 전개도의 잘린 모서리가 아닙니다(접는 선이거나 이름이 틀림).');
          const rev = (x) => [...x].reverse().join(''), i = pair.edges.findIndex((x) => x === e), j = pair.edges.findIndex((x) => rev(x) === e);
          value = i >= 0 ? pair.edges[1 - i] : rev(pair.edges[1 - j]);
        } else if (a.find && a.find.opposite !== undefined) {
          const o = lay.opposite.find((x) => x.cell[0] === a.find.opposite[0] && x.cell[1] === a.find.opposite[1]);
          if (!o) fail('칸 [' + a.find.opposite + ']이 없습니다.');
          value = o.other;
        } else fail('find는 "perimeter"(둘레), "area"(넓이), "volume"(부피), {"meets": "ㄱ"}, {"edge": "ㄱㄴ"}, {"opposite": [열, 행]} 중 하나입니다.');
        const same = (x, y) => Array.isArray(x) && Array.isArray(y) && x.every((v) => typeof v === 'string') ? x.length === y.length && [...x].sort().join() === [...y].sort().join() : JSON.stringify(x) === JSON.stringify(y);
        return { id, find: a.find, value, ...(a.answer !== undefined ? { answer: a.answer, matches: same(a.answer, value) } : {}) };
      } catch (error) { return { id, find: a.find, problem: 'error', message: error.message }; }
    });
  }
  function boxTable(net, shapeId) {
    const lay = boxLayout(net), u = net.unitLabel ?? 'cm', cube = lay.size.every((v) => v === lay.size[0]);
    const b = lay.rects[lay.base], shape = shapeId || (() => { const s = boxShapeId(net); return s ? s.id + '/' + s.total : ''; })();
    const lines = [(cube ? '정육면체' : '직육면체') + ' 전개도 · 상자 ' + [...lay.size].sort((x, y) => y - x).join('×') + ' ' + u + (shape ? ' · 모양 ' + shape : '') + ' · 기준 칸 [' + b.at + '] ' + rnd(b.w) + '×' + rnd(b.h)];
    lines.push('칸: ' + lay.rects.map((r) => '[' + r.at + '] ' + rnd(r.w) + '×' + rnd(r.h)).join(', '));
    lines.push('마주 보는 칸: ' + lay.opposite.filter((o, i) => lay.rects.findIndex((r) => r.at[0] === o.other[0] && r.at[1] === o.other[1]) > i).map((o) => '[' + o.cell + ']↔[' + o.other + ']').join(', '));
    lines.push('둘레 ' + lay.perimeter + ' ' + u + ' · 넓이 ' + lay.area + ' ' + u + '²(= 겉넓이) · 부피 ' + lay.volume + ' ' + u + '³');
    lines.push('꼭짓점(왼쪽 위부터 시계 방향): ' + lay.vertices.map((v) => v.name).join(''));
    lines.push('접으면 만나는 점: ' + lay.meets.map((g) => g.join('=')).join(', '));
    lines.push('접으면 맞닿는 선분: ' + lay.pairs.map((p) => p.edges.join('–') + ' (' + p.length + ')').join(', '));
    for (const r of boxAnswers(net)) lines.push('문제 ' + r.id + ' ' + JSON.stringify(r.find) + ' → ' + (r.problem ? '⚠ ' + r.message : JSON.stringify(r.value) + (r.answer === undefined ? '' : r.matches ? '  ✓ 정답과 같음' : '  ✗ 정답 ' + JSON.stringify(r.answer) + '과 다름 (answer-mismatch)')));
    return lines.join('\n');
  }

  // Turn a die so that the given contents land where asked: {top: 1, front: "ㄱ"}.
  function pose(faces, wanted, where = 'pose') {
    const want = Object.entries(wanted).map(([k, v]) => {
      const d = G.dirName(k) || fail(where + '의 "' + k + '"는 방향 이름이 아닙니다.');
      // Matched by what is printed, so 13 or "13" both find a face showing 13.
      return [d, G.normalizeFace(typeof v === 'number' && v > 12 ? String(v) : v, d, where + '.' + d)];
    });
    const hits = ORIENTATIONS.map((t) => apply(faces, t)).filter((f) => want.every(([d, c]) => G.faceText(f[d]) === G.faceText(c)));
    if (!hits.length) fail(where + ' ' + JSON.stringify(wanted) + ': 그렇게 놓을 수 없습니다(마주 보는 두 면을 함께 지정했는지 확인).');
    const distinct = hits.filter((f, i) => hits.findIndex((g) => same(f, g)) === i);
    return { faces: hits[0], ambiguous: distinct.length > 1 };
  }

  // --- Faces of dice in a model ----------------------------------------------------------------
  // Every face of every die: touching another block (and which die), on the floor, or exposed;
  // exposed faces are seen in the picture fully, partly, or not at all (sampled like the renderer).
  function classify(p) {
    const has = G.occupancy(p.cells), box = G.bounds(p.cells), d = R.viewBasis(p.view).normal;
    const diceAt = new Map(p.dice.map((die, i) => [G.key(die.at), i]));
    const axes = { top: [[1, 0, 0], [0, 1, 0]], bottom: [[1, 0, 0], [0, 1, 0]], front: [[1, 0, 0], [0, 0, 1]], back: [[1, 0, 0], [0, 0, 1]], left: [[0, 1, 0], [0, 0, 1]], right: [[0, 1, 0], [0, 0, 1]] };
    const view = (at, dir) => {
      const n = DIR_VEC[dir];
      if (G.dot(n, d) <= 1e-9) return 'away';
      const center = at.map((v, i) => v + .5 + n[i] * .5), [a, b] = axes[dir];
      let seen = 0;
      for (const s of [-.42, 0, .42]) for (const t of [-.42, 0, .42]) {
        const q = center.map((v, i) => v + a[i] * s + b[i] * t);
        if (!R.occluded(q, d, has, box)) seen++;
      }
      return seen === 9 ? 'visible' : seen === 0 ? 'covered' : 'partial';
    };
    return p.dice.map((die) => Object.fromEntries(DIRS.map((dir) => {
      const n = G.add(die.at, DIR_VEC[dir]);
      if (has(n[0], n[1], n[2])) { const j = diceAt.get(G.key(n)); return [dir, j === undefined ? { cls: 'touching', block: true } : { cls: 'touching', die: j, dir: OPPOSITE[dir] }]; }
      if (dir === 'bottom' && die.at[2] === box.min[2]) return [dir, { cls: 'floor' }];
      return [dir, { cls: 'exposed', view: view(die.at, dir) }];
    })));
  }
  const inClass = (c, name) => {
    const seen = c.cls === 'exposed' && (c.view === 'visible' || c.view === 'partial');
    switch (name) {
      case 'all': return true;
      case 'visible': return seen;
      case 'hidden': return !seen;
      case 'exposed': return c.cls === 'exposed';
      case 'surface': return c.cls === 'exposed' || c.cls === 'floor';
      case 'touching': return c.cls === 'touching';
      case 'floor': return c.cls === 'floor';
      case 'unseen': return c.cls === 'touching' || c.cls === 'floor';
      default: return false;
    }
  };
  // A selector names face positions: a class, a direction, ["A.top", …], {opposite: …}, {dice: [...], of: …}.
  function select(sel, p, cls) {
    const ids = new Map(p.dice.map((die, i) => [die.id, i]));
    const ref = (r) => {
      const at = r.lastIndexOf('.'), id = r.slice(0, at), dir = G.dirName(r.slice(at + 1));
      if (!ids.has(id)) fail('주사위 ID "' + id + '"가 없습니다 (있는 ID: ' + [...ids.keys()].join(', ') + ').');
      if (!dir) fail('"' + r + '"의 방향 이름이 올바르지 않습니다.');
      return [ids.get(id), dir];
    };
    if (typeof sel === 'string') {
      const dir = G.dirName(sel);
      if (dir) return p.dice.map((_, i) => [i, dir]);
      return p.dice.flatMap((_, i) => DIRS.filter((dd) => inClass(cls[i][dd], sel)).map((dd) => [i, dd]));
    }
    if (Array.isArray(sel)) return sel.map(ref);
    if (sel.opposite !== undefined) return select(sel.opposite, p, cls).map(([i, dd]) => [i, OPPOSITE[dd]]);
    const keep = new Set(sel.dice.map((x) => ids.has(x) ? ids.get(x) : fail('주사위 ID "' + x + '"가 없습니다.')));
    return select(sel.of, p, cls).filter(([i]) => keep.has(i));
  }
  function contacts(p, cls) {
    const list = [];
    cls.forEach((c, i) => DIRS.forEach((d) => { const t = c[d]; if (t.cls === 'touching' && t.die !== undefined && i < t.die) list.push({ a: i, da: d, b: t.die, db: t.dir }); }));
    return list;
  }

  // --- Solving asks ----------------------------------------------------------------------------
  // Every die has candidate states (its 24 turns, both hands if mirror, keeping fixed faces). An ask
  // is a tuple of numbers: the thing to find and each condition. The dice are visited in an order
  // where few assigned dice still touch unvisited ones (the "frontier"); results for the rest are
  // remembered per frontier state. Separate dice cost a sum-set; touching chains stay small.
  const NODE_LIMIT = 2000000, SET_LIMIT = 200000, WORK_LIMIT = 6000000, STORE_LIMIT = 1500000;
  function numberOf(face, where) {
    const v = G.faceValue(face);
    if (!Number.isFinite(v)) fail(where + '의 내용 "' + G.faceText(face) + '"은 수가 아니어서 계산할 수 없습니다.');
    return v;
  }
  function compile(expr, p, cls, edges) {
    const n = p.dice.length;
    if (expr.pairs) return { op: '+', unary: Array.from({ length: n }, () => []), pairs: expr.pairs, edges };
    if (expr.face) return { op: '+', unary: (() => { const [[i, d]] = select([expr.face], p, cls); const u = Array.from({ length: n }, () => []); u[i].push(d); return u; })() };
    const op = expr.sum !== undefined ? '+' : '*', slots = select(expr.sum !== undefined ? expr.sum : expr.product, p, cls);
    const unary = Array.from({ length: n }, () => []);
    const seen = new Set();
    for (const [i, d] of slots) { const k = i + d; if (!seen.has(k)) { seen.add(k); unary[i].push(d); } }
    return { op, unary };
  }
  function candidates(die, relevant, keepTurns) {
    if (die.fixed === 'all') return [{ faces: die.faces, turn: 0 }];
    const bases = die.mirror ? [die.faces, mirror(die.faces)] : [die.faces], list = [], keys = new Set();
    bases.forEach((b, m) => ORIENTATIONS.forEach((t, k) => {
      const f = apply(b, t);
      if (Array.isArray(die.fixed) && !die.fixed.every((d) => G.sameContent(f[d], die.faces[d]))) return;
      const sig = keepTurns ? m * 24 + k : [...relevant].map((d) => d + ':' + G.faceText(f[d])).join('|');
      if (keys.has(sig)) return;
      keys.add(sig); list.push({ faces: f, turn: m * 24 + k });
    }));
    return list;
  }
  function solve(p, ask, options = {}) {
    if (ask.roll) return solveRoll(p, ask);
    const cls = classify(p), n = p.dice.length;
    if (!n) fail('모델에 주사위(dice)가 없습니다.');
    const edges = contacts(p, cls);
    const conditions = ask.where || [];
    const exprs = [ask.find, ...conditions.map(({ equals, multipleOf, ...e }) => e)];
    const comps = exprs.map((e) => compile(e, p, cls, edges));
    const touchRules = p.rules.filter((r) => r.type === 'touching-equal' || r.type === 'touching-sum');
    const groups = p.rules.filter((r) => r.type === 'same-orientation').map((r) => (r.dice || p.dice.map((d) => d.id)).map((id) => p.dice.findIndex((d) => d.id === id)));
    const grouped = new Set(groups.flat());
    const usesPairs = comps.some((c) => c.pairs) || touchRules.length > 0;
    // Graph of what couples the dice: contacts (when asked about) and "same orientation" links.
    const links = [];
    if (usesPairs) for (const e of edges) links.push({ ...e, kind: 'contact' });
    for (const g of groups) for (const j of g.slice(1)) links.push({ a: g[0], b: j, kind: 'same' });
    // "All equal" / "all different" over chosen faces: checked inside a die and between every two dice.
    const valueRules = p.rules.filter((r) => r.type === 'all-equal' || r.type === 'all-different').map((r) => {
      const byDie = new Map();
      for (const [i, d] of select(r.of, p, cls)) { if (!byDie.has(i)) byDie.set(i, new Set()); byDie.get(i).add(d); }
      const list = [...byDie].map(([i, set]) => [i, [...set]]), equal = r.type === 'all-equal';
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) links.push({ a: list[x][0], b: list[y][0], kind: 'values', equal, da: list[x][1], db: list[y][1] });
      return { equal, own: new Map(list) };
    });
    const relevant = p.dice.map((_, i) => {
      const set = new Set(comps.flatMap((c) => c.unary[i]));
      if (usesPairs) for (const e of edges) { if (e.a === i) set.add(e.da); if (e.b === i) set.add(e.db); }
      for (const vr of valueRules) for (const d of vr.own.get(i) || []) set.add(d);
      return set;
    });
    const states = p.dice.map((die, i) => candidates(die, relevant[i], grouped.has(i)));
    const label = (i, d) => p.dice[i].id + '.' + d;
    // Order: depth first from the most connected die, so the frontier stays small.
    const adj = p.dice.map(() => []);
    for (const l of links) { adj[l.a].push(l); adj[l.b].push(l); }
    const order = [], placed = new Set();
    const roots = p.dice.map((_, i) => i).sort((a, b) => adj[b].length - adj[a].length);
    for (const r of roots) {
      if (placed.has(r)) continue;
      const stack = [r];
      while (stack.length) {
        const v = stack.pop(); if (placed.has(v)) continue;
        placed.add(v); order.push(v);
        for (const l of adj[v]) { const u = l.a === v ? l.b : l.a; if (!placed.has(u)) stack.push(u); }
      }
    }
    const pos = new Array(n); order.forEach((v, k) => { pos[v] = k; });
    const last = p.dice.map((_, v) => Math.max(-1, ...adj[v].map((l) => pos[l.a === v ? l.b : l.a])));
    const ZERO = comps.map((c) => c.op === '*' ? 1 : 0);
    const combine = (a, b) => a.map((x, i) => comps[i].op === '*' ? x * b[i] : x + b[i]);
    // Contribution of die v in state s, plus everything it shares with dice already placed.
    const valueOf = (f, d, i) => { const x = G.faceValue(f[d]); return Number.isFinite(x) ? x : 'c:' + G.faceText(f[d]); };
    function delta(v, s, assigned) {
      const f0 = states[v][s].faces;
      for (const vr of valueRules) {
        const own = (vr.own.get(v) || []).map((d) => valueOf(f0, d, v));
        if (vr.equal ? new Set(own).size > 1 : new Set(own).size < own.length) return null;
      }
      const f = f0, t = comps.map((c) => {
        const dirs = c.unary[v];
        if (c.op === '*') return dirs.reduce((m, d) => m * numberOf(f[d], label(v, d)), 1);
        return dirs.reduce((m, d) => m + numberOf(f[d], label(v, d)), 0);
      });
      for (const l of adj[v]) {
        const u = l.a === v ? l.b : l.a;
        if (!assigned.has(u)) continue;
        const g = states[u][assigned.get(u)].faces;
        if (l.kind === 'same') { if (states[v][s].turn !== states[u][assigned.get(u)].turn) return null; continue; }
        if (l.kind === 'values') {
          const mineV = (l.a === v ? l.da : l.db).map((d) => valueOf(f, d, v)), theirV = (l.a === v ? l.db : l.da).map((d) => valueOf(g, d, u));
          if (l.equal ? !mineV.every((x) => theirV.every((y) => x === y)) : mineV.some((x) => theirV.includes(x))) return null;
          continue;
        }
        const [myDir, theirDir] = l.a === v ? [l.da, l.db] : [l.db, l.da], mine = f[myDir], theirs = g[theirDir];
        for (const r of touchRules) {
          if (r.type === 'touching-equal') {
            const x = G.faceValue(mine), y = G.faceValue(theirs);
            if (Number.isFinite(x) && Number.isFinite(y) ? x !== y : !G.sameContent(mine, theirs)) return null;
          } else if (numberOf(mine, label(v, myDir)) + numberOf(theirs, label(u, theirDir)) !== r.value) return null;
        }
        comps.forEach((c, i) => {
          if (!c.pairs) return;
          const x = numberOf(mine, label(v, myDir)), y = numberOf(theirs, label(u, theirDir));
          t[i] += c.pairs === 'product' ? x * y : x + y;
        });
      }
      return t;
    }
    let nodes = 0, work = 0, stored = 0;
    const limit = (why) => { const e = new Error('경우가 너무 많아 끝까지 따지지 못했습니다 (search-limit, ' + why + '). 고정할 면(fixed)을 늘리거나 주사위 수를 줄이세요.'); e.code = 'search-limit'; return e; };
    const memo = new Map();
    function rest(k, frontier) {
      if (k === n) return new Map([[ZERO.join(','), ZERO]]);
      const memoKey = k + '|' + frontier.map(([, s]) => s).join(',');
      if (memo.has(memoKey)) return memo.get(memoKey);
      const v = order[k], assigned = new Map(frontier), result = new Map();
      for (let s = 0; s < states[v].length; s++) {
        if (++nodes > NODE_LIMIT) throw limit('배치 수');
        const t = delta(v, s, assigned);
        if (!t) continue;
        const next = [...frontier, [v, s]].filter(([u]) => last[u] > k);
        const tails = rest(k + 1, next);
        if ((work += tails.size) > WORK_LIMIT) throw limit('계산량');
        for (const tail of tails.values()) {
          const total = combine(t, tail), key = total.join(',');
          if (!result.has(key)) {
            result.set(key, total);
            if (result.size > SET_LIMIT) throw limit('가능한 값의 수');
          }
        }
      }
      if ((stored += result.size) > STORE_LIMIT) throw limit('기억할 값의 수');
      memo.set(memoKey, result);
      return result;
    }
    const all = [...rest(0, []).values()];
    const okTuple = (t) => conditions.every((c, i) => c.equals !== undefined ? t[i + 1] === c.equals : t[i + 1] % c.multipleOf === 0);
    const good = all.filter(okTuple), values = [...new Set(good.map((t) => t[0]))].sort((a, b) => a - b);
    // One arrangement reaching a target tuple (for the answer picture).
    function witness(target) {
      const chosen = new Map(); let frontier = [], acc = ZERO;
      for (let k = 0; k < n; k++) {
        const v = order[k], assigned = new Map(frontier); let found = false;
        for (let s = 0; s < states[v].length && !found; s++) {
          const t = delta(v, s, assigned); if (!t) continue;
          const next = [...frontier, [v, s]].filter(([u]) => last[u] > k), sofar = combine(acc, t);
          for (const tail of rest(k + 1, next).values()) {
            if (combine(sofar, tail).every((x, i) => x === target[i])) { chosen.set(v, s); frontier = next; acc = sofar; found = true; break; }
          }
        }
        if (!found) return null;
      }
      return p.dice.map((die, i) => ({ id: die.id, faces: states[i][chosen.get(i)].faces }));
    }
    const goal = ask.goal || 'value';
    let value, pick = null;
    if (goal === 'min' || goal === 'max') {
      if (values.length) { value = goal === 'min' ? values[0] : values[values.length - 1]; pick = good.find((t) => t[0] === value); }
    } else if (goal === 'values') value = values;
    else if (goal === 'count') value = values.length;
    else { if (values.length === 1) { value = values[0]; pick = good[0]; } }
    const result = { id: ask.id, goal, values, valueCount: values.length,
      ...(value !== undefined ? { value } : {}), states: states.map((s) => s.length), nodes };
    if (goal === 'value' && values.length !== 1) result.problem = values.length ? 'answer-ambiguous' : 'no-arrangement';
    if ((goal === 'min' || goal === 'max') && !values.length) result.problem = 'no-arrangement';
    if (options.witness && pick) result.witness = witness(pick);
    if (ask.answer !== undefined && value !== undefined) result.matches = JSON.stringify(ask.answer) === JSON.stringify(value);
    return result;
  }
  // Every result says how sure it is (status), whether it computed the one arrangement written or
  // went through every possible one (basis), and the readings it used (assumptions).
  const STATUS_OF = { 'answer-ambiguous': 'ambiguous', 'no-arrangement': 'no-solution', 'search-limit': 'search-limit', error: 'error' };
  const RULE_KO = { 'touching-equal': '맞닿은 면은 같은 수', 'touching-sum': '맞닿은 두 면의 합', 'same-orientation': '모두 같은 방향으로 놓임', 'all-equal': '고른 면이 모두 같은 수', 'all-different': '고른 면이 모두 다른 수' };
  function explain(p, ask, r) {
    const assumptions = [];
    let basis = 'given';
    if (ask.roll) {
      const plan = ask.roll;
      if (plan.all !== undefined) { basis = 'search'; assumptions.push(plan.all + '번 굴리는 모든 경우' + (plan.moves !== undefined ? ' (굴릴 수 있는 방향 ' + plan.moves + ')' : '')); }
      else assumptions.push(plan.path === 'arrows' ? '그림의 화살표를 따라 굴림' : '적은 순서대로 굴림: ' + (Array.isArray(plan.moves) ? plan.moves.join(' ') : plan.moves));
      const sums = [ask.find, ...(ask.where || [])].filter((e) => e && e.sum !== undefined);
      if (sums.length) assumptions.push(sums[0].start ? '처음 놓인 칸의 면도 더함' : '굴러간 칸의 면만 더함(처음 칸 뺌)');
    } else {
      for (const die of p.dice) {
        if (die.fixed === 'all') continue;
        basis = 'search';
        assumptions.push('주사위 ' + die.id + ': ' + (die.fixed === 'none' ? '마음대로 돌림' : die.fixed.map((d) => DIR_KO[d]).join('·') + ' 고정하고 돌림') + (die.mirror ? ', 1·2·3이 도는 방향을 몰라 거울 배치도 따짐' : ''));
      }
      if (basis === 'given') assumptions.push('모든 주사위가 그림 그대로');
      for (const rule of p.rules) assumptions.push('규칙: ' + RULE_KO[rule.type] + (rule.value !== undefined ? ' ' + rule.value : '') + (rule.dice ? ' (' + rule.dice.join(', ') + ')' : ''));
      if (JSON.stringify([ask.find, ask.where]).match(/"(visible|hidden)"/)) assumptions.push('보이는 면 = 모델의 그림 시점에서 조금이라도 보이는 면');
    }
    const status = r.problem ? STATUS_OF[r.problem] || 'error' : 'ok';
    return { id: r.id, status, basis, ...r, assumptions };
  }
  const isSolidAsk = (a) => !!(a.find && a.find.solid !== undefined);
  function solveAll(p, options) {
    return p.asks.filter((a) => !isSolidAsk(a)).map((a) => {
      try { return explain(p, a, solve(p, a, options)); } catch (error) { return explain(p, a, { id: a.id, goal: a.goal, problem: error.code || 'error', message: error.message }); }
    });
  }

  // --- Rolling ---------------------------------------------------------------------------------
  function rollTrace(faces, at, moves) {
    const rows = [{ step: 0, move: null, at: [...at], faces }];
    let f = faces, p = [...at];
    moves.forEach((m, i) => { const name = moveName(m); f = apply(f, MOVES[name]); p = G.add(p, STEP[name]); rows.push({ step: i + 1, move: name, at: p, faces: f }); });
    return rows;
  }
  // Every sequence of n moves (default the four tips): bottom-face sums and the final top.
  function rollAll(faces, n, moves = ['right', 'left', 'front', 'back']) {
    if (!Number.isInteger(n) || n < 1 || n > 8) fail('--all은 1~8번입니다.');
    const names = moves.map(moveName), list = [];
    const walk = (f, seq, sum) => {
      if (seq.length === n) { list.push({ moves: seq, bottomSum: sum, top: f.top }); return; }
      for (const m of names) { const g = apply(f, MOVES[m]); walk(g, [...seq, m], sum + (G.faceValue(g.bottom) || 0)); }
    };
    walk(faces, [], G.faceValue(faces.bottom) || 0);
    return list;
  }
  // The moves drawn as arrows: arrows chained from the die's floor cell, each leg straight along a
  // row or a column (a leg of three cells is three tips). null when no arrow starts at the die.
  function arrowMoves(p, die) {
    const used = new Set(), moves = [];
    let here = die.at.slice(0, 2), found = false;
    for (;;) {
      const i = p.arrows.findIndex((a, k) => !used.has(k) && a[0][0] === here[0] && a[0][1] === here[1]);
      if (i < 0) break;
      used.add(i); found = true;
      const a = p.arrows[i];
      for (let k = 1; k < a.length; k++) {
        const dx = a[k][0] - a[k - 1][0], dy = a[k][1] - a[k - 1][1], steps = Math.abs(dx) + Math.abs(dy);
        if ((dx && dy) || !Number.isInteger(steps) || !steps) fail('화살표 ' + (i + 1) + '의 ' + k + '번째 마디가 가로나 세로로 칸을 따라가지 않습니다. 굴리는 길은 칸 가운데 [x,y]를 이어 그립니다.');
        const m = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'front' : 'back';
        for (let s = 0; s < steps; s++) moves.push(m);
      }
      here = a[a.length - 1];
    }
    return found ? moves : null;
  }
  const MOVE_KO = { right: '오', left: '왼', front: '앞', back: '뒤', cw: '시계', ccw: '반시계' };
  function movesText(moves) {
    const parts = [];
    for (const m of moves) { const last = parts[parts.length - 1]; if (last && last[0] === m) last[1]++; else parts.push([m, 1]); }
    return parts.map(([m, k]) => MOVE_KO[m] + (k > 1 ? 'x' + k : '')).join(' ');
  }
  // What a rolling ask means: the die, its moves (written, or read off the arrows), or every n moves.
  function rollPlan(p, ask) {
    const r = ask.roll, die = r.die !== undefined ? p.dice.find((d) => d.id === r.die) : p.dice.length === 1 ? p.dice[0] : null;
    if (!die) fail(r.die !== undefined ? '굴릴 주사위 "' + r.die + '"가 없습니다 (있는 ID: ' + (p.dice.map((d) => d.id).join(', ') || '없음') + ').' : 'roll.die로 굴릴 주사위 ID를 정하세요 (주사위가 ' + p.dice.length + '개).');
    const list = (m) => Array.isArray(m) ? parseMoves(m.join(' ')) : parseMoves(m);
    if (r.all !== undefined) return { die, all: r.all, allowed: r.moves !== undefined ? [...new Set(list(r.moves))] : ['right', 'left', 'front', 'back'] };
    const drawn = p.arrows.length ? arrowMoves(p, die) : null;
    if (r.path === 'arrows') {
      if (!drawn) fail('주사위 ' + die.id + '가 놓인 바닥 칸 [' + die.at.slice(0, 2).join(',') + ']에서 시작하는 화살표(arrows)가 없습니다.');
      return { die, moves: drawn, drawn };
    }
    return { die, moves: list(r.moves), drawn };
  }
  function rollValue(e, rows, p, die) {
    if (e.face !== undefined) {
      const dir = G.dirName(e.face);
      let k = rows.length - 1;
      if (e.step !== undefined) {
        if (e.step >= rows.length) fail('step ' + e.step + ': ' + (rows.length - 1) + '번만 굴립니다.');
        k = e.step;
      }
      if (e.tile !== undefined) {
        const tile = p.tiles.find((t) => t.text === e.tile);
        if (!tile) fail('바닥 칸 "' + e.tile + '"이 tiles에 없습니다 (있는 칸: ' + (p.tiles.filter((t) => t.text).map((t) => t.text).join(', ') || '없음') + ').');
        const hits = rows.map((r, i) => r.at[0] === tile.at[0] && r.at[1] === tile.at[1] ? i : -1).filter((i) => i >= 0);
        if (!hits.length) fail('주사위 ' + die.id + '가 바닥 칸 ' + e.tile + ' [' + tile.at.join(',') + ']을 지나지 않습니다.');
        if (hits.length > 1) fail('주사위가 칸 ' + e.tile + '을 ' + hits.length + '번 지납니다. step(몇 번 굴린 뒤)으로 정하세요: ' + hits.join(', '));
        k = hits[0];
      }
      const f = rows[k].faces[dir], v = G.faceValue(f);
      return Number.isFinite(v) ? v : G.faceText(f);
    }
    const dir = G.dirName(e.sum);
    return rows.slice(e.start ? 0 : 1).reduce((m, r) => m + numberOf(r.faces[dir], die.id + ' ' + r.step + '번째 ' + DIR_KO[dir]), 0);
  }
  const byValue = (a, b) => typeof a === typeof b ? (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))) : typeof a === 'number' ? -1 : 1;
  function solveRoll(p, ask) {
    const plan = rollPlan(p, ask), { die } = plan, conditions = ask.where || [];
    const exprs = [ask.find, ...conditions.map(({ equals, multipleOf, ...e }) => e)];
    const tuple = (rows) => exprs.map((e) => e === undefined ? null : rollValue(e, rows, p, die));
    const tuples = [];
    if (plan.all === undefined) tuples.push(tuple(rollTrace(die.faces, die.at, plan.moves)));
    else {
      const rows = [{ step: 0, move: null, at: [...die.at], faces: die.faces }];
      const walk = () => {
        if (rows.length === plan.all + 1) { tuples.push(tuple(rows)); return; }
        const last = rows[rows.length - 1];
        for (const m of plan.allowed) {
          rows.push({ step: rows.length, move: m, at: G.add(last.at, STEP[m]), faces: apply(last.faces, MOVES[m]) });
          walk(); rows.pop();
        }
      };
      walk();
    }
    const good = tuples.filter((t) => conditions.every((c, i) => c.equals !== undefined ? t[i + 1] === c.equals : typeof t[i + 1] === 'number' && t[i + 1] % c.multipleOf === 0));
    const values = [...new Set(good.map((t) => t[0]).filter((x) => x !== null))].sort(byValue);
    const goal = ask.goal || 'value';
    let value;
    if (goal === 'ways') value = good.length;
    else if (goal === 'min' || goal === 'max') {
      if (values.some((x) => typeof x !== 'number')) fail('글자 면은 크고 작음을 비교할 수 없습니다: ' + values.join(', '));
      if (values.length) value = goal === 'min' ? values[0] : values[values.length - 1];
    } else if (goal === 'values') value = values;
    else if (goal === 'count') value = values.length;
    else if (values.length === 1) value = values[0];
    const result = { id: ask.id, goal, values, valueCount: values.length, ...(value !== undefined ? { value } : {}),
      roll: { die: die.id, ...(plan.all !== undefined ? { all: plan.all, allowed: plan.allowed, sequences: tuples.length } : { moves: movesText(plan.moves), steps: plan.moves.length }) } };
    if (goal === 'value' && values.length !== 1) result.problem = values.length ? 'answer-ambiguous' : 'no-arrangement';
    if ((goal === 'min' || goal === 'max') && !values.length) result.problem = 'no-arrangement';
    // Written moves that disagree with the drawn arrows: the picture and the answer tell two stories.
    if (plan.drawn && ask.roll.moves !== undefined && plan.drawn.join() !== plan.moves.join()) result.pathMismatch = { written: movesText(plan.moves), drawn: movesText(plan.drawn) };
    if (ask.answer !== undefined && value !== undefined) result.matches = typeof value === 'string' || typeof ask.answer === 'string' ? String(ask.answer) === String(value) : JSON.stringify(ask.answer) === JSON.stringify(value);
    return result;
  }
  function parseMoves(text) {
    const parts = String(text).split(/[\s,/]+/).filter(Boolean), moves = [];
    for (const part of parts) {
      const m = part.match(/^(.+?)(?:[x×*](\d+))?$/), name = moveName(m[1]);
      for (let i = 0; i < Number(m[2] ?? 1); i++) moves.push(name);
    }
    if (!moves.length) fail('굴리는 방향을 하나 이상 주세요. 예: "오 오 앞" 또는 "right x2, front"');
    return moves;
  }

  // --- Text tables -----------------------------------------------------------------------------
  const showFace = (f, dir) => G.faceText(f) + (f.kind !== 'blank' && f.up !== G.DEFAULT_UP[dir] && (f.kind === 'text' || [2, 3, 6].includes(f.pips)) ? '^' + DIR_KO[f.up] : '');
  const facesLine = (faces) => DIRS.map((d) => DIR_KO[d] + ' ' + showFace(faces[d], d)).join('  ');
  // A face's lines in words, ends named on the cube: "뒤왼 꼭짓점–앞오 꼭짓점", "앞 모서리 가운데",
  // "가운데". The face's right is n × up, the frame the picture uses.
  const NAME_ORDER = ['top', 'bottom', 'front', 'back', 'left', 'right'];
  function pointWords(q, dir, up) {
    const n = DIR_VEC[dir], u = DIR_VEC[up], r = cross(n, u);
    const p = [0, 1, 2].map((i) => n[i] * .5 + (q[0] - .5) * r[i] + (.5 - q[1]) * u[i]);
    const axis = n.findIndex((v) => v !== 0), named = [];
    for (const i of [0, 1, 2].filter((k) => k !== axis)) {
      if (Math.abs(p[i]) < 1e-9) continue;
      const d = NAME_ORDER.find((x) => DIR_VEC[x][i] === Math.sign(p[i]));
      if (Math.abs(Math.abs(p[i]) - .5) > 1e-9) return '[' + q.map((v) => Number(v.toFixed(3))).join(',') + ']';
      named.push(d);
    }
    named.sort((a, b) => NAME_ORDER.indexOf(a) - NAME_ORDER.indexOf(b));
    return named.length === 2 ? named.map((d) => DIR_KO[d]).join('') + ' 꼭짓점' : named.length ? DIR_KO[named[0]] + ' 모서리 가운데' : '가운데';
  }
  const linesWords = (face, dir) => (face.lines || []).map((l) => pointWords(l[0], dir, face.up) + '–' + pointWords(l[1], dir, face.up));
  const CLASS_KO = { visible: '그림에 보이는 면', exposed: '겉면(바닥 제외)', surface: '겉면(바닥 포함)', touching: '맞닿은 면', floor: '바닥에 닿은 면', unseen: '어디서도 안 보이는 면(맞닿음+바닥)', hidden: '그림에서 안 보이는 면' };
  function summary(p) {
    const cls = classify(p), edges = contacts(p, cls);
    const sumOf = (name) => {
      let total = 0, count = 0;
      p.dice.forEach((die, i) => DIRS.forEach((d) => { if (inClass(cls[i][d], name)) { total += G.faceValue(die.faces[d]); count++; } }));
      return { count, sum: Number.isFinite(total) ? total : null };
    };
    return {
      dice: p.dice.map((die, i) => ({ id: die.id, at: die.at, faces: Object.fromEntries(DIRS.map((d) => [d, G.encodeFace(die.faces[d], d)])),
        ...(DIRS.some((d) => die.faces[d].lines) ? { lines: Object.fromEntries(DIRS.filter((d) => die.faces[d].lines).map((d) => [d, linesWords(die.faces[d], d)])) } : {}),
        classes: Object.fromEntries(DIRS.map((d) => [d, cls[i][d].cls === 'exposed' ? cls[i][d].view : cls[i][d].cls + (cls[i][d].die !== undefined ? ':' + p.dice[cls[i][d].die].id + '.' + cls[i][d].dir : cls[i][d].block ? ':block' : '')])),
        ...(chirality(die.faces) ? { chirality: chirality(die.faces) } : {}) })),
      sums: Object.fromEntries(Object.keys(CLASS_KO).map((k) => [k, sumOf(k)])),
      contacts: edges.map((e) => {
        const x = G.faceValue(p.dice[e.a].faces[e.da]), y = G.faceValue(p.dice[e.b].faces[e.db]);
        return { a: p.dice[e.a].id + '.' + e.da, b: p.dice[e.b].id + '.' + e.db, values: [G.faceText(p.dice[e.a].faces[e.da]), G.faceText(p.dice[e.b].faces[e.db])], ...(Number.isFinite(x * y) ? { product: x * y } : {}) };
      }),
      asks: solveAll(p, { witness: false }).map((a) => a.values && a.values.length > 40 ? { ...a, values: [...a.values.slice(0, 40), '…'] } : a)
    };
  }
  function table(p) {
    const s = summary(p), lines = [];
    const viewDirs = DIRS.filter((d) => G.dot(DIR_VEC[d], R.viewBasis(p.view).normal) > 1e-9).map((d) => DIR_KO[d]).join('·');
    lines.push('주사위 ' + p.dice.length + '개 · 그림에서 보이는 쪽: ' + viewDirs);
    s.dice.forEach((d, i) => {
      const die = p.dice[i];
      lines.push(d.id + ' [' + d.at.join(',') + ']  ' + facesLine(die.faces) + (d.chirality ? '  (1·2·3 ' + (d.chirality === 'ccw' ? '반시계' : '시계') + ')' : '') + (die.fixed !== 'all' ? '  놓임: ' + (die.fixed === 'none' ? '자유' : die.fixed.map((x) => DIR_KO[x]).join('·') + ' 고정') + (die.mirror ? ', 거울 배치 포함' : '') : ''));
      const group = (pred) => DIRS.filter((dd) => pred(d.classes[dd])).map((dd) => DIR_KO[dd] + ' ' + G.faceText(die.faces[dd]));
      const parts = [['보임', (c) => c === 'visible'], ['일부 보임', (c) => c === 'partial'], ['맞닿음', (c) => c.startsWith('touching')], ['바닥', (c) => c === 'floor'], ['가려짐·뒤쪽', (c) => c === 'covered' || c === 'away']]
        .map(([name, pred]) => [name, group(pred)]).filter(([, g]) => g.length).map(([name, g]) => name + ': ' + g.join(', '));
      lines.push('   ' + parts.join(' · '));
      const drawn = DIRS.filter((dd) => die.faces[dd].lines).map((dd) => DIR_KO[dd] + ' 면 ' + linesWords(die.faces[dd], dd).join(', ') + (d.classes[dd] === 'visible' || d.classes[dd] === 'partial' ? '' : ' (그림에서 안 보임)'));
      if (drawn.length) lines.push('   선' + (die.answerLines ? '(정답용 그림에만)' : '') + ': ' + drawn.join(' · '));
    });
    lines.push('합계  ' + Object.entries(s.sums).filter(([, v]) => v.count).map(([k, v]) => CLASS_KO[k] + ' ' + v.count + '면 ' + (v.sum ?? '-')).join(' · '));
    if (s.contacts.length) {
      const products = s.contacts.every((c) => c.product !== undefined) ? s.contacts.reduce((m, c) => m + c.product, 0) : null;
      lines.push('맞닿은 짝  ' + s.contacts.map((c) => c.a + '–' + c.b + ' ' + c.values.join('·')).join(' / ') + (products !== null ? '  · 곱의 합 ' + products : ''));
    }
    s.asks.forEach((a) => {
      const ask = p.asks.find((x) => x.id === a.id);
      const rolled = a.roll ? '굴리기 ' + a.roll.die + ' ' + (a.roll.all !== undefined ? a.roll.all + '번 모든 경우(' + a.roll.allowed.map((m) => MOVE_KO[m]).join('·') + ', ' + a.roll.sequences + '가지)' : a.roll.moves + ' (' + a.roll.steps + '번)') + ' ' : '';
      const what = (ask.label ? ask.label + ' ' : '') + rolled + (ask.find !== undefined ? JSON.stringify(ask.find) : '') + (ask.where.length ? ' (조건 ' + JSON.stringify(ask.where) + ')' : '');
      const list = (v) => v.length > 40 ? v.slice(0, 40).join(', ') + ', … (' + v.length + '개)' : v.join(', ');
      const shown = a.value !== undefined ? (Array.isArray(a.value) ? '[' + list(a.value) + ']' : a.value) : '-';
      const verdict = a.problem ? '  ⚠ ' + a.problem + (a.message ? ': ' + a.message : '') : ask.answer !== undefined ? (a.matches ? '  ✓ 정답 ' + JSON.stringify(ask.answer) + '과 같음' : '  ✗ 정답 ' + JSON.stringify(ask.answer) + '과 다름 (answer-mismatch)') : '';
      lines.push('문제 ' + a.id + ' [' + (a.basis === 'search' ? '모든 경우를 따짐' : '그림 그대로 계산') + ']  ' + what + ' → ' + { value: '값', min: '최소', max: '최대', values: '가능한 값', count: '가짓수', ways: '경우의 수' }[a.goal] + ' ' + shown + (!['value', 'values', 'ways'].includes(a.goal) && a.valueCount > 1 ? ' (가능한 값 ' + a.valueCount + '가지)' : '') + verdict
        + (a.pathMismatch ? '  ⚠ 적은 길 ' + a.pathMismatch.written + ' ≠ 그림 화살표 ' + a.pathMismatch.drawn + ' (roll-path-mismatch)' : ''));
    });
    return lines.join('\n');
  }

  const api = { MOVES, MOVE_ALIASES, ORIENTATIONS, IDENTITY, apply, roll, mirror, compose, moveName, parseMoves, chirality, standardDie, netCells, foldNet, unfoldNet, netDiagram, pose,
    classify, select, contacts, solve, solveAll, rollTrace, rollAll, rollPlan, arrowMoves, movesText, summary, table, facesLine, showFace, linesWords, cross,
    CUBE_NETS, boxLayout, boxNets, boxShapeId, boxSketch, boxDiagram, boxAnswers, boxTable };
  if (node) module.exports = api;
  else root.SolidDice = api;
})(typeof window !== 'undefined' ? window : globalThis);
