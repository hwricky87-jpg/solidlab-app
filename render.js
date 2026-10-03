(function (root) {
  'use strict';
  const G = typeof module !== 'undefined' && module.exports ? require('./geometry.js') : root.SolidGeometry;
  const format = (v) => Number(v.toFixed(5)).toLocaleString('ko-KR', { maximumFractionDigits: 5 });
  const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Segoe UI',sans-serif";
  const PALETTES = {
    color: { top: '#e3edde', bottom: '#a4bfa8', x: '#cbdbc8', y: '#b7ceb7', edge: '#34503a', edgeWidth: 1.5, grid: '#7d977a', gridWidth: .6, hidden: '#34503a', hiddenWidth: 1, dash: '4 3', floor: '#d9e2d5', dim: '#5f7562', dimWidth: .9, dimDash: '4 3', text: '#243a2a', answer: '#b3261e', arrows: false, aux: '#34503a', auxWidth: 1.3, boldWidth: 2.8, auxDash: '5 3' },
    print: { top: '#ffffff', bottom: '#b3b3b3', x: '#d4d4d4', y: '#ececec', edge: '#000000', edgeWidth: 1.5, grid: '#000000', gridWidth: .7, hidden: '#000000', hiddenWidth: 1, dash: '4 3', floor: '#cfcfcf', dim: '#000000', dimWidth: .8, dimDash: '', text: '#000000', answer: '#b3261e', arrows: true, aux: '#000000', auxWidth: 1.3, boldWidth: 2.8, auxDash: '5 3' }
  };
  const faceFill = (n, pal) => n[2] > 0 ? pal.top : n[2] < 0 ? pal.bottom : n[0] !== 0 ? pal.x : pal.y;
  const faceColor = (n) => faceFill(n, PALETTES.color);

  // Named views. "oblique" is the textbook cabinet drawing (겨냥도): the front face is drawn
  // true, depth recedes up-right at 45° with half length.
  const VIEWS = { iso: [.76, .53], 'iso-left': [Math.PI - .76, .53], front: [Math.PI / 2, 0], back: [-Math.PI / 2, 0], right: [0, 0], left: [Math.PI, 0], top: [Math.PI / 2, Math.PI / 2] };
  function viewBasis(view) {
    if (view && view.projection === 'oblique') {
      const k = .5, c = Math.SQRT1_2, n = [k * c, 1, k * c], l = Math.hypot(...n);
      return { right: [1, -k * c, 0], up: [0, -k * c, 1], normal: n.map((v) => v / l), oblique: true };
    }
    return G.basis(view?.yaw ?? .76, view?.pitch ?? .53);
  }
  function solve3(rows, rhs) {
    const [a, b, c] = rows, det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det([a, b, c]);
    return [0, 1, 2].map((i) => det([a, b, c].map((row, r) => row.map((v, j) => j === i ? rhs[r] : v))) / d);
  }

  function corners(b) {
    const list = [];
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) list.push([x ? b.max[0] : b.min[0], y ? b.max[1] : b.min[1], z ? b.max[2] : b.min[2]]);
    return list;
  }
  function projectedExtent(box, basis) {
    const vertices = corners(box), xs = vertices.map((p) => G.dot(p, basis.right)), ys = vertices.map((p) => G.dot(p, basis.up));
    return [Math.max(Math.max(...xs) - Math.min(...xs), 1), Math.max(Math.max(...ys) - Math.min(...ys), 1)];
  }
  function fittingScale(w, h, box, basis) {
    if (!box) return Math.min(w, h) / 24;
    const [ew, eh] = projectedExtent(box, basis);
    return Math.max(.4, Math.min(100, (w - Math.min(160, w * .40)) / ew, (h - Math.min(170, h * .30)) / eh));
  }
  // Screen frame for the app canvas (pan, zoom) and for exports (centered on the solid).
  function createFrame(model, w, h, forExport = true) {
    const { box, view } = model, basis = viewBasis(view);
    const target = forExport ? (box ? box.center : [0, 0, 0]) : (view.target || (box ? box.center : [0, 0, 0]));
    const scale = forExport ? fittingScale(w, h, box, basis) : (view.scale ?? fittingScale(w, h, box, basis));
    const cx = w / 2 + (forExport ? 0 : view.panX || 0), cy = h * .51 + (forExport ? 0 : view.panY || 0);
    return makeFrame(basis, scale, target, cx, cy, w, h);
  }
  function makeFrame(basis, scale, target, cx = 0, cy = 0, w = 0, h = 0) {
    const project = (p) => { const q = G.sub(p, target); return { x: cx + G.dot(q, basis.right) * scale, y: cy - G.dot(q, basis.up) * scale, depth: G.dot(q, basis.normal) }; };
    const ray = (p) => {
      const q = G.add(target, solve3([basis.right, basis.up, basis.normal], [(p.x - cx) / scale, -(p.y - cy) / scale, 0]));
      return { origin: G.add(q, G.mul(basis.normal, 2000)), direction: G.mul(basis.normal, -1) };
    };
    return { w, h, basis, target, scale, cx, cy, project, ray, dimensions: [], screenEdges: [] };
  }
  function floorLines(box, f, enabled = true) {
    if (!enabled) return [];
    const b = box || { min: [-5, -5, 0], max: [5, 5, 0] }, minX = b.min[0] - 3, maxX = b.max[0] + 3, minY = b.min[1] - 3, maxY = b.max[1] + 3;
    const z = Math.min(0, b.min[2]) - .01, step = Math.max(1, Math.ceil(Math.max(maxX - minX, maxY - minY) / 50)), result = [];
    for (let x = minX; x <= maxX; x += step) result.push([f.project([x, minY, z]), f.project([x, maxY, z])]);
    for (let y = minY; y <= maxY; y += step) result.push([f.project([minX, y, z]), f.project([maxX, y, z])]);
    return result;
  }
  function featureEdge(a, b, geometry) {
    const axis = a.findIndex((v, i) => v !== b[i]);
    if (a[axis] > b[axis]) [a, b] = [b, a];
    return geometry.featureUnits.has(G.key(a) + ':' + G.key(b));
  }

  // --- Visibility --------------------------------------------------------------------------
  // A front face is "clear" when nothing occupies the prism it sweeps toward the viewer.
  // The swept boxes over-cover the prism, so a face is never wrongly called clear.
  function faceClear(face, d, has, box) {
    const lo = [0, 1, 2].map((i) => Math.min(face.vertices[0][i], face.vertices[2][i]));
    const hi = [0, 1, 2].map((i) => Math.max(face.vertices[0][i], face.vertices[2][i]));
    const dt = .5 / Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
    let exit = Infinity;
    for (let i = 0; i < 3; i++) {
      if (d[i] > 1e-9) exit = Math.min(exit, (box.max[i] - lo[i]) / d[i]);
      else if (d[i] < -1e-9) exit = Math.min(exit, (box.min[i] - hi[i]) / d[i]);
    }
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let t = 0; t < exit; t += dt) {
      const t2 = Math.min(t + dt, exit);
      for (let i = 0; i < 3; i++) {
        const s = d[i] * t, e = d[i] * t2;
        a[i] = Math.max(box.min[i], Math.floor(lo[i] + Math.min(s, e) + 1e-7));
        b[i] = Math.min(box.max[i] - 1, Math.ceil(hi[i] + Math.max(s, e) - 1e-7) - 1);
      }
      for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) if (has(x, y, z)) return false;
    }
    return true;
  }
  // Is a surface point hidden from the viewer? March cells from the point toward the viewer.
  function occluded(p, d, has, box) {
    const o = [p[0] + d[0] * 1e-5, p[1] + d[1] * 1e-5, p[2] + d[2] * 1e-5];
    const cell = o.map(Math.floor), step = d.map((v) => v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0);
    const next = [0, 1, 2].map((i) => step[i] ? ((step[i] > 0 ? cell[i] + 1 : cell[i]) - o[i]) / d[i] : Infinity);
    const delta = [0, 1, 2].map((i) => step[i] ? Math.abs(1 / d[i]) : Infinity);
    for (let guard = 0; guard < 4000; guard++) {
      for (let i = 0; i < 3; i++) if ((cell[i] < box.min[i] && step[i] <= 0) || (cell[i] >= box.max[i] && step[i] >= 0)) return false;
      if (has(cell[0], cell[1], cell[2])) return true;
      const axis = next[0] <= next[1] ? (next[0] <= next[2] ? 0 : 2) : (next[1] <= next[2] ? 1 : 2);
      cell[axis] += step[axis]; next[axis] += delta[axis];
    }
    return false;
  }
  // Seen and hidden stretches of any straight line a→b, as [t0, t1, seen] (t from 0 to 1).
  function visibleParts(a, b, seenAt, f, fast) {
    const at = (t) => a.map((v, i) => v + (b[i] - v) * t);
    // A ray can graze a cube's corner line at a single point; two of three nearby samples decide.
    const seen = (t) => seenAt(at(t)) + seenAt(at(Math.max(0, t - .003))) + seenAt(at(Math.min(1, t + .003))) >= 2;
    const pa = f.project(a), pb = f.project(b), screen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const count = fast ? 3 : Math.max(3, Math.min(64, Math.ceil(screen / 3)));
    const ts = [.004, ...Array.from({ length: count }, (_, i) => (i + .5) / count), .996], parts = [];
    let state = seen(ts[0]), from = 0;
    for (let i = 1; i < ts.length; i++) {
      const next = seen(ts[i]);
      if (next === state) continue;
      let x = ts[i - 1], y = ts[i];
      for (let k = 0; k < 12; k++) { const m = (x + y) / 2; if (seen(m) === state) x = m; else y = m; }
      parts.push([from, (x + y) / 2, state]); from = (x + y) / 2; state = next;
    }
    parts.push([from, 1, state]);
    return parts;
  }

  // --- Text metrics -----------------------------------------------------------------------
  function textWidth(text, size) {
    let w = 0;
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      w += c >= 0x1100 ? 1 : /[0-9]/.test(ch) ? .56 : ch === ' ' ? .3 : /[.,:;'|]/.test(ch) ? .3 : /[A-Z]/.test(ch) ? .66 : .56;
    }
    return w * size;
  }
  const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Does segment p–q pass through rectangle r? (Liang–Barsky clipping)
  function segmentHitsRect(p, q, r) {
    let lo = 0, hi = 1;
    for (const [s, dd, min, max] of [[p.x, q.x - p.x, r.x, r.x + r.w], [p.y, q.y - p.y, r.y, r.y + r.h]]) {
      if (Math.abs(dd) < 1e-9) { if (s <= min || s >= max) return false; continue; }
      const t1 = (min - s) / dd, t2 = (max - s) / dd;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      if (lo >= hi) return false;
    }
    return true;
  }
  // Two dimension lines drawn on top of each other: nearly parallel, close, and overlapping in extent.
  function linesCrowd(p1, q1, p2, q2, gap) {
    const dx = q1.x - p1.x, dy = q1.y - p1.y, len = Math.hypot(dx, dy); if (len < 1) return false;
    const ux = dx / len, uy = dy / len, ex = q2.x - p2.x, ey = q2.y - p2.y, len2 = Math.hypot(ex, ey); if (len2 < 1) return false;
    if (Math.abs(ux * ey - uy * ex) / len2 > .08) return false;
    const dist = Math.abs((p2.x - p1.x) * -uy + (p2.y - p1.y) * ux); if (dist > gap) return false;
    const s1 = (p2.x - p1.x) * ux + (p2.y - p1.y) * uy, s2 = (q2.x - p1.x) * ux + (q2.y - p1.y) * uy;
    return Math.min(len, Math.max(s1, s2)) - Math.max(0, Math.min(s1, s2)) > 2;
  }

  // Lengths on figures are plain numbers (1200 cm, not 1,200 cm).
  const plain = (v) => String(Number(v.toFixed(5)));
  function dimensionText(d, unit, unitLabel, answers) {
    const value = plain(G.length(G.sub(d.b, d.a)) * unit) + ' ' + unitLabel;
    if (d.question) return answers ? { text: value, answer: true } : { text: d.label ?? '?', question: true };
    return { text: d.label ?? value };
  }

  function dimensionLayout(d, f, box, unit, unitLabel, options = {}) {
    const a = f.project(d.a), b = f.project(d.b), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 5) return null;
    let normal = [-dy / len, dx / len];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, center = f.project(box ? box.center : [0, 0, 0]);
    if ((middle.x - center.x) * normal[0] + (middle.y - center.y) * normal[1] < 0) normal = normal.map((v) => -v);
    const size = options.fontSize ?? 13, content = dimensionText(d, unit, unitLabel, options.answers);
    const w = textWidth(content.text, size) + size * .5, h = size * 1.35;
    const placed = options.placed || [], lines = options.placedLines || [], step = size * 1.4, covers = options.covers || (() => false);
    const extent = Math.abs(normal[0]) * w / 2 + Math.abs(normal[1]) * h / 2;
    // A visible edge inside the outline (faces on both sides) gets its number written beside it,
    // as in textbooks, instead of extension lines drawn across a face. An edge hidden behind the
    // solid keeps its dimension line; check reports it.
    const probe = (s) => covers({ x: middle.x + normal[0] * s, y: middle.y + normal[1] * s });
    const behind = options.hidden3d ? options.hidden3d(d.a.map((v, i) => (v + d.b[i]) / 2)) : false;
    const inner = options.dimStyle !== 'text' && !behind && probe(6) && probe(-6);
    const textStyle = options.dimStyle === 'text' || inner;
    // Outward from the solid first; the other side only when the label would sit on a face.
    let best = null, anyOff = false;
    for (let attempt = 0; attempt < 6 && !(best && Math.floor(best.score) === 0); attempt++) for (const side of [1, -1]) {
      const n = [normal[0] * side, normal[1] * side];
      let da, db, mx, my, offset;
      if (textStyle) {
        offset = size * .35 + extent + attempt * step;
        da = a; db = b; mx = middle.x + n[0] * offset; my = middle.y + n[1] * offset;
      } else {
        const base = (Number.isFinite(d.offset) ? d.offset : 44) * (options.offsetScale ?? 1);
        offset = base + Math.sign(base || 1) * attempt * step;
        da = { x: a.x + n[0] * offset, y: a.y + n[1] * offset }; db = { x: b.x + n[0] * offset, y: b.y + n[1] * offset };
        mx = (da.x + db.x) / 2; my = (da.y + db.y) / 2;
      }
      const hit = { x: mx - w / 2, y: my - h / 2, w, h };
      const onShape = !inner && (covers({ x: mx, y: my }) || covers({ x: hit.x, y: hit.y }) || covers({ x: hit.x + w, y: hit.y + h }) || covers({ x: hit.x + w, y: hit.y }) || covers({ x: hit.x, y: hit.y + h }));
      if (!onShape) anyOff = true;
      // Collisions: label on a label, label on a dimension line, or two dimension lines stacked.
      const clash = placed.some((r) => rectsOverlap(r, hit)) || lines.some(([p, q]) => segmentHitsRect(p, q, hit)) || (!textStyle && lines.some(([p, q]) => linesCrowd(da, db, p, q, size * .9)));
      const score = (clash ? 2 : 0) + (onShape ? 1 : 0) + (side < 0 ? .1 : 0) + attempt * .01;
      if (!best || score < best.score) best = { score, onShape, clash, layout: { ...d, aScreen: a, bScreen: b, da, db, normal: n, label: content.text, answer: !!content.answer, questionMark: !!content.question, mx, my, labelWidth: w, labelHeight: h, fontSize: size, hit, textStyle, inner, behind } };
      if (Math.floor(best.score) === 0) break;
    }
    // onShape is only worth reporting when some placement off the faces existed.
    const layout = { ...best.layout, onShape: best.onShape && anyOff, crowded: best.clash };
    placed.push(layout.hit);
    if (!layout.textStyle) lines.push([layout.da, layout.db]);
    return layout;
  }

  // --- Scene --------------------------------------------------------------------------------
  // One scene feeds both the SVG writer and the app canvas, so what you see is what you export.
  function buildScene(model, f, options = {}) {
    const settings = model.settings, pal = PALETTES[settings.style] || PALETTES.color;
    const cells = model.cells, box = model.box !== undefined ? model.box : G.bounds(cells);
    const scene = { palette: pal, gridOn: settings.grid, floor: [], partial: [], regions: [], hidden: [], edges: [], lines: [], dims: [], dots: [], labels: [], fontSize: options.fontSize ?? 13 };
    if (!box) return scene;
    const geometry = model.geometry || G.extractSurface(cells), has = model.has || G.occupancy(cells);
    const d = f.basis.normal, fast = options.fast === true;
    scene.floor = floorLines(box, f, settings.floor);

    const front = geometry.faces.filter((face) => G.dot(face.n, d) > 1e-6);
    const clear = new Set(), partial = [], planes = new Map();
    for (const face of front) {
      if (!fast && faceClear(face, d, has, box)) {
        const axis = face.n.findIndex((v) => v !== 0), o = [0, 1, 2].filter((i) => i !== axis);
        const id = axis + ':' + face.n[axis] + ':' + face.vertices[0][axis];
        if (!planes.has(id)) planes.set(id, { axis, o, coord: face.vertices[0][axis], n: face.n, squares: [] });
        const minU = Math.min(...face.vertices.map((v) => v[o[0]])), minV = Math.min(...face.vertices.map((v) => v[o[1]]));
        planes.get(id).squares.push([minU, minV]);
        for (let i = 0; i < 4; i++) {
          let a = face.vertices[i], b = face.vertices[(i + 1) % 4];
          const ax = a.findIndex((v, j) => v !== b[j]); if (a[ax] > b[ax]) [a, b] = [b, a];
          clear.add(G.key(a) + ':' + G.key(b));
        }
      } else partial.push(face);
    }
    // Painter's order for faces that something may cover; the depth sort is exact for unit faces.
    partial.sort((a, b) => G.dot(G.sub(a.center, f.target), d) - G.dot(G.sub(b.center, f.target), d) || a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2] || a.n[0] - b.n[0] || a.n[1] - b.n[1]);
    scene.partial = partial.map((face) => ({ points: face.vertices.map(f.project), fill: faceFill(face.n, pal) }));

    // Fully visible faces never overlap each other, so each plane becomes one outlined region.
    for (const plane of planes.values()) {
      const to3 = (u, v) => { const p = [0, 0, 0]; p[plane.axis] = plane.coord; p[plane.o[0]] = u; p[plane.o[1]] = v; return p; };
      const directed = new Map(), undirected = new Map();
      for (const [u, v] of plane.squares) {
        const ring = [[u, v], [u + 1, v], [u + 1, v + 1], [u, v + 1]];
        for (let i = 0; i < 4; i++) {
          const s = ring[i], e = ring[(i + 1) % 4], fwd = s + '>' + e, back = e + '>' + s;
          if (directed.has(back)) directed.delete(back); else directed.set(fwd, [s, e]);
          const lo = s[0] < e[0] || s[1] < e[1] ? s : e, hi = lo === s ? e : s, uid = lo + '|' + hi;
          undirected.set(uid, (undirected.get(uid) || 0) + 1);
        }
      }
      const outgoing = new Map();
      for (const [s, e] of directed.values()) { const k = String(s); if (!outgoing.has(k)) outgoing.set(k, []); outgoing.get(k).push(e); }
      const loops = [];
      for (const [startKey, list] of outgoing) {
        while (list.length) {
          const loop = [startKey.split(',').map(Number)];
          let current = list.pop();
          while (String(current) !== startKey) { loop.push(current); const nextList = outgoing.get(String(current)); current = nextList.pop(); }
          // Drop collinear points to keep paths short.
          const simple = loop.filter((p, i) => { const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length]; return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0; });
          loops.push(simple.map(([u, v]) => f.project(to3(u, v))));
        }
      }
      let grid = [];
      if (settings.grid) {
        const lines = new Map();
        for (const [uid, count] of undirected) {
          if (count < 2) continue;
          const [s, e] = uid.split('|').map((t) => t.split(',').map(Number)), along = s[0] === e[0] ? 1 : 0, lid = along + ':' + s[1 - along];
          if (!lines.has(lid)) lines.set(lid, []);
          lines.get(lid).push([s, e, along]);
        }
        for (const segs of lines.values()) {
          segs.sort((p, q) => p[0][p[2]] - q[0][q[2]]);
          let run = null;
          for (const [s, e, along] of segs) {
            if (run && run[1][along] === s[along]) run[1] = e;
            else { if (run) grid.push(run); run = [s, e]; }
          }
          if (run) grid.push(run);
        }
        grid = grid.map(([s, e]) => [f.project(to3(...s)), f.project(to3(...e))]);
      }
      scene.regions.push({ loops, fill: faceFill(plane.n, pal), grid });
    }

    // Feature edges are drawn after every face, split into seen and hidden parts.
    const lines = new Map();
    const addInterval = (e, from, to, visible) => {
      const lid = e.axis + ':' + e.a.filter((_, i) => i !== e.axis).join(',');
      if (!lines.has(lid)) lines.set(lid, { e, seen: [], hidden: [] });
      lines.get(lid)[visible ? 'seen' : 'hidden'].push([from, to]);
    };
    for (const e of geometry.featureUnits.values()) {
      const id = G.key(e.a) + ':' + G.key(e.b), lo = e.a[e.axis];
      if (clear.has(id)) { addInterval(e, lo, lo + 1, true); continue; }
      const at = (t) => { const p = [...e.a]; p[e.axis] = lo + t; return p; };
      // A ray can graze a cube's corner line at a single point; two of three nearby samples decide.
      const seen = (t) => (!occluded(at(t), d, has, box)) + (!occluded(at(Math.max(0, t - .003)), d, has, box)) + (!occluded(at(Math.min(1, t + .003)), d, has, box)) >= 2;
      const pa = f.project(e.a), pb = f.project(e.b), screen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const count = fast ? 3 : Math.max(3, Math.min(48, Math.ceil(screen / 3)));
      // Samples include both ends (just inside the vertices), so no stretch goes unchecked.
      const ts = [.004, ...Array.from({ length: count }, (_, i) => (i + .5) / count), .996];
      let state = seen(ts[0]), from = 0;
      for (let i = 1; i < ts.length; i++) {
        const next = seen(ts[i]);
        if (next === state) continue;
        // Bisect the change between two samples to well under a pixel.
        let x = ts[i - 1], y = ts[i];
        for (let k = 0; k < 12; k++) { const m = (x + y) / 2; if (seen(m) === state) x = m; else y = m; }
        addInterval(e, lo + from, lo + (x + y) / 2, state);
        from = (x + y) / 2; state = next;
      }
      addInterval(e, lo + from, lo + 1, state);
    }
    const merge = (list) => {
      list.sort((p, q) => p[0] - q[0]);
      const out = [];
      for (const s of list) { const last = out[out.length - 1]; if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]); else out.push([...s]); }
      return out;
    };
    // In front/side/top views a back edge can land exactly on a front edge; draw each line once.
    const drawn = new Set(), screenKey = (p, q) => { const k1 = Math.round(p.x * 10) + ',' + Math.round(p.y * 10), k2 = Math.round(q.x * 10) + ',' + Math.round(q.y * 10); return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1; };
    for (const [key, target] of [['seen', scene.edges], ['hidden', scene.hidden]]) {
      if (target === scene.hidden && !settings.hidden) continue;
      for (const line of lines.values()) {
        const e = line.e;
        for (const [s, t] of merge(line[key])) {
          const a = [...e.a], b = [...e.a]; a[e.axis] = s; b[e.axis] = t;
          const pa = f.project(a), pb = f.project(b), segment = [pa, pb], k = screenKey(pa, pb);
          segment.from = a; segment.to = b; // 3D ends, for checks and tests
          if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > .3 && !drawn.has(k)) { drawn.add(k); target.push(segment); }
        }
      }
    }

    // Auxiliary segments (꼭짓점 잇기·보조선): stretches behind or inside the solid are dashed.
    const seenAt = (p) => !occluded(p, d, has, box), auxLines = [];
    for (const s of model.segments || []) {
      if (s.visible === false) continue;
      const ends = [f.project(s.from), f.project(s.to)], piece = ([t0, t1]) => [0, 1].map((k) => { const t = k ? t1 : t0; return f.project(s.from.map((v, i) => v + (s.to[i] - v) * t)); });
      const parts = s.behind === 'same' ? [[0, 1, true]] : visibleParts(s.from, s.to, seenAt, f, fast);
      scene.lines.push({ id: s.id, style: s.style, behind: s.behind, ticks: s.ticks || 0, ends, from: s.from, to: s.to,
        seen: parts.filter((q) => q[2]).map(piece), hidden: parts.filter((q) => !q[2]).map(piece) });
      if (s.style !== 'none') auxLines.push(ends);
    }

    // Dimensions, then vertex names; later labels step away from earlier ones.
    const placed = [], unitLabel = model.unitLabel || 'cm', size = scene.fontSize;
    // Screen point → does the solid cover it? Used to keep numbers and names off the faces.
    const covers = (pt) => { const r = f.ray(pt); return !!G.raycast(cells, box, r.origin, r.direction); };
    scene.covers = covers;
    const placedLines = [], hidden3d = (p) => !seenAt(p);
    const dimOptions = { fontSize: size, answers: options.answers, dimStyle: settings.dimStyle, offsetScale: options.offsetScale ?? 1, placed, placedLines, covers, hidden3d };
    const overall = settings.overall ? G.overallDimensions(box, model.overallDimensions, has, f.basis) : [];
    const pinned = settings.annotations ? (model.dimensions || []).map((v) => ({ ...v, kind: v.kind || 'pinned' })) : [];
    // Partial dimensions sit next to the solid; overall ones step outside them, as in textbooks.
    for (const dim of [...pinned, ...overall, ...(options.extraDimensions || [])]) {
      if (dim.visible === false) continue;
      const layout = dimensionLayout(dim, f, box, model.unit, unitLabel, dimOptions);
      if (layout) scene.dims.push(layout);
    }
    const center = f.project(box.center), labelSize = Math.round(size * 1.15), nearLines = [...placedLines, ...auxLines];
    // A name steps around its point, outward from the solid (or toward labelAt degrees) first.
    const placeName = (l, text, at, angle) => {
      const p = f.project(at), w = textWidth(text, labelSize) + 2, h = labelSize * 1.2;
      let dx = p.x - center.x, dy = p.y - center.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      if (Math.hypot(p.x - center.x, p.y - center.y) < 1) { dx = 0; dy = -1; }
      if (Number.isFinite(angle)) { dx = Math.cos(angle * Math.PI / 180); dy = -Math.sin(angle * Math.PI / 180); }
      let best = null, anyOff = false;
      for (const turn of [0, .5, -.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
        const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
        const reach = 5 + Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2;
        const x = p.x + ux * reach, y = p.y + uy * reach, hit = { x: x - w / 2, y: y - h / 2, w, h };
        const onShape = [[x, y], [hit.x, hit.y], [hit.x + w, hit.y], [hit.x, hit.y + h], [hit.x + w, hit.y + h]].some(([px, py]) => covers({ x: px, y: py }));
        if (!onShape) anyOff = true;
        const clash = placed.some((r) => rectsOverlap(r, hit)) || nearLines.some(([s, t]) => segmentHitsRect(s, t, hit));
        const score = (clash ? 2 : 0) + (onShape ? 1 : 0);
        if (!best || score < best.score) best = { score, label: { ...l, text, at, x, y, fontSize: labelSize, hit, anchor: p, onShape } };
        if (score === 0) break;
      }
      // A vertex inside the outline has faces all around; a name on a face is then expected.
      best.label.onShape = best.label.onShape && anyOff;
      placed.push(best.label.hit); scene.labels.push(best.label);
    };
    if (settings.labels) for (const l of model.labels || []) if (l.visible !== false) placeName(l, l.text, l.at);
    // Points: a dot marks the vertex (꼭짓점 표시); its name follows the vertex-name setting.
    for (const pt of model.points || []) {
      if (pt.visible === false) continue;
      if (pt.dot !== false) { const s = f.project(pt.at); scene.dots.push({ id: pt.id, x: s.x, y: s.y, r: Math.max(2, size * .18) }); }
      if (settings.labels && pt.label !== undefined) placeName({ id: pt.id, kind: 'point' }, pt.label, pt.at, pt.labelAt);
    }
    // A segment's symbol (㉠, a, 6 cm) sits beside its middle; on a face that is expected.
    for (const line of scene.lines) {
      const s = (model.segments || []).find((v) => v.id === line.id);
      if (s?.label === undefined) continue;
      const [a, b] = line.ends, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let n = [-dy / len, dx / len];
      if ((mid.x - center.x) * n[0] + (mid.y - center.y) * n[1] < 0) n = n.map((v) => -v);
      const w = textWidth(s.label, size) + size * .5, h = size * 1.35, extent = Math.abs(n[0]) * w / 2 + Math.abs(n[1]) * h / 2;
      let best = null;
      for (const along of [0, -.2, .2]) for (let attempt = 0; attempt < 4; attempt++) for (const side of [1, -1]) {
        const off = size * .3 + extent + attempt * size * .8, x = mid.x + dx * along + n[0] * side * off, y = mid.y + dy * along + n[1] * side * off;
        const hit = { x: x - w / 2, y: y - h / 2, w, h };
        const onShape = [[x, y], [hit.x, hit.y], [hit.x + w, hit.y], [hit.x, hit.y + h], [hit.x + w, hit.y + h]].some(([px, py]) => covers({ x: px, y: py }));
        // Staying next to its own segment matters more than keeping clear of a thin crossing line.
        const crossed = nearLines.filter(([p, q]) => segmentHitsRect(p, q, hit)).length, onDot = scene.dots.some((t) => t.x > hit.x - t.r && t.x < hit.x + w + t.r && t.y > hit.y - t.r && t.y < hit.y + h + t.r);
        const score = (placed.some((r) => rectsOverlap(r, hit)) ? 3 : 0) + crossed * .45 + (onDot ? 1 : 0) + (onShape ? .2 : 0) + (side < 0 ? .1 : 0) + attempt * .35 + Math.abs(along) * 1.5;
        if (!best || score < best.score) best = { score, label: { id: s.id, kind: 'segment', text: s.label, x, y, fontSize: size, weight: 500, hit, anchor: mid, onShape: false } };
      }
      placed.push(best.label.hit); scene.labels.push(best.label);
    }
    return scene;
  }

  function sceneBounds(scene) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = (p) => { if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x; if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y; };
    const rect = (r) => { add({ x: r.x, y: r.y }); add({ x: r.x + r.w, y: r.y + r.h }); };
    for (const face of scene.partial) face.points.forEach(add);
    for (const region of scene.regions) region.loops.forEach((loop) => loop.forEach(add));
    for (const list of [scene.edges, scene.hidden, scene.floor]) for (const [p, q] of list) { add(p); add(q); }
    for (const line of scene.lines || []) for (const part of auxParts(line, scene.palette)) for (const [p, q] of part.segments) { add(p); add(q); }
    for (const dot of scene.dots || []) { add({ x: dot.x - dot.r, y: dot.y - dot.r }); add({ x: dot.x + dot.r, y: dot.y + dot.r }); }
    for (const dim of scene.dims) {
      rect(dim.hit);
      if (!dim.textStyle) for (const [s, n] of [[dim.da, 7], [dim.db, 7]]) add({ x: s.x + dim.normal[0] * n, y: s.y + dim.normal[1] * n });
    }
    for (const l of scene.labels) rect(l.hit);
    return b;
  }

  // --- SVG writer ---------------------------------------------------------------------------
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const num = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? 0 : r; };
  const pathOf = (segments) => segments.map(([a, b]) => 'M' + num(a.x) + ' ' + num(a.y) + 'L' + num(b.x) + ' ' + num(b.y)).join('');
  const ringOf = (points) => 'M' + points.map((p) => num(p.x) + ' ' + num(p.y)).join('L') + 'Z';
  function arrowPath(tip, toward, size) {
    const dx = toward.x - tip.x, dy = toward.y - tip.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const bx = tip.x + ux * size, by = tip.y + uy * size, w = size * .36;
    return 'M' + num(tip.x) + ' ' + num(tip.y) + 'L' + num(bx - uy * w) + ' ' + num(by + ux * w) + 'L' + num(bx + uy * w) + ' ' + num(by - ux * w) + 'Z';
  }
  // Strokes of an auxiliary segment: hidden stretches dashed, the seen ones in its own style,
  // and slanted ticks at the middle for equal lengths.
  function auxParts(line, pal) {
    if (line.style === 'none' && !line.ticks) return [];
    const parts = [];
    if (line.style !== 'none') {
      if (line.hidden.length && line.behind !== 'hide') parts.push({ segments: line.hidden, width: pal.hiddenWidth, dash: pal.dash });
      if (line.seen.length) parts.push({ segments: line.seen, width: line.style === 'bold' ? pal.boldWidth : pal.auxWidth, dash: line.style === 'dash' ? pal.auxDash : '' });
    }
    if (line.ticks) {
      const [a, b] = line.ends, len = Math.hypot(b.x - a.x, b.y - a.y) || 1, v = [(b.x - a.x) / len, (b.y - a.y) / len], n = [-v[1], v[0]];
      const q = [n[0] + v[0] * .5, n[1] + v[1] * .5], ql = Math.hypot(...q), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ticks = [];
      for (let j = 0; j < line.ticks; j++) {
        const c = { x: mid.x + v[0] * (j - (line.ticks - 1) / 2) * 4, y: mid.y + v[1] * (j - (line.ticks - 1) / 2) * 4 };
        ticks.push([{ x: c.x - q[0] / ql * 5, y: c.y - q[1] / ql * 5 }, { x: c.x + q[0] / ql * 5, y: c.y + q[1] / ql * 5 }]);
      }
      parts.push({ segments: ticks, width: pal.auxWidth, dash: '' });
    }
    return parts;
  }
  const dotsPath = (dots) => dots.map((p) => 'M' + num(p.x - p.r) + ' ' + num(p.y) + 'a' + num(p.r) + ' ' + num(p.r) + ' 0 1 0 ' + num(2 * p.r) + ' 0a' + num(p.r) + ' ' + num(p.r) + ' 0 1 0 ' + num(-2 * p.r) + ' 0').join('');

  function dimensionParts(dim, pal) {
    const lines = [], arrows = [];
    if (!dim.textStyle) {
      const { aScreen: a, bScreen: b, da, db, normal } = dim, ext = (s) => ({ x: s.x + normal[0] * 6, y: s.y + normal[1] * 6 });
      lines.push([a, ext(da)], [b, ext(db)], [da, db]);
      if (pal.arrows && Math.hypot(db.x - da.x, db.y - da.y) > 18) arrows.push(arrowPath(da, db, 7), arrowPath(db, da, 7));
      else for (const s of [da, db]) lines.push([{ x: s.x - normal[0] * 4, y: s.y - normal[1] * 4 }, { x: s.x + normal[0] * 4, y: s.y + normal[1] * 4 }]);
    }
    return { lines, arrows };
  }

  function sceneToSvg(scene, options = {}) {
    const pal = scene.palette, b = sceneBounds(scene), pad = Math.max(4, scene.fontSize * .4);
    const vx = num(b.x0 - pad), vy = num(b.y0 - pad), vw = num(b.x1 - b.x0 + 2 * pad), vh = num(b.y1 - b.y0 + 2 * pad);
    let k = 1;
    if (options.width) k = options.width / vw;
    if (options.height) k = options.width ? Math.min(k, options.height / vh) : options.height / vh;
    const out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [vx, vy, vw, vh].join(' ') + '" width="' + num(vw * k) + '" height="' + num(vh * k) + '" role="img" aria-label="' + esc(options.title || '입체도형') + '" font-family="' + esc(FONT) + '">'];
    if (options.background !== 'none') out.push('<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="#fff"/>');
    if (scene.floor.length) out.push('<path d="' + pathOf(scene.floor) + '" fill="none" stroke="' + pal.floor + '" stroke-width=".7"/>');
    const grid = scene.gridOn;
    // Partial faces in painter's order; with the grid off, same-coloured runs share one path.
    for (let i = 0; i < scene.partial.length;) {
      const fill = scene.partial[i].fill;
      if (grid) { out.push('<path d="' + ringOf(scene.partial[i].points) + '" fill="' + fill + '" stroke="' + pal.grid + '" stroke-width="' + pal.gridWidth + '" stroke-linejoin="round"/>'); i++; continue; }
      let d = '';
      while (i < scene.partial.length && scene.partial[i].fill === fill) d += ringOf(scene.partial[i++].points);
      out.push('<path d="' + d + '" fill="' + fill + '" stroke="' + fill + '" stroke-width=".8" stroke-linejoin="round"/>');
    }
    for (const region of scene.regions) {
      out.push('<path d="' + region.loops.map(ringOf).join('') + '" fill="' + region.fill + '" stroke="' + (grid ? pal.grid : region.fill) + '" stroke-width="' + (grid ? pal.gridWidth : .8) + '" stroke-linejoin="round"/>');
      if (region.grid.length) out.push('<path d="' + pathOf(region.grid) + '" fill="none" stroke="' + pal.grid + '" stroke-width="' + pal.gridWidth + '"/>');
    }
    if (scene.hidden.length) out.push('<path d="' + pathOf(scene.hidden) + '" fill="none" stroke="' + pal.hidden + '" stroke-width="' + pal.hiddenWidth + '" stroke-dasharray="' + pal.dash + '"/>');
    if (scene.edges.length) out.push('<path d="' + pathOf(scene.edges) + '" fill="none" stroke="' + pal.edge + '" stroke-width="' + pal.edgeWidth + '" stroke-linecap="round" stroke-linejoin="round"/>');
    for (const line of scene.lines || []) for (const part of auxParts(line, pal)) out.push('<path d="' + pathOf(part.segments) + '" fill="none" stroke="' + pal.aux + '" stroke-width="' + part.width + '"' + (part.dash ? ' stroke-dasharray="' + part.dash + '"' : ' stroke-linecap="round"') + '/>');
    for (const dim of scene.dims) {
      const { lines, arrows } = dimensionParts(dim, pal);
      if (lines.length) out.push('<path d="' + pathOf(lines) + '" fill="none" stroke="' + pal.dim + '" stroke-width="' + pal.dimWidth + '"' + (pal.dimDash ? ' stroke-dasharray="' + pal.dimDash + '"' : '') + '/>');
      if (arrows.length) out.push('<path d="' + arrows.join('') + '" fill="' + pal.dim + '"/>');
      if (!dim.textStyle) out.push('<rect x="' + num(dim.mx - dim.labelWidth / 2) + '" y="' + num(dim.my - dim.labelHeight / 2) + '" width="' + num(dim.labelWidth) + '" height="' + num(dim.labelHeight) + '" fill="#fff"/>');
      out.push(textSvg(dim.label, dim.mx, dim.my, dim.fontSize, dim.answer ? pal.answer : pal.text, dim.answer ? 700 : 500));
    }
    if (scene.dots?.length) out.push('<path d="' + dotsPath(scene.dots) + '" fill="' + pal.aux + '" stroke="#fff" stroke-width=".6"/>');
    for (const l of scene.labels) out.push(textSvg(l.text, l.x, l.y, l.fontSize, pal.text, l.weight ?? 700));
    return out.join('') + '</svg>';
  }
  const halo = (size) => num(size * .16 + .8);
  function textSvg(text, x, y, size, fill, weight) {
    return '<text x="' + num(x) + '" y="' + num(y + size * .36) + '" text-anchor="middle" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '" stroke="#fff" stroke-width="' + halo(size) + '" stroke-linejoin="round" paint-order="stroke">' + esc(text) + '</text>';
  }

  // --- Canvas painter (app) -----------------------------------------------------------------
  function paintScene(ctx, scene) {
    const pal = scene.palette, grid = scene.gridOn;
    const poly = (points) => { ctx.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y); ctx.closePath(); };
    const segments = (list) => { ctx.beginPath(); for (const [a, b] of list) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); };
    ctx.save(); ctx.lineJoin = 'round';
    if (scene.floor.length) { ctx.strokeStyle = pal.floor; ctx.lineWidth = .7; segments(scene.floor); }
    for (const face of scene.partial) {
      ctx.beginPath(); poly(face.points); ctx.fillStyle = face.fill; ctx.fill();
      ctx.strokeStyle = grid ? pal.grid : face.fill; ctx.lineWidth = grid ? pal.gridWidth : .8; ctx.stroke();
    }
    for (const region of scene.regions) {
      ctx.beginPath(); region.loops.forEach(poly); ctx.fillStyle = region.fill; ctx.fill('nonzero');
      ctx.strokeStyle = grid ? pal.grid : region.fill; ctx.lineWidth = grid ? pal.gridWidth : .8; ctx.stroke();
      if (region.grid.length) { ctx.strokeStyle = pal.grid; ctx.lineWidth = pal.gridWidth; segments(region.grid); }
    }
    if (scene.hidden.length) { ctx.setLineDash(pal.dash.split(' ').map(Number)); ctx.strokeStyle = pal.hidden; ctx.lineWidth = pal.hiddenWidth; segments(scene.hidden); ctx.setLineDash([]); }
    if (scene.edges.length) { ctx.lineCap = 'round'; ctx.strokeStyle = pal.edge; ctx.lineWidth = pal.edgeWidth; segments(scene.edges); ctx.lineCap = 'butt'; }
    for (const line of scene.lines || []) for (const part of auxParts(line, pal)) {
      ctx.setLineDash(part.dash ? part.dash.split(' ').map(Number) : []); ctx.lineCap = part.dash ? 'butt' : 'round';
      ctx.strokeStyle = pal.aux; ctx.lineWidth = part.width; segments(part.segments);
    }
    ctx.setLineDash([]); ctx.lineCap = 'butt';
    ctx.restore();
    for (const dim of scene.dims) paintDimension(ctx, dim, pal);
    if (scene.dots?.length) { ctx.save(); ctx.fillStyle = pal.aux; ctx.strokeStyle = '#fff'; ctx.lineWidth = .6; const path = new Path2D(dotsPath(scene.dots)); ctx.fill(path); ctx.stroke(path); ctx.restore(); }
    for (const l of scene.labels) paintText(ctx, l.text, l.x, l.y, l.fontSize, pal.text, l.weight ?? 700);
  }
  function paintDimension(ctx, dim, pal, accent) {
    const { lines, arrows } = dimensionParts(dim, pal);
    ctx.save(); ctx.strokeStyle = accent || pal.dim; ctx.lineWidth = pal.dimWidth;
    if (pal.dimDash) ctx.setLineDash(pal.dimDash.split(' ').map(Number));
    ctx.beginPath(); for (const [a, b] of lines) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); ctx.setLineDash([]);
    if (arrows.length) { ctx.fillStyle = accent || pal.dim; ctx.fill(new Path2D(arrows.join(''))); }
    if (!dim.textStyle) { ctx.fillStyle = '#fff'; ctx.fillRect(dim.mx - dim.labelWidth / 2, dim.my - dim.labelHeight / 2, dim.labelWidth, dim.labelHeight); }
    ctx.restore();
    paintText(ctx, dim.label, dim.mx, dim.my, dim.fontSize, accent || (dim.answer ? pal.answer : pal.text), dim.answer ? 700 : 500);
  }
  function paintText(ctx, text, x, y, size, fill, weight) {
    ctx.save(); ctx.font = weight + ' ' + size + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff'; ctx.lineWidth = size * .16 + .8; ctx.strokeText(text, x, y + size * .36);
    ctx.fillStyle = fill; ctx.fillText(text, x, y + size * .36); ctx.restore();
  }

  // --- Export entry point -------------------------------------------------------------------
  const PRESETS = { worksheet: { style: 'print', floor: false, width: 240, fontSize: 12 } };
  function exportOptions(p, options) {
    const preset = options.preset ? { ...PRESETS[options.preset] } : {};
    if (options.preset && !PRESETS[options.preset]) throw new Error('preset은 worksheet만 지원합니다.');
    // Seen from the top the floor grid is the grid paper of a plane figure, so the preset keeps it.
    const topView = options.view === 'top' || (options.view === undefined && options.yaw === undefined && options.pitch === undefined && p.view.projection !== 'oblique' && p.view.pitch > 1.5);
    if (topView) delete preset.floor;
    const o = { ...preset };
    for (const [name, value] of Object.entries(options)) if (value !== undefined) o[name] = value;
    const settings = { ...p.settings };
    for (const name of ['grid', 'floor', 'overall', 'annotations', 'hidden', 'labels']) if (o[name] !== undefined) {
      if (typeof o[name] !== 'boolean') throw new Error('그림 표시 설정 ' + name + '은 true 또는 false여야 합니다.');
      settings[name] = o[name];
    }
    if (o.style !== undefined) { if (!PALETTES[o.style]) throw new Error('style은 color 또는 print입니다.'); settings.style = o.style; }
    if (o.dimStyle !== undefined) { if (!['line', 'text'].includes(o.dimStyle)) throw new Error('dims는 line 또는 text입니다.'); settings.dimStyle = o.dimStyle; }
    const view = { ...p.view };
    if (o.view !== undefined) {
      if (o.view === 'oblique') view.projection = 'oblique';
      else if (VIEWS[o.view]) { [view.yaw, view.pitch] = VIEWS[o.view]; delete view.projection; }
      else throw new Error('시점은 ' + Object.keys(VIEWS).join(', ') + ', oblique 중 하나여야 합니다.');
    }
    if (o.yaw !== undefined) { if (!Number.isFinite(o.yaw)) throw new Error('yaw는 숫자(라디안)입니다.'); view.yaw = o.yaw; delete view.projection; }
    if (o.pitch !== undefined) { if (!Number.isFinite(o.pitch) || Math.abs(o.pitch) > Math.PI / 2 + 1e-9) throw new Error('pitch는 -1.57~1.57 라디안입니다.'); view.pitch = o.pitch; delete view.projection; }
    for (const name of ['width', 'height', 'fit']) if (o[name] !== undefined && !(Number.isFinite(o[name]) && o[name] >= 40 && o[name] <= 8000)) throw new Error(name + '는 40~8000 픽셀이어야 합니다.');
    if (o.fontSize !== undefined && !(Number.isFinite(o.fontSize) && o.fontSize >= 6 && o.fontSize <= 72)) throw new Error('글자 크기는 6~72 픽셀입니다.');
    return { o, settings, view };
  }

  function prepareExport(data, options = {}) {
    const p = G.validateProject(data), box = G.bounds(p.cells);
    if (!box) throw new Error('빈 도형은 그림으로 내보낼 수 없습니다.');
    const { o, settings, view } = exportOptions(p, options);
    const basis = viewBasis(view), geometry = options.geometry || G.extractSurface(p.cells), has = G.occupancy(p.cells);
    const model = { cells: p.cells, box, geometry, has, unit: p.unit, unitLabel: p.unitLabel, dimensions: p.dimensions, overallDimensions: p.overallDimensions, labels: p.labels, points: p.points, segments: p.segments, settings };
    const fontSize = o.fontSize ?? 14, [ew, eh] = projectedExtent(box, basis);
    const build = (scale) => {
      const frame = makeFrame(basis, scale, box.center);
      return { scene: buildScene(model, frame, { fontSize, answers: o.answers === true, offsetScale: o.offsetScale ?? .6 }), frame };
    };
    let scale = Math.max(.3, Math.min(400, (o.fit ?? 240) / Math.max(ew, eh)));
    let result = build(scale);
    // Fit the whole drawing (labels included) to a requested pixel size; labels keep their size.
    if (o.width || o.height) {
      for (let i = 0; i < 4; i++) {
        const b = sceneBounds(result.scene), pad = Math.max(4, fontSize * .4), w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad;
        const sw = ew * scale, sh = eh * scale;
        let next = Infinity;
        if (o.width) next = Math.min(next, scale * Math.max(.1, o.width - (w - sw)) / sw);
        if (o.height) next = Math.min(next, scale * Math.max(.1, o.height - (h - sh)) / sh);
        next = Math.max(.3, Math.min(400, next));
        if (Math.abs(next - scale) < .01) break;
        scale = next; result = build(scale);
      }
    }
    return { p, box, model, settings, view, options: o, ...result };
  }

  // Same pure renderer for the app's SVG button and the Node command.
  function renderSvg(data, options = {}) {
    const r = prepareExport(data, options);
    return sceneToSvg(r.scene, { width: r.options.width, height: r.options.height, background: r.options.background, title: r.options.title });
  }

  // Machine-checkable review of a figure: what an assistant must confirm before handing it on.
  function checkProject(data, options = {}) {
    const errors = [], warnings = [];
    let r;
    try { r = prepareExport(data, options); } catch (error) { return { ok: false, errors: [{ code: 'invalid', message: error.message }], warnings }; }
    const { p, box, model, scene, frame, settings } = r, has = model.has, unitText = (v) => format(v) + ' ' + p.unitLabel;
    const warn = (code, message, extra = {}) => warnings.push({ code, message, ...extra });
    for (const d of p.dimensions) {
      const status = G.dimensionAttachment(has, d), len = G.length(G.sub(d.b, d.a)) * p.unit;
      if (status === 'detached') warn('dimension-detached', '치수 ' + d.id + '의 끝점이 도형에 닿지 않습니다. 블록을 지운 뒤 남은 치수인지 확인하세요.', { id: d.id, a: d.a, b: d.b });
      else if (status === 'crosses') warn('dimension-crosses', '치수 ' + d.id + '가 도형 표면을 따라가지 않고 빈 공간이나 내부를 지납니다.', { id: d.id, a: d.a, b: d.b });
      else if (status === 'diagonal') warn('dimension-diagonal', '치수 ' + d.id + '는 사선입니다. 표시 길이 ' + unitText(len) + '는 반올림된 값일 수 있습니다.', { id: d.id });
      if (d.question && (d.visible === false || !settings.annotations)) warn('question-hidden', '치수 ' + d.id + '는 question인데 숨겨져 있어 그림에 "?"가 보이지 않습니다.', { id: d.id });
    }
    if (settings.overall) for (const d of G.overallDimensions(box, p.overallDimensions, has, frame.basis)) {
      if (d.visible && !d.attached) warn('overall-floating', '전체 ' + 'XYZ'[d.axis] + ' 치수선을 붙일 온전한 바깥 모서리가 없어 일부가 허공에 표시됩니다. 부분 치수로 바꾸거나 이 전체 치수를 숨기세요.', { id: d.id });
      if (d.question && !d.visible) warn('question-hidden', '전체 ' + 'XYZ'[d.axis] + ' 치수가 question인데 숨겨져 있습니다.', { id: d.id });
    }
    for (const dim of scene.dims) {
      const name = dim.kind === 'overall' ? '전체 ' + 'XYZ'[dim.axis] + ' 치수' : '치수 ' + dim.id;
      if (dim.behind) warn('dimension-behind', name + '가 가리키는 모서리가 이 시점에서 도형 뒤에 가려져 있어 치수선이 도형 위를 지납니다. 시점을 바꾸거나 다른 모서리를 재세요.', { id: dim.id });
      if (dim.crowded) warn('dimension-overlap', name + '의 선이나 글자가 다른 치수와 겹칩니다. offset을 바꾸거나 한쪽을 숨기세요.', { id: dim.id });
    }
    // A "?" is pointless if a parallel dimension of the same length prints the answer.
    const vec = (d) => G.sub(d.b, d.a);
    for (const q of scene.dims.filter((d) => d.questionMark)) {
      const qv = vec(q), leak = scene.dims.find((o) => o !== q && !o.questionMark && !o.answer && Math.abs(G.length(vec(o)) - G.length(qv)) < 1e-9 && Math.abs(Math.abs(G.dot(vec(o), qv)) - G.length(qv) ** 2) < 1e-9);
      if (leak) warn('answer-visible', '문제 치수 ' + q.id + '와 같은 방향·같은 길이의 치수 ' + leak.id + '가 "' + leak.label + '"로 보여 답이 드러납니다. ' + leak.id + '를 숨기거나(visibility … hide) 전체 치수 자체를 문제로 바꾸세요(ask).', { id: q.id, leak: leak.id });
    }
    const rects = [...scene.dims.map((d) => ({ id: d.id, text: d.label, hit: d.hit })), ...scene.labels.map((l) => ({ id: l.id, text: l.text, hit: l.hit }))];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i].hit, rects[j].hit)) warn('label-overlap', '"' + rects[i].text + '"와 "' + rects[j].text + '" 글자가 겹칩니다. offset을 바꾸거나 시점을 바꾸세요.', { ids: [rects[i].id, rects[j].id] });
    }
    for (const item of [...scene.dims, ...scene.labels]) if (item.onShape) warn('text-on-face', '"' + (item.kind ? item.text : item.label ?? item.text) + '" 글자가 도형 면 위에 놓였습니다. 시점이나 offset을 바꾸거나 --dims text를 써 보세요.', { id: item.id });
    for (const l of p.labels) if (!G.onSurface(has, l.at)) warn('label-off-shape', '꼭짓점 이름 "' + l.text + '"의 위치가 도형에 닿지 않습니다.', { id: l.id, at: l.at });
    // Points and auxiliary segments: off the solid, or hidden in this view.
    for (const pt of p.points) {
      const place = G.pointPlace(has, pt.at), name = '점 ' + pt.id + (pt.label !== undefined ? '("' + pt.label + '")' : '');
      if (place === 'outside') warn('point-off-shape', name + '의 위치가 도형에 닿지 않는 빈 곳입니다. 좌표를 확인하세요.', { id: pt.id, at: pt.at });
      else if (pt.visible && (pt.dot || (pt.label !== undefined && settings.labels)) && occluded(pt.at, frame.basis.normal, has, box))
        warn('point-hidden', name + ': 이 시점에서 ' + (place === 'inside' ? '도형 안쪽에' : '도형 뒤에 가려져') + ' 있습니다. 의도한 것인지 확인하세요(보이는 시점으로 바꾸거나 숨은 모서리 점선을 켜기).', { id: pt.id, at: pt.at, place });
    }
    for (const line of scene.lines) if (line.style !== 'none' && !line.seen.length && line.behind === 'hide') warn('segment-hidden', '선분 ' + line.id + ': 이 시점에서 전부 가려져 그림에 나오지 않습니다. behind를 dash로 바꾸거나 시점을 바꾸세요.', { id: line.id });
    const cavity = G.cavityAnalysis(p.cells), components = G.componentCount(p.cells), floating = G.unsupportedBlocks(p.cells);
    if (cavity?.cavityCells) warn('hidden-cavity', '겉에서 보이지 않는 빈 공간이 ' + cavity.cavityCells + '칸 있습니다. surfaceArea에는 안쪽 면도 들어 있고, 바깥 겉넓이는 ' + unitText(cavity.exteriorFaces * p.unit ** 2) + '²입니다.');
    if (components > 1) warn('disconnected', '도형이 서로 떨어진 ' + components + '덩어리입니다.');
    if (floating.length) warn('unsupported-blocks', '아래가 비어 있는 블록이 ' + floating.length + '개 있습니다. 쌓기나무라면 공중에 뜬 블록입니다.', { blocks: floating.slice(0, 12) });
    const geometry = model.geometry, views = G.projections(p.cells);
    return {
      ok: errors.length === 0, errors, warnings,
      info: {
        size: box.size.map((v) => Number((v * p.unit).toFixed(6))), unitLabel: p.unitLabel, blockCount: p.cells.size,
        volume: Number((p.cells.size * p.unit ** 3).toFixed(6)), surfaceArea: Number((geometry.surfaceArea * p.unit ** 2).toFixed(6)),
        ...(cavity ? { exteriorSurfaceArea: Number((cavity.exteriorFaces * p.unit ** 2).toFixed(6)), cavityCells: cavity.cavityCells } : {}),
        components,
        // Plane figures seen from each side (평면도형): area in unit², perimeter in unit.
        views: views ? Object.fromEntries(['front', 'right', 'top'].map((k) => [k, { area: Number((views.squares[k] * p.unit ** 2).toFixed(6)), perimeter: Number((views.perimeter[k] * p.unit).toFixed(6)) }])) : null,
        shown: [...scene.dims.map((d) => ({ id: d.id, text: d.label, length: Number((G.length(G.sub(d.b, d.a)) * p.unit).toFixed(6)), ...(d.questionMark ? { question: true } : {}), ...(d.answer ? { answer: true } : {}) })),
          ...scene.labels.map((l) => ({ id: l.id, text: l.text, ...(l.kind ? { kind: l.kind } : {}), ...(l.at ? { at: l.at } : {}) }))],
        ...(p.points.length ? { points: p.points.map((pt) => ({ id: pt.id, ...(pt.label !== undefined ? { label: pt.label } : {}), at: pt.at, place: G.pointPlace(has, pt.at), dot: pt.dot, visible: pt.visible })) } : {}),
        // How each auxiliary segment came out in this view: solid, dashed where hidden, or not drawn.
        ...(scene.lines.length || p.segments.length ? { segments: p.segments.map((s) => {
          const line = scene.lines.find((l) => l.id === s.id);
          const drawn = !line ? 'hidden-by-setting' : s.style === 'none' ? 'marks-only' : !line.hidden.length ? 'seen' : !line.seen.length ? (s.behind === 'hide' ? 'not-drawn' : 'dashed') : (s.behind === 'hide' ? 'partly-drawn' : 'partly-dashed');
          return { id: s.id, length: Number((G.length(G.sub(s.to, s.from)) * p.unit).toFixed(6)), from: s.from, to: s.to, style: s.style, drawn, ...(s.label !== undefined ? { label: s.label } : {}), ...(s.ticks ? { ticks: s.ticks } : {}) };
        }) } : {}),
        view: r.view, style: settings.style
      }
    };
  }

  const api = { checkProject, format, FONT, PALETTES, VIEWS, viewBasis, corners, projectedExtent, fittingScale, createFrame, makeFrame, floorLines, featureEdge, faceClear, occluded, visibleParts, auxParts, textWidth, rectsOverlap, dimensionText, dimensionLayout, faceColor, faceFill, buildScene, sceneBounds, sceneToSvg, paintScene, paintDimension, paintText, prepareExport, renderSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolidRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
