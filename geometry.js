(function (root) {
  'use strict';
  const MAX_BLOCKS = 100000;
  const COORD_LIMIT = 500;
  const key = (p) => p.join(',');
  const point = (s) => s.split(',').map(Number);
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, n) => a.map((v) => v * n);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const length = (a) => Math.hypot(...a);
  const directions = [
    { n: [1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
    { n: [-1, 0, 0], corners: [[0,1,0],[0,0,0],[0,0,1],[0,1,1]] },
    { n: [0, 1, 0], corners: [[1,1,0],[0,1,0],[0,1,1],[1,1,1]] },
    { n: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
    { n: [0, 0, 1], corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
    { n: [0, 0, -1], corners: [[0,1,0],[1,1,0],[1,0,0],[0,0,0]] }
  ];

  function bounds(cells) {
    if (!cells.size) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const cell of cells) {
      const p = point(cell);
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i] + 1); }
    }
    return { min, max, size: sub(max, min), center: mul(add(min, max), .5) };
  }

  function validateRegion(start, size) {
    if (!start.every((v) => Number.isInteger(v) && Math.abs(v) <= COORD_LIMIT)) throw new Error('시작 좌표는 -500부터 500 사이의 정수로 입력해 주세요.');
    if (!size.every((v) => Number.isInteger(v) && v >= 1 && v <= 100)) throw new Error('가로·세로·높이는 1부터 100 사이의 블록 수로 입력해 주세요.');
    if (size.reduce((a, b) => a * b, 1) > MAX_BLOCKS) throw new Error('한 번에 만들 수 있는 영역은 100,000칸까지입니다.');
    if (start.some((v, i) => Math.abs(v + size[i]) > COORD_LIMIT)) throw new Error('영역의 끝 좌표가 편집 범위(-500~500)를 벗어납니다.');
  }

  function editRegion(cells, start, size, mode) {
    validateRegion(start, size);
    const next = new Set(cells);
    let changed = 0;
    for (let x = start[0]; x < start[0] + size[0]; x++) {
      for (let y = start[1]; y < start[1] + size[1]; y++) {
        for (let z = start[2]; z < start[2] + size[2]; z++) {
          const k = key([x, y, z]);
          if (mode === 'remove') { if (next.delete(k)) changed++; }
          else if (!next.has(k)) { next.add(k); changed++; }
          if (next.size > MAX_BLOCKS) throw new Error('도형 하나에는 최대 100,000개 블록을 담을 수 있습니다.');
        }
      }
    }
    return { cells: next, changed };
  }

  function cuboid(size) { return editRegion(new Set(), [0, 0, 0], size, 'add').cells; }

  function extractSurface(cells) {
    const faces = [], edges = new Map();
    for (const cell of cells) {
      const p = point(cell);
      for (const d of directions) {
        if (cells.has(key(add(p, d.n)))) continue;
        const vertices = d.corners.map((v) => add(p, v));
        faces.push({ vertices, n: d.n, center: add(p, d.n.map((v) => .5 + v * .5)) });
        for (let i = 0; i < 4; i++) {
          let a = vertices[i], b = vertices[(i + 1) % 4];
          const axis = a.findIndex((v, j) => v !== b[j]);
          if (a[axis] > b[axis]) [a, b] = [b, a];
          const id = key(a) + ':' + key(b);
          if (!edges.has(id)) edges.set(id, { a, b, axis, normals: new Set() });
          edges.get(id).normals.add(key(d.n));
        }
      }
    }
    const featureUnits = new Map([...edges].filter(([, e]) => e.normals.size > 1));
    const lines = new Map();
    for (const e of featureUnits.values()) {
      const lineId = e.axis + ':' + e.a.filter((_, i) => i !== e.axis).join(',');
      if (!lines.has(lineId)) lines.set(lineId, []);
      lines.get(lineId).push(e);
    }
    const merged = [];
    for (const units of lines.values()) {
      units.sort((a, b) => a.a[a.axis] - b.a[b.axis]);
      let run = null;
      for (const e of units) {
        if (run && run.b[e.axis] === e.a[e.axis]) run.b = e.b;
        else {
          if (run) merged.push(run);
          run = { a: e.a, b: e.b, axis: e.axis };
        }
      }
      if (run) merged.push(run);
    }
    for (const e of merged) { e.id = key(e.a) + ':' + key(e.b); e.length = length(sub(e.b, e.a)); }
    return { faces, edges: merged, featureUnits, surfaceArea: faces.length };
  }

  function basis(yaw, pitch) {
    return {
      right: [Math.sin(yaw), -Math.cos(yaw), 0],
      up: [-Math.cos(yaw) * Math.sin(pitch), -Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch)],
      normal: [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)]
    };
  }

  function raycast(cells, box, origin, direction) {
    if (!box || !cells.size) return null;
    let enter = -Infinity, exit = Infinity, entryAxis = 0;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(direction[i]) < 1e-9) {
        if (origin[i] < box.min[i] || origin[i] >= box.max[i]) return null;
        continue;
      }
      const a = (box.min[i] - origin[i]) / direction[i], b = (box.max[i] - origin[i]) / direction[i];
      const near = Math.min(a, b), far = Math.max(a, b);
      if (near > enter) { enter = near; entryAxis = i; }
      exit = Math.min(exit, far);
    }
    if (exit < Math.max(enter, 0)) return null;
    let t = Math.max(enter, 0);
    const p = add(origin, mul(direction, t + 1e-6));
    const cell = p.map(Math.floor), step = direction.map((v) => Math.sign(v));
    const delta = direction.map((v) => Math.abs(v) < 1e-9 ? Infinity : Math.abs(1 / v));
    const next = cell.map((v, i) => Math.abs(direction[i]) < 1e-9 ? Infinity : ((step[i] > 0 ? v + 1 : v) - origin[i]) / direction[i]);
    let normal = [0, 0, 0]; normal[entryAxis] = -step[entryAxis];
    for (let count = 0; count < 3100 && t <= exit + 1e-6; count++) {
      if (cells.has(key(cell))) return { cell: [...cell], normal, point: add(origin, mul(direction, t)), t };
      let axis = next[0] <= next[1] ? 0 : 1;
      if (next[2] < next[axis]) axis = 2;
      t = next[axis]; cell[axis] += step[axis]; next[axis] += delta[axis];
      normal = [0, 0, 0]; normal[axis] = -step[axis];
    }
    return null;
  }

  function brushRegion(hit, size, mode) {
    const start = hit.cell.map((v, i) => v - Math.floor((size[i] - 1) / 2));
    const axis = hit.normal.findIndex((v) => v !== 0);
    if (axis >= 0) {
      if (mode === 'add') start[axis] = hit.normal[axis] > 0 ? hit.cell[axis] + 1 : hit.cell[axis] - size[axis];
      else start[axis] = hit.normal[axis] > 0 ? hit.cell[axis] - size[axis] + 1 : hit.cell[axis];
    }
    return { start, size };
  }

  // The interval is cut at every coordinate where any row changes occupancy. Each piece keeps
  // at least one cell, so resizing never deletes a column, a thin wall or a hidden cavity.
  // Pieces share their new boundaries across rows, so faces stay aligned. Points outside the
  // interval translate with its moving end.
  function resizeInterval(cells, axis, lo, hi, newSpan, anchor = 'start') {
    if (![0, 1, 2].includes(axis) || !Number.isInteger(lo) || !Number.isInteger(hi) || hi <= lo || !Number.isInteger(newSpan) || newSpan < 1) throw new Error('축과 치수 구간이 올바르지 않습니다.');
    const oldSpan = hi - lo, delta = newSpan - oldSpan;
    const newLo = anchor === 'end' ? hi - newSpan : lo;
    const cuts = new Set([lo, hi]);
    for (const cell of cells) {
      const p = point(cell), v = p[axis];
      for (const [boundary, neighbour] of [[v, v - 1], [v + 1, v + 1]]) {
        if (boundary <= lo || boundary >= hi) continue;
        const q = [...p]; q[axis] = neighbour;
        if (!cells.has(key(q))) cuts.add(boundary);
      }
    }
    const breaks = [...cuts].sort((a, b) => a - b), pieces = breaks.length - 1;
    if (newSpan < pieces) {
      const error = new Error('이 구간은 모양이 ' + pieces + '조각으로 나뉘어 있어 최소 ' + pieces + '칸이어야 모양을 유지합니다.');
      error.minSpan = pieces; throw error;
    }
    const lengths = breaks.slice(1).map((b, i) => b - breaks[i]);
    const targets = lengths.map((l) => l * newSpan / oldSpan);
    const alloc = targets.map((t) => Math.max(1, Math.floor(t + 1e-9)));
    let total = alloc.reduce((a, b) => a + b, 0);
    while (total > newSpan) {
      let best = -1;
      for (let i = 0; i < pieces; i++) if (alloc[i] > 1 && (best < 0 || alloc[i] - targets[i] > alloc[best] - targets[best])) best = i;
      alloc[best]--; total--;
    }
    while (total < newSpan) {
      let best = 0;
      for (let i = 1; i < pieces; i++) if (targets[i] - alloc[i] > targets[best] - alloc[best]) best = i;
      alloc[best]++; total++;
    }
    const starts = [newLo];
    for (const n of alloc) starts.push(starts[starts.length - 1] + n);
    const mapCoordinate = (v) => {
      if (v <= lo) return anchor === 'end' ? v - delta : v;
      if (v >= hi) return anchor === 'end' ? v : v + delta;
      let i = 0; while (breaks[i + 1] < v) i++;
      return starts[i] + Math.round((v - breaks[i]) * alloc[i] / lengths[i]);
    };
    const next = new Set();
    for (const cell of cells) {
      const p = point(cell), v = p[axis];
      if (v < lo || v >= hi) {
        p[axis] = mapCoordinate(v);
        if (Math.abs(p[axis]) > COORD_LIMIT || p[axis] + 1 > COORD_LIMIT) throw new Error('변경한 도형이 편집 범위(-500~500)를 벗어납니다.');
        next.add(key(p)); continue;
      }
      const i = breaks.indexOf(v);
      if (i < 0) continue; // Only the first cell of a piece carries it; the piece is uniform.
      for (let u = starts[i]; u < starts[i + 1]; u++) {
        if (u < -COORD_LIMIT || u + 1 > COORD_LIMIT) throw new Error('변경한 도형이 편집 범위(-500~500)를 벗어납니다.');
        const q = [...p]; q[axis] = u; next.add(key(q));
      }
      if (next.size > MAX_BLOCKS) throw new Error('치수를 늘린 결과가 100,000개 블록을 초과합니다.');
    }
    const mapPoint = (p) => p.map((v, i) => i === axis ? mapCoordinate(v) : v);
    // Points and segment ends stretch with their piece instead of snapping to the grid, so a
    // crossing or a midpoint stays one after resizing (corners land on whole numbers anyway).
    const mapExact = (v) => {
      if (v <= lo) return anchor === 'end' ? v - delta : v;
      if (v >= hi) return anchor === 'end' ? v : v + delta;
      let i = 0; while (breaks[i + 1] < v) i++;
      return starts[i] + (v - breaks[i]) * alloc[i] / lengths[i];
    };
    const mapFree = (p) => p.map((v, i) => i !== axis ? v : Number(mapExact(v).toFixed(9)));
    return { cells: next, mapPoint, mapFree, pieces };
  }

  const UNIT_LABELS = ['cm', 'mm', 'm', '칸'];
  const STYLES = ['color', 'print'];
  const DIM_STYLES = ['line', 'text'];
  const BOOLEAN_SETTINGS = ['grid', 'floor', 'overall', 'annotations', 'hidden', 'labels'];
  const SETTING_DEFAULTS = { grid: true, floor: true, overall: true, annotations: true, hidden: false, labels: true, style: 'color', dimStyle: 'line' };
  const invalid = (text) => { throw new Error(text); };
  const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => Number.isInteger(v) && Math.abs(v) <= COORD_LIMIT);
  const textValue = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 30 && !/[\u0000-\u001f]/.test(v);

  function labelFields(d, where) {
    const result = {};
    if (d.label !== undefined) { if (!textValue(d.label)) invalid(where + '.label은 1~30자의 글자여야 합니다. 예: "?", "㉠", "x cm"'); result.label = d.label; }
    if (d.question !== undefined) { if (typeof d.question !== 'boolean') invalid(where + '.question은 true 또는 false여야 합니다.'); if (d.question) result.question = true; }
    return result;
  }

  // --- Points and auxiliary segments --------------------------------------------------------
  // A point may sit anywhere on the figure (a midpoint is x.5). "on" places it between two
  // points (t = 0.5 is the middle) and "cross" where two lines meet, so it follows them when the
  // solid is resized. Vertex names (labels) are points too, and segments may join any of them.
  const MARK_ID = /^[\p{L}\p{N}_-]{1,30}$/u;
  const SEGMENT_STYLES = ['solid', 'dash', 'bold', 'none'];
  const BEHIND_STYLES = ['dash', 'hide', 'same'];
  const isCoord = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT);
  const tidy = (v) => { const r = Number(v.toFixed(9)); return Object.is(r, -0) ? 0 : r; };
  const copyRef = (r) => Array.isArray(r) ? [...r] : r;

  // Where the lines AB and CD meet, or null when they are parallel or skew.
  function lineCross(a, b, c, d) {
    const u = sub(b, a), v = sub(d, c), w = sub(a, c);
    const A = dot(u, u), B = dot(u, v), C = dot(v, v), D = dot(u, w), E = dot(v, w), den = A * C - B * B;
    if (A < 1e-12 || C < 1e-12 || den < 1e-9 * A * C) return null;
    const s = (B * E - C * D) / den, t = (A * E - B * D) / den;
    const p = add(a, mul(u, s)), q = add(c, mul(v, t));
    return length(sub(p, q)) > 1e-6 * Math.max(1, Math.sqrt(A), Math.sqrt(C)) ? null : mul(add(p, q), .5);
  }

  function resolveMarks(labels, pointList, segmentList) {
    if (pointList !== undefined && (!Array.isArray(pointList) || pointList.length > 200)) invalid('points는 200개 이하의 배열이어야 합니다.');
    if (segmentList !== undefined && (!Array.isArray(segmentList) || segmentList.length > 200)) invalid('segments는 200개 이하의 배열이어야 합니다.');
    const resolved = new Map(labels.map((l) => [l.id, l.at])), defs = new Map(), busy = new Set();
    (pointList || []).forEach((p, index) => {
      const where = 'points[' + index + ']';
      if (!p || typeof p !== 'object' || Array.isArray(p)) invalid(where + '는 {id, at} 객체여야 합니다.');
      const id = p.id ?? 'point-' + (index + 1);
      if (typeof id !== 'string' || !MARK_ID.test(id) || resolved.has(id) || defs.has(id)) invalid(where + '.id는 중복 없는 1~30자 이름(글자·숫자·_·-)이어야 하고 labels의 id와도 달라야 합니다.');
      if (['at', 'on', 'cross'].filter((k) => p[k] !== undefined).length !== 1) invalid(where + '에는 위치 at, on, cross 중 하나만 넣어야 합니다.');
      if (p.t !== undefined && (p.on === undefined || typeof p.t !== 'number' || !(p.t >= 0 && p.t <= 1))) invalid(where + '.t는 on과 함께 쓰는 0~1 사이 비율입니다 (0.5 = 가운데).');
      if (p.label !== undefined && (!textValue(p.label) || p.label.length > 12)) invalid(where + '.label은 1~12자여야 합니다. 예: "ㄱ", "M"');
      if (p.dot !== undefined && typeof p.dot !== 'boolean') invalid(where + '.dot은 true 또는 false여야 합니다.');
      if (p.labelAt !== undefined && !(typeof p.labelAt === 'number' && Number.isFinite(p.labelAt))) invalid(where + '.labelAt은 이름을 둘 방향(도, 0 = 오른쪽, 90 = 위)입니다.');
      if (p.visible !== undefined && typeof p.visible !== 'boolean') invalid(where + '.visible은 true 또는 false여야 합니다.');
      defs.set(id, { p, where });
    });
    const ref = (r, where) => {
      if (isCoord(r)) return r.map(tidy);
      if (typeof r === 'string' && (resolved.has(r) || defs.has(r))) return locate(r);
      return invalid(where + '는 점 id 또는 [x,y,z] 좌표여야 합니다: ' + JSON.stringify(r));
    };
    const locate = (id) => {
      if (resolved.has(id)) return resolved.get(id);
      if (busy.has(id)) invalid('점 ' + id + '의 위치가 서로를 참조합니다(순환).');
      busy.add(id);
      const { p, where } = defs.get(id);
      let at;
      if (p.at !== undefined) {
        if (!isCoord(p.at)) invalid(where + '.at은 [x,y,z] 숫자 3개(-500~500)여야 합니다. 모서리 가운데는 2.5처럼 씁니다.');
        at = p.at;
      } else if (p.on !== undefined) {
        if (!Array.isArray(p.on) || p.on.length !== 2) invalid(where + '.on은 [점1, 점2]입니다. 두 점을 잇는 선분 위 비율 t(기본 0.5) 자리에 놓입니다.');
        const a = ref(p.on[0], where + '.on[0]'), b = ref(p.on[1], where + '.on[1]'), t = p.t ?? .5;
        at = a.map((v, i) => v + (b[i] - v) * t);
      } else {
        if (!Array.isArray(p.cross) || p.cross.length !== 2 || !p.cross.every((l) => Array.isArray(l) && l.length === 2)) invalid(where + '.cross는 [[점1, 점2], [점3, 점4]] 두 직선입니다.');
        const [[a, b], [c, d]] = p.cross.map((l, i) => l.map((r, j) => ref(r, where + '.cross[' + i + '][' + j + ']')));
        at = lineCross(a, b, c, d);
        if (!at) invalid(where + '.cross의 두 직선이 한 점에서 만나지 않습니다 (평행하거나 꼬인 위치).');
      }
      at = at.map(tidy);
      busy.delete(id); resolved.set(id, at); return at;
    };
    const points = [...defs].map(([id, { p }]) => ({
      id, at: locate(id), def: p.at !== undefined ? { at: [...p.at] } : p.on !== undefined ? { on: p.on.map(copyRef), ...(p.t !== undefined ? { t: p.t } : {}) } : { cross: p.cross.map((l) => l.map(copyRef)) },
      ...(p.label !== undefined ? { label: p.label } : {}), dot: p.dot !== false, ...(p.labelAt !== undefined ? { labelAt: p.labelAt } : {}), visible: p.visible !== false
    }));
    const segmentIds = new Set();
    const segments = (segmentList || []).map((s, index) => {
      const where = 'segments[' + index + ']';
      if (!s || typeof s !== 'object' || Array.isArray(s)) invalid(where + '는 {a, b} 객체여야 합니다.');
      const id = s.id ?? 'seg-' + (index + 1);
      if (typeof id !== 'string' || !MARK_ID.test(id) || segmentIds.has(id)) invalid(where + '.id는 중복 없는 1~30자 이름(글자·숫자·_·-)이어야 합니다.');
      segmentIds.add(id);
      const from = ref(s.a, where + '.a'), to = ref(s.b, where + '.b');
      if (length(sub(to, from)) < 1e-9) invalid(where + '의 두 끝점이 같습니다.');
      if (s.style !== undefined && !SEGMENT_STYLES.includes(s.style)) invalid(where + '.style은 solid(실선), dash(점선), bold(굵은 선), none(선 없이 기호만) 중 하나입니다.');
      if (s.behind !== undefined && !BEHIND_STYLES.includes(s.behind)) invalid(where + '.behind는 dash(가려진 부분 점선), hide(가려진 부분 숨김), same(가려져도 그대로) 중 하나입니다.');
      if (s.label !== undefined && !textValue(s.label)) invalid(where + '.label은 1~30자의 글자여야 합니다. 예: "㉠", "a", "6 cm"');
      if (s.ticks !== undefined && ![1, 2, 3].includes(s.ticks)) invalid(where + '.ticks(같은 길이 표시)는 1~3입니다.');
      if (s.visible !== undefined && typeof s.visible !== 'boolean') invalid(where + '.visible은 true 또는 false여야 합니다.');
      return { id, a: copyRef(s.a), b: copyRef(s.b), from, to, style: s.style ?? 'solid', behind: s.behind ?? 'dash',
        ...(s.label !== undefined ? { label: s.label } : {}), ...(s.ticks ? { ticks: s.ticks } : {}), visible: s.visible !== false };
    });
    return { points, segments };
  }
  // Saved form: the definition (at, on or cross), never the derived coordinates.
  const encodePoint = (p) => ({ id: p.id, ...JSON.parse(JSON.stringify(p.def)), ...(p.label !== undefined ? { label: p.label } : {}), dot: p.dot, ...(p.labelAt !== undefined ? { labelAt: p.labelAt } : {}), visible: p.visible });
  const encodeSegment = (s) => ({ id: s.id, a: copyRef(s.a), b: copyRef(s.b), style: s.style, behind: s.behind, ...(s.label !== undefined ? { label: s.label } : {}), ...(s.ticks ? { ticks: s.ticks } : {}), visible: s.visible });
  // Move every coordinate written in points and segments (ids follow their own points).
  function mapMarks(data, map) {
    const ref = (r) => Array.isArray(r) ? map(r) : r;
    return {
      points: (data.points || []).map((p) => ({ ...p, ...(p.at ? { at: map(p.at) } : {}), ...(p.on ? { on: p.on.map(ref) } : {}), ...(p.cross ? { cross: p.cross.map((l) => l.map(ref)) } : {}) })),
      segments: (data.segments || []).map((s) => ({ ...s, a: ref(s.a), b: ref(s.b) }))
    };
  }

  function validateProject(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('도형 JSON 객체가 필요합니다.');
    if (data.format !== 'yeonjun-solid-editor') invalid('format은 "yeonjun-solid-editor"여야 합니다.');
    if (![1, 2].includes(data.version)) invalid('version은 숫자 1 또는 2여야 합니다. (문자열 "2"는 안 됩니다)');
    const cells = new Set();
    if (data.boxes !== undefined && data.blocks !== undefined) invalid('boxes와 blocks 중 하나만 넣어야 합니다.');
    if (data.boxes !== undefined) {
      if (data.version !== 2) invalid('boxes는 version 2에서만 쓸 수 있습니다.');
      if (!Array.isArray(data.boxes) || data.boxes.length > MAX_BLOCKS) invalid('boxes는 [x,y,z,가로,세로,높이] 배열의 목록이어야 합니다.');
      let total = 0;
      data.boxes.forEach((box, index) => {
        const where = 'boxes[' + index + ']';
        if (!Array.isArray(box) || box.length !== 6 || !box.every(Number.isInteger)) invalid(where + '는 [x,y,z,가로,세로,높이]의 정수 6개여야 합니다.');
        const start = box.slice(0, 3), size = box.slice(3);
        if (start.some((v, i) => v < -COORD_LIMIT || v >= COORD_LIMIT || size[i] < 1 || size[i] > 1000 || v + size[i] > COORD_LIMIT)) invalid(where + '가 편집 좌표 범위(-500~500)를 벗어나거나 크기가 1 미만입니다.');
        total += size[0] * size[1] * size[2];
        if (total > MAX_BLOCKS) invalid('도형은 최대 100,000블록까지입니다.');
        for (let x = start[0]; x < start[0] + size[0]; x++) for (let y = start[1]; y < start[1] + size[1]; y++) for (let z = start[2]; z < start[2] + size[2]; z++) {
          const id = key([x, y, z]);
          if (cells.has(id)) invalid(where + '가 앞의 상자와 겹칩니다 (' + id + '). 상자는 서로 겹치지 않아야 합니다. 더하기·빼기로 만들려면 model-tools.cjs build의 shape를 쓰세요.');
          cells.add(id);
        }
      });
    } else {
      if (!Array.isArray(data.blocks) || data.blocks.length > MAX_BLOCKS) invalid(data.version === 2 ? 'version 2에는 boxes 또는 blocks 목록이 필요합니다.' : 'version 1에는 blocks 목록이 필요합니다.');
      data.blocks.forEach((p, index) => {
        if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isInteger(v) && v >= -COORD_LIMIT && v < COORD_LIMIT)) invalid('blocks[' + index + ']는 -500~499 사이 정수 [x,y,z]여야 합니다.');
        cells.add(key(p));
      });
    }
    if (!Number.isFinite(data.unit) || data.unit < .001 || data.unit > 1000) invalid('unit(한 칸 길이)은 0.001~1000 사이의 숫자여야 합니다.');
    if (data.unitLabel !== undefined && !UNIT_LABELS.includes(data.unitLabel)) invalid('unitLabel은 cm, mm, m, 칸 중 하나여야 합니다.');
    const dimensions = [];
    if (data.dimensions !== undefined && (!Array.isArray(data.dimensions) || data.dimensions.length > 200)) invalid('dimensions는 200개 이하의 배열이어야 합니다. 치수가 없으면 []로 두세요.');
    const ids = new Set();
    (data.dimensions || []).forEach((d, index) => {
      const where = 'dimensions[' + index + ']';
      if (!d || typeof d !== 'object') invalid(where + '는 {id,a,b} 객체여야 합니다.');
      if (!isPoint(d.a) || !isPoint(d.b)) invalid(where + '.a와 .b는 격자 꼭짓점 좌표 [x,y,z] 정수 3개여야 합니다.');
      if (length(sub(d.b, d.a)) === 0) invalid(where + '의 두 끝점이 같습니다.');
      if (d.offset !== undefined && (!Number.isFinite(d.offset) || Math.abs(d.offset) > 2000)) invalid(where + '.offset은 -2000~2000 사이의 화면 픽셀 값이어야 합니다.');
      if (d.visible !== undefined && typeof d.visible !== 'boolean') invalid(where + '.visible은 true 또는 false여야 합니다.');
      let id = d.id;
      if (id === undefined) {
        id = 'saved-' + dimensions.length;
        while (ids.has(id)) id += '-legacy';
      }
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || id.startsWith('overall-') || ids.has(id)) invalid(where + '.id는 중복 없는 영문·숫자·밑줄·하이픈이어야 하고 overall-로 시작할 수 없습니다.');
      ids.add(id);
      dimensions.push({ id, a: [...d.a], b: [...d.b], offset: d.offset ?? 44, visible: d.visible !== false, ...labelFields(d, where) });
    });
    const overall = [0, 1, 2].map((axis) => ({ id: 'overall-' + axis, visible: true, offset: 46 }));
    if (data.overallDimensions !== undefined) {
      if (!Array.isArray(data.overallDimensions) || data.overallDimensions.length !== 3) invalid('overallDimensions는 X·Y·Z 순서의 3개 항목이어야 합니다.');
      data.overallDimensions.forEach((d, axis) => {
        const where = 'overallDimensions[' + axis + ']';
        if (!d || typeof d !== 'object' || (d.id !== undefined && d.id !== overall[axis].id)) invalid(where + '.id는 "' + overall[axis].id + '"여야 합니다.');
        if (d.visible !== undefined && typeof d.visible !== 'boolean') invalid(where + '.visible은 true 또는 false여야 합니다.');
        if (d.offset !== undefined && (!Number.isFinite(d.offset) || Math.abs(d.offset) > 2000)) invalid(where + '.offset은 -2000~2000 사이여야 합니다.');
        overall[axis] = { id: overall[axis].id, visible: d.visible !== false, offset: d.offset ?? 46, ...labelFields(d, where) };
      });
    }
    const labels = [];
    if (data.labels !== undefined && (!Array.isArray(data.labels) || data.labels.length > 200)) invalid('labels는 200개 이하의 배열이어야 합니다.');
    const labelIds = new Set();
    (data.labels || []).forEach((l, index) => {
      const where = 'labels[' + index + ']';
      if (!l || typeof l !== 'object' || !isPoint(l.at)) invalid(where + '.at은 꼭짓점 좌표 [x,y,z] 정수 3개여야 합니다.');
      if (!textValue(l.text) || l.text.length > 12) invalid(where + '.text는 1~12자여야 합니다. 예: "ㄱ", "A"');
      if (l.visible !== undefined && typeof l.visible !== 'boolean') invalid(where + '.visible은 true 또는 false여야 합니다.');
      const id = l.id ?? 'label-' + index;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || labelIds.has(id)) invalid(where + '.id는 중복 없는 영문·숫자·밑줄·하이픈이어야 합니다.');
      labelIds.add(id);
      labels.push({ id, at: [...l.at], text: l.text, visible: l.visible !== false });
    });
    const { points, segments } = resolveMarks(labels, data.points, data.segments);
    const settings = { ...SETTING_DEFAULTS }, source = data.settings ?? {};
    if (typeof source !== 'object' || Array.isArray(source)) invalid('settings는 객체여야 합니다.');
    for (const name of BOOLEAN_SETTINGS) if (source[name] !== undefined) {
      if (typeof source[name] !== 'boolean') invalid('settings.' + name + '는 true 또는 false여야 합니다.');
      settings[name] = source[name];
    }
    if (source.style !== undefined) { if (!STYLES.includes(source.style)) invalid('settings.style은 "color" 또는 "print"여야 합니다.'); settings.style = source.style; }
    if (source.dimStyle !== undefined) { if (!DIM_STYLES.includes(source.dimStyle)) invalid('settings.dimStyle은 "line" 또는 "text"여야 합니다.'); settings.dimStyle = source.dimStyle; }
    const view = data.view ?? {};
    if (typeof view !== 'object' || Array.isArray(view)) invalid('view는 {yaw, pitch} 객체여야 합니다.');
    for (const name of ['yaw', 'pitch']) if (view[name] !== undefined && !Number.isFinite(view[name])) invalid('view.' + name + '는 라디안 숫자여야 합니다.');
    if (view.projection !== undefined && !['orthographic', 'oblique'].includes(view.projection)) invalid('view.projection은 "orthographic" 또는 "oblique"(겨냥도)여야 합니다.');
    return {
      cells, unit: data.unit, unitLabel: data.unitLabel ?? 'cm', dimensions, overallDimensions: overall, labels, points, segments, settings,
      view: { yaw: view.yaw ?? .76, pitch: Math.max(-1.55, Math.min(1.5707963, view.pitch ?? .53)), ...(view.projection === 'oblique' ? { projection: 'oblique' } : {}) }
    };
  }

  // Lossless final occupancy, not an edit history. Cuboids never overlap.
  function packCells(cells) {
    const points = [...cells].map(point).sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    const remaining = new Set(cells), boxes = [];
    for (const [x, y, z] of points) {
      if (!remaining.has(key([x, y, z]))) continue;
      let w = 1, d = 1, h = 1;
      while (remaining.has(key([x + w, y, z]))) w++;
      const rowFull = (yy, zz) => {
        for (let xx = x; xx < x + w; xx++) if (!remaining.has(key([xx, yy, zz]))) return false;
        return true;
      };
      while (rowFull(y + d, z)) d++;
      const planeFull = (zz) => {
        for (let yy = y; yy < y + d; yy++) if (!rowFull(yy, zz)) return false;
        return true;
      };
      while (planeFull(z + h)) h++;
      for (let xx = x; xx < x + w; xx++) for (let yy = y; yy < y + d; yy++) for (let zz = z; zz < z + h; zz++) remaining.delete(key([xx, yy, zz]));
      boxes.push([x, y, z, w, d, h]);
    }
    // Sparse, isolated voxels may be smaller as coordinate triples.
    return JSON.stringify(boxes).length < JSON.stringify(points).length ? { boxes } : { blocks: points };
  }

  function encodeProject(data, legacy = false) {
    const p = validateProject(data), result = { ...data, version: legacy ? 1 : 2 };
    delete result.blocks; delete result.boxes; delete result.labels; delete result.points; delete result.segments;
    Object.assign(result, legacy ? { blocks: [...p.cells].map(point) } : packCells(p.cells));
    result.unitLabel = p.unitLabel;
    result.dimensions = p.dimensions; result.overallDimensions = p.overallDimensions;
    if (p.labels.length) result.labels = p.labels;
    if (p.points.length) result.points = p.points.map(encodePoint);
    if (p.segments.length) result.segments = p.segments.map(encodeSegment);
    result.settings = p.settings; result.view = p.view;
    return result;
  }

  // Keep each coordinate, brush size and packed cuboid on one readable line.
  function stringifyProject(data) {
    const pretty = (value, depth) => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      const indent = '  '.repeat(depth), inner = indent + '  ';
      if (Array.isArray(value)) {
        if (!value.length || value.every((v) => v === null || typeof v !== 'object')) return JSON.stringify(value);
        return '[\n' + value.map((v) => inner + pretty(v, depth + 1)).join(',\n') + '\n' + indent + ']';
      }
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      return entries.length ? '{\n' + entries.map(([k, v]) => inner + JSON.stringify(k) + ': ' + pretty(v, depth + 1)).join(',\n') + '\n' + indent + '}' : '{}';
    };
    return pretty(data, 0) + '\n';
  }

  // Fast numeric occupancy for rendering and analysis (coordinates stay within ±1024).
  const nkey = (x, y, z) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
  function occupancy(cells) {
    const set = new Set();
    for (const cell of cells) { const [x, y, z] = point(cell); set.add(nkey(x, y, z)); }
    return (x, y, z) => set.has(nkey(x, y, z));
  }

  // Candidate edges of the bounding box parallel to one axis, in textbook preference order:
  // X/Y at the bottom front, Z at the left front. A candidate is preferred when the shape
  // really has that whole edge (not empty air) and when it is an outline edge in this view.
  const OVERALL_ORDER = [[1, [1, 0], 2, [0, 1]], [0, [1, 0], 2, [0, 1]], [0, [0, 1], 1, [1, 0]]];
  function overallEdge(axis, box, has, normal) {
    const [b, bOrder, c, cOrder] = OVERALL_ORDER[axis], candidates = [];
    for (const sb of bOrder) for (const sc of cOrder) {
      const a = [...box.min], e = [...box.min], cell = [0, 0, 0];
      a[b] = e[b] = sb ? box.max[b] : box.min[b]; a[c] = e[c] = sc ? box.max[c] : box.min[c]; e[axis] = box.max[axis];
      cell[b] = sb ? box.max[b] - 1 : box.min[b]; cell[c] = sc ? box.max[c] - 1 : box.min[c];
      let covered = 0;
      for (let u = box.min[axis]; u < box.max[axis]; u++) { cell[axis] = u; if (has(cell[0], cell[1], cell[2])) covered++; }
      const facing = ((sb ? 1 : -1) * normal[b] > 1e-6) + ((sc ? 1 : -1) * normal[c] > 1e-6);
      // rank 0: outline edge (one neighbouring face seen), 1: front edge inside the outline, 2: hidden back edge.
      candidates.push({ a, b: e, full: covered === box.max[axis] - box.min[axis], coverage: covered / (box.max[axis] - box.min[axis]), rank: [2, 0, 1][facing], order: candidates.length });
    }
    // A dimension on a hidden back edge would be drawn across the solid, so it is the last resort.
    candidates.sort((p, q) => ((p.rank === 2) - (q.rank === 2)) || (q.full - p.full) || (p.rank - q.rank) || (q.coverage - p.coverage) || (p.order - q.order));
    return candidates[0];
  }

  function overallDimensions(box, options, cells, viewBasis) {
    if (!box) return [];
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
    const has = cells ? (cells instanceof Set ? occupancy(cells) : cells) : null;
    const normal = viewBasis?.normal || basis(.76, .53).normal;
    return [
      { a: [x0, y1, z0], b: [x1, y1, z0] },
      { a: [x1, y0, z0], b: [x1, y1, z0] },
      { a: [x0, y1, z0], b: [x0, y1, z1] }
    ].map((d, axis) => {
      const chosen = has ? overallEdge(axis, box, has, normal) : { ...d, full: true };
      const o = options?.[axis] || {};
      return { a: chosen.a, b: chosen.b, attached: chosen.full, id: 'overall-' + axis, axis, kind: 'overall', visible: o.visible !== false, offset: o.offset ?? 46,
        ...(o.label !== undefined ? { label: o.label } : {}), ...(o.question ? { question: true } : {}) };
    });
  }

  // A lattice point is on the surface when the 8 cells around it are neither all full nor all empty.
  function onSurface(has, p) {
    let full = 0;
    for (let i = 0; i < 8; i++) if (has(p[0] - (i & 1), p[1] - (i >> 1 & 1), p[2] - (i >> 2 & 1))) full++;
    return full > 0 && full < 8;
  }
  // Any point (midpoints too): 'surface', 'inside' the solid, or 'outside' it, from the cells it touches.
  function pointPlace(has, p) {
    const spans = p.map((v) => { const r = Math.round(v); return Math.abs(v - r) < 1e-9 ? [r - 1, r] : [Math.floor(v)]; });
    let full = 0, total = 0;
    for (const x of spans[0]) for (const y of spans[1]) for (const z of spans[2]) { total++; if (has(x, y, z)) full++; }
    return full === 0 ? 'outside' : full === total ? 'inside' : 'surface';
  }
  // Attached: both ends touch the solid, and an axis-aligned measurement runs along its surface.
  function dimensionAttachment(has, d) {
    const v = sub(d.b, d.a), axes = v.filter((x) => x !== 0).length;
    if (!onSurface(has, d.a) || !onSurface(has, d.b)) return 'detached';
    if (axes !== 1) return 'diagonal';
    const axis = v.findIndex((x) => x !== 0), step = Math.sign(v[axis]);
    for (let p = [...d.a]; p[axis] !== d.b[axis]; p[axis] += step) {
      const mid = [...p]; mid[axis] += step / 2;
      // Midpoint of a unit segment: on the surface if its 4 surrounding cells are mixed.
      const others = [0, 1, 2].filter((i) => i !== axis);
      let full = 0;
      for (let i = 0; i < 4; i++) {
        const c = [0, 0, 0]; c[axis] = Math.floor(mid[axis]);
        c[others[0]] = p[others[0]] - (i & 1); c[others[1]] = p[others[1]] - (i >> 1 & 1);
        if (has(c[0], c[1], c[2])) full++;
      }
      if (full === 0 || full === 4) return 'crosses';
    }
    return 'attached';
  }

  // Flood fill from outside: separates the outer skin from sealed cavities.
  function cavityAnalysis(cells) {
    const box = bounds(cells);
    if (!box) return { exteriorFaces: 0, cavityFaces: 0, cavityCells: 0 };
    const lo = box.min.map((v) => v - 1), n = box.size.map((v) => v + 2), volume = n[0] * n[1] * n[2];
    if (volume > 6000000) return null;
    const index = (x, y, z) => ((x - lo[0]) * n[1] + (y - lo[1])) * n[2] + (z - lo[2]);
    const solid = new Uint8Array(volume), outside = new Uint8Array(volume), queue = new Int32Array(volume);
    for (const cell of cells) { const [x, y, z] = point(cell); solid[index(x, y, z)] = 1; }
    const strides = [n[1] * n[2], n[2], 1];
    let head = 0, tail = 0; queue[tail++] = 0; outside[0] = 1;
    while (head < tail) {
      const i = queue[head++], z = i % n[2], y = Math.floor(i / n[2]) % n[1], x = Math.floor(i / strides[0]);
      const coords = [x, y, z];
      for (let axis = 0; axis < 3; axis++) for (const s of [-1, 1]) {
        const c = coords[axis] + s; if (c < 0 || c >= n[axis]) continue;
        const j = i + s * strides[axis];
        if (!solid[j] && !outside[j]) { outside[j] = 1; queue[tail++] = j; }
      }
    }
    let exteriorFaces = 0, cavityFaces = 0, cavityCells = 0;
    for (let i = 0; i < volume; i++) {
      if (!solid[i]) { if (!outside[i]) cavityCells++; continue; }
      for (let axis = 0; axis < 3; axis++) for (const s of [-1, 1]) {
        const j = i + s * strides[axis];
        if (solid[j]) continue;
        if (outside[j]) exteriorFaces++; else cavityFaces++;
      }
    }
    return { exteriorFaces, cavityFaces, cavityCells };
  }

  function componentCount(cells) {
    const seen = new Set(); let count = 0;
    for (const start of cells) {
      if (seen.has(start)) continue;
      count++; seen.add(start); const stack = [start];
      while (stack.length) {
        const p = point(stack.pop());
        for (const d of directions) { const k = key(add(p, d.n)); if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); } }
      }
    }
    return count;
  }

  // Blocks with nothing directly below them and not on the lowest layer (floating in a 쌓기나무).
  function unsupportedBlocks(cells) {
    const box = bounds(cells); if (!box) return [];
    return [...cells].map(point).filter(([x, y, z]) => z > box.min[2] && !cells.has(key([x, y, z - 1])));
  }

  // Textbook projections, rows top-to-bottom as drawn by the renderer's front/right/top views.
  // front: seen from +Y (앞), X to the right. right: seen from +X (옆), the front (+Y) on the left.
  // top: seen from above, the front (+Y) at the bottom; numbers are blocks stacked in each column.
  function projections(cells) {
    const box = bounds(cells); if (!box) return null;
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, has = occupancy(cells);
    if ((x1 - x0) * (y1 - y0) * (z1 - z0) > 4000000) return null;
    const front = [], right = [], top = [];
    for (let z = z1 - 1; z >= z0; z--) {
      const f = [], r = [];
      for (let x = x0; x < x1; x++) { let any = false; for (let y = y0; y < y1 && !any; y++) any = has(x, y, z); f.push(any ? 1 : 0); }
      for (let y = y1 - 1; y >= y0; y--) { let any = false; for (let x = x0; x < x1 && !any; x++) any = has(x, y, z); r.push(any ? 1 : 0); }
      front.push(f); right.push(r);
    }
    for (let y = y0; y < y1; y++) {
      const row = [];
      for (let x = x0; x < x1; x++) { let count = 0; for (let z = z0; z < z1; z++) if (has(x, y, z)) count++; row.push(count); }
      top.push(row);
    }
    const area = (grid) => grid.flat().filter((v) => v > 0).length;
    // 둘레 of a plane figure: unit edges between a filled square and an empty one (or the border).
    const perimeter = (grid) => {
      let count = 0;
      grid.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!(grid[r + dr]?.[c + dc] > 0)) count++;
      }));
      return count;
    };
    return { origin: box.min, front, right, top, squares: { front: area(front), right: area(right), top: area(top) }, perimeter: { front: perimeter(front), right: perimeter(right), top: perimeter(top) } };
  }

  // 쌓기나무 from a top-view number map: rows top-to-bottom = back-to-front (+Y at the bottom),
  // columns left-to-right = X. "0" or "." means an empty column.
  function heightmapCells(rows) {
    const lines = (Array.isArray(rows) ? rows : String(rows).split(/[\/\n;]/)).map((r) => String(r).trim()).filter((r) => r.length);
    if (!lines.length) invalid('높이 지도가 비어 있습니다. 예: "3 2 1 / 2 1 0"');
    const cells = new Set();
    lines.forEach((line, y) => {
      const tokens = line.includes(' ') || line.includes(',') ? line.split(/[\s,]+/).filter(Boolean) : [...line];
      tokens.forEach((token, x) => {
        const h = token === '.' ? 0 : Number(token);
        if (!Number.isInteger(h) || h < 0 || h > 100) invalid('높이 지도의 ' + (y + 1) + '번째 줄 ' + (x + 1) + '번째 값 "' + token + '"은 0~100 정수여야 합니다.');
        for (let z = 0; z < h; z++) cells.add(key([x, y, z]));
      });
    });
    if (!cells.size) invalid('높이 지도에 블록이 하나도 없습니다.');
    if (cells.size > MAX_BLOCKS) invalid('도형은 최대 100,000블록까지입니다.');
    return cells;
  }

  const round6 = (v) => Number(v.toFixed(6));

  // Readable, derived information for local assistants. Hidden values remain in model JSON.
  function describeProject(data) {
    const p = validateProject(data), box = bounds(p.cells), has = occupancy(p.cells);
    let exposedFaces = 0;
    for (const cell of p.cells) {
      const position = point(cell);
      for (const d of directions) if (!p.cells.has(key(add(position, d.n)))) exposedFaces++;
    }
    const cavity = cavityAnalysis(p.cells);
    const viewBasis = basis(p.view.yaw, p.view.pitch);
    const dims = [...overallDimensions(box, p.overallDimensions, has, viewBasis), ...p.dimensions.map((d) => ({ ...d, kind: 'pinned', attached: dimensionAttachment(has, d) }))];
    return {
      format: data.format, version: data.version, unit: p.unit, unitLabel: p.unitLabel, blockCount: p.cells.size,
      storage: { encoding: data.boxes ? 'boxes' : 'blocks', items: (data.boxes || data.blocks).length },
      bounds: box, physicalSize: box ? box.size.map((v) => round6(v * p.unit)) : [0, 0, 0],
      volume: round6(p.cells.size * p.unit ** 3), surfaceArea: round6(exposedFaces * p.unit ** 2),
      ...(cavity ? { exteriorSurfaceArea: round6(cavity.exteriorFaces * p.unit ** 2), cavityCells: cavity.cavityCells } : {}),
      components: componentCount(p.cells),
      dimensions: dims.map((d) => ({ ...d, length: round6(length(sub(d.b, d.a)) * p.unit), effectiveVisible: d.visible !== false && p.settings[d.kind === 'overall' ? 'overall' : 'annotations'] })),
      labels: p.labels.map((l) => ({ ...l, onShape: onSurface(has, l.at), effectiveVisible: l.visible && p.settings.labels })),
      ...(p.points.length ? { points: p.points.map((pt) => ({ ...encodePoint(pt), at: pt.at, place: pointPlace(has, pt.at) })) } : {}),
      ...(p.segments.length ? { segments: p.segments.map((s) => ({ ...encodeSegment(s), from: s.from, to: s.to, length: round6(length(sub(s.to, s.from)) * p.unit) })) } : {}),
      settings: p.settings, view: p.view
    };
  }

  const api = { MAX_BLOCKS, UNIT_LABELS, key, point, add, sub, mul, dot, length, bounds, cuboid, editRegion, extractSurface, basis, raycast, brushRegion, resizeInterval, validateProject, overallDimensions, describeProject, packCells, encodeProject, stringifyProject,
    occupancy, onSurface, pointPlace, dimensionAttachment, cavityAnalysis, componentCount, unsupportedBlocks, projections, heightmapCells,
    lineCross, resolveMarks, encodePoint, encodeSegment, mapMarks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolidGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
