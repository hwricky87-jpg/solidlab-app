/* 2D diagram editor: points, segments, polygons, circles, arcs, angle marks, dimensions and text.
   The drawing itself is the same SVG that export writes (diagram.js); this file only edits. */
(() => {
  'use strict';
  const D = window.SolidDiagram;
  const $ = (id) => document.getElementById(id);
  const shell = () => window.SolidLabShell || {};
  const STORAGE = 'solidlab-diagram-v1', PREFS = 'solidlab-diagram-prefs', MODE_KEY = 'solidlab-mode';
  const NAMES = { latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', hangul: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ' };
  const HELP = {
    select: '점을 끌어 옮기고, 점이나 선을 누르면 오른쪽에서 이름과 모양을 바꿉니다.\n빈 곳을 끌면 화면이 움직여요.',
    point: '누른 곳에 점을 찍습니다.',
    segment: '두 점을 차례로 누르면 선분이 됩니다.\n꼭짓점·교점·변의 중점·변 위에 저절로 붙어요.',
    perp: '점을 누른 뒤 변을 누르면, 그 변에 수직인 선(높이)과 직각 표시를 긋습니다.',
    parallel: '점을 누른 뒤 변을 누르면, 그 점을 지나고 변과 평행한 선분을 긋습니다.',
    polygon: '꼭짓점을 차례로 누르고, 첫 점을 다시 누르거나 Enter로 닫습니다.',
    circle: '중심을 누른 뒤 원 위의 한 곳을 누릅니다.\n이미 있는 점을 누르면 그 점을 지나는 원이 됩니다.',
    arc: '중심 → 시작점 → 끝점 순서로 누릅니다.\n시계 반대 방향으로 그려요.',
    angle: '한 변 위의 점 → 꼭짓점 → 다른 변 위의 점 순서로 누릅니다.\n90°면 직각 표시가 됩니다.',
    dim: '길이를 잴 두 점을 누릅니다.',
    text: '글자를 넣을 곳을 누릅니다.'
  };
  const STEPS = { segment: 2, dim: 2, circle: 2, arc: 3, angle: 3 };
  // Edge picked by a click, for the perpendicular and parallel tools.
  function edgeAt(p) {
    let best = null;
    for (const e of edges()) { const d = dist(toS(onEdge(e, toM(p))), p); if (d < 10 && (!best || d < best.d)) best = { e, d }; }
    return best?.e || null;
  }
  const stage = $('dgStage'), drawing = $('dgDrawing'), overlay = $('dgOverlay'), gridLayer = $('dgGridLayer');

  const blank = () => ({ format: 'solidlab-diagram', version: 1, unit: 1, unitLabel: 'cm', grid: false, settings: { style: 'print' }, points: [], items: [] });
  let doc = blank(), history = [], future = [], checkpoint = JSON.stringify(doc);
  let view = { cx: 5, cy: 4, k: 40 }, W = 0, H = 0, scene = null, toS = null, toM = null;
  let tool = 'segment', pending = [], hover = null, selection = null, drag = null, spaceDown = false, saveTimer = null, queued = false, saveBusy = false;
  const prefs = (() => { try { return { snap: 1, naming: '', ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { snap: 1, naming: '' }; } })();

  const active = () => document.body.dataset.mode === 'diagram';
  const message = (text, error) => shell().message ? shell().message(text, error) : console.log(text);
  const pointById = (id) => doc.points.find((p) => p.id === id);
  const at = (ref) => typeof ref === 'string' ? pointById(ref)?.at : ref;
  const fmt = (v) => String(Number(v.toFixed(3)));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // --- Document changes ------------------------------------------------------------------
  function commit(change, keepSelection = true) {
    history.push(JSON.stringify(doc)); if (history.length > 60) history.shift(); future = [];
    change();
    if (!keepSelection) selection = null;
    changed();
  }
  function changed() {
    try { D.resolve(doc); } catch {} // derived points follow their sides; check reports a broken one
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORAGE, JSON.stringify({ doc, clean: !dirty() })); } catch {} }, 250);
    updateHistory(); updateProps(); updateCheck(); syncDocControls(); request(); shell().updateDirty?.();
    $('dgSaveStatus').textContent = dirty() ? '저장 안 된 변경 있음' : '평면 그림 · 파일 저장은 별도';
  }
  function undo(step = -1) {
    const from = step < 0 ? history : future, to = step < 0 ? future : history;
    if (!from.length) return;
    to.push(JSON.stringify(doc)); doc = JSON.parse(from.pop()); selection = null; pending = []; changed();
  }
  function updateHistory() { $('dgUndoBtn').disabled = !history.length; $('dgRedoBtn').disabled = !future.length; }
  const empty = () => !doc.points.length && !doc.items.length;
  function dirty() { return JSON.stringify(doc) !== checkpoint; }

  function nextId() { let n = doc.points.length + 1; while (pointById('P' + n)) n++; return 'P' + n; }
  function nextName() {
    const letters = NAMES[prefs.naming]; if (!letters) return undefined;
    const used = new Set(doc.points.map((p) => p.label));
    for (const c of letters) if (!used.has(c)) return c;
    return undefined;
  }
  // A snap is either an existing point {id} or a free position {at}; creation turns it into a point.
  // A crossing or a point on a side remembers how it was made (cross / on), so it follows the sides.
  function ensurePoint(snap) {
    if (snap.id) return snap.id;
    const id = nextId(), label = nextName();
    doc.points.push({ id, at: snap.at.map((v) => Number(v.toFixed(6))), ...(label ? { label } : {}), ...(snap.def ? JSON.parse(JSON.stringify(snap.def)) : {}) });
    return id;
  }
  // A point that stops following others keeps where it is now.
  function freePoint(p) { delete p.on; delete p.t; delete p.cross; }
  const derivedFrom = (p, id) => (p.on || []).includes(id) || (p.cross || []).flat().includes(id);
  function removePoint(id) {
    const uses = (it) => [it.a, it.b, it.center, it.through, it.from, it.to, it.at].includes(id) || (it.points || []).includes(id);
    doc.items = doc.items.filter((it) => !uses(it));
    for (const p of doc.points) if (derivedFrom(p, id)) freePoint(p);
    doc.points = doc.points.filter((p) => p.id !== id);
  }
  function deleteSelection() {
    if (!selection) return;
    commit(() => { if (selection.kind === 'point') removePoint(selection.id); else doc.items.splice(selection.index, 1); }, false);
  }

  // --- View and mapping ------------------------------------------------------------------
  function viewport() {
    const w = W / view.k, h = H / view.k;
    return { x0: view.cx - w / 2, y0: view.cy - h / 2, x1: view.cx + w / 2, y1: view.cy + h / 2 };
  }
  function request() { if (!queued && active()) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } }
  function render() {
    if (!active() || W < 80 || H < 80) return;
    const box = viewport();
    try {
      D.resolve(doc);
      scene = D.scene(doc, { viewport: { ...box, bounds: box, width: W, height: H }, pixelsPerUnit: view.k, answers: $('dgAnswers').checked });
      drawing.innerHTML = D.toSvg(scene, { background: 'none' });
      toS = (p) => { const q = scene.toScreen(p); return Array.isArray(q) ? q : [q.x, q.y]; };
      toM = (p) => { const q = scene.toModel(p); return Array.isArray(q) ? q : [q.x, q.y]; };
    } catch (error) {
      drawing.textContent = '';
      toS = (p) => [(p[0] - box.x0) * view.k, (box.y1 - p[1]) * view.k];
      toM = (p) => [box.x0 + p[0] / view.k, box.y1 - p[1] / view.k];
      $('dgCheck').innerHTML = ''; $('dgCheck').append(Object.assign(document.createElement('div'), { textContent: error.message }));
    }
    drawGrid(box); drawOverlay();
  }
  function drawGrid(box) {
    let step = prefs.snap > 0 ? prefs.snap : 1;
    while (step * view.k < 9) step *= 2;
    let d = '', strong = '';
    for (let x = Math.ceil(box.x0 / step) * step; x <= box.x1; x += step) {
      const s = toS([x, box.y0])[0], seg = 'M' + s.toFixed(1) + ' 0V' + H;
      if (Math.abs(x - Math.round(x)) < 1e-9 && Math.round(x) % 5 === 0) strong += seg; else d += seg;
    }
    for (let y = Math.ceil(box.y0 / step) * step; y <= box.y1; y += step) {
      const s = toS([box.x0, y])[1], seg = 'M0 ' + s.toFixed(1) + 'H' + W;
      if (Math.abs(y - Math.round(y)) < 1e-9 && Math.round(y) % 5 === 0) strong += seg; else d += seg;
    }
    gridLayer.innerHTML = '<path d="' + d + '" stroke="#edf1ec" stroke-width="1" fill="none"/><path d="' + strong + '" stroke="#dde5dc" stroke-width="1" fill="none"/>';
  }

  // Screen outline of an item, used for highlight and hit testing.
  function itemShape(it) {
    const P = (ref) => toS(at(ref));
    if (['segment', 'line', 'ray', 'dim'].includes(it.type)) return { kind: it.type === 'segment' || it.type === 'dim' ? 'seg' : it.type, pts: [P(it.a), P(it.b)] };
    if (it.type === 'polygon') return { kind: 'poly', pts: it.points.map(P), fill: it.fill === 'light' };
    if (it.type === 'circle') { const c = P(it.center), r = (it.r ?? dist(at(it.center), at(it.through))) * view.k; return { kind: 'circle', c, r, fill: it.fill === 'light' }; }
    if (it.type === 'arc' || it.type === 'sector') {
      const c = at(it.center), a = at(it.from), b = at(it.to);
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
      return { kind: 'arc', c: toS(c), r: dist(c, a) * view.k, a0, sweep: it.ccw === false ? -((a0 - a1 + 2 * Math.PI) % (2 * Math.PI)) : (a1 - a0 + 2 * Math.PI) % (2 * Math.PI) };
    }
    if (it.type === 'angle') return { kind: 'dot', c: P(it.at), r: 22 };
    if (it.type === 'text') return { kind: 'dot', c: toS(at(it.at)), r: 14 };
    return null;
  }
  function segDistance(p, a, b, ray, line) {
    const d = [b[0] - a[0], b[1] - a[1]], l = d[0] * d[0] + d[1] * d[1] || 1;
    let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l;
    if (!line) t = Math.max(0, ray ? t : Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]);
  }
  function shapeDistance(s, p) {
    if (s.kind === 'seg' || s.kind === 'line' || s.kind === 'ray') return segDistance(p, s.pts[0], s.pts[1], s.kind === 'ray', s.kind === 'line');
    if (s.kind === 'poly') {
      let best = Infinity, inside = false;
      s.pts.forEach((a, i) => {
        const b = s.pts[(i + 1) % s.pts.length]; best = Math.min(best, segDistance(p, a, b));
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
      });
      return inside ? Math.min(best, 7) : best;
    }
    if (s.kind === 'circle') { const e = Math.abs(Math.hypot(p[0] - s.c[0], p[1] - s.c[1]) - s.r); return s.fill && Math.hypot(p[0] - s.c[0], p[1] - s.c[1]) < s.r ? Math.min(e, 7) : e; }
    if (s.kind === 'arc') {
      const ang = Math.atan2(-(p[1] - s.c[1]), p[0] - s.c[0]), rel = s.sweep >= 0 ? (ang - s.a0 + 4 * Math.PI) % (2 * Math.PI) : (s.a0 - ang + 4 * Math.PI) % (2 * Math.PI);
      return rel <= Math.abs(s.sweep) + .05 ? Math.abs(Math.hypot(p[0] - s.c[0], p[1] - s.c[1]) - s.r) : Infinity;
    }
    if (s.kind === 'dot') { const d = Math.hypot(p[0] - s.c[0], p[1] - s.c[1]); return d < s.r ? d / 3 : Infinity; }
    return Infinity;
  }
  function hitTest(p) {
    let best = null;
    for (const pt of doc.points) { const d = dist(toS(pt.at), p); if (d < 9 && (!best || d < best.d)) best = { kind: 'point', id: pt.id, d }; }
    if (best) return best;
    doc.items.forEach((it, index) => { const s = itemShape(it); if (!s) return; const d = shapeDistance(s, p); if (d < 7 && (!best || d < best.d)) best = { kind: 'item', index, d }; });
    return best;
  }
  // Straight edges of the drawing (segments, lines, polygon sides) in model coordinates.
  function edges() {
    const list = [];
    for (const it of doc.items) {
      if (['segment', 'line', 'ray'].includes(it.type)) list.push({ a: at(it.a), b: at(it.b), kind: it.type, ids: [it.a, it.b] });
      else if (it.type === 'polygon') it.points.forEach((id, i) => list.push({ a: at(id), b: at(it.points[(i + 1) % it.points.length]), kind: 'segment', ids: [id, it.points[(i + 1) % it.points.length]] }));
    }
    return list.filter((e) => e.a && e.b && dist(e.a, e.b) > 1e-9);
  }
  // Ratio of q between the ends of e (0 at a, 1 at b).
  const ratio = (e, q) => { const d = [e.b[0] - e.a[0], e.b[1] - e.a[1]]; return ((q[0] - e.a[0]) * d[0] + (q[1] - e.a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]); };
  const onDef = (e, q) => { const t = Number(ratio(e, q).toFixed(6)); return t >= 0 && t <= 1 ? { on: [...e.ids], ...(Math.abs(t - .5) > 1e-9 ? { t } : {}) } : undefined; };
  // Parameter t of the point on edge e nearest to m; segments clamp to their ends.
  function onEdge(e, m) {
    const d = [e.b[0] - e.a[0], e.b[1] - e.a[1]], l = d[0] * d[0] + d[1] * d[1];
    let t = ((m[0] - e.a[0]) * d[0] + (m[1] - e.a[1]) * d[1]) / l;
    if (e.kind === 'segment') t = Math.max(0, Math.min(1, t)); else if (e.kind === 'ray') t = Math.max(0, t);
    return [e.a[0] + t * d[0], e.a[1] + t * d[1]];
  }
  function crossing(e, f) {
    const r = [e.b[0] - e.a[0], e.b[1] - e.a[1]], s = [f.b[0] - f.a[0], f.b[1] - f.a[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) return null;
    const q = [f.a[0] - e.a[0], f.a[1] - e.a[1]], t = (q[0] * s[1] - q[1] * s[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den;
    const inside = (k, v) => k === 'line' || (k === 'ray' ? v >= -1e-9 : v >= -1e-9 && v <= 1 + 1e-9);
    return inside(e.kind, t) && inside(f.kind, u) ? [e.a[0] + t * r[0], e.a[1] + t * r[1]] : null;
  }
  const clean = (q) => q.map((v) => Number(v.toFixed(6)));
  // Snap order: existing point › crossing of two lines › midpoint of a side › on a side › grid.
  // This is what makes auxiliary lines (diagonals, heights, lines through midpoints) easy to draw.
  // Fingers are less precise than a mouse, so touch snaps from farther away.
  let reach = 1;
  function snapAt(p, free, except) {
    let best = null;
    for (const pt of doc.points) { if (pt.id === except) continue; const d = dist(toS(pt.at), p); if (d < 11 * reach && (!best || d < best.d)) best = { id: pt.id, at: pt.at, d }; }
    if (best) return best;
    const m = toM(p), near = 14 * reach;
    if (!free) {
      // Only edges passing near the pointer can give a crossing or a snap, which keeps this cheap.
      const list = edges().filter((e) => dist(toS(onEdge(e, m)), p) < near * 1.6), consider = (q, kind, radius, def) => { const d = dist(toS(q), p); if (d < radius && (!best || d < best.d)) best = { at: clean(q), kind, d, ...(def ? { def } : {}) }; };
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const q = crossing(list[i], list[j]); if (q) consider(q, '교점', 11 * reach, { cross: [[...list[i].ids], [...list[j].ids]] }); }
      if (best) return best;
      for (const e of list) if (e.kind === 'segment') consider([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], '중점', 10 * reach, { on: [...e.ids] });
      if (best) return best;
      const step = prefs.snap;
      // Near a side the point always lands on it: at the grid crossing along the side when one is
      // close, otherwise at the nearest point. It never falls back to a grid point off the side
      // (such a point can sit on a dimension line drawn beside the side).
      for (const e of list) {
        const q = onEdge(e, m), g = step > 0 ? m.map((v) => Math.round(v / step) * step) : null;
        const onGrid = g && dist(onEdge(e, g), g) < 1e-9 && dist(toS(g), p) < near;
        consider(onGrid ? g : q, '변 위', near * 1.6, onDef(e, onGrid ? g : q));
      }
      if (best) return best;
    }
    const step = free ? 0 : prefs.snap;
    const q = step > 0 ? m.map((v) => Number((Math.round(v / step) * step).toFixed(6))) : m.map((v) => Number(v.toFixed(3)));
    // A grid position that already holds a point reuses that point.
    const existing = doc.points.find((pt) => pt.id !== except && dist(pt.at, q) < 1e-9);
    return existing ? { id: existing.id, at: existing.at } : { at: q };
  }

  function drawOverlay() {
    const svg = [], accent = '#2f8f6a';
    const shapeSvg = (s, stroke, width) => {
      if (!s) return '';
      const style = ' fill="none" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linecap="round" stroke-opacity=".55"';
      if (s.kind === 'seg' || s.kind === 'line' || s.kind === 'ray') return '<line x1="' + s.pts[0][0] + '" y1="' + s.pts[0][1] + '" x2="' + s.pts[1][0] + '" y2="' + s.pts[1][1] + '"' + style + '/>';
      if (s.kind === 'poly') return '<polygon points="' + s.pts.map((q) => q.join(',')).join(' ') + '"' + style + '/>';
      if (s.kind === 'circle') return '<circle cx="' + s.c[0] + '" cy="' + s.c[1] + '" r="' + s.r + '"' + style + '/>';
      if (s.kind === 'arc') {
        const e = s.a0 + s.sweep, x = (a) => s.c[0] + s.r * Math.cos(a), y = (a) => s.c[1] - s.r * Math.sin(a);
        return '<path d="M' + x(s.a0) + ' ' + y(s.a0) + 'A' + s.r + ' ' + s.r + ' 0 ' + (Math.abs(s.sweep) > Math.PI ? 1 : 0) + ' ' + (s.sweep >= 0 ? 0 : 1) + ' ' + x(e) + ' ' + y(e) + '"' + style + '/>';
      }
      if (s.kind === 'dot') return '<circle cx="' + s.c[0] + '" cy="' + s.c[1] + '" r="' + s.r + '"' + style + '/>';
      return '';
    };
    if (selection?.kind === 'item' && doc.items[selection.index]) svg.push(shapeSvg(itemShape(doc.items[selection.index]), accent, 6));
    if (tool === 'select' && hover?.hit?.kind === 'item' && !(selection?.kind === 'item' && selection.index === hover.hit.index)) svg.push(shapeSvg(itemShape(doc.items[hover.hit.index]), '#8fb9a2', 5));
    // Tool preview from the clicked points to the pointer.
    const cursor = hover?.snap ? toS(hover.snap.at) : null, placed = pending.map((s) => toS(s.at));
    if (placed.length && cursor) {
      const line = (a, b) => '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="' + accent + '" stroke-width="1.3" stroke-dasharray="5 4"/>';
      if (tool === 'circle') svg.push('<circle cx="' + placed[0][0] + '" cy="' + placed[0][1] + '" r="' + dist(placed[0], cursor) + '" fill="none" stroke="' + accent + '" stroke-width="1.3" stroke-dasharray="5 4"/>');
      else if (tool === 'arc') { svg.push(line(placed[0], placed.length > 1 ? placed[1] : cursor)); if (placed.length > 1) svg.push(line(placed[0], cursor)); }
      else { placed.forEach((q, i) => { if (i) svg.push(line(placed[i - 1], q)); }); svg.push(line(placed[placed.length - 1], cursor)); }
    }
    for (const pt of doc.points) {
      const q = toS(pt.at), selected = selection?.kind === 'point' && selection.id === pt.id;
      svg.push('<circle cx="' + q[0] + '" cy="' + q[1] + '" r="' + (selected ? 6 : 4) + '" fill="' + (selected ? accent : '#fff') + '" stroke="' + accent + '" stroke-width="1.4"' + (pt.show === false ? ' stroke-dasharray="2 2"' : '') + '/>');
    }
    placed.forEach((q) => svg.push('<circle cx="' + q[0] + '" cy="' + q[1] + '" r="5" fill="' + accent + '"/>'));
    if (cursor && tool !== 'select') {
      svg.push('<circle cx="' + cursor[0] + '" cy="' + cursor[1] + '" r="' + (hover.snap.id || hover.snap.kind ? 8 : 3.5) + '" fill="none" stroke="' + accent + '" stroke-width="1.6"/>');
      if (hover.snap.kind) svg.push('<text x="' + (cursor[0] + 11) + '" y="' + (cursor[1] - 9) + '" font-size="11" fill="' + accent + '" font-family="sans-serif">' + hover.snap.kind + '</text>');
    }
    overlay.innerHTML = svg.join('');
  }

  // --- Tools -----------------------------------------------------------------------------
  function setTool(name) {
    tool = name; pending = []; hover = null; $('dgHint').style.display = 'none';
    document.querySelectorAll('[data-dtool]').forEach((el) => el.classList.toggle('active', el.dataset.dtool === name));
    stage.classList.toggle('select', name === 'select');
    $('dgToolHelp').textContent = HELP[name]; request();
  }
  function hint(text) { $('dgHint').textContent = text; $('dgHint').style.display = text ? 'block' : 'none'; }
  const same = (a, b) => (a.id && a.id === b.id) || (!a.id && !b.id && dist(a.at, b.at) < 1e-9);

  function place(snap) {
    if (tool === 'point') { if (snap.id) { selection = { kind: 'point', id: snap.id }; changed(); return; } commit(() => { selection = { kind: 'point', id: ensurePoint(snap) }; }); return; }
    if (tool === 'text') {
      const text = window.prompt('넣을 글자를 입력하세요 (100자 이내)'); if (!text || !text.trim()) return;
      commit(() => { doc.items.push({ type: 'text', at: snap.id || snap.at, text: text.trim().slice(0, 100) }); selection = { kind: 'item', index: doc.items.length - 1 }; });
      return;
    }
    if (tool === 'perp' || tool === 'parallel') { helperLine(snap); return; }
    if (pending.length && same(pending[pending.length - 1], snap)) return;
    if (tool === 'polygon') {
      if (pending.length >= 3 && same(pending[0], snap)) { finishPolygon(); return; }
      if (pending.some((s) => same(s, snap))) return;
      pending.push(snap); hint(pending.length < 3 ? '다음 꼭짓점을 누르세요.' : '첫 점을 누르거나 Enter로 닫습니다.'); request(); return;
    }
    if (tool === 'arc' && pending.length === 2 && !snap.id) {
      // The end point sits on the circle through the start point, in the clicked direction.
      const c = pending[0].at, r = dist(c, pending[1].at), a = Math.atan2(snap.at[1] - c[1], snap.at[0] - c[0]);
      snap = { at: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] };
    }
    pending.push(snap);
    if (pending.length < STEPS[tool]) { hint({ arc: ['', '호의 시작점을 누르세요.', '호의 끝점을 누르세요.'], angle: ['', '각의 꼭짓점을 누르세요.', '다른 변 위의 점을 누르세요.'] }[tool]?.[pending.length] || '두 번째 점을 누르세요.'); request(); return; }
    const snaps = pending; pending = []; hint('');
    commit(() => {
      let item;
      if (tool === 'segment') item = { type: 'segment', a: ensurePoint(snaps[0]), b: ensurePoint(snaps[1]), ...(prefs.dash ? { dash: true } : {}) };
      else if (tool === 'dim') item = { type: 'dim', a: ensurePoint(snaps[0]), b: ensurePoint(snaps[1]) };
      else if (tool === 'circle') {
        const center = ensurePoint(snaps[0]);
        item = snaps[1].id ? { type: 'circle', center, through: snaps[1].id } : { type: 'circle', center, r: Number(dist(snaps[0].at, snaps[1].at).toFixed(6)) };
      } else if (tool === 'arc') item = { type: 'arc', center: ensurePoint(snaps[0]), from: ensurePoint(snaps[1]), to: ensurePoint(snaps[2]) };
      else if (tool === 'angle') {
        const [f, v, t] = snaps.map((s) => s.at), u = [f[0] - v[0], f[1] - v[1]], w = [t[0] - v[0], t[1] - v[1]];
        const deg = Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w) || 1)))) * 180 / Math.PI;
        item = { type: 'angle', from: ensurePoint(snaps[0]), at: ensurePoint(snaps[1]), to: ensurePoint(snaps[2]), mark: Math.abs(deg - 90) < .5 ? 'right' : 'arc' };
      }
      if (item) { doc.items.push(item); selection = { kind: 'item', index: doc.items.length - 1 }; }
    });
  }
  function helperLine(snap) {
    if (!pending.length) { pending = [snap]; hint(tool === 'perp' ? '수직으로 내릴 변을 누르세요.' : '평행하게 그을 기준 변을 누르세요.'); request(); return; }
    const e = edgeAt(toS(hover?.snap?.at || snap.at)) || edgeAt(toS(snap.at));
    if (!e) { hint('변 위를 눌러 주세요.'); return; }
    const from = pending[0], p0 = from.at, d = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
    pending = []; hint('');
    if (tool === 'perp') {
      const foot = clean(onEdge({ ...e, kind: 'line' }, p0));
      if (dist(foot, p0) < 1e-9) { message('점이 이미 그 변 위에 있습니다.', true); return; }
      commit(() => {
        const a = ensurePoint(from), existing = doc.points.find((pt) => dist(pt.at, foot) < 1e-9);
        const f = existing ? existing.id : (() => { const id = nextId(); doc.points.push({ id, at: foot, show: false }); return id; })();
        const side = dist(e.a, foot) > 1e-9 ? e.a : e.b, s = doc.points.find((pt) => dist(pt.at, side) < 1e-9)?.id ?? ensurePoint({ at: clean(side) });
        doc.items.push({ type: 'segment', a, b: f, dash: true }, { type: 'angle', from: s, at: f, to: a, mark: 'right' });
        selection = { kind: 'item', index: doc.items.length - 2 };
      });
    } else {
      const l = Math.hypot(...d), u = [d[0] / l, d[1] / l], half = l / 2;
      commit(() => {
        const a = ensurePoint({ at: clean([p0[0] - u[0] * half, p0[1] - u[1] * half]) }), b = ensurePoint({ at: clean([p0[0] + u[0] * half, p0[1] + u[1] * half]) });
        doc.items.push({ type: 'segment', a, b, dash: prefs.dash || undefined });
        selection = { kind: 'item', index: doc.items.length - 1 };
      });
    }
  }
  function finishPolygon() {
    if (tool !== 'polygon' || pending.length < 3) return;
    const snaps = pending; pending = []; hint('');
    commit(() => { doc.items.push({ type: 'polygon', points: snaps.map(ensurePoint) }); selection = { kind: 'item', index: doc.items.length - 1 }; });
  }

  const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // Touch: one finger draws (on release, so a second finger can still start a pinch), two
  // fingers pinch-zoom and pan. Mouse: draws on press, as before.
  const touches = new Map();
  let pinch = null, tap = null;
  function startPinch() {
    const [a, b] = [...touches.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (drag?.kind === 'move' && drag.moved) doc = JSON.parse(drag.before);
    drag = null; tap = null;
    pinch = { d: Math.max(10, dist(a, b)), k: view.k, m: toM ? toM(mid) : [view.cx, view.cy] };
  }
  function movePinch() {
    const [a, b] = [...touches.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    view.k = Math.max(4, Math.min(400, pinch.k * dist(a, b) / pinch.d));
    view.cx = pinch.m[0] - (mid[0] - W / 2) / view.k; view.cy = pinch.m[1] + (mid[1] - H / 2) / view.k; request();
  }
  stage.addEventListener('pointerdown', (e) => {
    stage.focus({ preventScroll: true });
    const p = local(e), touch = e.pointerType === 'touch';
    reach = touch ? 1.8 : 1;
    if (touch) { touches.set(e.pointerId, p); stage.setPointerCapture(e.pointerId); if (touches.size === 2) { startPinch(); return; } if (touches.size > 2) return; }
    if (e.button === 1 || e.button === 2 || spaceDown) { drag = { kind: 'pan', p, view: { ...view } }; stage.setPointerCapture(e.pointerId); stage.classList.add('panning'); return; }
    if (e.button !== 0) return;
    if (tool === 'select') {
      const hit = hitTest(p);
      if (hit?.kind === 'point') { selection = { kind: 'point', id: hit.id }; drag = { kind: 'move', id: hit.id, before: JSON.stringify(doc), moved: false }; stage.setPointerCapture(e.pointerId); changed(); return; }
      if (hit?.kind === 'item') { selection = { kind: 'item', index: hit.index }; changed(); return; }
      selection = null; changed(); drag = { kind: 'pan', p, view: { ...view } }; stage.setPointerCapture(e.pointerId); stage.classList.add('panning'); return;
    }
    if (touch) { tap = { p, id: e.pointerId }; hover = { snap: snapAt(p, false) }; request(); return; }
    place(snapAt(p, e.shiftKey));
  });
  stage.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (touches.has(e.pointerId)) { touches.set(e.pointerId, p); if (pinch && touches.size === 2) { movePinch(); return; } }
    if (toM) { const m = toM(p); $('dgPointer').textContent = 'x ' + fmt(m[0]) + ' / y ' + fmt(m[1]); }
    if (drag?.kind === 'pan') { view.cx = drag.view.cx - (p[0] - drag.p[0]) / view.k; view.cy = drag.view.cy + (p[1] - drag.p[1]) / view.k; request(); return; }
    if (drag?.kind === 'move') {
      const pt = pointById(drag.id), snap = snapAt(p, e.shiftKey, drag.id);
      if (!pt || snap.id) return;
      // Dragging a crossing or a midpoint makes it a free point at the new place.
      if (dist(pt.at, snap.at) > 1e-9) { freePoint(pt); pt.at = snap.at.map((v) => Number(v.toFixed(6))); drag.moved = true; request(); }
      return;
    }
    // A finger slides the snap marker to the exact spot; the point is placed on release.
    // (Two fingers pan and zoom.)
    if (tap && tap.id === e.pointerId) { tap.p = p; hover = { snap: snapAt(p, false) }; request(); return; }
    if (e.pointerType === 'mouse') reach = 1;
    hover = tool === 'select' ? { hit: hitTest(p) } : { snap: snapAt(p, e.shiftKey) };
    request();
  });
  const endDrag = (e) => {
    if (touches.delete(e.pointerId) && pinch) { if (touches.size < 2) pinch = null; drag = null; return; }
    if (e.type === 'pointerup' && tap && tap.id === e.pointerId) { const p = tap.p; tap = null; place(snapAt(p, false)); }
    tap = null;
    if (drag?.kind === 'move' && drag.moved) { history.push(drag.before); if (history.length > 60) history.shift(); future = []; changed(); }
    drag = null; stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => { if (!drag) { hover = null; request(); } });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('dblclick', (e) => {
    if (tool === 'polygon') { finishPolygon(); return; }
    const hit = hitTest(local(e));
    if (hit?.kind === 'point') { selection = { kind: 'point', id: hit.id }; changed(); setTimeout(() => $('dgPropLabel')?.focus(), 0); }
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); if (!toM) return;
    const p = local(e), m = toM(p), k = Math.max(4, Math.min(400, view.k * Math.exp(-e.deltaY * .0015)));
    view.k = k; view.cx = m[0] - (p[0] - W / 2) / k; view.cy = m[1] + (p[1] - H / 2) / k; request();
  }, { passive: false });
  function zoom(f) { view.k = Math.max(4, Math.min(400, view.k * f)); request(); }
  function fit() {
    const list = doc.points.map((p) => p.at);
    for (const it of doc.items) {
      if (it.type === 'circle') { const c = at(it.center), r = it.r ?? dist(c, at(it.through)); list.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]); }
      else if (it.type === 'arc' || it.type === 'sector') { const c = at(it.center), r = dist(c, at(it.from)); list.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]); }
      else if (it.type === 'text' && Array.isArray(it.at)) list.push(it.at);
    }
    if (!list.length) { view = { cx: 5, cy: 4, k: 40 }; request(); return; }
    const xs = list.map((p) => p[0]), ys = list.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    view.k = Math.max(4, Math.min(120, (W - 140) / Math.max(1, x1 - x0), (H - 140) / Math.max(1, y1 - y0)));
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2; request();
  }

  // --- Properties panel --------------------------------------------------------------------
  function field(label, input) { const f = document.createElement('div'); f.className = 'field'; const l = document.createElement('label'); l.textContent = label; if (input.id) l.htmlFor = input.id; f.append(l, input); return f; }
  function textInput(value, onChange, id, placeholder) {
    const el = Object.assign(document.createElement('input'), { type: 'text', value: value ?? '', maxLength: 40, placeholder: placeholder || '' }); if (id) el.id = id;
    el.addEventListener('change', () => onChange(el.value.trim())); return el;
  }
  function numberInput(value, onChange) {
    const el = Object.assign(document.createElement('input'), { type: 'number', step: 'any', value: Number(value.toFixed(6)) });
    el.addEventListener('change', () => { const v = Number(el.value); if (Number.isFinite(v)) onChange(v); else el.value = value; }); return el;
  }
  function select(options, value, onChange) {
    const el = document.createElement('select');
    for (const [v, t] of options) el.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
    el.value = value; el.addEventListener('change', () => onChange(el.value)); return el;
  }
  function toggle(label, checked, onChange) {
    const row = document.createElement('label'); row.className = 'switch-row'; row.textContent = label;
    const el = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!checked }); el.setAttribute('role', 'switch');
    el.addEventListener('change', () => onChange(el.checked)); row.append(el); return row;
  }
  const info = (text) => { const el = Object.assign(document.createElement('p'), { className: 'help', textContent: text }); el.style.whiteSpace = 'pre-line'; return el; };
  // Set or remove an optional property in one undoable step.
  const set = (obj, key, value, remove) => commit(() => { if (remove) delete obj[key]; else obj[key] = value; });
  const unitText = (v, power = 1) => fmt(v * doc.unit ** power) + ' ' + doc.unitLabel + (power === 2 ? '²' : '');

  function updateProps() {
    const box = $('dgProps'); box.replaceChildren();
    $('dgCount').textContent = doc.points.length + '점 · ' + doc.items.length + '개';
    if (selection?.kind === 'point' && !pointById(selection.id)) selection = null;
    if (selection?.kind === 'item' && !doc.items[selection.index]) selection = null;
    if (!selection) { box.append(info('선택·이동 도구(V)로 점이나 선을 누르면 이름과 모양을 바꿀 수 있어요.\n점을 더블클릭하면 바로 이름을 적습니다.')); return; }
    const parts = [];
    if (selection.kind === 'point') {
      const p = pointById(selection.id);
      parts.push(field('이름 (ㄱ, A…)', textInput(p.label, (v) => set(p, 'label', v.slice(0, 20), !v), 'dgPropLabel', '비우면 이름 없음')));
      const row = document.createElement('div'); row.className = 'field-row two';
      row.append(field('x', numberInput(p.at[0], (v) => commit(() => { freePoint(p); p.at = [v, p.at[1]]; }))), field('y', numberInput(p.at[1], (v) => commit(() => { freePoint(p); p.at = [p.at[0], v]; }))));
      parts.push(row);
      if (p.on || p.cross) {
        const name = (r) => typeof r === 'string' ? (pointById(r)?.label || r) : '(' + r.map(fmt).join(', ') + ')';
        parts.push(info(p.on ? name(p.on[0]) + ' · ' + name(p.on[1]) + ' 사이의 점 (비율 ' + fmt(p.t ?? .5) + ')\n두 점을 옮기면 따라갑니다.' : '두 직선 ' + p.cross[0].map(name).join('') + ', ' + p.cross[1].map(name).join('') + '의 교점\n선을 옮기면 따라갑니다.'));
        const unlink = Object.assign(document.createElement('button'), { className: 'small full', textContent: '이 자리에 고정하기' });
        unlink.addEventListener('click', () => commit(() => freePoint(p))); parts.push(unlink);
      }
      parts.push(field('이름 위치', select([['auto', '자동'], ['90', '위'], ['270', '아래'], ['180', '왼쪽'], ['0', '오른쪽'], ['135', '왼쪽 위'], ['45', '오른쪽 위'], ['225', '왼쪽 아래'], ['315', '오른쪽 아래']], String(p.labelAt ?? 'auto'), (v) => set(p, 'labelAt', Number(v), v === 'auto'))));
      parts.push(toggle('점 찍어 보이기', p.show !== false, (v) => set(p, 'show', false, v)));
    } else {
      const it = doc.items[selection.index], A = (r) => at(r);
      if (['segment', 'line', 'ray'].includes(it.type)) {
        parts.push(field('종류', select([['segment', '선분'], ['line', '직선'], ['ray', '반직선']], it.type, (v) => commit(() => { it.type = v; if (v !== 'segment') { delete it.ticks; delete it.parallel; delete it.arrows; } }))));
        parts.push(toggle('점선', it.dash, (v) => set(it, 'dash', true, !v)));
        if (it.type === 'segment') {
          parts.push(field('같은 길이 표시', select([['0', '없음'], ['1', '빗금 1개'], ['2', '빗금 2개'], ['3', '빗금 3개']], String(it.ticks || 0), (v) => set(it, 'ticks', Number(v), v === '0'))));
          parts.push(field('평행 표시', select([['0', '없음'], ['1', '1개'], ['2', '2개'], ['3', '3개']], String(it.parallel || 0), (v) => set(it, 'parallel', Number(v), v === '0'))));
          parts.push(field('화살표', select([['', '없음'], ['end', '끝에'], ['both', '양쪽']], it.arrows || '', (v) => set(it, 'arrows', v, !v))));
          labelFields(it, parts, '선분 옆 기호 (㉠, a, 6 cm…)', '비우면 없음');
          parts.push(info('길이 ' + unitText(dist(A(it.a), A(it.b)))));
        }
      } else if (it.type === 'polygon') {
        parts.push(toggle('안쪽 색칠', it.fill === 'light', (v) => set(it, 'fill', 'light', !v)));
        const q = it.points.map(A); let area = 0, per = 0;
        q.forEach((a, i) => { const b = q[(i + 1) % q.length]; area += a[0] * b[1] - b[0] * a[1]; per += dist(a, b); });
        parts.push(info('넓이 ' + unitText(Math.abs(area) / 2, 2) + ' · 둘레 ' + unitText(per)));
      } else if (it.type === 'circle') {
        if (it.r !== undefined) parts.push(field('반지름 (칸)', numberInput(it.r, (v) => { if (v > 0) set(it, 'r', v); })));
        parts.push(toggle('안쪽 색칠', it.fill === 'light', (v) => set(it, 'fill', 'light', !v)));
        const r = it.r ?? dist(A(it.center), A(it.through));
        parts.push(info('반지름 ' + unitText(r) + ' · 지름 ' + unitText(2 * r)));
      } else if (it.type === 'arc' || it.type === 'sector') {
        parts.push(field('종류', select([['arc', '호'], ['sector', '부채꼴']], it.type, (v) => commit(() => { it.type = v; if (v === 'arc') delete it.fill; }))));
        parts.push(toggle('시계 반대 방향', it.ccw !== false, (v) => set(it, 'ccw', false, v)));
        if (it.type === 'sector') parts.push(toggle('안쪽 색칠', it.fill === 'light', (v) => set(it, 'fill', 'light', !v)));
      } else if (it.type === 'angle') {
        parts.push(field('표시', select([['arc', '호 모양'], ['right', '직각 표시']], it.mark || 'arc', (v) => set(it, 'mark', v))));
        if ((it.mark || 'arc') === 'arc') parts.push(field('호 개수', select([['1', '1개'], ['2', '2개'], ['3', '3개']], String(it.arcs || 1), (v) => set(it, 'arcs', Number(v), v === '1'))));
        labelFields(it, parts);
        const f = A(it.from), v = A(it.at), t = A(it.to), deg = ((Math.atan2(t[1] - v[1], t[0] - v[0]) - Math.atan2(f[1] - v[1], f[0] - v[0])) * 180 / Math.PI + 360) % 360;
        parts.push(info('그린 각도 ' + fmt(deg) + '°'));
      } else if (it.type === 'dim') {
        labelFields(it, parts);
        parts.push(field('치수선 거리 (px, 음수면 반대쪽)', numberInput(it.offset ?? 25, (v) => set(it, 'offset', Math.max(-300, Math.min(300, v))))));
        parts.push(info('그린 길이 ' + unitText(dist(A(it.a), A(it.b)))));
      } else if (it.type === 'text') {
        parts.push(field('글자', textInput(it.text, (v) => { if (v) set(it, 'text', v.slice(0, 100)); })));
      }
    }
    const remove = Object.assign(document.createElement('button'), { className: 'small danger full', textContent: '지우기 (Delete)' });
    remove.style.marginTop = '12px'; remove.addEventListener('click', deleteSelection);
    box.append(...parts, remove);
  }
  function labelFields(it, parts, caption = '그림에 쓸 글자 (비우면 그린 값)', placeholder = '예: ?, ㉠, 60°') {
    parts.push(field(caption, textInput(it.label, (v) => set(it, 'label', v, !v), null, placeholder)));
    parts.push(toggle('문제로 표시 (정답 보기에서만 정답)', it.question, (v) => set(it, 'question', true, !v)));
    if (it.question) parts.push(field('정답', textInput(it.value === undefined ? '' : String(it.value), (v) => set(it, 'value', v !== '' && Number.isFinite(Number(v)) ? Number(v) : v, v === ''), null, '예: 5')));
  }

  function updateCheck() {
    const box = $('dgCheck'); box.replaceChildren();
    const result = D.check(doc), list = [...(result.errors || []), ...(result.warnings || [])];
    if (!list.length) { box.append(Object.assign(document.createElement('div'), { className: 'ok', textContent: doc.points.length ? '검사에서 문제를 찾지 못했습니다.' : '점을 찍어 그리기 시작하세요.' })); return; }
    const lines = [...new Set(list.map((w) => w.message + (w.labels ? ' (' + w.labels.join(', ') + ')' : '')))];
    for (const text of lines.slice(0, 10)) box.append(Object.assign(document.createElement('div'), { textContent: text }));
  }
  function syncDocControls() {
    $('dgUnit').value = doc.unit; $('dgUnitLabel').value = doc.unitLabel || 'cm';
    $('dgGrid').checked = !!doc.grid; $('dgToScale').checked = doc.toScale === true;
  }

  // --- Files and export ------------------------------------------------------------------
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  async function download(blob, name) {
    if (shell().download) return shell().download(blob, name);
    const url = URL.createObjectURL(blob), a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000); return true;
  }
  async function save() {
    if (saveBusy) return false;
    saveBusy = true; $('dgSaveBtn').disabled = true;
    try {
      const savedCheckpoint = JSON.stringify(doc);
      const text = JSON.stringify(doc, null, 2) + '\n';
      if (await download(new Blob([text], { type: 'application/json' }), '평면그림_' + stamp() + '.json')) { checkpoint = savedCheckpoint; changed(); message('평면 그림 파일을 저장했습니다.'); return true; }
      message('저장을 취소했습니다.'); return false;
    } catch (error) { message(error.message, true); return false; }
    finally { saveBusy = false; $('dgSaveBtn').disabled = false; }
  }
  function load(data) {
    try { D.validate(data); } catch (error) { message(error.message, true); return false; }
    if (dirty() && !window.confirm('저장하지 않은 평면 그림이 있습니다. 새 파일로 바꿀까요?')) return false;
    setMode('diagram');
    doc = D.resolve(clone(data)); history = []; future = []; selection = null; pending = []; checkpoint = JSON.stringify(doc);
    changed(); fit(); message('평면 그림을 열었습니다.'); return true;
  }
  async function open() {
    const desktop = shell().desktop;
    if (!desktop) { $('dgFileInput').click(); return; }
    const result = await desktop.openProject();
    if (result.status === 'cancelled') return;
    if (result.status !== 'opened') { message(result.error || '파일을 열지 못했습니다.', true); return; }
    if (result.data?.format !== 'solidlab-diagram') { message('입체 도형 파일입니다. 입체 화면에서 열어 주세요.', true); return; }
    load(result.data);
  }
  function exportSvg() { return D.renderSvg(doc, { preset: $('dgPreset').value || undefined, answers: $('dgAnswers').checked, title: '평면 그림' }); }
  async function saveSvgPair() {
    if (empty()) { message('먼저 그림을 그려 주세요.'); return; }
    if (!doc.items.some((it) => it.question === true)) { message('문제로 표시한 치수가 없습니다.', true); return; }
    try {
      const options = { preset: $('dgPreset').value || undefined, title: '평면 그림' };
      const name = '평면그림_' + stamp();
      const problem = await download(new Blob([D.renderSvg(doc, { ...options, answers: false })], { type: 'image/svg+xml;charset=utf-8' }), name + '_문제.svg');
      if (!problem) { message('저장을 취소했습니다.'); return; }
      const answer = await download(new Blob([D.renderSvg(doc, { ...options, answers: true })], { type: 'image/svg+xml;charset=utf-8' }), name + '_정답.svg');
      message(answer ? '문제·정답 SVG를 저장했습니다.' : '정답 그림 저장을 취소했습니다.');
    } catch (error) { message(error.message, true); }
  }
  function svgToPng(svg, scale) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })), image = new Image();
      image.onload = () => {
        const out = document.createElement('canvas'); out.width = Math.ceil(image.width * scale); out.height = Math.ceil(image.height * scale);
        const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height); c.scale(scale, scale); c.drawImage(image, 0, 0); URL.revokeObjectURL(url);
        out.toBlob((blob) => blob ? resolve(blob) : reject(new Error('그림 저장에 실패했습니다.')), 'image/png');
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('그림을 PNG로 바꾸지 못했습니다.')); };
      image.src = url;
    });
  }
  const answerTag = () => $('dgAnswers').checked ? '_정답' : '';
  async function saveImage(kind) {
    if (empty()) { message('먼저 그림을 그려 주세요.'); return; }
    try {
      const svg = exportSvg(), blob = kind === 'png' ? await svgToPng(svg, 3) : new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const saved = await download(blob, '평면그림_' + stamp() + answerTag() + '.' + kind);
      message(saved ? kind.toUpperCase() + ' 그림을 저장했습니다.' : '그림 저장을 취소했습니다.');
    } catch (error) { message(error.message, true); }
  }
  async function copySvg() {
    if (empty()) { message('먼저 그림을 그려 주세요.'); return; }
    try {
      const svg = exportSvg(), desktop = shell().desktop;
      if (desktop) { if (!await desktop.copyText(svg)) throw new Error(); } else await navigator.clipboard.writeText(svg);
      message('SVG 코드를 복사했습니다 (' + svg.length + '자).');
    } catch { message('클립보드에 복사하지 못했습니다. SVG 저장을 사용하세요.', true); }
  }
  function newDiagram() {
    if (dirty() && !window.confirm('저장하지 않은 평면 그림이 있습니다. 새로 시작할까요?')) return;
    doc = blank(); history = []; future = []; selection = null; pending = []; checkpoint = JSON.stringify(doc); changed(); fit();
  }
  function demo(kind) {
    commit(() => {
      Object.assign(doc, blank(), { unit: doc.unit, unitLabel: doc.unitLabel });
      if (kind === 'triangle') {
        doc.points = [{ id: 'A', at: [0, 3], label: 'ㄱ' }, { id: 'B', at: [0, 0], label: 'ㄴ' }, { id: 'C', at: [4, 0], label: 'ㄷ' }];
        doc.items = [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'angle', from: 'C', at: 'B', to: 'A', mark: 'right' },
          { type: 'dim', a: 'B', b: 'A', offset: 25 }, { type: 'dim', a: 'C', b: 'B', offset: 25 }, { type: 'dim', a: 'A', b: 'C', offset: 25, question: true, value: 5 }];
      } else {
        doc.points = [{ id: 'O', at: [0, 0], label: 'ㅇ' }, { id: 'A', at: [3, 0], show: false }, { id: 'B', at: [0, 3], show: false }];
        doc.items = [{ type: 'circle', center: 'O', r: 3 }, { type: 'sector', center: 'O', from: 'A', to: 'B', fill: 'light' },
          { type: 'angle', from: 'A', at: 'O', to: 'B', mark: 'right' }, { type: 'dim', a: 'O', b: 'A', offset: -20 }];
      }
    }, false);
    fit();
  }

  // --- Shape templates -------------------------------------------------------------------
  // Lengths are entered in the document unit (cm…); angles in degrees. Each template returns
  // vertices (counter-clockwise), the edges to measure and extra marks.
  const rad = (d) => d * Math.PI / 180;
  const SHAPES = {
    rect: { params: [['가로', 4], ['세로', 3]], build: ([w, h]) => ({ pts: [[0, 0], [w, 0], [w, h], [0, h]], dims: [[0, 1], [1, 2]], rights: [0] }) },
    square: { params: [['한 변', 3]], build: ([a]) => ({ pts: [[0, 0], [a, 0], [a, a], [0, a]], dims: [[0, 1]], rights: [0], ticks: true }) },
    triangle: { params: [['밑변', 5], ['오른쪽 변', 4], ['왼쪽 변', 3]], build: ([a, b, c]) => {
      if (a >= b + c || b >= a + c || c >= a + b) throw new Error('세 변으로 삼각형을 만들 수 없습니다. 가장 긴 변이 나머지 두 변의 합보다 짧아야 해요.');
      const x = (a * a + c * c - b * b) / (2 * a); return { pts: [[0, 0], [a, 0], [x, Math.sqrt(c * c - x * x)]], dims: [[0, 1], [1, 2], [2, 0]] };
    } },
    sas: { params: [['밑변', 5], ['다른 변', 4], ['끼인각 (°)', 60]], build: ([a, b, t]) => {
      if (!(t > 0 && t < 180)) throw new Error('끼인각은 0°보다 크고 180°보다 작아야 합니다.');
      return { pts: [[0, 0], [a, 0], [b * Math.cos(rad(t)), b * Math.sin(rad(t))]], dims: [[0, 1], [2, 0]], angles: [[1, 0, 2, t]] };
    } },
    right: { params: [['밑변', 4], ['높이', 3]], build: ([b, h]) => ({ pts: [[0, 0], [b, 0], [0, h]], dims: [[0, 1], [2, 0]], rights: [0] }) },
    parallelogram: { params: [['밑변', 5], ['옆변', 3], ['각 (°)', 60]], build: ([b, s, t]) => {
      if (!(t > 0 && t < 180)) throw new Error('각은 0°보다 크고 180°보다 작아야 합니다.');
      const d = [s * Math.cos(rad(t)), s * Math.sin(rad(t))]; return { pts: [[0, 0], [b, 0], [b + d[0], d[1]], d], dims: [[0, 1], [3, 0]], angles: [[1, 0, 3, t]] };
    } },
    trapezoid: { params: [['윗변', 3], ['아랫변', 6], ['높이', 3]], build: ([t, b, h]) => {
      const x = (b - t) / 2; return { pts: [[0, 0], [b, 0], [x + t, h], [x, h]], dims: [[0, 1], [2, 3]], height: [3, [x, 0]] };
    } },
    rhombus: { params: [['가로 대각선', 6], ['세로 대각선', 4]], build: ([p, q]) => ({ pts: [[0, q / 2], [p / 2, 0], [p, q / 2], [p / 2, q]], diagonals: true, ticksAll: true }) },
    regular: { params: [['변의 수', 6], ['한 변', 2]], build: ([n, a]) => {
      if (!Number.isInteger(n) || n < 3 || n > 12) throw new Error('변의 수는 3~12 사이의 정수여야 합니다.');
      const r = a / (2 * Math.sin(Math.PI / n)), start = -Math.PI / 2 - Math.PI / n;
      return { pts: Array.from({ length: n }, (_, i) => [r * Math.cos(start + 2 * Math.PI * i / n), r * Math.sin(start + 2 * Math.PI * i / n)]), dims: [[0, 1]], ticksAll: true };
    } },
    circle: { params: [['반지름', 3]], build: ([r]) => ({ circle: r }) },
    sector: { params: [['반지름', 3], ['중심각 (°)', 90]], build: ([r, t]) => {
      if (!(t > 0 && t < 360)) throw new Error('중심각은 0°보다 크고 360°보다 작아야 합니다.');
      return { sector: [r, t] };
    } }
  };
  const isCount = (label) => /°|수/.test(label);
  function shapeParams() {
    const box = $('dgShapeParams'), shape = SHAPES[$('dgShape').value]; box.replaceChildren();
    box.className = 'field-row' + (shape.params.length === 2 ? ' two' : '');
    shape.params.forEach(([label, value], i) => {
      const input = Object.assign(document.createElement('input'), { type: 'number', step: 'any', value, id: 'dgShapeP' + i });
      box.append(field(label + (isCount(label) ? '' : ' (' + doc.unitLabel + ')'), input));
    });
    $('dgShapeError').textContent = '';
  }
  function addShape() {
    const shape = SHAPES[$('dgShape').value], withDims = $('dgShapeDims').checked;
    try {
      const values = shape.params.map(([label], i) => {
        const v = Number($('dgShapeP' + i).value);
        if (!(Number.isFinite(v) && v > 0 && v <= 10000)) throw new Error(label + '에 0보다 큰 수를 넣어 주세요.');
        return isCount(label) ? v : v / doc.unit; // lengths become grid units
      });
      const spec = shape.build(values), r0 = spec.circle ?? spec.sector?.[0];
      const all = spec.pts || [[-r0, -r0], [r0, r0]];
      // Place to the right of what is already drawn, on the same baseline.
      const minX = Math.min(...all.map((p) => p[0])), minY = Math.min(...all.map((p) => p[1]));
      let dx = -minX, dy = -minY;
      if (doc.points.length) { dx = Math.max(...doc.points.map((p) => p.at[0])) + 2 - minX; dy = Math.min(...doc.points.map((p) => p.at[1])) - minY; }
      const move = (p) => [Number((p[0] + dx).toFixed(6)), Number((p[1] + dy).toFixed(6))];
      commit(() => {
        // Corners are drawn by the lines; names follow the "새 점 이름" setting.
        const corner = (p) => { const id = ensurePoint({ at: move(p) }); pointById(id).show = false; return id; };
        const hidden = (p) => { const id = nextId(); doc.points.push({ id, at: move(p), show: false }); return id; };
        const items = doc.items;
        if (spec.pts) {
          const ids = spec.pts.map(corner), n = ids.length;
          items.push({ type: 'polygon', points: ids });
          if (spec.ticks || spec.ticksAll) ids.forEach((id, i) => items.push({ type: 'segment', a: id, b: ids[(i + 1) % n], ticks: 1 }));
          if (withDims) for (const [i, j] of spec.dims || []) items.push({ type: 'dim', a: ids[i], b: ids[j] });
          for (const i of spec.rights || []) items.push({ type: 'angle', from: ids[(i + 1) % n], at: ids[i], to: ids[(i + n - 1) % n], mark: 'right' });
          for (const [f, v, t, deg] of spec.angles || []) items.push({ type: 'angle', from: ids[f], at: ids[v], to: ids[t], mark: 'arc', label: fmt(deg) + '°' });
          if (spec.diagonals) {
            const c = hidden([spec.pts[1][0], spec.pts[0][1]]);
            items.push({ type: 'segment', a: ids[0], b: ids[2], dash: true }, { type: 'segment', a: ids[1], b: ids[3], dash: true }, { type: 'angle', from: ids[2], at: c, to: ids[3], mark: 'right' });
            // Both diagonals cross at the centre, so each length is written beside its own half.
            if (withDims) {
              const [l, b, r, t] = spec.pts, mm = (v) => fmt(v * doc.unit) + ' ' + doc.unitLabel;
              items.push({ type: 'text', at: move([(l[0] * 1 + r[0] * 3) / 4, l[1] + (t[1] - b[1]) * .08]), text: mm(r[0] - l[0]) }, { type: 'text', at: move([b[0] + (r[0] - l[0]) * .1, (b[1] + t[1] * 3) / 4]), text: mm(t[1] - b[1]) });
            }
          }
          if (spec.height) {
            const [top, foot] = spec.height, f = hidden(foot);
            items.push({ type: 'segment', a: ids[top], b: f, dash: true }, { type: 'angle', from: ids[0], at: f, to: ids[top], mark: 'right' });
            if (withDims) items.push({ type: 'dim', a: f, b: ids[top], style: 'text' });
          }
        } else {
          const o = ensurePoint({ at: move([0, 0]) }), a = hidden([r0, 0]);
          if (spec.circle) { items.push({ type: 'circle', center: o, r: r0 }, { type: 'segment', a: o, b: a }); if (withDims) items.push({ type: 'dim', a: o, b: a, style: 'text' }); }
          else {
            const t = spec.sector[1], right = Math.abs(t - 90) < 1e-9, b = hidden([r0 * Math.cos(rad(t)), r0 * Math.sin(rad(t))]);
            items.push({ type: 'sector', center: o, from: a, to: b }, { type: 'angle', from: a, at: o, to: b, mark: right ? 'right' : 'arc', ...(right ? {} : { label: fmt(t) + '°' }) });
            if (withDims) items.push({ type: 'dim', a: o, b: a });
          }
        }
      }, false);
      $('dgShapeError').textContent = ''; fit();
    } catch (error) { $('dgShapeError').textContent = error.message; }
  }

  // --- Mode and wiring ---------------------------------------------------------------------
  function setMode(mode) {
    const diagram = mode === 'diagram';
    if (diagram) document.body.dataset.mode = 'diagram'; else delete document.body.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((el) => { if (el.tagName === 'BUTTON') el.classList.toggle('active', el.dataset.mode === (diagram ? 'diagram' : 'solid')); });
    $('appTitle').textContent = diagram ? '평면 그림 작업실' : '입체 도형 작업실';
    try { localStorage.setItem(MODE_KEY, diagram ? 'diagram' : 'solid'); } catch {}
    if (diagram) { measure(); render(); }
  }
  function measure() { const r = $('dgWrap').getBoundingClientRect(); W = Math.round(r.width); H = Math.round(r.height); for (const el of [overlay, gridLayer]) { el.setAttribute('width', W); el.setAttribute('height', H); } }
  function command(name) {
    if (name === 'new') newDiagram(); else if (name === 'open') open(); else if (name === 'save') save();
    else if (name === 'svg') saveImage('svg'); else if (name === 'png') saveImage('png');
  }

  document.querySelectorAll('.mode-switch [data-mode]').forEach((el) => el.addEventListener('click', () => setMode(el.dataset.mode)));
  document.querySelectorAll('[data-dtool]').forEach((el) => el.addEventListener('click', () => setTool(el.dataset.dtool)));
  $('dgUndoBtn').addEventListener('click', () => undo(-1)); $('dgRedoBtn').addEventListener('click', () => undo(1));
  $('dgNewBtn').addEventListener('click', newDiagram); $('dgLoadBtn').addEventListener('click', open); $('dgSaveBtn').addEventListener('click', save);
  $('dgSvgBtn').addEventListener('click', () => saveImage('svg')); $('dgPngBtn').addEventListener('click', () => saveImage('png')); $('dgPairBtn').addEventListener('click', saveSvgPair); $('dgCopyBtn').addEventListener('click', copySvg);
  $('dgFitBtn').addEventListener('click', fit); $('dgZoomIn').addEventListener('click', () => zoom(1.25)); $('dgZoomOut').addEventListener('click', () => zoom(.8));
  $('dgDemoTriangle').addEventListener('click', () => demo('triangle')); $('dgDemoCircle').addEventListener('click', () => demo('circle'));
  $('dgAnswers').addEventListener('change', request);
  $('dgShape').addEventListener('change', shapeParams); $('dgShapeAdd').addEventListener('click', addShape); shapeParams();
  $('dgSnap').value = String(prefs.snap); $('dgNaming').value = prefs.naming;
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch {} };
  $('dgSnap').addEventListener('change', () => { prefs.snap = Number($('dgSnap').value); savePrefs(); request(); });
  $('dgNaming').addEventListener('change', () => { prefs.naming = $('dgNaming').value; savePrefs(); });
  $('dgDash').checked = !!prefs.dash; $('dgDash').addEventListener('change', () => { prefs.dash = $('dgDash').checked; savePrefs(); });
  $('dgUnit').addEventListener('change', () => { const v = Number($('dgUnit').value); if (v > 0 && v <= 1000) set(doc, 'unit', v); else syncDocControls(); });
  $('dgUnitLabel').addEventListener('change', () => { set(doc, 'unitLabel', $('dgUnitLabel').value); shapeParams(); });
  $('dgGrid').addEventListener('change', () => set(doc, 'grid', { step: prefs.snap > 0 ? prefs.snap : 1 }, !$('dgGrid').checked));
  $('dgToScale').addEventListener('change', () => set(doc, 'toScale', true, !$('dgToScale').checked));
  $('dgFileInput').addEventListener('change', async () => {
    const file = $('dgFileInput').files[0]; if (!file) return;
    try {
      if (file.size > 15000000) throw new Error('파일은 15MB 이하여야 합니다.');
      const data = JSON.parse(await file.text());
      if (data?.format !== 'solidlab-diagram') throw new Error('입체 도형 파일입니다. 입체 화면에서 열어 주세요.');
      load(data);
    } catch (error) { message(error instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : error.message, true); }
    finally { $('dgFileInput').value = ''; }
  });
  document.addEventListener('keydown', (e) => {
    if (!active() || document.querySelector('dialog[open]')) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && key === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); return; }
    if (mod && key === 'y') { e.preventDefault(); undo(1); return; }
    if (mod && key === 's') { e.preventDefault(); save(); return; }
    if (mod && key === 'o') { e.preventDefault(); open(); return; }
    if (typing || mod || e.altKey) return;
    if (e.code === 'Space') { spaceDown = true; return; }
    if (e.key === 'Escape') { pending = []; selection = null; hint(''); changed(); return; }
    if (e.key === 'Enter') { finishPolygon(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    const tools = { v: 'select', p: 'point', l: 'segment', g: 'polygon', c: 'circle', r: 'arc', n: 'angle', d: 'dim', t: 'text', h: 'perp', k: 'parallel' };
    if (tools[key]) setTool(tools[key]);
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
  window.addEventListener('beforeunload', () => { try { localStorage.setItem(STORAGE, JSON.stringify({ doc, clean: !dirty() })); } catch {} });
  new ResizeObserver(() => { if (active()) { measure(); request(); } }).observe($('dgWrap'));

  // Restore the last diagram from this browser; a file-saved state stays "clean".
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (saved?.doc) { D.validate(saved.doc); doc = D.resolve(saved.doc); checkpoint = saved.clean ? JSON.stringify(doc) : JSON.stringify(blank()); }
  } catch {}
  window.SolidDiagramApp = { load, command, setMode, dirty, save, snapshot: () => clone(doc) };
  setTool('segment'); changed();
  if (localStorage.getItem(MODE_KEY) === 'diagram') { setMode('diagram'); requestAnimationFrame(fit); }
})();
