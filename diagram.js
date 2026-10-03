(function (root) {
  'use strict';
  // Independent, package-free 2D math diagrams. Coordinates are mathematical (Y grows up).
  const FORMAT = 'solidlab-diagram', VERSION = 1;
  const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Segoe UI',sans-serif";
  const finite = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000;
  const point = (v) => Array.isArray(v) && v.length === 2 && v.every(finite);
  const str = (v, max = 60) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
  const fail = (s) => { throw new Error(s); };
  const num = (v) => Number(v.toFixed(4));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const len = (a) => Math.hypot(...a);
  const unit = (a) => { const n = len(a); return n ? a.map((v) => v / n) : [1, 0]; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, n) => a.map((v) => v * n);
  const refs = (ids, value, where) => {
    if (!ids.has(value)) fail(where + '는 존재하는 점 ID여야 합니다: ' + value);
    return value;
  };
  const optionalLabel = (item, where) => {
    if (item.label !== undefined && !str(item.label, 40)) fail(where + '.label은 1~40자여야 합니다.');
    if (item.value !== undefined && !(finite(item.value) || str(item.value, 40))) fail(where + '.value는 숫자나 1~40자 글자여야 합니다.');
    if (item.question !== undefined && typeof item.question !== 'boolean') fail(where + '.question은 true/false여야 합니다.');
  };

  // Where lines AB and CD meet (they need not be drawn that far), or null when parallel.
  function meet(a, b, c, d) {
    const r = minus(b, a), s = minus(d, c), den = cross(r, s);
    if (Math.abs(den) < 1e-12 * Math.max(1e-12, len(r) * len(s))) return null;
    return add(a, mul(r, cross(minus(c, a), s) / den));
  }
  // A point is either fixed ("at") or derived: "on" [P, Q] at ratio t (0.5 = middle), or "cross"
  // of lines [[P, Q], [R, S]]. Derived points are recomputed, so they follow when P moves.
  function locate(list) {
    const byId = new Map(list.map((p, i) => [p?.id, { p, w: 'points[' + i + ']' }])), out = new Map(), busy = new Set();
    const ref = (r, w) => {
      if (point(r)) return r;
      if (typeof r === 'string' && byId.has(r)) return place(r);
      return fail(w + '는 점 ID 또는 [x,y] 좌표여야 합니다: ' + JSON.stringify(r));
    };
    const place = (id) => {
      if (out.has(id)) return out.get(id);
      const { p, w } = byId.get(id);
      if (busy.has(id)) fail(w + ' ' + id + '의 위치가 서로를 참조합니다(순환).');
      busy.add(id);
      let at;
      if (p.on !== undefined) {
        if (!Array.isArray(p.on) || p.on.length !== 2) fail(w + '.on은 [점1, 점2]입니다. 두 점 사이 비율 t(기본 0.5) 자리에 놓입니다.');
        if (p.t !== undefined && !(finite(p.t) && p.t >= 0 && p.t <= 1)) fail(w + '.t는 0~1 사이 비율입니다 (0.5 = 가운데).');
        const a = ref(p.on[0], w + '.on[0]'), b = ref(p.on[1], w + '.on[1]');
        at = add(a, mul(minus(b, a), p.t ?? .5));
      } else if (p.cross !== undefined) {
        if (!Array.isArray(p.cross) || p.cross.length !== 2 || !p.cross.every((l) => Array.isArray(l) && l.length === 2)) fail(w + '.cross는 [[점1, 점2], [점3, 점4]] 두 직선입니다.');
        const [[a, b], [c, d]] = p.cross.map((l, i) => l.map((r, j) => ref(r, w + '.cross[' + i + '][' + j + ']')));
        at = meet(a, b, c, d);
        if (!at) fail(w + '.cross의 두 직선이 평행해서 만나지 않습니다.');
      } else at = p.at;
      if (!point(at)) fail(w + '.at은 유한한 [x,y] 좌표여야 합니다.');
      at = at.map((v) => Number(v.toFixed(9)));
      busy.delete(id); out.set(id, at); return at;
    };
    for (const p of list) place(p.id);
    return out;
  }
  // Recompute derived points of an editable document in place (the editor keeps at as a cache).
  function resolve(doc) {
    const at = locate(doc.points);
    for (const p of doc.points) if (p.on !== undefined || p.cross !== undefined) p.at = at.get(p.id);
    return doc;
  }

  function validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== FORMAT || data.version !== VERSION) fail('format은 solidlab-diagram, version은 1이어야 합니다.');
    if (data.unit !== undefined && (!finite(data.unit) || data.unit <= 0)) fail('unit은 0보다 큰 숫자여야 합니다.');
    if (data.unitLabel !== undefined && !['cm', 'mm', 'm', '칸', ''].includes(data.unitLabel)) fail('unitLabel은 cm, mm, m, 칸 중 하나여야 합니다.');
    if (data.grid !== undefined && data.grid !== false && !(data.grid && typeof data.grid === 'object' && finite(data.grid.step) && data.grid.step > 0)) fail('grid는 false 또는 {step: 양수}여야 합니다.');
    if (data.settings !== undefined && (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))) fail('settings는 객체여야 합니다.');
    if (data.toScale !== undefined && typeof data.toScale !== 'boolean') fail('toScale은 true/false여야 합니다.');
    const settings = { style: 'print', ...(data.settings || {}) };
    if (!['print', 'color'].includes(settings.style)) fail('settings.style은 print 또는 color여야 합니다.');
    if (!Array.isArray(data.points) || data.points.length > 300) fail('points는 최대 300개의 배열이어야 합니다.');
    if (!Array.isArray(data.items) || data.items.length > 500) fail('items는 최대 500개의 배열이어야 합니다.');
    const ids = new Set(), points = data.points.map((p, i) => {
      const w = 'points[' + i + ']';
      if (!p || !str(p.id, 30) || !/^[\p{L}\p{N}_-]+$/u.test(p.id) || ids.has(p.id)) fail(w + '.id는 중복 없는 1~30자 점 이름이어야 합니다.');
      const derived = (p.on !== undefined) + (p.cross !== undefined);
      if (derived > 1) fail(w + '에는 on과 cross 중 하나만 넣어야 합니다.');
      if (!derived && !point(p.at)) fail(w + '.at은 유한한 [x,y] 좌표여야 합니다. (또는 on·cross로 다른 점에서 정하기)');
      if (p.t !== undefined && p.on === undefined) fail(w + '.t는 on과 함께 쓰는 비율입니다.');
      if (p.label !== undefined && !str(p.label, 20)) fail(w + '.label은 1~20자여야 합니다.');
      if (p.labelAt !== undefined && p.labelAt !== 'auto' && !finite(p.labelAt)) fail(w + '.labelAt은 auto 또는 각도여야 합니다.');
      if (p.show !== undefined && typeof p.show !== 'boolean') fail(w + '.show는 true/false여야 합니다.');
      ids.add(p.id);
      return { ...p, show: p.show !== false };
    });
    const located = locate(points);
    for (const p of points) p.at = [...located.get(p.id)];
    const itemIds = new Set();
    const items = data.items.map((it, i) => {
      const w = 'items[' + i + ']';
      if (!it || typeof it !== 'object' || !str(it.type, 20)) fail(w + '.type이 필요합니다.');
      const itemId = it.id ?? ('i' + (i + 1));
      if (!str(itemId, 30) || !/^[\p{L}\p{N}_-]+$/u.test(itemId) || itemIds.has(itemId)) fail(w + '.id는 중복 없는 1~30자여야 합니다.');
      itemIds.add(itemId);
      if (['segment', 'line', 'ray', 'dim'].includes(it.type)) {
        refs(ids, it.a, w + '.a'); refs(ids, it.b, w + '.b');
        if (it.a === it.b) fail(w + '의 두 점은 달라야 합니다.');
      } else if (it.type === 'polygon') {
        if (!Array.isArray(it.points) || it.points.length < 3 || it.points.length > 100) fail(w + '.points는 3~100개 점 ID여야 합니다.');
        it.points.forEach((id) => refs(ids, id, w + '.points'));
        if (new Set(it.points).size !== it.points.length) fail(w + '.points에 중복이 있습니다.');
      } else if (['circle', 'arc', 'sector'].includes(it.type)) {
        refs(ids, it.center, w + '.center');
        if (it.type === 'circle') {
          if ((it.r === undefined) === (it.through === undefined)) fail(w + '에는 r 또는 through 중 하나가 필요합니다.');
          if (it.r !== undefined && (!finite(it.r) || it.r <= 0)) fail(w + '.r은 양수여야 합니다.');
          if (it.through !== undefined) refs(ids, it.through, w + '.through');
          if (it.through === it.center) fail(w + '.through는 중심과 다른 점이어야 합니다.');
        } else {
          refs(ids, it.from, w + '.from'); refs(ids, it.to, w + '.to');
          if (it.from === it.center || it.to === it.center || it.from === it.to) fail(w + '의 중심과 두 끝점은 서로 달라야 합니다.');
        }
      } else if (it.type === 'angle') {
        for (const k of ['at', 'from', 'to']) refs(ids, it[k], w + '.' + k);
        if (new Set([it.at, it.from, it.to]).size !== 3) fail(w + '의 세 점은 달라야 합니다.');
        if (!['arc', 'right'].includes(it.mark || 'arc')) fail(w + '.mark는 arc 또는 right여야 합니다.');
      } else if (it.type === 'text') {
        if (!(point(it.at) || ids.has(it.at)) || !str(it.text, 100)) fail(w + '에는 점 ID/[x,y]와 1~100자 text가 필요합니다.');
      } else fail(w + '.type은 segment, line, ray, polygon, circle, arc, sector, angle, dim, text 중 하나여야 합니다.');
      if (it.type === 'segment') {
        if (it.ticks !== undefined && ![1, 2, 3].includes(it.ticks)) fail(w + '.ticks는 1~3이어야 합니다.');
        if (it.parallel !== undefined && ![1, 2, 3].includes(it.parallel)) fail(w + '.parallel은 1~3이어야 합니다.');
        if (it.arrows !== undefined && !['end', 'both'].includes(it.arrows)) fail(w + '.arrows는 end 또는 both여야 합니다.');
      }
      if (it.type === 'dim' && it.offset !== undefined && (!finite(it.offset) || Math.abs(it.offset) > 300)) fail(w + '.offset은 -300~300 픽셀이어야 합니다.');
      if (it.type === 'dim' && it.style !== undefined && !['line', 'text'].includes(it.style)) fail(w + '.style은 line 또는 text여야 합니다.');
      if (it.type === 'angle' && it.arcs !== undefined && ![1, 2, 3].includes(it.arcs)) fail(w + '.arcs는 1~3이어야 합니다.');
      if (['polygon', 'circle', 'sector'].includes(it.type) && it.fill !== undefined && !['none', 'light'].includes(it.fill)) fail(w + '.fill은 none 또는 light여야 합니다.');
      if (['arc', 'sector'].includes(it.type) && it.ccw !== undefined && typeof it.ccw !== 'boolean') fail(w + '.ccw는 true/false여야 합니다.');
      optionalLabel(it, w);
      return { ...it, id: itemId, ...(Array.isArray(it.points) ? { points: [...it.points] } : {}) };
    });
    return { format: FORMAT, version: VERSION, unit: data.unit ?? 1, unitLabel: data.unitLabel ?? 'cm', grid: data.grid || false, toScale: data.toScale === true, settings, points, items };
  }

  function bounds(doc, xy) {
    const list = doc.points.map((p) => p.at);
    for (const it of doc.items) if (it.type === 'text') list.push(xy(it.at));
    for (const it of doc.items) if (['circle', 'arc', 'sector'].includes(it.type)) {
      const c = xy(it.center), r = it.type === 'circle' ? (it.r ?? dist(c, xy(it.through))) : dist(c, xy(it.from));
      if (it.type === 'circle') list.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]);
      else {
        if (it.type === 'sector') list.push(c);
        const a = xy(it.from), b = xy(it.to), start = Math.atan2(a[1] - c[1], a[0] - c[0]), end = Math.atan2(b[1] - c[1], b[0] - c[0]);
        const ccw = it.ccw !== false, sweep = ccw ? (end - start + 2 * Math.PI) % (2 * Math.PI) : (start - end + 2 * Math.PI) % (2 * Math.PI);
        for (const t of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
          const progress = ccw ? (t - start + 2 * Math.PI) % (2 * Math.PI) : (start - t + 2 * Math.PI) % (2 * Math.PI);
          if (progress <= sweep + 1e-9) list.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
        }
      }
    }
    if (!list.length) list.push([0, 0], [5, 5]);
    let x0 = Math.min(...list.map((p) => p[0])), y0 = Math.min(...list.map((p) => p[1]));
    let x1 = Math.max(...list.map((p) => p[0])), y1 = Math.max(...list.map((p) => p[1]));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    x0 -= w * .05; x1 += w * .05; y0 -= h * .05; y1 += h * .05;
    if (x1 - x0 < 2) { x0 -= 1; x1 += 1; }
    if (y1 - y0 < 2) { y0 -= 1; y1 += 1; }
    return { x0, y0, x1, y1 };
  }
  function clipLine(a, b, box, ray) {
    const d = minus(b, a), t = ray ? [0, Infinity] : [-Infinity, Infinity];
    for (let k = 0; k < 2; k++) {
      if (Math.abs(d[k]) < 1e-12) { if (a[k] < [box.x0, box.y0][k] || a[k] > [box.x1, box.y1][k]) return null; continue; }
      const lo = ([box.x0, box.y0][k] - a[k]) / d[k], hi = ([box.x1, box.y1][k] - a[k]) / d[k];
      t[0] = Math.max(t[0], Math.min(lo, hi)); t[1] = Math.min(t[1], Math.max(lo, hi));
    }
    return t[0] <= t[1] ? [add(a, mul(d, t[0])), add(a, mul(d, t[1]))] : null;
  }

  function scene(input, options = {}) {
    const doc = validate(input), named = new Map(doc.points.map((p) => [p.id, p.at]));
    const xy = (ref) => typeof ref === 'string' ? named.get(ref) : ref;
    const preset = options.preset === 'worksheet';
    if (options.preset && !preset) fail('preset은 worksheet만 지원합니다.');
    const viewport = options.viewport, fixed = !!viewport;
    const world = viewport ? (viewport.bounds || viewport) : bounds(doc, xy);
    const spanX = world.x1 - world.x0, spanY = world.y1 - world.y0;
    if (!(spanX > 0 && spanY > 0)) fail('viewport는 양의 넓이와 높이가 필요합니다.');
    const k = options.pixelsPerUnit;
    if (k !== undefined && (!finite(k) || k <= 0)) fail('pixelsPerUnit은 양수여야 합니다.');
    const width = options.width ?? (viewport?.width ?? (k && viewport ? spanX * k : (preset ? 240 : 480)));
    const fontSize = options.fontSize ?? (preset ? 12 : 14);
    if (!(finite(width) && width >= 80 && width <= 8000 && finite(fontSize) && fontSize >= 6 && fontSize <= 72)) fail('width는 80~8000, fontSize는 6~72여야 합니다.');
    const pads = fixed ? [0, 0, 0, 0] : (options._pads || [8, 8, 8, 8]); // left, right, top, bottom
    if (!fixed && pads[0] + pads[1] >= width - 20) fail('그림 폭보다 치수와 글자가 큽니다. width를 늘리거나 offset을 줄이세요.');
    const scale = (width - pads[0] - pads[1]) / spanX;
    const height = options.height ?? (viewport?.height ?? (k && viewport ? spanY * k : Math.max(80, num(spanY * scale + pads[2] + pads[3]))));
    if (!(finite(height) && height >= 80 && height <= 8000)) fail('height는 80~8000이어야 합니다.');
    if (!fixed && pads[2] + pads[3] >= height - 20) fail('그림 높이보다 치수와 글자가 큽니다. height를 늘리거나 offset을 줄이세요.');
    const actualScale = fixed ? (k || Math.min(width / spanX, height / spanY)) : Math.min(scale, (height - pads[2] - pads[3]) / spanY);
    const ox = fixed ? 0 : pads[0] + (width - pads[0] - pads[1] - spanX * actualScale) / 2;
    const oy = fixed ? 0 : pads[3] + (height - pads[2] - pads[3] - spanY * actualScale) / 2;
    const toScreen = (p) => [num(ox + (p[0] - world.x0) * actualScale), num(height - oy - (p[1] - world.y0) * actualScale)];
    const toModel = (p) => [world.x0 + (p[0] - ox) / actualScale, world.y0 + (height - oy - p[1]) / actualScale];
    const style = options.style || doc.settings.style;
    if (!['print', 'color'].includes(style)) fail('style은 print 또는 color여야 합니다.');
    const color = style === 'print' ? '#000' : '#34503a', light = style === 'print' ? '#ededed' : '#e3edde';
    const shapes = [], labels = [], warnings = [], strokes = [];
    const line = (a, b, extra = '') => { shapes.push(`<line x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"${extra}/>`); if (!extra.includes('class="grid"')) strokes.push([a, b]); };
    const path = (d, extra = '') => shapes.push(`<path d="${d}"${extra}/>`);
    const text = (p, value, extra = '') => labels.push({ p, value: String(value), extra });
    const P = (id) => toScreen(xy(id));
    const arrow = (tip, toward) => {
      const u = unit(minus(toward, tip)), n = [-u[1], u[0]], base = add(tip, mul(u, 9));
      path(`M ${num(tip[0])} ${num(tip[1])} L ${num(add(base, mul(n, 3))[0])} ${num(add(base, mul(n, 3))[1])} L ${num(add(base, mul(n, -3))[0])} ${num(add(base, mul(n, -3))[1])} Z`, ` fill="${color}" stroke="none"`);
    };
    const shown = (it, fallback) => it.question ? (options.answers ? (it.value ?? '?') : (it.label ?? '?')) : (it.label ?? it.value ?? fallback);
    const labelWidth = (value, size = fontSize) => [...String(value)].reduce((n, ch) => n + (/[\u1100-\u11ff\u2e80-\uffff]/u.test(ch) ? 1 : .55), 0) * size;
    const labelPenalty = (at, value, size = fontSize) => {
      const tw = labelWidth(value, size);
      let score = at[0] - tw / 2 < 1 || at[0] + tw / 2 > width - 1 || at[1] - size / 2 < 1 || at[1] + size / 2 > height - 1 ? 100 : 0;
      for (const l of labels) if (Math.abs(at[0] - l.p[0]) < (tw + labelWidth(l.value)) / 2 + 3 && Math.abs(at[1] - l.p[1]) < size + 3) score += 50;
      for (const [a, b] of strokes) {
        if (at[0] < Math.min(a[0], b[0]) - tw / 2 - 3 || at[0] > Math.max(a[0], b[0]) + tw / 2 + 3 ||
            at[1] < Math.min(a[1], b[1]) - size / 2 - 3 || at[1] > Math.max(a[1], b[1]) + size / 2 + 3) continue;
        const d = minus(b, a), t = Math.max(0, Math.min(1, ((at[0] - a[0]) * d[0] + (at[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
        const nearest = add(a, mul(d, t));
        if (Math.abs(at[0] - nearest[0]) < tw / 2 + 3 && Math.abs(at[1] - nearest[1]) < size / 2 + 3) score += 8;
      }
      return score;
    };
    // Centre of the smallest polygon holding both points (else of all points): "outside" is away from it.
    const centerFor = (ida, idb) => {
      const enclosing = doc.items.filter((p) => p.type === 'polygon' && p.points.includes(ida) && p.points.includes(idb));
      const area = (p) => Math.abs(p.points.reduce((sum, id, j) => sum + cross(xy(id), xy(p.points[(j + 1) % p.points.length])), 0));
      enclosing.sort((p, q) => area(p) - area(q));
      const near = enclosing[0]?.points.map(xy) || doc.points.map((p) => p.at);
      return [near.reduce((s, p) => s + p[0], 0) / (near.length || 1), near.reduce((s, p) => s + p[1], 0) / (near.length || 1)];
    };
    const segmentTexts = [];
    const grid = options.grid === undefined ? doc.grid : options.grid;
    if (grid && grid.step) {
      const step = grid.step;
      if ((spanX / step + spanY / step) < 500) {
        for (let x = Math.ceil(world.x0 / step) * step; x <= world.x1; x += step) line(toScreen([x, world.y0]), toScreen([x, world.y1]), ' class="grid"');
        for (let y = Math.ceil(world.y0 / step) * step; y <= world.y1; y += step) line(toScreen([world.x0, y]), toScreen([world.x1, y]), ' class="grid"');
      }
    }
    for (const [i, it] of doc.items.entries()) {
      if (['segment', 'line', 'ray'].includes(it.type)) {
        const pair = it.type === 'segment' ? [xy(it.a), xy(it.b)] : clipLine(xy(it.a), xy(it.b), world, it.type === 'ray');
        if (!pair) continue;
        const a = toScreen(pair[0]), b = toScreen(pair[1]); line(a, b, it.dash ? ' stroke-dasharray="4 3"' : '');
        if (it.type === 'segment') {
          if (it.arrows) { arrow(b, a); if (it.arrows === 'both') arrow(a, b); }
          const v = unit(minus(b, a)), n = [-v[1], v[0]], mid = mul(add(a, b), .5);
          for (const [count, diagonal] of [[it.ticks, true], [it.parallel, false]]) if (count) for (let j = 0; j < count; j++) {
            const c = add(mid, mul(v, (j - (count - 1) / 2) * 5));
            const q = diagonal ? unit(add(n, mul(v, .5))) : n;
            line(add(c, mul(q, -5)), add(c, mul(q, 5)));
          }
          // A symbol beside the segment (㉠, a, 6 cm): placed after every line is known.
          const symbol = shown(it, '');
          if (symbol) segmentTexts.push({ it, i, a, b, symbol });
          if (it.question && it.value === undefined) warnings.push({ code: 'answer-missing', item: i, message: '문제로 표시한 선분에 정답 value가 없습니다.' });
        }
      } else if (it.type === 'polygon') {
        const q = it.points.map(P); shapes.push(`<polygon points="${q.map((p) => p.map(num).join(',')).join(' ')}" fill="${it.fill === 'light' ? light : 'none'}"/>`);
        for (let j = 0; j < q.length; j++) strokes.push([q[j], q[(j + 1) % q.length]]);
      } else if (it.type === 'circle') {
        const c = P(it.center), r = (it.r ?? dist(xy(it.center), xy(it.through))) * actualScale;
        shapes.push(`<circle cx="${c[0]}" cy="${c[1]}" r="${num(r)}" fill="${it.fill === 'light' ? light : 'none'}"/>`);
      } else if (it.type === 'arc' || it.type === 'sector') {
        const c = xy(it.center), a = xy(it.from), b = xy(it.to), r = dist(c, a);
        if (Math.abs(dist(c, b) - r) > Math.max(1e-6, r * .001)) warnings.push({ code: 'arc-radius', item: i, message: '호의 두 끝점이 중심에서 같은 거리에 있지 않습니다.' });
        const ac = Math.atan2(a[1] - c[1], a[0] - c[0]), bc = Math.atan2(b[1] - c[1], b[0] - c[0]);
        const ccw = it.ccw !== false, sweep = ccw ? (bc - ac + Math.PI * 2) % (Math.PI * 2) : (ac - bc + Math.PI * 2) % (Math.PI * 2);
        const end = add(c, [r * Math.cos(bc), r * Math.sin(bc)]), start = P(it.from), stop = toScreen(end), center = P(it.center);
        const d = `${it.type === 'sector' ? `M ${center[0]} ${center[1]} L ` : 'M '}${start[0]} ${start[1]} A ${num(r * actualScale)} ${num(r * actualScale)} 0 ${sweep > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${stop[0]} ${stop[1]}${it.type === 'sector' ? ' Z' : ''}`;
        path(d, ` fill="${it.fill === 'light' ? light : 'none'}"`);
      } else if (it.type === 'angle') {
        const c = P(it.at), u = unit(minus(P(it.from), c)), v = unit(minus(P(it.to), c)), radius = 19;
        const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
        const a0 = Math.atan2(u[1], u[0]), a1 = Math.atan2(v[1], v[0]);
        const delta = ((a1 - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        if (it.mark === 'right' && Math.abs(dot) > .015) warnings.push({ code: 'right-angle', item: i, message: '직각 표시의 두 선이 좌표상 직각이 아닙니다.' });
        if (it.mark === 'right') {
          const x = add(c, mul(u, radius)), y = add(c, mul(v, radius)), z = add(x, mul(v, radius));
          path(`M ${x[0]} ${x[1]} L ${num(z[0])} ${num(z[1])} L ${y[0]} ${y[1]}`);
        } else {
          for (let j = 0; j < (it.arcs || 1); j++) {
            const rr = radius + j * 5, p = add(c, mul(u, rr)), q = add(c, mul(v, rr));
            path(`M ${num(p[0])} ${num(p[1])} A ${rr} ${rr} 0 0 ${delta >= 0 ? 1 : 0} ${num(q[0])} ${num(q[1])}`);
          }
        }
        const label = shown(it, '');
        if (label) text(add(c, [Math.cos(a0 + delta / 2) * 34, Math.sin(a0 + delta / 2) * 34]), label, it.question && options.answers ? ' fill="#b3261e" font-weight="700"' : '');
        if (it.question && it.value === undefined) warnings.push({ code: 'answer-missing', item: i, message: '문제 각에 정답 value가 없습니다.' });
        if (doc.toScale && (it.value !== undefined || it.label !== undefined)) {
          const stated = Number(String(it.value ?? it.label).match(/^-?\d+(?:\.\d+)?/)?.[0]);
          if (Number.isFinite(stated) && Math.abs(stated - Math.abs(delta) * 180 / Math.PI) > 1)
            warnings.push({ code: 'angle-scale', item: i, message: '실제 비율 도형의 각도 값이 좌표의 각도와 다릅니다.' });
        }
      } else if (it.type === 'dim') {
        const a = P(it.a), b = P(it.b), v = unit(minus(b, a)), n = [-v[1], v[0]], off = it.offset ?? 25;
        const centerScreen = toScreen(centerFor(it.a, it.b)), middle = mul(add(a, b), .5);
        const outward = (minus(middle, centerScreen)[0] * n[0] + minus(middle, centerScreen)[1] * n[1]) >= 0 ? 1 : -1;
        const side = outward * (off < 0 ? -1 : 1), signed = side * Math.abs(off);
        const da = add(a, mul(n, signed)), db = add(b, mul(n, signed));
        if (it.style !== 'text') {
          line(a, add(da, mul(n, side * 4))); line(b, add(db, mul(n, side * 4))); line(da, db);
          if (dist(da, db) > 25) { arrow(da, db); arrow(db, da); }
        }
        const measured = num(dist(xy(it.a), xy(it.b)) * doc.unit) + (doc.unitLabel ? ' ' + doc.unitLabel : '');
        const label = shown(it, measured);
        const textGap = fontSize * .85 + 3 + Math.abs(n[0]) * labelWidth(label) / 2;
        let labelAt = add(it.style === 'text' ? middle : mul(add(da, db), .5), mul(n, side * textGap));
        if (it.style === 'text') {
          let best = { at: labelAt, score: Infinity };
          for (const dir of [side, -side]) for (const shift of [15, 22, 30, 40]) for (const along of [0, -7, 7]) {
            const at = add(add(middle, mul(n, dir * shift)), mul(v, along));
            const score = labelPenalty(at, label) + shift * .04 + (dir === side ? 0 : 1) + Math.abs(along) * .03;
            if (score < best.score) best = { at, score };
          }
          labelAt = best.at;
        }
        text(labelAt, label, it.question && options.answers ? ' fill="#b3261e" font-weight="700"' : '');
        if (it.question && it.value === undefined) warnings.push({ code: 'answer-missing', item: i, message: '문제 치수에 정답 value가 없습니다.' });
        if (doc.toScale && (it.value !== undefined || it.label !== undefined)) {
          const stated = Number(String(it.value ?? it.label).match(/^-?\d+(?:\.\d+)?/)?.[0]);
          if (Number.isFinite(stated) && Math.abs(stated - dist(xy(it.a), xy(it.b)) * doc.unit) > .01)
            warnings.push({ code: 'dimension-scale', item: i, message: '실제 비율 도형의 치수 값이 좌표 거리와 다릅니다.' });
        }
      } else if (it.type === 'text') text(toScreen(xy(it.at)), it.text);
    }
    for (const { it, a, b, symbol } of segmentTexts) {
      const v = unit(minus(b, a)), n = [-v[1], v[0]], middle = mul(add(a, b), .5), c = toScreen(centerFor(it.a, it.b));
      const outward = (middle[0] - c[0]) * n[0] + (middle[1] - c[1]) * n[1] >= 0 ? 1 : -1, reachOut = Math.abs(n[0]) * labelWidth(symbol) / 2 + Math.abs(n[1]) * fontSize / 2;
      let best = null;
      for (const dir of [outward, -outward]) for (const shift of [5, 9, 14, 20]) for (const along of [0, -8, 8]) {
        const at = add(add(middle, mul(n, dir * (shift + reachOut))), mul(v, along));
        const score = labelPenalty(at, symbol) + shift * .05 + (dir === outward ? 0 : .6) + Math.abs(along) * .05;
        if (!best || score < best.score) best = { at, score };
      }
      text(best.at, symbol, it.question && options.answers ? ' fill="#b3261e" font-weight="700"' : '');
    }
    const center = [doc.points.reduce((s, p) => s + p.at[0], 0) / (doc.points.length || 1), doc.points.reduce((s, p) => s + p.at[1], 0) / (doc.points.length || 1)];
    for (const p of doc.points) {
      const screen = P(p.id);
      if (p.show) shapes.push(`<circle cx="${screen[0]}" cy="${screen[1]}" r="2.3" fill="${color}" stroke="none"/>`);
      if (!p.label) continue;
      const angle = p.labelAt === undefined || p.labelAt === 'auto' ? Math.atan2(p.at[1] - center[1], p.at[0] - center[0]) : p.labelAt * Math.PI / 180;
      let best = null;
      candidates: for (const turn of [0, 45, -45, 90, -90, 135, -135, 180]) for (const radius of [15, 21, 27]) {
        const a = angle + turn * Math.PI / 180, at = add(screen, [Math.cos(a) * radius, -Math.sin(a) * radius]);
        const penalty = labelPenalty(at, p.label, fontSize * 1.12) + radius * .05 + Math.abs(turn) * .005;
        if (!best || penalty < best.penalty) best = { at, penalty };
        if (penalty < 2) break candidates;
      }
      text(best.at, p.label, ` font-size="${num(fontSize * 1.12)}"`);
    }
    // Refit automatic exports to the union of geometry, dimension strokes and text boxes.
    if (!fixed && (options._fitPass || 0) < 5) {
      let x0 = ox, x1 = ox + spanX * actualScale, y0 = height - oy - spanY * actualScale, y1 = height - oy;
      for (const [a, b] of strokes) {
        x0 = Math.min(x0, a[0], b[0]); x1 = Math.max(x1, a[0], b[0]);
        y0 = Math.min(y0, a[1], b[1]); y1 = Math.max(y1, a[1], b[1]);
      }
      for (const l of labels) {
        const size = l.extra.includes('font-size=') ? fontSize * 1.12 : fontSize, half = labelWidth(l.value, size) / 2 + 2;
        x0 = Math.min(x0, l.p[0] - half); x1 = Math.max(x1, l.p[0] + half);
        y0 = Math.min(y0, l.p[1] - size * .65 - 2); y1 = Math.max(y1, l.p[1] + size * .65 + 2);
      }
      const grow = [Math.max(0, 6 - x0), Math.max(0, x1 + 6 - width), Math.max(0, 6 - y0), Math.max(0, y1 + 6 - height)];
      if (grow.some((v) => v > .5)) return scene(doc, { ...options, _pads: pads.map((v, i) => v + Math.ceil(grow[i] + 1)), _fitPass: (options._fitPass || 0) + 1 });
    }
    // Warn about label collisions without changing the semantic positions in the document.
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j], aw = labelWidth(a.value), bw = labelWidth(b.value);
      if (Math.abs(a.p[0] - b.p[0]) < (aw + bw) / 2 && Math.abs(a.p[1] - b.p[1]) < fontSize) warnings.push({ code: 'label-overlap', labels: [a.value, b.value], message: '그림의 글자가 겹칩니다.' });
    }
    for (const l of labels) {
      const half = labelWidth(l.value) / 2;
      if (l.p[0] - half < 0 || l.p[0] + half > width || l.p[1] - fontSize * .6 < 0 || l.p[1] + fontSize * .6 > height)
        warnings.push({ code: 'label-off-canvas', label: l.value, message: '글자가 그림 경계 밖으로 나갑니다. 크기나 이름 위치를 조정하세요.' });
    }
    return { doc, width: num(width), height: num(height), fontSize, color, light, style, shapes, labels, warnings, world, toScreen, toModel };
  }

  function toSvg(s, options = {}) {
    if (!s || !s.shapes || !s.labels) fail('toSvg에는 scene() 결과가 필요합니다.');
    const background = options.background ?? 'white';
    if (!['white', 'none'].includes(background)) fail('background는 white 또는 none이어야 합니다.');
    const title = options.title ? `<title>${esc(options.title)}</title>` : '';
    const labels = s.labels.map((l) => `<text x="${num(l.p[0])}" y="${num(l.p[1])}"${l.extra}>${esc(l.value)}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width} ${s.height}" width="${s.width}" height="${s.height}" role="img">${title}${background === 'white' ? `<rect width="100%" height="100%" fill="#fff"/>` : ''}<g fill="none" stroke="${s.color}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><g class="grid" stroke="#d5d5d5" stroke-width=".6">${s.shapes.filter((v) => v.includes('class="grid"')).join('')}</g>${s.shapes.filter((v) => !v.includes('class="grid"')).join('')}</g><g font-family="${esc(FONT)}" font-size="${s.fontSize}" text-anchor="middle" dominant-baseline="middle" fill="${s.color}" paint-order="stroke" stroke="#fff" stroke-width="2.5" stroke-linejoin="round">${labels}</g></svg>`;
  }
  function renderSvg(data, options = {}) { return toSvg(scene(data, options), options); }
  function check(data, options = {}) {
    try { const s = scene(data, options); return { ok: true, errors: [], warnings: s.warnings, info: { points: s.doc.points.length, items: s.doc.items.length, size: [s.width, s.height] } }; }
    catch (e) { return { ok: false, errors: [{ code: 'invalid', message: e.message }], warnings: [] }; }
  }
  const api = { FORMAT, VERSION, validate, resolve, meet, scene, toSvg, renderSvg, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolidDiagram = api;
})(typeof window !== 'undefined' ? window : globalThis);
