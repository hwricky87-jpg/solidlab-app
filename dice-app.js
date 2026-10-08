/* The 전개도 view and dice editing, on top of the solid editor (app.js). The numbers, checks and
   answer comparison stay in model-tools.cjs (dice, net, check); this page only shows and edits. */
(() => {
  'use strict';
  const G = window.SolidGeometry, X = window.SolidDice, D = window.SolidDiagram, E = window.SolidLabEditor;
  if (!G || !X || !D || !E) return;
  const $ = (id) => document.getElementById(id);
  const DIRS = G.DIR_NAMES, KO = G.DIR_KO;
  const STANDARD = { top: 1, bottom: 6, front: 2, back: 5, left: 4, right: 3 };
  const picked = new Map(); // which net is shown, per box size
  let current = null; // { doc, kind, list, index, key }

  // --- 전개도 view ---------------------------------------------------------------------------
  // What the model is: one box (its real lengths), one die (cube nets with its faces), or neither.
  function source() {
    const p = G.validateProject(E.project()), box = G.bounds(p.cells);
    if (!box) return { kind: 'none', why: '도형이 비어 있습니다.' };
    if (p.cells.size === 1 && p.dice.length === 1) return { kind: 'die', die: p.dice[0], unitLabel: p.unitLabel };
    if (p.cells.size !== box.size.reduce((a, b) => a * b, 1)) return { kind: 'none', why: '전개도는 직육면체·정육면체(빈 곳 없는 상자 하나)나 주사위 하나일 때 보여 줍니다.\n쌓기나무 모양은 평면 모드에서 선으로 그리세요.' };
    return { kind: 'box', size: box.size.map((v) => Number((v * p.unit).toFixed(6))), unitLabel: p.unitLabel };
  }
  function netDoc(src, list, index) {
    const shape = list[index].design;
    if (src.kind === 'die') {
      const cells = X.unfoldNet(src.die.faces, shape.cells, { at: shape.base, dir: 'top', rot: 0 });
      return X.netDiagram({ cells: cells.map((c) => ({ at: c.at, ...(c.content.kind === 'pips' ? { pips: c.content.pips } : c.content.kind === 'text' ? { text: c.content.text } : {}), ...(c.rot ? { rot: c.rot } : {}), ...(c.lines ? { lines: c.lines } : {}) })) });
    }
    return X.boxDiagram({ ...shape, unitLabel: src.unitLabel, names: $('netNames').checked, dims: $('netDims').checked ? 'auto' : 'none' });
  }
  function refreshNet() {
    const stage = $('netStage');
    if (!E.netView()) { stage.hidden = true; return; }
    stage.hidden = false;
    let src;
    try { src = source(); } catch (error) { src = { kind: 'none', why: error.message }; }
    const bar = [$('netPrev'), $('netNext'), $('netToDiagram'), $('netNames'), $('netDims')];
    if (src.kind === 'none') {
      current = null; bar.forEach((el) => { el.disabled = true; });
      $('netCount').textContent = '–'; $('netInfo').textContent = '';
      $('netPicture').replaceChildren(Object.assign(document.createElement('p'), { className: 'net-empty', textContent: src.why }));
      return;
    }
    bar.forEach((el) => { el.disabled = false; });
    $('netNames').disabled = $('netDims').disabled = src.kind === 'die';
    const key = src.kind === 'die' ? 'die' : src.size.join('x');
    const list = X.boxNets(src.kind === 'die' ? [1, 1, 1] : src.size);
    const index = Math.min(picked.get(key) ?? 0, list.length - 1);
    const doc = netDoc(src, list, index);
    current = { doc, kind: src.kind, list, index, key };
    $('netCount').textContent = (index + 1) + ' / ' + list.length;
    // The text first: it takes room from the picture below it.
    if (src.kind === 'die') $('netInfo').textContent = '주사위를 펼친 전개도 ' + list.length + '가지 중 ' + (index + 1) + '번 · 윗면이 된 칸을 기준으로 펼쳤어요.';
    else {
      const design = { ...list[index].design, unitLabel: src.unitLabel }, lay = X.boxLayout(design), u = src.unitLabel;
      $('netInfo').textContent = '상자 ' + src.size.join(' × ') + ' ' + u + ' · 전개도 ' + list.length + '가지 중 ' + (index + 1) + '번\n'
        + '둘레 ' + lay.perimeter + ' ' + u + ' · 넓이 ' + lay.area + ' ' + u + '² (겉넓이와 같음)\n'
        + '접으면 만나는 점: ' + lay.meets.map((g) => g.join('=')).join(', ');
    }
    // Fit the picture in its box: draw once, then narrower if it came out too tall.
    const room = $('netPicture'), roomW = room.clientWidth - 32 || 480, roomH = room.clientHeight - 32 || 360;
    let width = Math.max(240, Math.min(620, roomW));
    room.innerHTML = D.renderSvg(doc, { width, style: 'print' });
    const drawnH = Number(room.querySelector('svg')?.getAttribute('height'));
    if (drawnH > roomH && roomH > 120) { width = Math.max(200, Math.floor(width * roomH / drawnH)); room.innerHTML = D.renderSvg(doc, { width, style: 'print' }); }
  }
  function step(delta) {
    if (!current) return;
    picked.set(current.key, (current.index + delta + current.list.length) % current.list.length);
    refreshNet();
  }
  $('netPrev').addEventListener('click', () => step(-1));
  $('netNext').addEventListener('click', () => step(1));
  $('netNames').addEventListener('change', refreshNet);
  $('netDims').addEventListener('change', refreshNet);
  $('netToDiagram').addEventListener('click', () => {
    if (!current || !window.SolidDiagramApp) return;
    if (window.SolidDiagramApp.load(JSON.parse(JSON.stringify(current.doc))) !== false) E.message('전개도를 평면 모드로 열었어요. ㉠·색칠·선을 더하고 그림으로 저장하세요.');
  });
  new ResizeObserver(() => { if (E.netView()) refreshNet(); }).observe($('canvasWrap'));

  // --- Dice editing ----------------------------------------------------------------------------
  // A face typed in a box: 1–12 are pips, other text is printed as is, empty is blank. The face
  // keeps its turn (up) and any lines it had.
  function typedFace(text, old) {
    const v = String(text).trim(), body = v === '' ? null : /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 12 ? Number(v) : v;
    if (body === null) return old && typeof old === 'object' && old.lines ? { up: old.up, lines: old.lines } : null;
    if (old && typeof old === 'object') return { [typeof body === 'number' ? 'pips' : 'text']: body, up: old.up, ...(old.lines ? { lines: old.lines } : {}) };
    return body;
  }
  const shown = (face) => face === null ? '' : typeof face === 'object' ? String(face.pips ?? face.text ?? '') : String(face);
  const sameCell = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  function edit(change, done) {
    try { const data = E.project(); change(data); E.edit(data); if (done) E.message(done); }
    catch (error) { $('diceInfo').textContent = error.message; $('diceInfo').classList.add('error'); }
  }
  function dieAt(data, cell) { return (data.dice || []).find((d) => sameCell(d.at, cell)); }
  function nextId(data) {
    const used = new Set((data.dice || []).map((d) => d.id));
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return c;
    for (let k = 1; ; k++) if (!used.has('D' + k)) return 'D' + k;
  }
  function refreshDice() {
    const cell = E.diceCell(), info = $('diceInfo');
    info.classList.remove('error');
    const data = E.project(), has = cell && G.validateProject(data).cells.has(G.key(cell));
    const die = has ? dieAt(data, cell) : null;
    $('dicePlace').hidden = !has || !!die; $('diceEditor').hidden = !die;
    const count = (data.dice || []).length;
    if (!has) { info.textContent = '주사위 도구(U)로 블록을 누르면 그 칸을 고릅니다.' + (count ? '\n이 도형의 주사위 ' + count + '개' : ''); return; }
    if (!die) { info.textContent = '칸 [' + cell.join(', ') + ']: 주사위가 없습니다.\n아래에서 놓을 수 있어요.'; return; }
    info.textContent = '주사위 ' + die.id + ' · 칸 [' + die.at.join(', ') + ']' + (die.marks && Object.keys(die.marks).length ? '\n학생용에서 가림: ' + Object.entries(die.marks).map(([d, t]) => KO[G.dirName(d)] + ' ' + t).join(', ') : '');
    const box = $('diceFaces');
    if (box.dataset.die !== die.id || box.childElementCount !== 6) {
      box.replaceChildren(...DIRS.map((d) => {
        const field = document.createElement('div'); field.className = 'field';
        const label = document.createElement('label'); label.htmlFor = 'diceFace-' + d; label.textContent = KO[d];
        const input = document.createElement('input'); input.id = 'diceFace-' + d; input.type = 'text'; input.maxLength = 12; input.dataset.dir = d;
        input.addEventListener('change', () => edit((x) => { const t = dieAt(x, E.diceCell()); t.faces[d] = typedFace(input.value, t.faces[d]); }));
        field.append(label, input); return field;
      }));
      box.dataset.die = die.id;
    }
    for (const d of DIRS) { const input = $('diceFace-' + d); if (document.activeElement !== input) input.value = shown(die.faces[d]); }
  }
  function select(cell) { refreshDice(); if (cell) $('diceSection').scrollIntoView({ block: 'nearest' }); }
  function place(faces) {
    const cell = E.diceCell(); if (!cell) return;
    edit((data) => { data.dice = [...(data.dice || []), { id: nextId(data), at: [...cell], faces }]; }, '주사위를 놓았어요. 면 칸에 숫자나 글자를 적으세요.');
  }
  $('dicePlaceStd').addEventListener('click', () => place({ ...STANDARD }));
  $('dicePlaceBlank').addEventListener('click', () => place(Object.fromEntries(DIRS.map((d) => [d, null]))));
  document.querySelectorAll('[data-roll]').forEach((button) => button.addEventListener('click', () => edit((data) => {
    const raw = dieAt(data, E.diceCell()), die = G.validateProject({ ...data, dice: [raw] }).dice[0], faces = X.roll(die.faces, button.dataset.roll);
    raw.faces = Object.fromEntries(DIRS.map((d) => [d, G.encodeFace(faces[d], d)]));
  })));
  $('diceMarkApply').addEventListener('click', () => edit((data) => {
    const die = dieAt(data, E.diceCell()), dir = $('diceMarkDir').value, text = $('diceMarkText').value.trim();
    const marks = { ...(die.marks || {}) };
    if (!dir) { delete die.marks; return; }
    if (text) marks[dir] = text; else delete marks[dir];
    if (Object.keys(marks).length) die.marks = marks; else delete die.marks;
  }, '표시를 바꿨어요. 학생용 그림에는 그 면 대신 표시 글자가 나옵니다.'));
  $('diceRemove').addEventListener('click', () => edit((data) => { data.dice = (data.dice || []).filter((d) => !sameCell(d.at, E.diceCell())); }, '주사위를 뺐어요. 블록은 그대로 남습니다.'));

  function refresh() { refreshNet(); refreshDice(); }
  window.SolidDiceApp = { refresh, select };
  refresh();
})();
