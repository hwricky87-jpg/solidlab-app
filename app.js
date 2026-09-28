/* Local, dependency-free orthographic voxel editor. */
(() => {
  'use strict';
  const G = window.SolidGeometry;
  const R = window.SolidRender;
  const desktop = window.SolidDesktop?.version === 1 ? window.SolidDesktop : null;
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene'), ctx = canvas.getContext('2d');
  const axisNames = ['가로 X', '세로 Y', '높이 Z'];
  const STORAGE_KEY = 'yeonjun-solid-editor-v1';
  const RECOVERY_KEY = STORAGE_KEY + '-previous';
  const DEFAULT_SETTINGS = { grid: true, floor: true, overall: true, annotations: true, hidden: false, labels: true, style: 'color', dimStyle: 'line' };
  const state = {
    cells: new Set(), unit: 1, unitLabel: 'cm', dimensions: [], labels: [],
    settings: { ...DEFAULT_SETTINGS },
    view: { yaw: .76, pitch: .53, scale: 18, panX: 0, panY: 0, target: [7, 7.5, 8.5], autoFit: true },
    tool: 'orbit', selection: new Set(), pointMode: false, labelMode: false, points: [], overallOffsets: [46, 46, 46], overallVisible: [true, true, true], overallMeta: [{}, {}, {}], measurementMode: 'each',
    answers: false
  };
  let box = G.bounds(state.cells), geometry = G.extractSurface(state.cells), occupied = G.occupancy(state.cells), geometryVersion = 0;
  let frame = null, queued = false, hover = null, pointer = null, spacePressed = false, sceneCache = null;
  let previewRegion = null, presentation = false, editingSettings = null, dialogDimension = null, dialogLabel = null;
  let width = 800, height = 600, history = [], future = [], saveTimer, toastTimer, dimensionSerial = 0;
  let lastBrushClick = null, packedCache = null;
  let sessionReady = false, fileCheckpoint = null, startupDraft = null, recoveryData = null;
  let recoveryPersisted = false, pendingProjectAction = null;
  let fileSaveBusy = false;

  const { format, corners, fittingScale } = R;
  const value = (id) => Number($(id).value);
  const physicalLength = (d) => G.length(G.sub(d.b, d.a)) * state.unit;
  const labelOf = (d) => format(physicalLength(d)) + ' ' + state.unitLabel;
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const labelMeta = (d) => ({ ...(d.label !== undefined ? { label: d.label } : {}), ...(d.question ? { question: true } : {}) });

  function message(text, error = false) {
    $('toast').textContent = text;
    $('toast').className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').className = 'toast'; }, error ? 5500 : 3200);
  }

  function snapshot() {
    return projectData();
  }

  function pushHistory(previous) {
    history.push(previous); if (history.length > 25) history.shift(); future = []; updateHistory();
  }

  // Shared by undo/redo and file loading: copy a validated project into the editor state.
  function applyProject(p) {
    state.cells = p.cells; state.unit = p.unit; state.unitLabel = p.unitLabel;
    state.dimensions = p.dimensions; state.labels = p.labels; state.settings = { ...p.settings };
    state.overallOffsets = p.overallDimensions.map((d) => d.offset); state.overallVisible = p.overallDimensions.map((d) => d.visible);
    state.overallMeta = p.overallDimensions.map(labelMeta);
  }

  function restore(s) {
    lastBrushClick = null;
    applyProject(G.validateProject(s));
    state.selection.clear(); state.points = []; previewRegion = null; hover = null;
    syncControls(); rebuild();
    // Undo keeps the user's zoom and pan unless the view is following the solid.
    if (state.view.autoFit) fitView(); else requestRender();
    scheduleSave();
  }

  function updateHistory() { $('undoBtn').disabled = !history.length; $('redoBtn').disabled = !future.length; }
  function undo() { if (!history.length) return; future.push(snapshot()); restore(history.pop()); updateHistory(); message('이전 작업으로 되돌렸습니다.'); }
  function redo() { if (!future.length) return; history.push(snapshot()); restore(future.pop()); updateHistory(); message('작업을 다시 적용했습니다.'); }

  function projectData() {
    if (!packedCache) packedCache = G.packCells(state.cells);
    return { $schema: 'model.schema.json', format: 'yeonjun-solid-editor', version: 2, unit: state.unit, unitLabel: state.unitLabel,
      ...packedCache, dimensions: state.dimensions.map((d) => ({ id: d.id, a: [...d.a], b: [...d.b], offset: d.offset, visible: d.visible !== false, ...labelMeta(d) })),
      overallDimensions: state.overallVisible.map((visible, axis) => ({ id: 'overall-' + axis, visible, offset: state.overallOffsets[axis], ...state.overallMeta[axis] })),
      ...(state.labels.length ? { labels: state.labels.map((l) => ({ id: l.id, at: [...l.at], text: l.text, visible: l.visible !== false })) } : {}),
      settings: { ...state.settings }, view: { yaw: state.view.yaw, pitch: state.view.pitch, ...(state.view.projection === 'oblique' ? { projection: 'oblique' } : {}) }, measurementMode: state.measurementMode,
      brush: { basis: $('brushBasis').value, size: ['brushX','brushY','brushZ'].map(value), drag: $('dragPaint').checked } };
  }

  // What counts as the saved document: turning the view or the brush is not an unsaved change.
  function documentKey(data = projectData()) {
    const { view, brush, measurementMode, ...content } = data;
    return JSON.stringify(content);
  }

  function scheduleSave() {
    if (!sessionReady) return; // Never replace the old draft before a startup choice.
    updateDesktopDirty();
    $('saveStatus').textContent = '저장 중…'; clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData())); $('saveStatus').textContent = desktop ? '이 앱에 자동 저장됨' : '이 브라우저에 자동 저장됨'; }
      catch { $('saveStatus').textContent = '도형 저장 버튼으로 보관하세요'; }
    }, 450);
  }

  function loadData(data, keepHistory = true) {
    const validated = G.validateProject(data);
    if (!sessionReady) {
      if (startupDraft && data !== startupDraft) rememberPrevious(startupDraft);
      sessionReady = true; startupDraft = null; $('startupDialog').close();
    }
    presentation = false; editingSettings = null; $('presentationBtn').textContent = '완성 보기';
    if (keepHistory) pushHistory(snapshot());
    applyProject(validated);
    delete state.view.projection; Object.assign(state.view, validated.view); syncViewTabs();
    state.measurementMode = data.measurementMode === 'span' ? 'span' : 'each';
    const brush = data.brush;
    $('brushBasis').value = brush?.basis === 'xyz' ? 'xyz' : 'face';
    const brushSize = Array.isArray(brush?.size) && brush.size.length === 3 && brush.size.every((v) => Number.isInteger(v) && v >= 1 && v <= 100) ? brush.size : [1,1,1];
    ['brushX','brushY','brushZ'].forEach((id, i) => { $(id).value = brushSize[i]; });
    $('dragPaint').checked = brush?.drag === true; updateBrushControls(); lastBrushClick = null;
    state.selection.clear(); state.points = []; previewRegion = null; hover = null;
    syncControls(); rebuild(); fitView();
    if (keepHistory) scheduleSave();
  }

  function emptyProject() {
    return { format: 'yeonjun-solid-editor', version: 2, boxes: [], unit: 1, unitLabel: 'cm', dimensions: [],
      settings: { ...DEFAULT_SETTINGS }, view: { yaw: .76, pitch: .53 },
      measurementMode: 'each', brush: { basis: 'face', size: [1, 1, 1], drag: false } };
  }

  function hasContent(data) {
    return Boolean(data?.dimensions?.length || data?.boxes?.length || data?.blocks?.length || data?.labels?.length);
  }

  function updateRecoveryControls() {
    $('recoveryControls').hidden = !recoveryData;
    $('recoveryHint').textContent = recoveryPersisted ? '직전 작업 한 개만 ' + (desktop ? '이 앱' : '이 브라우저') + '에 임시 보관합니다.' : '직전 작업은 이 창에서만 복원할 수 있습니다. 파일로도 저장하세요.';
  }

  function rememberPrevious(data) {
    if (!hasContent(data)) return;
    const text = JSON.stringify(data);
    recoveryData = JSON.parse(text); recoveryPersisted = false;
    try { localStorage.setItem(RECOVERY_KEY, text); recoveryPersisted = true; } catch {}
    updateRecoveryControls();
  }

  function hasUnsavedWork() {
    return sessionReady && (state.cells.size || state.dimensions.length || state.labels.length) && fileCheckpoint !== documentKey();
  }

  // The window asks before closing when either the solid or the 2D diagram has unsaved work.
  function updateDesktopDirty() { if (desktop) desktop.setDocumentState(Boolean(hasUnsavedWork()) || Boolean(window.SolidDiagramApp?.dirty())); }
  const diagramMode = () => document.body.dataset.mode === 'diagram';
  // A 2D diagram file opened from the solid side is handed to the diagram editor.
  function openDiagram(data) {
    if ($('startupDialog').open) ($('continueProjectBtn').disabled ? $('startupNewBtn') : $('continueProjectBtn')).click();
    window.SolidDiagramApp.load(data);
  }

  async function saveProjectFile() {
    if (!sessionReady || fileSaveBusy) return false;
    fileSaveBusy = true; $('saveBtn').disabled = $('saveThenProjectBtn').disabled = true;
    try {
      const data = projectData();
      const saved = await download(new Blob([G.stringifyProject(data)], { type: 'application/json' }), '입체도형_' + stamp() + '.json');
      if (!saved) { message('파일 저장을 취소했습니다. 현재 작업은 그대로입니다.'); return false; }
      fileCheckpoint = documentKey(data); updateDesktopDirty();
      message(desktop ? '도형 파일을 저장했습니다.' : '도형 파일 저장을 요청했습니다. 브라우저 다운로드를 확인하세요.');
      return true;
    } catch (error) {
      message(error.message || '파일 저장에 실패했습니다.', true);
      if ($('projectChangeDialog').open) $('projectChangeError').textContent = error.message;
      return false;
    } finally { fileSaveBusy = false; $('saveBtn').disabled = $('saveThenProjectBtn').disabled = false; }
  }

  function commitProjectAction(action) {
    cancelActivePointer(); clearTimeout(saveTimer);
    if (action.kind === 'close' && desktop) { desktop.finishClose(); return; }
    if (sessionReady && (state.cells.size || state.dimensions.length)) rememberPrevious(projectData());
    else if (startupDraft && action.kind !== 'continue') rememberPrevious(startupDraft);
    sessionReady = true; startupDraft = null; $('startupDialog').close();
    loadData(action.data || emptyProject(), false);
    history = []; future = []; updateHistory(); setTool('orbit'); spacePressed = false;
    $('selectionBox').style.display = 'none'; $('previewRegionBtn').textContent = '영역 미리보기';
    for (const id of ['createError', 'regionError', 'dimensionError']) $(id).textContent = '';
    if (action.kind === 'new') {
      for (const id of ['sizeX', 'sizeY', 'sizeZ', 'regionX', 'regionY', 'regionZ', 'regionW', 'regionD', 'regionH']) $(id).value = $(id).defaultValue;
      setView('iso');
    }
    fileCheckpoint = ['new', 'load'].includes(action.kind) ? documentKey() : null;
    scheduleSave(); updateRecoveryControls();
    message(action.kind === 'new' ? '빈 화면에서 새 도형을 시작합니다.' : '도형을 열었습니다.');
    if (recoveryData && !recoveryPersisted) message('직전 작업은 이 창에서만 복원 가능합니다. 닫기 전에 파일로 저장하세요.', true);
  }

  function requestProjectAction(action) {
    cancelActivePointer();
    const unsaved = hasUnsavedWork();
    if (!unsaved) { commitProjectAction(action); return; }
    pendingProjectAction = action;
    const isNew = action.kind === 'new';
    const isClose = action.kind === 'close';
    $('projectChangeTitle').textContent = isClose ? '앱을 닫을까요?' : isNew ? '새 도형을 만들까요?' : '다른 도형을 열까요?';
    $('discardProjectBtn').textContent = isClose ? '저장 없이 닫기' : isNew ? '저장 없이 새 도형' : '저장 없이 열기';
    $('saveThenProjectBtn').textContent = isClose ? '저장 후 닫기' : isNew ? '저장 후 새 도형' : '저장 후 열기';
    $('projectChangeError').textContent = ''; $('projectChangeDialog').showModal(); $('cancelProjectBtn').focus();
  }

  async function applyPendingProject(saveFirst) {
    const action = pendingProjectAction; if (!action) return;
    try {
      if (saveFirst && !await saveProjectFile()) return;
      if (action !== pendingProjectAction) return;
      commitProjectAction(action); pendingProjectAction = null; $('projectChangeDialog').close();
    } catch (e) { $('projectChangeError').textContent = e.message; }
  }

  function prepareStartup() {
    let saved = null, raw = null, error = '';
    try {
      const previous = localStorage.getItem(RECOVERY_KEY);
      if (previous) { const data = JSON.parse(previous); G.validateProject(data); recoveryData = data; recoveryPersisted = true; }
    } catch {}
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { saved = JSON.parse(raw); G.validateProject(saved); }
    } catch { saved = null; error = '자동 저장본을 읽지 못했습니다. 기록은 아직 바꾸지 않았습니다. 새 도형을 만들거나 JSON 파일을 불러오세요.'; }
    startupDraft = saved && hasContent(saved) ? saved : recoveryData || saved;
    updateRecoveryControls();
    // An empty autosave is not worth a question: start a new shape directly.
    if (hasContent(startupDraft) || error) {
      $('continueProjectBtn').disabled = !startupDraft;
      $('startupError').textContent = error;
      if (startupDraft) {
        const validated = G.validateProject(startupDraft), savedBox = G.bounds(validated.cells);
        $('startupSummary').textContent = savedBox ? savedBox.size.map((v) => format(v * validated.unit)).join(' × ') + ' ' + (startupDraft.unitLabel || 'cm') + ' · ' + format(validated.cells.size) + '블록' : '빈 도형 · 이전 표시 설정';
      } else $('startupSummary').textContent = '불러올 수 있는 자동 저장본이 없습니다.';
      $('saveStatus').textContent = '시작할 작업을 선택하세요'; $('startupDialog').showModal();
    } else {
      startupDraft = null; sessionReady = true; fileCheckpoint = documentKey(); $('saveStatus').textContent = '새 도형 · 파일 저장은 별도';
    }
    updateDesktopDirty();
  }

  function syncControls() {
    $('unitSize').value = state.unit; $('unitLabel').value = state.unitLabel;
    $('showGrid').checked = state.settings.grid; $('showFloor').checked = state.settings.floor;
    $('showOverall').checked = state.settings.overall; $('showDimensions').checked = state.settings.annotations;
    $('showHidden').checked = state.settings.hidden; $('showLabels').checked = state.settings.labels;
    $('figureStyle').value = state.settings.style; $('dimStyle').value = state.settings.dimStyle;
    $('measurementMode').value = state.measurementMode;
  }

  function rebuild() {
    packedCache = null; geometryVersion++;
    box = G.bounds(state.cells); geometry = G.extractSurface(state.cells); occupied = G.occupancy(state.cells);
    $('blockCount').textContent = format(state.cells.size) + '개';
    $('volumeValue').textContent = format(state.cells.size * state.unit ** 3) + ' ' + state.unitLabel + '³';
    $('surfaceValue').textContent = format(geometry.surfaceArea * state.unit ** 2) + ' ' + state.unitLabel + '²';
    $('extentValue').textContent = box ? box.size.map((v) => format(v * state.unit)).join(' × ') : '0 × 0 × 0';
    $('extentValue').title = '길이 단위: ' + state.unitLabel;
    $('modelBadge').textContent = !box ? '빈 도형' : state.cells.size === box.size.reduce((a, b) => a * b, 1) ? '직육면체' : '편집한 도형';
    $('emptyState').hidden = state.cells.size !== 0;
    updateSelection(); updateDimensionList(); requestRender();
  }

  function fitView() {
    state.view.autoFit = true; state.view.panX = 0; state.view.panY = 0;
    state.view.target = box ? [...box.center] : [0, 0, 0];
    state.view.scale = fittingScale(width, height, box, R.viewBasis(state.view));
    requestRender();
  }

  function makeFrame(w, h) {
    return R.createFrame({ box, view: state.view }, w, h, false);
  }

  function tracePolygon(context, pts) { context.beginPath(); context.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) context.lineTo(pts[i].x, pts[i].y); context.closePath(); }
  function strokeLine(context, a, b) { context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }

  function overallOptions() {
    return state.overallVisible.map((visible, axis) => ({ visible, offset: state.overallOffsets[axis], ...state.overallMeta[axis] }));
  }
  // The overall dimension sits on a real outline edge for the current view (same rule as export).
  function overallDimensions() {
    return G.overallDimensions(box, overallOptions(), occupied, R.viewBasis(state.view));
  }

  function visibleDimensions(includeOverall = true) {
    return [...(includeOverall && state.settings.overall ? overallDimensions() : []), ...(state.settings.annotations ? state.dimensions.map((d) => ({ ...d, kind: 'pinned' })) : [])].filter((d) => d.visible !== false);
  }

  function selectedEdges() { return geometry.edges.filter((e) => state.selection.has(e.id)); }

  function selectedDimensions() {
    const edges = selectedEdges(); if (!edges.length) return [];
    if (state.measurementMode === 'each') return edges.map((edge, i) => ({ id: 'selected-' + i, a: [...edge.a], b: [...edge.b], offset: 42, kind: 'selection' }));
    const pts = edges.flatMap((e) => [e.a, e.b]);
    const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))), max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
    if (edges.length === 1) return [{ id: 'selected-0', a: edges[0].a, b: edges[0].b, offset: 42, kind: 'selection' }];
    return [0, 1, 2].filter((i) => max[i] > min[i]).map((i) => { const a = [...min], b = [...min]; b[i] = max[i]; return { id: 'selected-' + i, a, b, offset: 44, kind: 'selection' }; });
  }

  // The canvas draws the same scene as the SVG export. Rebuilt only when something it shows changes.
  function sceneFor(f, fast) {
    const settings = { ...state.settings, overall: state.settings.overall && !state.selection.size };
    const key = [geometryVersion, fast, f.scale, f.cx, f.cy, f.target.join(), f.basis.normal.join(), state.unit, state.unitLabel, state.answers,
      JSON.stringify([settings, state.dimensions, state.labels, state.overallVisible, state.overallOffsets, state.overallMeta])].join('|');
    if (sceneCache?.key === key) return sceneCache.scene;
    const scene = R.buildScene({ cells: state.cells, box, geometry, has: occupied, unit: state.unit, unitLabel: state.unitLabel,
      dimensions: state.dimensions.map((d) => ({ ...d, kind: 'pinned' })), overallDimensions: overallOptions(), labels: state.labels, settings }, f, { fontSize: 13, fast, answers: state.answers });
    sceneCache = { key, scene };
    return scene;
  }

  function pointVisible(p, f) {
    const r = f.ray(f.project(p)), hit = G.raycast(state.cells, box, r.origin, r.direction);
    return !hit || f.project(hit.point).depth <= f.project(p).depth + .006;
  }

  function hasFacingEdge(e, f) {
    const a = [...e.a]; a[e.axis] = Math.floor((e.a[e.axis] + e.b[e.axis] - .001) / 2);
    const b = [...a]; b[e.axis]++;
    const unit = geometry.featureUnits.get(G.key(a) + ':' + G.key(b));
    return unit && [...unit.normals].some((n) => G.dot(G.point(n), f.basis.normal) > 1e-6);
  }

  function drawBoxPreview(context, region, f, mode = 'add') {
    if (!region) return;
    const b = { min: region.start, max: G.add(region.start, region.size) }, vertices = corners(b);
    const color = mode === 'remove' ? '#a2463d' : '#35765e';
    context.save(); context.strokeStyle = color; context.fillStyle = mode === 'remove' ? '#a2463d13' : '#35765e16'; context.lineWidth = 1.5; context.setLineDash([5, 3]);
    for (const d of [
      [0, 4, 6, 2], [1, 5, 7, 3], [0, 4, 5, 1], [2, 6, 7, 3], [0, 2, 3, 1], [4, 6, 7, 5]
    ]) { tracePolygon(context, d.map((i) => f.project(vertices[i]))); context.fill(); context.stroke(); }
    context.restore();
  }

  function drawScene(context, f) {
    context.clearRect(0, 0, f.w, f.h); context.fillStyle = '#f5f7f2'; context.fillRect(0, 0, f.w, f.h);
    // Rotating or panning uses the quick path; the exact one returns when the pointer is released.
    const scene = sceneFor(f, pointer?.kind === 'orbit' || pointer?.kind === 'pan');
    R.paintScene(context, scene);
    f.dimensions = [...scene.dims];
    f.screenEdges = geometry.edges.filter((e) => hasFacingEdge(e, f) && [.15, .5, .85].some((t) => pointVisible(G.add(e.a, G.mul(G.sub(e.b, e.a), t)), f))).map((e) => ({ ...e, sa: f.project(e.a), sb: f.project(e.b) }));
    context.strokeStyle = '#2b8057'; context.lineWidth = 3;
    for (const e of selectedEdges()) strokeLine(context, f.project(e.a), f.project(e.b));
    drawBoxPreview(context, previewRegion, f, 'remove');
    if (hover?.region && !pointer?.kind?.startsWith('annotation')) drawBrushPreview(context, hover, f);
    if ((state.pointMode || state.labelMode) && hover?.point) drawPoint(context, f.project(hover.point), 5, '#35765e');
    for (const p of state.points) drawPoint(context, f.project(p), 5, '#35765e');
    const placed = scene.dims.map((d) => ({ ...d.hit }));
    for (const d of selectedDimensions()) {
      const layout = R.dimensionLayout(d, f, box, state.unit, state.unitLabel, { fontSize: 13, placed });
      if (layout) { R.paintDimension(context, layout, scene.palette, '#27684c'); f.dimensions.push(layout); }
    }
    drawAxisWidget(context, f);
  }

  function drawPoint(context, p, radius, color) { context.fillStyle = color; context.strokeStyle = '#fff'; context.lineWidth = 1.5; context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fill(); context.stroke(); }

  function drawAxisWidget(context, f) {
    const center = { x: 35, y: f.h - 38 };
    context.save(); context.font = '10px Consolas'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.strokeStyle = '#90a18e'; context.fillStyle = '#678064'; context.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const d = [0, 0, 0]; d[i] = 1;
      const end = { x: center.x + G.dot(d, f.basis.right) * 24, y: center.y - G.dot(d, f.basis.up) * 24 };
      if (Math.hypot(end.x - center.x, end.y - center.y) < 4) continue;
      strokeLine(context, center, end); context.fillText('XYZ'[i], end.x + (end.x - center.x) * .4, end.y + (end.y - center.y) * .4);
    }
    context.restore();
  }

  function requestRender() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; frame = makeFrame(width, height); drawScene(ctx, frame); });
  }

  function updateSelection() {
    const edges = selectedEdges(); $('pinDimensionBtn').disabled = !edges.length;
    if (!edges.length) $('selectionInfo').innerHTML = '선분 선택 도구로 모서리를 누르거나<br>드래그해 여러 선분을 고르세요.';
    else {
      const sum = edges.reduce((s, e) => s + e.length, 0) * state.unit;
      const dims = selectedDimensions().map((d) => labelOf(d));
      $('selectionInfo').textContent = edges.length + '개 선분 · 길이 합 ' + format(sum) + ' ' + state.unitLabel + '\n' + (state.measurementMode === 'each' ? '각 길이 ' + dims.join(' / ') : '전체 범위 ' + dims.join(' × '));
      $('selectionInfo').style.whiteSpace = 'pre-line';
    }
    requestRender();
  }

  function updateDimensionList() {
    const list = $('dimensionList'); list.replaceChildren();
    const all = [...overallDimensions(), ...state.dimensions.map((d) => ({ ...d, kind: 'pinned' }))];
    $('dimensionVisibilityCount').textContent = all.length + '개 중 ' + visibleDimensions().length + '개 표시';
    $('showAllDimensionsBtn').disabled = $('hideAllDimensionsBtn').disabled = !all.length;
    if (!all.length) { const empty = document.createElement('p'); empty.className = 'help'; empty.textContent = '도형을 만들거나 치수를 고정하면 이곳에 표시됩니다.'; list.append(empty); }
    let pinnedIndex = 0;
    for (const d of all) {
      const effective = d.visible !== false && state.settings[d.kind === 'overall' ? 'overall' : 'annotations'];
      const attachment = d.kind === 'overall' ? (d.attached ? 'attached' : 'floating') : G.dimensionAttachment(occupied, d);
      const row = document.createElement('div'); row.className = 'dim-row' + (effective ? '' : ' is-hidden') + (['detached', 'crosses', 'floating'].includes(attachment) ? ' is-warning' : ''); row.dataset.dimensionId = d.id;
      const name = d.kind === 'overall' ? axisNames[d.axis] + ' · 전체' : '고정 치수 ' + (++pinnedIndex);
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'dim-visible'; toggle.checked = d.visible !== false;
      toggle.setAttribute('aria-label', name + ' 표시'); toggle.title = '체크를 끄면 점선과 숫자를 함께 숨깁니다.';
      toggle.addEventListener('change', () => setDimensionVisible(d.id, toggle.checked));
      const main = document.createElement('button'); main.type = 'button'; main.className = 'dim-main'; main.setAttribute('aria-label', name + ' 길이 ' + labelOf(d) + ' 수정');
      const title = document.createElement('span'); title.className = 'dim-title'; title.textContent = name;
      const number = document.createElement('span'); number.className = 'dim-value'; number.textContent = labelOf(d);
      const shown = d.question ? '문제: ' + (d.label ?? '?') : d.label !== undefined ? '표시: ' + d.label : '';
      const warning = { detached: '도형에 닿지 않음', crosses: '빈 곳을 지남', floating: '일부가 허공', diagonal: '사선' }[attachment] || '';
      const status = document.createElement('span'); status.className = 'dim-state';
      status.textContent = [shown, effective ? '' : d.visible === false ? '숨김' : '그룹 꺼짐', warning].filter(Boolean).join(' · ');
      if (warning) status.title = attachment === 'floating' ? '이 방향의 온전한 바깥 모서리가 없어 치수선 일부가 허공에 표시됩니다.' : '블록을 바꾼 뒤 남은 치수일 수 있습니다. 확인 후 지우거나 다시 재세요.';
      main.append(title, number, status); main.addEventListener('click', () => openDimension(d));
      const edit = document.createElement('button'); edit.textContent = '수정'; edit.setAttribute('aria-label', title.textContent + ' 수정'); edit.addEventListener('click', () => openDimension(d));
      row.append(toggle, main, edit);
      if (d.kind !== 'overall') {
        const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', '고정 치수 삭제');
        remove.addEventListener('click', () => { pushHistory(snapshot()); state.dimensions = state.dimensions.filter((v) => v.id !== d.id); updateDimensionList(); requestRender(); scheduleSave(); }); row.append(remove);
      }
      list.append(row);
    }
    updateLabelList();
  }

  function updateLabelList() {
    const list = $('labelList'); list.replaceChildren();
    for (const l of state.labels) {
      const row = document.createElement('div'); row.className = 'dim-row' + (G.onSurface(occupied, l.at) ? '' : ' is-warning');
      const main = document.createElement('button'); main.type = 'button'; main.className = 'dim-main';
      const title = document.createElement('span'); title.className = 'dim-title'; title.textContent = '꼭짓점 (' + l.at.join(', ') + ')' + (G.onSurface(occupied, l.at) ? '' : ' · 도형에 닿지 않음');
      const text = document.createElement('span'); text.className = 'dim-value'; text.textContent = l.text;
      main.append(title, text); main.addEventListener('click', () => openLabel(l));
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', '꼭짓점 이름 ' + l.text + ' 삭제');
      remove.addEventListener('click', () => { pushHistory(snapshot()); state.labels = state.labels.filter((v) => v.id !== l.id); updateDimensionList(); requestRender(); scheduleSave(); });
      row.append(main, remove); list.append(row);
    }
  }

  function openLabel(label) {
    dialogLabel = label;
    $('labelText').value = label.text || ''; $('labelError').textContent = '';
    $('labelDialogDescription').textContent = '꼭짓점 (' + label.at.join(', ') + ')에 붙일 이름입니다. 예: ㄱ, ㄴ, A, B';
    $('labelDialog').showModal(); setTimeout(() => { $('labelText').focus(); $('labelText').select(); }, 30);
  }

  function setDimensionVisible(id, visible) {
    if (typeof visible !== 'boolean') throw new Error('표시 여부는 true 또는 false여야 합니다.');
    const axis = ['overall-0', 'overall-1', 'overall-2'].indexOf(id), item = state.dimensions.find((d) => d.id === id);
    if (axis < 0 && !item) throw new Error('해당 치수선을 찾지 못했습니다: ' + id);
    if ((axis >= 0 ? state.overallVisible[axis] : item.visible !== false) === visible) return;
    pushHistory(snapshot());
    if (axis >= 0) state.overallVisible[axis] = visible; else item.visible = visible;
    state.selection.clear(); updateSelection(); updateDimensionList(); scheduleSave();
  }

  function setAllDimensionsVisible(visible) {
    pushHistory(snapshot()); state.overallVisible.fill(visible); state.dimensions.forEach((d) => { d.visible = visible; });
    if (visible) { state.settings.overall = true; state.settings.annotations = true; }
    state.selection.clear(); syncControls(); updateSelection(); updateDimensionList(); scheduleSave();
  }

  function setTool(tool) {
    if (state.tool !== tool) lastBrushClick = null;
    state.tool = tool; state.pointMode = false; state.labelMode = false; state.points = []; hover = null;
    $('labelModeBtn').classList.remove('active');
    document.querySelectorAll('[data-tool]').forEach((el) => el.classList.toggle('active', el.dataset.tool === tool));
    const text = {
      orbit: ['왼쪽 드래그로 회전합니다.\n다른 도구에서도 오른쪽 드래그로 회전해요.', '드래그 회전 · 휠 확대 · Space + 드래그 이동'],
      add: ['버튼을 떼면 미리 본 영역을 한 번 더합니다.\n연속으로 쌓으려면 드래그 편집을 켜세요.', '클릭 1회 더하기 · 오른쪽 드래그 회전 · Ctrl+Z 되돌리기'],
      remove: ['버튼을 떼면 미리 본 영역을 한 번 파냅니다.\n깊이 1은 한 층만, 깊이 3은 세 층입니다.', '클릭 1회 파내기 · 오른쪽 드래그 회전 · Ctrl+Z 되돌리기'],
      measure: ['모서리를 누르거나 드래그해 고릅니다.\nShift를 누르면 기존 선택에 더해져요.', '클릭·드래그 선분 선택 · Shift 추가 선택 · 숫자 더블클릭 수정']
    };
    $('toolHelp').textContent = text[tool][0]; $('toolHelp').style.whiteSpace = 'pre-line'; $('canvasHelp').textContent = text[tool][1];
    $('pointHint').style.display = 'none'; $('twoPointBtn').classList.remove('active');
    canvas.style.cursor = tool === 'orbit' ? 'grab' : 'crosshair'; requestRender();
    resetBrushStatus();
  }

  const VIEW_TITLES = { iso: '입체 · 정투영', oblique: '겨냥도 · 앞면은 그대로, 깊이는 45°로 반만', front: '앞에서 본 모습 · 평면 투영', right: '옆에서 본 모습 · 평면 투영', top: '위에서 본 모습 · 평면 투영' };
  // Highlight the tab that matches the current view (also after opening a file), or none if free.
  function syncViewTabs() {
    const v = state.view, name = v.projection === 'oblique' ? 'oblique'
      : Object.keys(VIEW_TITLES).find((k) => R.VIEWS[k] && Math.abs(R.VIEWS[k][0] - v.yaw) < 1e-6 && Math.abs(R.VIEWS[k][1] - v.pitch) < 1e-6);
    document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === name));
    $('viewTitle').textContent = VIEW_TITLES[name] || '자유 시점 · 정투영';
  }

  function setView(name) {
    lastBrushClick = null;
    if (name === 'oblique') state.view.projection = 'oblique';
    else { delete state.view.projection; [state.view.yaw, state.view.pitch] = R.VIEWS[name]; }
    syncViewTabs();
    hover = null; fitView(); scheduleSave();
  }

  function makeCuboid() {
    lastBrushClick = null;
    $('createError').textContent = '';
    try {
      const size = ['sizeX', 'sizeY', 'sizeZ'].map(value), cells = G.cuboid(size);
      pushHistory(snapshot()); state.cells = cells; state.dimensions = []; state.overallVisible.fill(true); state.overallOffsets.fill(46); state.selection.clear(); state.points = []; hover = null; previewRegion = null;
      rebuild(); fitView(); scheduleSave(); message(size.join(' × ') + ' 직육면체를 만들었습니다.');
    } catch (e) { $('createError').textContent = e.message; }
  }

  function regionInput() { return { start: ['regionX', 'regionY', 'regionZ'].map(value), size: ['regionW', 'regionD', 'regionH'].map(value) }; }
  function applyRegion(mode) {
    lastBrushClick = null;
    $('regionError').textContent = '';
    try {
      const r = regionInput(), result = G.editRegion(state.cells, r.start, r.size, mode);
      if (!result.changed) { message(mode === 'remove' ? '선택한 영역에 파낼 블록이 없습니다.' : '선택한 영역은 이미 채워져 있습니다.'); return; }
      pushHistory(snapshot()); state.cells = result.cells; state.selection.clear(); previewRegion = null; hover = null;
      rebuild(); fitView(); scheduleSave(); message(format(result.changed) + '개 블록을 ' + (mode === 'remove' ? '파냈습니다.' : '더했습니다.'));
    } catch (e) { $('regionError').textContent = e.message; }
  }

  function eventPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function hitAt(p) { if (!frame) return null; const r = frame.ray(p); return G.raycast(state.cells, box, r.origin, r.direction); }
  function groundHit(p) {
    if (!frame) return null; const r = frame.ray(p);
    if (Math.abs(r.direction[2]) < 1e-5) return null;
    const t = -r.origin[2] / r.direction[2]; if (t < 0) return null;
    const q = G.add(r.origin, G.mul(r.direction, t));
    return { cell: [Math.floor(q[0]), Math.floor(q[1]), -1], point: [q[0], q[1], 0], normal: [0, 0, 1] };
  }

  function resetBrushStatus() {
    $('brushStatus').classList.remove('error');
    $('brushStatus').textContent = $('dragPaint').checked ? '드래그하면 처음 누른 면을 따라 편집합니다. 한 번의 드래그는 한 번에 되돌릴 수 있어요.' : '클릭 한 번에 한 번 편집합니다. 버튼을 떼기 전까지 도형이 바뀌지 않아요.';
  }

  function updateBrushControls() {
    const face = $('brushBasis').value === 'face';
    ['brushX','brushY','brushZ'].forEach((id, i) => { document.querySelector('label[for="' + id + '"]').textContent = (face ? ['면 가로','면 세로','깊이'] : ['브러시 X','브러시 Y','브러시 Z'])[i]; });
    document.querySelectorAll('[data-brush]').forEach((el) => { const n = el.dataset.brush; el.textContent = n === '1' ? '1칸' : face ? n + ' × ' + n + ' 면' : n + ' × ' + n + ' × ' + n; });
    hover = null; resetBrushStatus(); requestRender();
  }

  function brushOptions() {
    const size = ['brushX','brushY','brushZ'].map(value);
    if (!size.every((v) => Number.isInteger(v) && v >= 1 && v <= 100) || size.reduce((a,b) => a*b,1) > G.MAX_BLOCKS) throw new Error('브러시 크기는 1~100 사이의 정수, 전체 100,000칸 이내로 입력해 주세요.');
    return { basis: $('brushBasis').value, size };
  }

  function brushForHit(hit, options, mode) {
    let size = [...options.size];
    if (options.basis === 'face') {
      const axis = hit.normal.findIndex((v) => v !== 0), other = [0,1,2].filter((i) => i !== axis);
      size = [1,1,1]; size[other[0]] = options.size[0]; size[other[1]] = options.size[1]; size[axis] = options.size[2];
    }
    return G.brushRegion(hit, size, mode);
  }

  function affectedCount(region, mode) {
    let total = 0;
    for (let x=region.start[0];x<region.start[0]+region.size[0];x++) for (let y=region.start[1];y<region.start[1]+region.size[1];y++) for (let z=region.start[2];z<region.start[2]+region.size[2];z++) {
      const occupied = state.cells.has(G.key([x,y,z])); if (mode === 'remove' ? occupied : !occupied) total++;
    }
    return total;
  }

  function showBrushPreview(hit, options, mode, pressed = false) {
    const region = brushForHit(hit, options, mode), count = affectedCount(region, mode);
    hover = { region, normal: hit.normal, mode };
    $('brushStatus').classList.remove('error');
    const extent = options.basis === 'face' ? options.size[0] + ' × ' + options.size[1] + ' 면 · 깊이 ' + options.size[2] + '칸' : 'X·Y·Z ' + options.size.join(' × ');
    $('brushStatus').textContent = extent + ' · ' + format(count) + '개 ' + (mode === 'remove' ? '파내기' : '더하기') + (pressed ? '\n버튼을 떼면 이 영역에 한 번 적용합니다.' : '\n미리보기 영역을 확인하고 클릭하세요.');
    return region;
  }

  function drawBrushPreview(context, preview, f) {
    const { region, normal, mode } = preview, axis = normal.findIndex((v) => v !== 0);
    if (axis < 0) return;
    const others = [0,1,2].filter((i) => i !== axis), lo = [...region.start], hi = G.add(region.start, region.size);
    const plane = mode === 'remove' ? (normal[axis] > 0 ? hi[axis] : lo[axis]) : (normal[axis] > 0 ? lo[axis] : hi[axis]);
    const vertices = [[0,0],[1,0],[1,1],[0,1]].map((v) => { const p=[...lo]; p[axis]=plane; p[others[0]]=v[0]?hi[others[0]]:lo[others[0]]; p[others[1]]=v[1]?hi[others[1]]:lo[others[1]]; return p; });
    context.save(); context.strokeStyle = mode === 'remove' ? '#a2463d' : '#35765e'; context.fillStyle = mode === 'remove' ? '#a2463d35' : '#35765e35'; context.lineWidth=2;
    tracePolygon(context, vertices.map(f.project)); context.fill(); context.stroke();
    context.lineWidth=.6;
    for (let i=0;i<2;i++) { const a=others[i], b=others[1-i]; if(region.size[a]>20)continue; for(let v=lo[a]+1;v<hi[a];v++){const p=[...lo],q=[...lo];p[axis]=q[axis]=plane;p[a]=q[a]=v;q[b]=hi[b];strokeLine(context,f.project(p),f.project(q));} }
    const depth=region.size[axis];
    if(depth>1){context.setLineDash([4,4]);context.lineWidth=1;for(const p of vertices){const q=[...p];q[axis]+=mode==='remove'?-normal[axis]*depth:normal[axis]*depth;strokeLine(context,f.project(p),f.project(q));} }
    context.restore();
  }

  function hoverAt(p) {
    const hit = hitAt(p); $('pointerInfo').textContent = hit ? 'X ' + hit.cell[0] + ' / Y ' + hit.cell[1] + ' / Z ' + hit.cell[2] : 'X — / Y — / Z —';
    if (state.pointMode || state.labelMode) hover = { point: snapPoint(p) };
    else if (state.tool === 'add' || state.tool === 'remove') {
      const target = hit || (state.tool === 'add' ? groundHit(p) : null);
      try { if (target) showBrushPreview(target, brushOptions(), state.tool); else { hover = null; resetBrushStatus(); } }
      catch (err) { hover = null; $('brushStatus').textContent = err.message; $('brushStatus').classList.add('error'); }
    } else hover = null;
    requestRender();
  }

  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return { distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
  }

  function nearestEdge(p) {
    let best = null, min = 9;
    for (const e of frame?.screenEdges || []) {
      const result = distanceToSegment(p, e.sa, e.sb);
      if (result.distance < min && pointVisible(G.add(e.a, G.mul(G.sub(e.b, e.a), result.t)), frame)) { min = result.distance; best = e; }
    }
    return best;
  }

  function clippedSegment(a, b, rectangle) {
    let lo = 0, hi = 1;
    for (const axis of ['x', 'y']) {
      const delta = b[axis] - a[axis], min = rectangle[axis + '0'], max = rectangle[axis + '1'];
      if (Math.abs(delta) < 1e-9) { if (a[axis] < min || a[axis] > max) return null; continue; }
      const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return null;
    }
    return [lo, hi];
  }

  function snapPoint(p) {
    let result = null, distance = 13;
    for (const edge of frame?.screenEdges || []) {
      for (const q of [edge.a, edge.b]) {
        const screen = frame.project(q), d = Math.hypot(screen.x - p.x, screen.y - p.y);
        if (d < distance && pointVisible(q, frame)) { result = q; distance = d; }
      }
    }
    if (result) return [...result];
    const edge = nearestEdge(p);
    if (edge) {
      const { t } = distanceToSegment(p, edge.sa, edge.sb);
      const q = G.add(edge.a, G.mul(G.sub(edge.b, edge.a), t)).map(Math.round);
      if (pointVisible(q, frame)) return q;
    }
    const hit = hitAt(p); return hit ? hit.point.map(Math.round) : null;
  }

  function hitDimension(p) { return (frame?.dimensions || []).slice().reverse().find((d) => p.x >= d.hit.x && p.x <= d.hit.x + d.hit.w && p.y >= d.hit.y && p.y <= d.hit.y + d.hit.h); }

  function pinSelected() {
    const dims = selectedDimensions(); if (!dims.length) return;
    if (state.dimensions.length + dims.length > 200) { message('고정 치수는 200개까지 저장할 수 있습니다.', true); return; }
    pushHistory(snapshot());
    for (const d of dims) state.dimensions.push({ id: 'dim-' + (++dimensionSerial) + '-' + Date.now(), a: [...d.a], b: [...d.b], offset: d.offset, visible: true });
    state.selection.clear(); state.settings.annotations = true; $('showDimensions').checked = true;
    updateSelection(); updateDimensionList(); scheduleSave(); message('치수선을 고정했습니다. 숫자를 더블클릭해 수정할 수 있어요.');
  }

  function pointClick(p) {
    const q = snapPoint(p); if (!q) { message('도형의 꼭짓점이나 격자 교차점을 눌러 주세요.'); return; }
    if (state.labelMode) {
      const existing = state.labels.find((l) => G.length(G.sub(l.at, q)) === 0);
      openLabel(existing || { id: null, at: q, text: '' }); return;
    }
    if (!state.points.length) { state.points = [q]; $('pointHint').textContent = '두 번째 점을 선택하세요. 같은 축의 두 점은 길이 수정도 가능합니다.'; requestRender(); return; }
    if (G.length(G.sub(state.points[0], q)) === 0) { message('첫 번째 점과 다른 점을 골라 주세요.'); return; }
    if (state.dimensions.length >= 200) { message('고정 치수는 200개까지입니다.', true); return; }
    pushHistory(snapshot()); state.dimensions.push({ id: 'dim-' + (++dimensionSerial) + '-' + Date.now(), a: state.points[0], b: q, offset: 44, visible: true });
    state.settings.annotations = true; $('showDimensions').checked = true; state.points = [];
    $('pointHint').textContent = '첫 번째 점을 선택하세요. Escape로 종료합니다.';
    updateDimensionList(); requestRender(); scheduleSave(); message('두 점 사이의 실제 길이를 표시했습니다.');
  }

  function preparePaint(active, p) {
    const hit = hitAt(p) || (active.mode === 'add' ? groundHit(p) : null);
    if (!hit) return;
    const axis = hit.normal.findIndex((v) => v !== 0);
    active.plane = { axis, coordinate: hit.point[axis], cellCoordinate: hit.cell[axis], normal: hit.normal };
    active.firstHit = hit; active.lastCell = hit.cell;
    active.pending = showBrushPreview(hit, active.options, active.mode, true); requestRender();
  }

  function applyPaint(active, region) {
    const id = G.key(region.start); if (active.visited.has(id)) return; active.visited.add(id);
    try {
      const result = G.editRegion(state.cells, region.start, region.size, active.mode);
      if (!result.changed) return;
      state.cells = result.cells; active.changed = true; active.totalChanged += result.changed; state.selection.clear();
      hover = { region, normal: active.plane.normal, mode: active.mode };
      rebuild();
      $('brushStatus').textContent = format(active.totalChanged) + '개 ' + (active.mode === 'remove' ? '파냄' : '더함') + (active.dragging ? ' · 같은 평면을 따라 드래그 중' : ' · 한 번 적용 완료');
    } catch (e) { if (!active.errorShown) message(e.message, true); active.errorShown = true; }
  }

  function paintSweep(active, p) {
    if (!active.plane) preparePaint(active, p);
    if (!active.plane) return;
    if (!active.dragging) { active.dragging = true; applyPaint(active, active.pending); }
    const r=frame.ray(p), plane=active.plane, d=r.direction[plane.axis]; if(Math.abs(d)<1e-7)return;
    const t=(plane.coordinate-r.origin[plane.axis])/d;if(t<0)return;
    const q=G.add(r.origin,G.mul(r.direction,t)),cell=q.map(Math.floor);cell[plane.axis]=plane.cellCoordinate;
    const delta=G.sub(cell,active.lastCell),steps=Math.max(...delta.map(Math.abs));
    for(let i=1;i<=steps;i++){
      const next=active.lastCell.map((v,j)=>Math.round(v+delta[j]*i/steps));
      applyPaint(active,brushForHit({cell:next,normal:plane.normal},active.options,active.mode));
    }
    active.lastCell=cell;
  }

  function cancelActivePointer() {
    if (!pointer) return; const active=pointer;pointer=null;
    if (canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
    if ((active.kind==='paint'&&active.changed)||(active.kind==='annotation'&&active.moved)) restore(active.original);
    hover=null;$('selectionBox').style.display='none';resetBrushStatus();requestRender();
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Two fingers pinch-zoom the solid on phones and tablets; one finger keeps the current tool.
  const touchPoints = new Map(); let pinchDistance = 0;
  const pinchGap = () => { const [a, b] = [...touchPoints.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.size === 2) { cancelActivePointer(); pinchDistance = Math.max(10, pinchGap()); }
    if (touchPoints.size >= 2) e.stopImmediatePropagation();
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!touchPoints.has(e.pointerId)) return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.size < 2) return;
    e.stopImmediatePropagation();
    const gap = Math.max(10, pinchGap()); zoom(gap / pinchDistance); pinchDistance = gap;
  }, true);
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => {
    if (!touchPoints.delete(e.pointerId)) return;
    if (touchPoints.size >= 1 && pinchDistance) e.stopImmediatePropagation();
    if (!touchPoints.size) pinchDistance = 0;
  }, true);
  canvas.addEventListener('pointerdown', (e) => {
    if (pointer || !frame) return;
    const p = eventPoint(e); canvas.setPointerCapture(e.pointerId);
    const pan = e.button === 1 || spacePressed;
    if (pan) pointer = { kind: 'pan', start: p, panX: state.view.panX, panY: state.view.panY, id: e.pointerId };
    else if (e.button === 2 || e.altKey) pointer = { kind: 'orbit', start: p, yaw: state.view.yaw, pitch: state.view.pitch, id: e.pointerId };
    else if (e.button === 0) {
      const dimension = hitDimension(p);
      if (dimension && !dimension.textStyle && !state.pointMode && !state.labelMode) pointer = { kind: 'annotation', start: p, dimension, original: snapshot(), moved: false, id: e.pointerId };
      else if (state.tool === 'orbit') pointer = { kind: 'orbit', start: p, yaw: state.view.yaw, pitch: state.view.pitch, id: e.pointerId };
      else if (state.tool === 'measure') pointer = { kind: state.pointMode || state.labelMode ? 'point' : 'select', start: p, end: p, shift: e.shiftKey, id: e.pointerId };
      else {
        try {
          const options=brushOptions(), signature=options.basis+':'+options.size.join(',');
          const rapid=lastBrushClick&&lastBrushClick.mode===state.tool&&lastBrushClick.signature===signature&&performance.now()-lastBrushClick.at<320&&Math.hypot(p.x-lastBrushClick.p.x,p.y-lastBrushClick.p.y)<=4;
          if(rapid){pointer={kind:'ignored-paint',start:p,id:e.pointerId};$('brushStatus').textContent='빠른 중복 클릭을 무시했습니다. 더 깊게 파려면 잠시 후 다시 클릭하세요.';}
          else{pointer={kind:'paint',start:p,id:e.pointerId,original:snapshot(),mode:state.tool,options,signature,dragEnabled:$('dragPaint').checked,dragging:false,changed:false,totalChanged:0,visited:new Set()};preparePaint(pointer,p);}
        }catch(err){message(err.message,true);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}
      }
    }
    if (pointer) e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = eventPoint(e);
    if (!pointer) { hoverAt(p); canvas.style.cursor = hitDimension(p) ? 'move' : state.tool === 'orbit' ? 'grab' : 'crosshair'; return; }
    if (e.pointerId !== pointer.id) return;
    const dx = p.x - pointer.start.x, dy = p.y - pointer.start.y;
    if (pointer.kind === 'orbit') {
      delete state.view.projection; // Dragging turns a 겨냥도 back into a free rotation.
      state.view.yaw = pointer.yaw + dx * .007; state.view.pitch = Math.max(-.95, Math.min(Math.PI / 2, pointer.pitch + dy * .007));
      document.querySelectorAll('[data-view]').forEach((el) => el.classList.remove('active'));
      $('viewTitle').textContent = '자유 시점 · 정투영'; canvas.style.cursor = 'grabbing'; requestRender();
    } else if (pointer.kind === 'pan') {
      state.view.panX = pointer.panX + dx; state.view.panY = pointer.panY + dy; state.view.autoFit = false; requestRender();
    } else if (pointer.kind === 'paint') {
      const moved=Math.hypot(dx,dy)>=8;
      if(moved&&pointer.dragEnabled)paintSweep(pointer,p);
      else if(moved){pointer.cancelled=true;hover=null;$('brushStatus').textContent='마우스가 크게 움직여 클릭을 취소합니다. 드래그 편집을 켜면 연속으로 편집할 수 있어요.';requestRender();}
    }
    else if (pointer.kind === 'select') {
      pointer.end = p;
      if (Math.hypot(dx, dy) > 4) {
        const s = $('selectionBox'); s.style.display = 'block'; s.style.left = Math.min(p.x, pointer.start.x) + 'px'; s.style.top = Math.min(p.y, pointer.start.y) + 'px'; s.style.width = Math.abs(dx) + 'px'; s.style.height = Math.abs(dy) + 'px';
      }
    } else if (pointer.kind === 'annotation' && Math.hypot(dx, dy) > 3) {
      pointer.moved = true;
      const d = pointer.dimension, offset = d.offset + dx * d.normal[0] + dy * d.normal[1];
      if (d.kind === 'overall') state.overallOffsets[d.axis] = Math.max(-1000, Math.min(1000, offset));
      else if (d.kind === 'pinned') { const item = state.dimensions.find((v) => v.id === d.id); if (item) item.offset = Math.max(-1000, Math.min(1000, offset)); }
      requestRender();
    }
  });

  function endPointer(e, cancel = false) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const active = pointer, p = eventPoint(e); pointer = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    $('selectionBox').style.display = 'none';
    if(active.kind==='paint'){
      if(cancel){if(active.changed)restore(active.original);resetBrushStatus();}
      else{
        if(!active.dragging&&!active.cancelled&&active.pending)applyPaint(active,active.pending);
        if(active.changed){pushHistory(active.original);scheduleSave();if(!active.dragging)lastBrushClick={p:active.start,mode:active.mode,signature:active.signature,at:performance.now()};}
      }
      hover=null;requestRender();
    }
    else if (active.kind === 'annotation' && active.moved) { if(cancel)restore(active.original);else{pushHistory(active.original);scheduleSave();} }
    else if (active.kind === 'point' && !cancel) pointClick(p);
    else if (active.kind === 'select' && !cancel) {
      if (!active.shift) state.selection.clear();
      if (Math.hypot(p.x - active.start.x, p.y - active.start.y) < 5) {
        const edge = nearestEdge(p);
        if (edge) { if (active.shift && state.selection.has(edge.id)) state.selection.delete(edge.id); else state.selection.add(edge.id); }
      } else {
        const x0 = Math.min(p.x, active.start.x), x1 = Math.max(p.x, active.start.x), y0 = Math.min(p.y, active.start.y), y1 = Math.max(p.y, active.start.y);
        for (const edge of frame.screenEdges) {
          const interval = clippedSegment(edge.sa, edge.sb, { x0, x1, y0, y1 });
          if (!interval) continue;
          const samples = [interval[0], (interval[0] + interval[1]) / 2, interval[1]];
          if (samples.some((t) => pointVisible(G.add(edge.a, G.mul(G.sub(edge.b, edge.a), t)), frame))) state.selection.add(edge.id);
        }
      }
      updateSelection();
    } else if (active.kind === 'orbit') scheduleSave();
    if(active.kind!=='paint'&&active.kind!=='ignored-paint')hoverAt(p); canvas.style.cursor = state.tool === 'orbit' ? 'grab' : 'crosshair';
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('pointerleave', () => { if (!pointer) { hover = null; requestRender(); } });
  canvas.addEventListener('dblclick', (e) => { const d = hitDimension(eventPoint(e)); if (d && d.kind !== 'selection') openDimension(d); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * .001)); }, { passive: false });

  function zoom(factor) { state.view.scale = Math.max(.3, Math.min(220, state.view.scale * factor)); state.view.autoFit = false; hover = null; requestRender(); }

  function openDimension(d) {
    const changedAxes = G.sub(d.b, d.a).map((v, i) => v ? i : -1).filter((i) => i >= 0);
    if (changedAxes.length !== 1) { message('사선은 거리 측정만 가능합니다. 도형을 바꾸려면 X·Y·Z 중 한 축의 치수를 선택해 주세요.', true); return; }
    dialogDimension = { ...d, axis: changedAxes[0] };
    $('dimensionValue').value = Number(physicalLength(d).toFixed(5)); $('dimensionValue').step = 'any'; $('dimensionValue').min = state.unit;
    $('dimensionDialogDescription').textContent = axisNames[dialogDimension.axis] + ' 방향의 ' + labelOf(d) + '를 수정합니다. 이 구간과 연결된 면을 이동합니다.';
    $('dimensionGridHint').textContent = '한 칸 ' + format(state.unit) + state.unitLabel + '의 배수로 입력하세요. 파낸 부분도 이 축을 따라 늘거나 줄며, 작은 부분은 격자에 맞춰 바뀔 수 있습니다.';
    $('dimensionLabel').value = d.label ?? ''; $('dimensionQuestion').checked = d.question === true;
    $('dimensionError').textContent = ''; $('dimensionForm').elements.anchor.value = 'start';
    $('dimensionDialog').showModal(); setTimeout(() => { $('dimensionValue').focus(); $('dimensionValue').select(); }, 30);
  }

  $('dimensionForm').addEventListener('submit', (e) => {
    e.preventDefault(); $('dimensionError').textContent = '';
    const d = dialogDimension; if (!d) return;
    try {
      const newLength = value('dimensionValue'), span = newLength / state.unit;
      if (!Number.isFinite(newLength) || newLength <= 0) throw new Error('0보다 큰 길이를 입력해 주세요.');
      if (Math.abs(span - Math.round(span)) > 1e-5) throw new Error('현재 한 칸은 ' + format(state.unit) + state.unitLabel + '입니다. 길이는 이 값의 배수여야 합니다.');
      const text = $('dimensionLabel').value.trim(), meta = { ...(text ? { label: text } : {}), ...($('dimensionQuestion').checked ? { question: true } : {}) };
      if (text.length > 30) throw new Error('표시 글자는 30자 이내로 입력해 주세요.');
      const lo = Math.min(d.a[d.axis], d.b[d.axis]), hi = Math.max(d.a[d.axis], d.b[d.axis]), resized = Math.round(span) !== hi - lo;
      const metaChanged = JSON.stringify(meta) !== JSON.stringify(labelMeta(d));
      if (!resized && !metaChanged) { $('dimensionDialog').close(); message('바뀐 내용이 없습니다.'); return; }
      let result = null;
      try { if (resized) result = G.resizeInterval(state.cells, d.axis, lo, hi, Math.round(span), $('dimensionForm').elements.anchor.value); }
      catch (err) { if (err.minSpan) throw new Error('이 구간은 모양이 ' + err.minSpan + '조각으로 나뉘어 있어 최소 ' + format(err.minSpan * state.unit) + state.unitLabel + ' 이상이어야 모양이 유지됩니다.'); throw err; }
      pushHistory(snapshot());
      if (d.kind === 'overall') state.overallMeta[d.axis] = meta;
      else state.dimensions = state.dimensions.map((v) => { if (v.id !== d.id) return v; const { label, question, ...rest } = v; return { ...rest, ...meta }; });
      if (result) {
        state.cells = result.cells;
        state.dimensions = state.dimensions.map((v) => ({ ...v, a: result.mapPoint(v.a), b: result.mapPoint(v.b) })).filter((v) => G.length(G.sub(v.b, v.a)) > 0);
        state.labels = state.labels.map((l) => ({ ...l, at: result.mapPoint(l.at) }));
        state.selection.clear(); state.points = []; hover = null; previewRegion = null;
      }
      rebuild(); if (result) fitView(); scheduleSave(); $('dimensionDialog').close();
      message(result ? axisNames[d.axis] + ' 치수와 실제 도형을 ' + format(newLength) + state.unitLabel + '로 바꿨습니다.' : '치수 표시를 바꿨습니다.');
    } catch (err) { $('dimensionError').textContent = err.message; }
  });
  $('cancelDimensionBtn').addEventListener('click', () => $('dimensionDialog').close());

  $('labelForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const l = dialogLabel, text = $('labelText').value.trim(); if (!l) return;
    if (!text || text.length > 12) { $('labelError').textContent = '이름은 1~12자로 입력해 주세요.'; return; }
    pushHistory(snapshot());
    if (l.id) state.labels = state.labels.map((v) => v.id === l.id ? { ...v, text } : v);
    else {
      let n = state.labels.length + 1; while (state.labels.some((v) => v.id === 'label-' + n)) n++;
      state.labels = [...state.labels, { id: 'label-' + n, at: [...l.at], text, visible: true }];
    }
    state.settings.labels = true; syncControls();
    $('labelDialog').close(); updateDimensionList(); requestRender(); scheduleSave();
  });
  $('cancelLabelBtn').addEventListener('click', () => $('labelDialog').close());

  async function download(blob, name) {
    if (desktop) {
      const kind = name.split('.').pop().toLowerCase();
      const data = kind === 'png' ? new Uint8Array(await blob.arrayBuffer()) : await blob.text();
      const result = await desktop.saveFile({ kind, data, suggestedName: name });
      if (result.status === 'cancelled') return false;
      if (result.status !== 'saved') throw new Error(result.error || '파일을 저장하지 못했습니다.');
      return true;
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    return true;
  }

  // Every export uses the same SVG as the command-line tool; PNG is that SVG rasterized.
  function exportedSvg() {
    return R.renderSvg(projectData(), { geometry, answers: state.answers, preset: $('exportPreset').value || undefined });
  }
  const exportName = (ext) => '입체도형_' + stamp() + (state.answers ? '_정답' : '') + '.' + ext;

  async function exportSvg() {
    if (!state.cells.size) { message('먼저 도형을 만들어 주세요.'); return; }
    try {
      const saved = await download(new Blob([exportedSvg()], { type: 'image/svg+xml;charset=utf-8' }), exportName('svg'));
      message(saved ? (desktop ? 'SVG 그림을 저장했습니다.' : 'SVG 그림 저장을 요청했습니다.') : '그림 저장을 취소했습니다.');
    } catch (error) { message(error.message, true); }
  }

  function svgToPngBlob(svg, scale) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })), image = new Image();
      image.onload = () => {
        const out = document.createElement('canvas'); out.width = Math.ceil(image.width * scale); out.height = Math.ceil(image.height * scale);
        const context = out.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, out.width, out.height);
        context.scale(scale, scale); context.drawImage(image, 0, 0); URL.revokeObjectURL(url);
        out.toBlob((blob) => blob ? resolve(blob) : reject(new Error('그림 저장에 실패했습니다.')), 'image/png');
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('그림을 PNG로 바꾸지 못했습니다.')); };
      image.src = url;
    });
  }

  async function exportPng() {
    if (!state.cells.size) { message('먼저 도형을 만들어 주세요.'); return; }
    try {
      const saved = await download(await svgToPngBlob(exportedSvg(), 3), exportName('png'));
      message(saved ? (desktop ? '고해상도 PNG 그림을 저장했습니다.' : 'PNG 그림 저장을 요청했습니다.') : '그림 저장을 취소했습니다.');
    } catch (error) { message(error.message, true); }
  }

  async function copySvg() {
    if (!state.cells.size) { message('먼저 도형을 만들어 주세요.'); return; }
    try {
      const svg = exportedSvg();
      if (desktop) { if (!await desktop.copyText(svg)) throw new Error(); }
      else { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(svg); }
      message('SVG 코드를 복사했습니다 (' + format(svg.length) + '자). 문서나 figure_svg에 붙여 넣으세요.');
    } catch { message('클립보드에 복사하지 못했습니다. SVG 저장을 사용하세요.', true); }
  }

  async function openProjectFile() {
    if (!desktop) { $('fileInput').click(); return; }
    try {
      const result = await desktop.openProject();
      if (result.status === 'cancelled') return;
      if (result.status !== 'opened') throw new Error(result.error || '도형을 불러오지 못했습니다.');
      if (result.data?.format === 'solidlab-diagram') { openDiagram(result.data); return; }
      G.validateProject(result.data); requestProjectAction({ kind: 'load', data: result.data });
    } catch (error) {
      if ($('startupDialog').open) $('startupError').textContent = error.message; else message(error.message, true);
    }
  }

  $('createBtn').addEventListener('click', makeCuboid);
  $('demoBtn').addEventListener('click', () => {
    lastBrushClick = null;
    pushHistory(snapshot()); state.cells = G.editRegion(G.cuboid([14, 15, 17]), [7, 7, 10], [7, 8, 7], 'remove').cells;
    state.dimensions = []; state.overallVisible.fill(true); state.overallOffsets.fill(46); state.selection.clear(); previewRegion = null; hover = null;
    rebuild(); setView('iso'); scheduleSave(); message('모서리를 파낸 계단 예제를 만들었습니다.');
  });
  $('clearBtn').addEventListener('click', () => { lastBrushClick=null;pushHistory(snapshot()); state.cells = new Set(); state.dimensions = []; state.selection.clear(); previewRegion = null; hover = null; rebuild(); fitView(); scheduleSave(); });
  $('regionAddBtn').addEventListener('click', () => applyRegion('add'));
  $('regionRemoveBtn').addEventListener('click', () => applyRegion('remove'));
  $('previewRegionBtn').addEventListener('click', () => {
    $('regionError').textContent = '';
    if (previewRegion) { previewRegion = null; $('previewRegionBtn').textContent = '영역 미리보기'; requestRender(); return; }
    try { const r = regionInput(); G.editRegion(new Set(), r.start, r.size, 'remove'); previewRegion = r; $('previewRegionBtn').textContent = '미리보기 닫기'; requestRender(); }
    catch (e) { $('regionError').textContent = e.message; }
  });
  for (const id of ['regionX','regionY','regionZ','regionW','regionD','regionH']) $(id).addEventListener('input', () => { previewRegion = null; $('previewRegionBtn').textContent = '영역 미리보기'; requestRender(); });
  $('unitSize').addEventListener('change', () => {
    const unit = value('unitSize');
    if (!Number.isFinite(unit) || unit <= 0 || unit > 1000) { $('unitSize').value = state.unit; message('한 칸 길이는 0보다 크고 1000 이하인 값으로 입력해 주세요.', true); return; }
    pushHistory(snapshot()); state.unit = unit; rebuild(); scheduleSave();
  });
  $('unitLabel').addEventListener('change', () => { pushHistory(snapshot()); state.unitLabel = $('unitLabel').value; rebuild(); scheduleSave(); });
  document.querySelectorAll('[data-tool]').forEach((el) => el.addEventListener('click', () => setTool(el.dataset.tool)));
  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => setView(el.dataset.view)));
  document.querySelectorAll('[data-brush]').forEach((el) => el.addEventListener('click', () => { $('brushX').value=$('brushY').value=el.dataset.brush;if($('brushBasis').value==='xyz')$('brushZ').value=el.dataset.brush;else if(el.dataset.brush==='1')$('brushZ').value=1;lastBrushClick=null;hover=null;resetBrushStatus();requestRender();scheduleSave(); }));
  $('brushBasis').addEventListener('change',()=>{lastBrushClick=null;updateBrushControls();scheduleSave();});
  $('dragPaint').addEventListener('change',()=>{lastBrushClick=null;resetBrushStatus();scheduleSave();});
  for(const id of ['brushX','brushY','brushZ'])$(id).addEventListener('change',()=>{lastBrushClick=null;hover=null;resetBrushStatus();requestRender();scheduleSave();});
  $('twoPointBtn').addEventListener('click', () => {
    if (state.pointMode) { setTool('measure'); return; }
    setTool('measure'); state.pointMode = true; state.selection.clear(); state.points = [];
    $('twoPointBtn').classList.add('active'); $('pointHint').textContent = '첫 번째 점을 선택하세요. Escape로 종료합니다.'; $('pointHint').style.display = 'block'; updateSelection();
  });
  $('pinDimensionBtn').addEventListener('click', pinSelected);
  $('measurementMode').addEventListener('change', () => { state.measurementMode = $('measurementMode').value; updateSelection(); scheduleSave(); });
  $('clearSelectionBtn').addEventListener('click', () => { state.selection.clear(); state.points = []; updateSelection(); });
  $('showAllDimensionsBtn').addEventListener('click', () => setAllDimensionsVisible(true));
  $('hideAllDimensionsBtn').addEventListener('click', () => setAllDimensionsVisible(false));
  const settingInputs = { showGrid: 'grid', showFloor: 'floor', showOverall: 'overall', showDimensions: 'annotations', showHidden: 'hidden', showLabels: 'labels' };
  for (const [id, setting] of Object.entries(settingInputs)) $(id).addEventListener('change', () => { pushHistory(snapshot()); state.settings[setting] = $(id).checked; updateDimensionList(); requestRender(); scheduleSave(); });
  for (const [id, setting] of [['figureStyle', 'style'], ['dimStyle', 'dimStyle']]) $(id).addEventListener('change', () => { pushHistory(snapshot()); state.settings[setting] = $(id).value; requestRender(); scheduleSave(); });
  $('showAnswers').addEventListener('change', () => { state.answers = $('showAnswers').checked; requestRender(); });
  $('labelModeBtn').addEventListener('click', () => {
    if (state.labelMode) { setTool('measure'); return; }
    setTool('measure'); state.labelMode = true; state.selection.clear(); state.points = [];
    $('labelModeBtn').classList.add('active'); $('pointHint').textContent = '이름을 붙일 꼭짓점을 누르세요. Escape로 종료합니다.'; $('pointHint').style.display = 'block'; updateSelection();
  });
  $('presentationBtn').addEventListener('click', () => {
    presentation = !presentation;
    if (presentation) { editingSettings = { grid: state.settings.grid, floor: state.settings.floor }; state.settings.grid = false; state.settings.floor = false; state.selection.clear(); setTool('orbit'); }
    else if (editingSettings) Object.assign(state.settings, editingSettings);
    $('presentationBtn').textContent = presentation ? '편집 보기' : '완성 보기'; syncControls(); updateSelection(); requestRender(); scheduleSave();
  });
  $('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo);
  $('fitBtn').addEventListener('click', fitView); $('zoomInBtn').addEventListener('click', () => zoom(1.2)); $('zoomOutBtn').addEventListener('click', () => zoom(1 / 1.2));
  $('newBtn').addEventListener('click', () => requestProjectAction({ kind: 'new' }));
  $('saveBtn').addEventListener('click', saveProjectFile);
  $('loadBtn').addEventListener('click', openProjectFile);
  $('restorePreviousBtn').addEventListener('click', () => { if (recoveryData) requestProjectAction({ kind: 'recover', data: recoveryData }); });
  $('startupNewBtn').addEventListener('click', () => commitProjectAction({ kind: 'new' }));
  $('continueProjectBtn').addEventListener('click', () => { if (startupDraft) commitProjectAction({ kind: 'continue', data: startupDraft }); });
  $('startupLoadBtn').addEventListener('click', openProjectFile);
  $('startupDialog').addEventListener('cancel', (e) => e.preventDefault());
  $('cancelProjectBtn').addEventListener('click', () => { pendingProjectAction = null; $('projectChangeDialog').close(); });
  $('projectChangeDialog').addEventListener('cancel', () => { pendingProjectAction = null; });
  $('discardProjectBtn').addEventListener('click', () => applyPendingProject(false));
  $('saveThenProjectBtn').addEventListener('click', () => applyPendingProject(true));
  $('fileInput').addEventListener('change', async () => {
    const file = $('fileInput').files[0]; if (!file) return;
    try {
      if (file.size > 15000000) throw new Error('도형 파일은 15MB 이하로 불러올 수 있습니다.');
      const data = JSON.parse(await file.text());
      if (data?.format === 'solidlab-diagram') { openDiagram(data); return; }
      G.validateProject(data); requestProjectAction({ kind: 'load', data });
    } catch (e) {
      const text = e instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : e.message;
      if ($('startupDialog').open) $('startupError').textContent = text; else message(text, true);
    }
    finally { $('fileInput').value = ''; }
  });
  $('exportSvgBtn').addEventListener('click', exportSvg); $('exportPngBtn').addEventListener('click', exportPng); $('copySvgBtn').addEventListener('click', copySvg);
  const toolFolder = desktop ? '설치 폴더의 resources\\app.asar.unpacked (보통 %LOCALAPPDATA%\\Programs\\SolidLab\\resources\\app.asar.unpacked)' : '이 앱 폴더';
  const aiPrompt = '첨부한 입체도형 JSON을 읽고 실제 크기, 치수선별 길이와 숨김 상태를 확인해 줘. 수정 요청이 있으면 원본은 보존하고 새 JSON 파일로 만들어 줘.\n\nSolidLab 도구는 ' + toolFolder + '에 있어. 그 폴더의 AI_도형_연동.md를 먼저 읽고 node model-tools.cjs를 써. 순서는 inspect → 수정 → check(경고 확인) → views(앞·옆·위 모양 확인) → render.\n\n그림은 node model-tools.cjs render "도형.json" "확인.png"로 PNG를 만들어 직접 눈으로 확인하고, 학습지에 넣을 SVG는 --preset worksheet로 만들어. 실제 길이는 칸 수 × unit이야. 치수 숫자 대신 실제 형상을 고치고, 요청하지 않은 숨김·격자 설정은 유지해.';
  $('aiHelpBtn').addEventListener('click', () => { $('aiPrompt').value = aiPrompt; $('aiCopyStatus').textContent = ''; $('aiDialog').showModal(); });
  $('closeAiBtn').addEventListener('click', () => $('aiDialog').close());
  $('copyAiPromptBtn').addEventListener('click', async () => {
    try {
      if (desktop) { if (!await desktop.copyText(aiPrompt)) throw new Error(); }
      else { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(aiPrompt); }
      $('aiCopyStatus').textContent = '복사했습니다. JSON 파일과 함께 전달하세요.';
    }
    catch { $('aiPrompt').focus(); $('aiPrompt').select(); $('aiCopyStatus').textContent = '요청문을 선택했습니다. Ctrl+C로 복사하세요.'; }
  });
  // Explicit local API: no network or automatic connection to an AI service.
  window.SolidStudio = Object.freeze({
    version: 2,
    exportProject: () => JSON.parse(JSON.stringify(projectData())),
    getSummary: () => G.describeProject(projectData()),
    getSelectedDimensions: () => selectedDimensions().map((d) => ({ ...d, a: [...d.a], b: [...d.b], length: physicalLength(d) })),
    validateProject: (data) => G.describeProject(data),
    importProject: (data) => { cancelActivePointer(); loadData(data); return G.describeProject(projectData()); },
    setDimensionVisible: (id, visible) => { cancelActivePointer(); setDimensionVisible(id, visible); return G.describeProject(projectData()); }
  });
  document.addEventListener('keydown', (e) => {
    if (diagramMode()) return;
    if(pointer){if(e.key==='Escape')cancelActivePointer();e.preventDefault();return;}
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProjectFile(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openProjectFile(); return; }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { spacePressed = true; e.preventDefault(); }
    const shortcuts = { v: 'orbit', a: 'add', d: 'remove', m: 'measure' };
    if (shortcuts[e.key.toLowerCase()]) setTool(shortcuts[e.key.toLowerCase()]);
    if (e.key === 'Escape') { state.selection.clear(); setTool(state.tool); updateSelection(); previewRegion = null; requestRender(); }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') spacePressed = false; });
  if (desktop) desktop.onCommand((command) => {
    const modal = document.querySelector('dialog[open]');
    // Closing the window always works: a small open dialog is dismissed first.
    if (command === 'close') {
      if (window.SolidDiagramApp?.dirty() && !window.confirm('저장하지 않은 평면 그림이 있습니다. 그래도 닫을까요?')) return;
      if (modal && !['startupDialog', 'projectChangeDialog'].includes(modal.id)) modal.close(); requestProjectAction({ kind: 'close' }); return;
    }
    if (diagramMode() && !modal) { window.SolidDiagramApp.command(command); return; }
    if (modal && modal.id !== 'startupDialog') return;
    if (command === 'new') { if (modal) $('startupNewBtn').click(); else $('newBtn').click(); }
    else if (command === 'open') openProjectFile();
    else if (command === 'save' && sessionReady) saveProjectFile();
    else if (command === 'svg' && sessionReady) exportSvg();
    else if (command === 'png' && sessionReady) exportPng();
  });
  window.addEventListener('blur', () => { spacePressed = false; cancelActivePointer(); });
  window.addEventListener('beforeunload', () => { if (sessionReady) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData())); } catch {} } });
  const resizeObserver = new ResizeObserver(() => {
    const r = $('canvasWrap').getBoundingClientRect(); width = Math.max(1, r.width); height = Math.max(1, r.height);
    const ratio = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (state.view.autoFit) fitView(); else requestRender();
  });
  window.SolidLabShell = { desktop, message, download, updateDirty: updateDesktopDirty };
  resizeObserver.observe($('canvasWrap')); syncControls(); rebuild(); updateHistory(); updateBrushControls(); setTool('orbit'); prepareStartup();
})();
