/* Grilla tipo Excel: letras de columna, números de fila, celda activa, selección de rango,
   edición en celda, copiar/pegar con Excel, filtros, orden, ancho de columnas y barra de estado. */
(function () {
'use strict';
const letter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RH = 22;           // alto de fila
const RN = 46;           // ancho columna de números de fila

function Grid(host, opt) {
  const g = { opt, rows: [], view: [], sel: { r: 0, c: 0, r2: 0, c2: 0 }, sort: null, filters: {}, editing: null };
  const cols = opt.cols;
  const widthsKey = 'gridw_' + (opt.id || 'g');
  try { const w = JSON.parse(localStorage.getItem(widthsKey) || '{}'); cols.forEach(c => { if (w[c.key]) c.w = w[c.key]; }); } catch { /* sin storage */ }
  const nf = opt.frozen || 0;
  const ghost = !!opt.onNewRow;

  host.classList.add('xlwrap');
  const PAL = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47',
    '#F2F2F2', '#7F7F7F', '#D0CECE', '#D6DCE4', '#D9E1F2', '#FCE4D6', '#EDEDED', '#FFF2CC', '#DDEBF7', '#E2EFDA',
    '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
  const tools = opt.onFormat ? `<div class="xltools">
      <button data-t="b" title="Negrita (Ctrl+N / Ctrl+B)"><b>N</b></button><button data-t="i" title="Cursiva (Ctrl+K / Ctrl+I)"><i>K</i></button><button data-t="u" title="Subrayado (Ctrl+S / Ctrl+U)"><u>S</u></button>
      <span class="xlsep"></span>
      <span class="xlsplit"><button data-t="bgLast" title="Color de relleno"><span class="ico">🪣</span><i class="sw" data-sw="bg" style="background:#FFFF00"></i></button><button data-t="bgMenu" class="dd" title="Elegir color de relleno">▾</button></span>
      <span class="xlsplit"><button data-t="cLast" title="Color de fuente"><b class="ico">A</b><i class="sw" data-sw="c" style="background:#FF0000"></i></button><button data-t="cMenu" class="dd" title="Elegir color de fuente">▾</button></span>
      <span class="xlsep"></span>
      <span class="xlsplit"><button data-t="bdLast" title="Bordes">▦<i class="sw" style="background:#222"></i></button><button data-t="bdMenu" class="dd" title="Elegir bordes">▾</button></span>
      <span class="xlsep"></span>
      <button data-t="al:left" title="Alinear a la izquierda">⯇≡</button><button data-t="al:center" title="Centrar">≡</button><button data-t="al:right" title="Alinear a la derecha">≡⯈</button>
      <span class="xlsep"></span>
      <button data-t="paint" title="Copiar formato: tocá, después seleccioná las celdas destino">🖌</button><button data-t="clear" title="Borrar formato">⌫ Formato</button>
    </div>` : '';
  host.innerHTML = tools + `<div class="xlbar"><span class="xlref"></span><span class="xlfx">fx</span><input class="xlfbox" spellcheck="false"></div>
    <div class="xl" tabindex="0"><table class="xlt"><colgroup></colgroup><thead></thead><tbody></tbody></table><input class="xled" spellcheck="false"></div>
    <div class="xlstatus"><span class="xlcount"></span><span class="xlsum"></span></div>`;
  const $ = s => host.querySelector(s);
  const box = $('.xl'), table = $('.xlt'), thead = $('thead'), tbody = $('tbody'), ed = $('.xled'), fbox = $('.xlfbox'), ref = $('.xlref'), stat = $('.xlsum'), cnt = $('.xlcount');

  // ---------- encabezados ----------
  function lefts() { const L = [RN]; for (let i = 0; i < nf; i++) L.push(L[i] + cols[i].w); return L; }
  function renderHead() {
    const L = lefts();
    $('colgroup').innerHTML = `<col style="width:${RN}px">` + cols.map(c => `<col style="width:${c.w}px">`).join('');
    table.style.width = (RN + cols.reduce((s, c) => s + c.w, 0)) + 'px';
    const st = i => i < nf ? `position:sticky;left:${L[i]}px;z-index:6;` : '';
    thead.innerHTML =
      `<tr class="xll"><th class="xlcorner" style="left:0"></th>${cols.map((c, i) => `<th data-c="${i}" class="xlletter ${i === nf - 1 ? 'xlfz' : ''}" style="${st(i)}">${letter(i)}</th>`).join('')}</tr>` +
      `<tr class="xlh"><th class="xlcorner" style="left:0"></th>${cols.map((c, i) => `<th data-c="${i}" class="xltitle ${c.live ? 'live' : ''} ${c.edit ? '' : 'calc'} ${i === nf - 1 ? 'xlfz' : ''}" style="${st(i)}" title="${esc(c.tip || c.title)}">${esc(c.title)}${g.sort && g.sort.c === i ? (g.sort.d > 0 ? ' ▲' : ' ▼') : ''}<span class="rz" data-rz="${i}"></span></th>`).join('')}</tr>` +
      `<tr class="xlf"><th class="xlcorner" style="left:0" title="Filtros: texto, o >n, <n, =n para números">⏷</th>${cols.map((c, i) => `<th class="${i === nf - 1 ? 'xlfz' : ''}" style="${st(i)}"><input data-f="${i}" value="${esc(g.filters[i] || '')}" placeholder="filtro"></th>`).join('')}</tr>`;
  }

  // ---------- filas (virtualizadas) ----------
  const nRows = () => g.view.length + (ghost ? 1 : 0);
  function cellHTML(row, ri, ci, L) {
    const c = cols[ci];
    const v = row ? c.get(row) : null;
    let txt = row ? (c.fmt ? c.fmt(v, row) : (v ?? '')) : '';
    if (!row && ghost && opt.ghostText) txt = opt.ghostText(c) || '';
    const cls = ['xc', c.type === 'text' ? '' : 'num', c.edit ? '' : 'calc', c.live ? 'live' : '', row && c.cls ? c.cls(v, row) || '' : '', ci === nf - 1 ? 'xlfz' : '', !row ? 'ghost' : ''].join(' ');
    let css = ci < nf ? `position:sticky;left:${L[ci + 1] - c.w}px;z-index:2;` : '';
    const f = row && opt.fmtOf ? opt.fmtOf(row, c) : null;
    if (f) {
      if (f.bg) css += `background:${f.bg};`;
      if (f.c) css += `color:${f.c};`;
      if (f.b) css += 'font-weight:700;';
      if (f.i) css += 'font-style:italic;';
      if (f.u) css += 'text-decoration:underline;';
      if (f.al) css += `text-align:${f.al};`;
      const sh = []; const bd = f.bd || {};
      if (bd.t) sh.push('inset 0 1.5px 0 #222'); if (bd.b) sh.push('inset 0 -1.5px 0 #222'); if (bd.l) sh.push('inset 1.5px 0 0 #222'); if (bd.r) sh.push('inset -1.5px 0 0 #222');
      if (sh.length) css += `box-shadow:${sh.join(',')};`;
    }
    const st = css ? ` style="${css}"` : '';
    return `<td data-r="${ri}" data-c="${ci}" class="${cls}"${st}${c.titleOf && row ? ` title="${esc(c.titleOf(v, row))}"` : ''}>${txt}</td>`;
  }
  let lastFirst = -1;
  function renderBody(force) {
    const top = Math.max(0, box.scrollTop - 70);
    const first = Math.max(0, Math.floor(top / RH) - 8);
    const n = Math.ceil(box.clientHeight / RH) + 20;
    if (!force && first === lastFirst) return;
    lastFirst = first;
    const last = Math.min(nRows(), first + n);
    const L = lefts();
    let h = `<tr style="height:${first * RH}px"><td colspan="${cols.length + 1}" class="sp"></td></tr>`;
    for (let ri = first; ri < last; ri++) {
      const row = g.view[ri] || null;
      const rc = row && opt.rowClass ? opt.rowClass(row) : '';
      h += `<tr class="${rc}"><th class="xlrn" data-rn="${ri}">${row ? ri + 1 : '＋'}</th>${cols.map((c, ci) => cellHTML(row, ri, ci, L)).join('')}</tr>`;
    }
    h += `<tr style="height:${(nRows() - last) * RH}px"><td colspan="${cols.length + 1}" class="sp"></td></tr>`;
    tbody.innerHTML = h;
    paintSel();
  }
  box.addEventListener('scroll', () => { renderBody(false); if (g.editing) positionEditor(); });

  // ---------- datos: filtro + orden ----------
  function matchF(c, v, row, f) {
    const s = String(c.fmt ? stripTags(c.fmt(v, row)) : v ?? '');
    const m = f.match(/^\s*([<>]=?|=)\s*(-?[\d.,]+)\s*%?\s*$/);
    if (m && c.type !== 'text') {
      let x = typeof v === 'number' ? v : P.num(v); if (x == null) return false;
      let y = P.num(m[2]); if (c.type === 'pct') y = y / 100;
      return { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y, '=': Math.abs(x - y) < 1e-9 }[m[1]];
    }
    return P.norm(s).includes(P.norm(f));
  }
  const stripTags = s => String(s ?? '').replace(/<[^>]*>/g, ' ');
  function recompute() {
    let v = g.rows;
    const fs = Object.entries(g.filters).filter(([, f]) => f && f.trim());
    if (fs.length) v = v.filter(r => fs.every(([i, f]) => { const c = cols[+i]; return matchF(c, c.get(r), r, f); }));
    if (g.sort) {
      const c = cols[g.sort.c], d = g.sort.d;
      v = [...v].sort((a, b) => { const x = c.get(a), y = c.get(b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * d; });
    }
    g.view = v;
  }

  // ---------- selección ----------
  const norm = () => ({ r0: Math.min(g.sel.r, g.sel.r2), r1: Math.max(g.sel.r, g.sel.r2), c0: Math.min(g.sel.c, g.sel.c2), c1: Math.max(g.sel.c, g.sel.c2) });
  function paintSel() {
    const s = norm();
    tbody.querySelectorAll('td.xc').forEach(td => {
      const r = +td.dataset.r, c = +td.dataset.c;
      td.classList.toggle('in', r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1 && !(s.r0 === s.r1 && s.c0 === s.c1));
      td.classList.toggle('cur', r === g.sel.r && c === g.sel.c);
    });
    tbody.querySelectorAll('th.xlrn').forEach(th => th.classList.toggle('on', +th.dataset.rn >= s.r0 && +th.dataset.rn <= s.r1));
    thead.querySelectorAll('th[data-c]').forEach(th => th.classList.toggle('on', +th.dataset.c >= s.c0 && +th.dataset.c <= s.c1));
    // barra de fórmula
    const row = g.view[g.sel.r], c = cols[g.sel.c];
    ref.textContent = letter(g.sel.c) + (g.sel.r + 1);
    if (document.activeElement !== fbox) fbox.value = row ? (c.edit ? rawOf(row, c) : (c.formula ? c.formula(g.sel.r + 1, colLetter) : stripTags(c.fmt ? c.fmt(c.get(row), row) : c.get(row) ?? '').trim())) : '';
    fbox.readOnly = !c.edit;
    // estado: suma / promedio / recuento
    let n = 0, sum = 0, k = 0, isPct = true;
    for (let r = s.r0; r <= s.r1 && r < g.view.length; r++) for (let ci = s.c0; ci <= s.c1; ci++) { const v = cols[ci].get(g.view[r]); if (v != null && v !== '') k++; if (typeof v === 'number' && isFinite(v)) { n++; sum += v; if (cols[ci].type !== 'pct') isPct = false; } }
    const f = x => isPct ? (x * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 }) + ' %' : x.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    stat.textContent = k > 1 ? (n ? `Promedio: ${f(sum / n)}   Recuento: ${k}   Suma: ${f(sum)}` : `Recuento: ${k}`) : '';
    cnt.textContent = `${g.view.length} filas${g.view.length !== g.rows.length ? ` (de ${g.rows.length}, filtradas)` : ''}`;
  }
  const colLetter = key => letter(cols.findIndex(c => c.key === key));
  function rawOf(row, c) { const v = c.raw ? c.raw(row) : c.get(row); if (v == null) return ''; if (typeof v === 'number') return String(+v.toFixed(6)).replace('.', ','); return String(v); }
  function setSel(r, c, extend) {
    r = Math.max(0, Math.min(nRows() - 1, r)); c = Math.max(0, Math.min(cols.length - 1, c));
    if (extend) { g.sel.r2 = r; g.sel.c2 = c; } else g.sel = { r, c, r2: r, c2: c };
    if (extend) { scrollInto(r, c); paintSel(); return; }
    scrollInto(r, c); paintSel();
  }
  function scrollInto(r, c) {
    const L = lefts(); const frozenW = L[nf];
    const y = r * RH + 70; // aprox. alto del encabezado
    if (y < box.scrollTop + 70) box.scrollTop = Math.max(0, r * RH);
    else if (y + RH > box.scrollTop + box.clientHeight) box.scrollTop = y + RH - box.clientHeight;
    if (c >= nf) {
      let x = RN; for (let i = 0; i < c; i++) x += cols[i].w;
      if (x < box.scrollLeft + frozenW) box.scrollLeft = x - frozenW;
      else if (x + cols[c].w > box.scrollLeft + box.clientWidth) box.scrollLeft = x + cols[c].w - box.clientWidth + 2;
    }
    renderBody(false);
  }

  // ---------- edición ----------
  function tdAt(r, c) { return tbody.querySelector(`td[data-r="${r}"][data-c="${c}"]`); }
  function positionEditor() {
    const td = tdAt(g.editing.r, g.editing.c); if (!td) return;
    const a = td.getBoundingClientRect(), b = box.getBoundingClientRect();
    ed.style.left = (a.left - b.left + box.scrollLeft) + 'px'; ed.style.top = (a.top - b.top + box.scrollTop) + 'px';
    ed.style.width = Math.max(td.offsetWidth, 120) + 'px'; ed.style.height = td.offsetHeight + 'px';
  }
  function startEdit(initial) {
    const c = cols[g.sel.c]; const row = g.view[g.sel.r];
    if (!c.edit) { flash('Columna calculada: no se edita'); return; }
    if (!row && !ghost) return;
    g.editing = { r: g.sel.r, c: g.sel.c };
    scrollInto(g.sel.r, g.sel.c);
    ed.value = initial != null ? initial : (row ? rawOf(row, c) : '');
    ed.style.display = 'block'; positionEditor();
    ed.classList.toggle('left', c.type === 'text');
    ed.focus(); if (initial == null) ed.select(); else ed.setSelectionRange(ed.value.length, ed.value.length);
  }
  async function commit(move) {
    if (!g.editing) return;
    const { r, c } = g.editing; const val = ed.value;
    g.editing = null; ed.style.display = 'none'; box.focus({ preventScroll: true });
    const row = g.view[r];
    const old = row ? rawOf(row, cols[c]) : '';
    if (val !== old) await apply([{ r, c, value: val }]);
    if (move) setSel(g.sel.r + move[0], g.sel.c + move[1]);
  }
  function cancel() { g.editing = null; ed.style.display = 'none'; box.focus({ preventScroll: true }); }
  async function apply(changes) {
    const conRow = [], nuevas = [];
    for (const ch of changes) { const row = g.view[ch.r]; if (!cols[ch.c].edit) continue; if (row) conRow.push({ row, col: cols[ch.c], value: ch.value }); else if (ghost) nuevas.push(ch); }
    try {
      if (conRow.length) await opt.onEdit(conRow);
      if (nuevas.length) {
        const byR = {}; nuevas.forEach(ch => { (byR[ch.r] = byR[ch.r] || []).push({ col: cols[ch.c], value: ch.value }); });
        for (const k of Object.keys(byR).sort((a, b) => a - b)) await opt.onNewRow(byR[k]);
      }
    } catch (e) { flash('Error: ' + e.message); }
    g.refresh();
  }
  ed.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey) { e.preventDefault(); commit([e.key === 'ArrowUp' ? -1 : 1, 0]); }
  });
  ed.addEventListener('blur', () => { if (g.editing) commit(null); });
  fbox.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !fbox.readOnly) { e.preventDefault(); const v = fbox.value; fbox.blur(); apply([{ r: g.sel.r, c: g.sel.c, value: v }]); }
    if (e.key === 'Escape') { fbox.blur(); paintSel(); }
  });

  // ---------- teclado / mouse ----------
  box.addEventListener('keydown', e => {
    if (g.editing) return;
    const s = g.sel, k = e.key, ext = e.shiftKey;
    const cur = ext ? [s.r2, s.c2] : [s.r, s.c];
    const page = Math.floor(box.clientHeight / RH) - 3;
    const mv = (dr, dc) => { e.preventDefault(); setSel(cur[0] + dr, cur[1] + dc, ext); };
    if (k === 'ArrowDown') return e.ctrlKey ? mv(nRows(), 0) : mv(1, 0);
    if (k === 'ArrowUp') return e.ctrlKey ? mv(-nRows(), 0) : mv(-1, 0);
    if (k === 'ArrowRight') return e.ctrlKey ? mv(0, cols.length) : mv(0, 1);
    if (k === 'ArrowLeft') return e.ctrlKey ? mv(0, -cols.length) : mv(0, -1);
    if (k === 'PageDown') return mv(page, 0);
    if (k === 'PageUp') return mv(-page, 0);
    if (k === 'Home') { e.preventDefault(); return setSel(e.ctrlKey ? 0 : cur[0], 0, ext); }
    if (k === 'End' && e.ctrlKey) { e.preventDefault(); return setSel(g.view.length - 1, cols.length - 1, ext); }
    if (k === 'Tab') { e.preventDefault(); return setSel(s.r, s.c + (e.shiftKey ? -1 : 1)); }
    if (k === 'Enter') { e.preventDefault(); return setSel(s.r + (e.shiftKey ? -1 : 1), s.c); }
    if (k === 'F2') { e.preventDefault(); return startEdit(null); }
    if ((k === 'Delete' || k === 'Backspace') && !e.ctrlKey) {
      e.preventDefault(); const n = norm(); const ch = [];
      for (let r = n.r0; r <= n.r1 && r < g.view.length; r++) for (let c = n.c0; c <= n.c1; c++) if (cols[c].edit) ch.push({ r, c, value: '' });
      if (ch.length) apply(ch); return;
    }
    if ((e.ctrlKey || e.metaKey) && opt.onFormat && ['b', 'n', 'i', 'k', 'u', 's'].includes(k.toLowerCase())) { e.preventDefault(); toggle({ b: 'b', n: 'b', i: 'i', k: 'i', u: 'u', s: 'u' }[k.toLowerCase()]); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); opt.onUndo && opt.onUndo().then(() => g.refresh()); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { e.preventDefault(); g.sel = { r: 0, c: 0, r2: g.view.length - 1, c2: cols.length - 1 }; paintSel(); return; }
    if ((e.ctrlKey || e.metaKey) && k === '-') { e.preventDefault(); delRows(); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(k); }
  });
  let drag = false;
  tbody.addEventListener('mousedown', e => {
    const td = e.target.closest('td.xc'); const rn = e.target.closest('th.xlrn');
    if (e.button === 2) return;
    if (g.editing) commit(null);
    if (rn) { const r = +rn.dataset.rn; if (e.shiftKey) g.sel.r2 = r; else g.sel = { r, c: 0, r2: r, c2: cols.length - 1 }; g.sel.c2 = cols.length - 1; g.sel.c = 0; paintSel(); drag = 'row'; e.preventDefault(); box.focus({ preventScroll: true }); return; }
    if (!td) return;
    e.preventDefault(); box.focus({ preventScroll: true });
    const r = +td.dataset.r, c = +td.dataset.c;
    if (e.shiftKey) { g.sel.r2 = r; g.sel.c2 = c; paintSel(); } else setSel(r, c);
    drag = 'cell';
  });
  tbody.addEventListener('mouseover', e => {
    if (!drag) return;
    if (drag === 'row') { const rn = e.target.closest('th.xlrn'); if (rn) { g.sel.r2 = +rn.dataset.rn; paintSel(); } return; }
    const td = e.target.closest('td.xc'); if (!td) return;
    g.sel.r2 = +td.dataset.r; g.sel.c2 = +td.dataset.c; paintSel();
  });
  document.addEventListener('mouseup', () => drag = false);
  tbody.addEventListener('dblclick', e => {
    const td = e.target.closest('td.xc'); if (!td) return;
    const c = cols[+td.dataset.c], row = g.view[+td.dataset.r];
    if (c.onOpen && row) return c.onOpen(row);
    startEdit(null);
  });
  tbody.addEventListener('contextmenu', e => {
    const td = e.target.closest('td.xc,th.xlrn'); if (!td || !opt.menu) return;
    e.preventDefault();
    const r = +(td.dataset.r ?? td.dataset.rn); const n = norm();
    if (!(r >= n.r0 && r <= n.r1)) setSel(r, td.dataset.c != null ? +td.dataset.c : g.sel.c);
    const rows = selRows(); if (!rows.length) return;
    const items = opt.menu(rows, g.view[g.sel.r]);
    const m = document.createElement('div'); m.className = 'xlmenu';
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<div data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</div>`).join('');
    m.style.left = Math.min(e.clientX, innerWidth - 230) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - items.length * 30 - 10) + 'px';
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); };
    const out = ev => { if (!m.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    m.onclick = async ev => { const d = ev.target.closest('[data-i]'); if (!d) return; close(); await items[+d.dataset.i].run(); g.refresh(); };
  });
  const selRows = () => { const n = norm(); const out = []; for (let r = n.r0; r <= n.r1; r++) if (g.view[r]) out.push(g.view[r]); return out; };
  // ---------- formato de celdas ----------
  let last = { bg: '#FFFF00', c: '#FF0000', bd: 'all' }, painter = null;
  const selCells = () => { const n = norm(); const out = []; for (let r = n.r0; r <= n.r1; r++) { const row = g.view[r]; if (!row) continue; for (let c = n.c0; c <= n.c1; c++) out.push({ r, c, row, col: cols[c], fmt: { ...(opt.fmtOf(row, cols[c]) || {}), bd: { ...((opt.fmtOf(row, cols[c]) || {}).bd || {}) } } }); } return out; };
  async function formatear(fn) {
    if (!opt.onFormat) return;
    const n = norm(); const cs = selCells(); if (!cs.length) return;
    cs.forEach(x => fn(x, n));
    cs.forEach(x => { const f = x.fmt; if (f.bd && !f.bd.t && !f.bd.b && !f.bd.l && !f.bd.r) delete f.bd; for (const k of Object.keys(f)) if (f[k] == null || f[k] === false || f[k] === '') delete f[k]; });
    try { await opt.onFormat(cs.map(x => ({ row: x.row, col: x.col, fmt: x.fmt }))); } catch (e) { flash('Error: ' + e.message); }
    renderBody(true);
  }
  const toggle = k => { const cs = selCells(); const all = cs.length && cs.every(x => x.fmt[k]); formatear(x => { x.fmt[k] = all ? null : 1; }); };
  function bordes(tipo) {
    last.bd = tipo;
    formatear((x, n) => {
      const b = x.fmt.bd || (x.fmt.bd = {});
      if (tipo === 'none') { x.fmt.bd = {}; return; }
      if (tipo === 'all') { b.t = b.b = b.l = b.r = 1; return; }
      if (tipo === 'out') { if (x.r === n.r0) b.t = 1; if (x.r === n.r1) b.b = 1; if (x.c === n.c0) b.l = 1; if (x.c === n.c1) b.r = 1; return; }
      if (tipo === 'bottom' && x.r === n.r1) b.b = 1;
      if (tipo === 'top' && x.r === n.r0) b.t = 1;
      if (tipo === 'left' && x.c === n.c0) b.l = 1;
      if (tipo === 'right' && x.c === n.c1) b.r = 1;
    });
  }
  function popup(anchor, html, onPick) {
    document.querySelectorAll('.xlpop').forEach(p => p.remove());
    const p = document.createElement('div'); p.className = 'xlpop'; p.innerHTML = html;
    const r = anchor.getBoundingClientRect(); p.style.left = r.left + 'px'; p.style.top = (r.bottom + 2) + 'px';
    document.body.appendChild(p);
    const close = () => { p.remove(); document.removeEventListener('mousedown', out, true); };
    const out = ev => { if (!p.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    p.addEventListener('click', ev => { const d = ev.target.closest('[data-v]'); if (d) { close(); onPick(d.dataset.v); } });
    const inp = p.querySelector('input[type=color]'); if (inp) inp.addEventListener('change', () => { close(); onPick(inp.value.toUpperCase()); });
  }
  const paleta = (titulo, nada) => `<div class="xlpt">${titulo}</div><div class="xlpal">${PAL.map(c => `<i data-v="${c}" style="background:${c}" title="${c}"></i>`).join('')}</div>
    <div class="xlpo" data-v="">${nada}</div><label class="xlpo">Más colores… <input type="color" value="#FFFF00"></label>`;
  const BORD = [['bottom', 'Borde inferior'], ['top', 'Borde superior'], ['left', 'Borde izquierdo'], ['right', 'Borde derecho'], ['all', 'Todos los bordes'], ['out', 'Bordes externos'], ['none', 'Sin borde']];
  const tbar = host.querySelector('.xltools');
  const setSw = () => { if (!tbar) return; tbar.querySelector('[data-sw="bg"]').style.background = last.bg || 'transparent'; tbar.querySelector('[data-sw="c"]').style.background = last.c || '#000'; };
  if (tbar) tbar.addEventListener('mousedown', e => e.preventDefault());
  if (tbar) tbar.addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return; const t = b.dataset.t;
    if (t === 'b' || t === 'i' || t === 'u') toggle(t);
    else if (t === 'bgLast') formatear(x => { x.fmt.bg = last.bg || null; });
    else if (t === 'cLast') formatear(x => { x.fmt.c = last.c || null; });
    else if (t === 'bgMenu') popup(b, paleta('Color de relleno', 'Sin relleno'), v => { last.bg = v; setSw(); formatear(x => { x.fmt.bg = v || null; }); });
    else if (t === 'cMenu') popup(b, paleta('Color de fuente', 'Automático'), v => { last.c = v; setSw(); formatear(x => { x.fmt.c = v || null; }); });
    else if (t === 'bdLast') bordes(last.bd);
    else if (t === 'bdMenu') popup(b, BORD.map(([k, l]) => `<div class="xlpo" data-v="${k}">${l}</div>`).join(''), v => bordes(v));
    else if (t.startsWith('al:')) { const a = t.slice(3); const cs = selCells(); const all = cs.every(x => x.fmt.al === a); formatear(x => { x.fmt.al = all ? null : a; }); }
    else if (t === 'clear') formatear(x => { x.fmt = {}; });
    else if (t === 'paint') { const row = g.view[g.sel.r]; painter = row ? { ...(opt.fmtOf(row, cols[g.sel.c]) || {}) } : {}; box.classList.add('painting'); b.classList.add('on'); flash('Seleccioná las celdas donde copiar el formato'); }
    box.focus({ preventScroll: true });
  });
  tbody.addEventListener('mouseup', () => { if (painter && drag) { const f = painter; painter = null; box.classList.remove('painting'); tbar && tbar.querySelector('[data-t="paint"]').classList.remove('on'); setTimeout(() => formatear(x => { x.fmt = JSON.parse(JSON.stringify(f)); }), 0); } });

  async function delRows() { if (opt.onDelete) { const rows = selRows(); if (rows.length && await opt.onDelete(rows)) g.refresh(); } }

  // copiar / pegar (compatible con Excel: tabulaciones y saltos de línea)
  box.addEventListener('copy', e => {
    if (g.editing) return;
    const n = norm(); const lines = [];
    for (let r = n.r0; r <= n.r1 && r < g.view.length; r++) { const row = g.view[r]; const a = []; for (let c = n.c0; c <= n.c1; c++) { const col = cols[c]; const v = col.get(row); a.push(typeof v === 'number' ? String(+v.toFixed(6)).replace('.', ',') : stripTags(col.fmt && v != null && typeof v !== 'string' ? col.fmt(v, row) : v ?? '').trim()); } lines.push(a.join('\t')); }
    e.clipboardData.setData('text/plain', lines.join('\r\n')); e.preventDefault();
    flash(`${n.r1 - n.r0 + 1} × ${n.c1 - n.c0 + 1} celdas copiadas`);
  });
  box.addEventListener('paste', e => {
    if (g.editing) return;
    e.preventDefault();
    const t = (e.clipboardData.getData('text/plain') || '').replace(/\r/g, '').replace(/\n$/, '');
    if (!t) return;
    const data = t.split('\n').map(l => l.split('\t'));
    const n = norm(); const ch = [];
    const single = data.length === 1 && data[0].length === 1;
    const rr = single ? n.r1 - n.r0 + 1 : data.length, cc = single ? n.c1 - n.c0 + 1 : data[0].length;
    let skipped = 0;
    for (let i = 0; i < rr; i++) for (let j = 0; j < cc; j++) {
      const r = n.r0 + i, c = n.c0 + j; if (c >= cols.length) continue;
      if (!cols[c].edit) { skipped++; continue; }
      if (r >= g.view.length && !(ghost && r === g.view.length) && !(ghost && r > g.view.length)) continue;
      ch.push({ r, c, value: single ? data[0][0] : (data[i][j] ?? '') });
    }
    if (skipped) flash(`${skipped} celdas calculadas no se pegaron`);
    apply(ch);
  });

  // encabezados: orden, filtros, ancho
  thead.addEventListener('click', e => {
    if (e.target.closest('.rz') || e.target.closest('input')) return;
    const th = e.target.closest('th.xltitle'); const tl = e.target.closest('th.xlletter');
    if (th) { const c = +th.dataset.c; g.sort = g.sort && g.sort.c === c ? (g.sort.d > 0 ? { c, d: -1 } : null) : { c, d: 1 }; recompute(); renderHead(); renderBody(true); }
    if (tl) { const c = +tl.dataset.c; g.sel = { r: 0, c, r2: g.view.length - 1, c2: c }; paintSel(); box.focus({ preventScroll: true }); }
  });
  let fT;
  thead.addEventListener('input', e => { const i = e.target.dataset.f; if (i == null) return; g.filters[i] = e.target.value; clearTimeout(fT); fT = setTimeout(() => { recompute(); box.scrollTop = 0; renderBody(true); }, 180); });
  thead.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.dataset.f != null) { e.target.value = ''; g.filters[e.target.dataset.f] = ''; recompute(); renderBody(true); } e.stopPropagation(); });
  thead.addEventListener('mousedown', e => {
    const h = e.target.closest('.rz'); if (!h) return;
    e.preventDefault(); e.stopPropagation();
    const i = +h.dataset.rz, x0 = e.clientX, w0 = cols[i].w;
    const mm = ev => { cols[i].w = Math.max(30, w0 + ev.clientX - x0); table.querySelectorAll('col')[i + 1].style.width = cols[i].w + 'px'; table.style.width = (RN + cols.reduce((s, c) => s + c.w, 0)) + 'px'; };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); try { localStorage.setItem(widthsKey, JSON.stringify(Object.fromEntries(cols.map(c => [c.key, c.w])))); } catch { /* */ } renderHead(); renderBody(true); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });

  function flash(m) { if (window.toast) window.toast(m); }

  // ---------- API ----------
  g.setRows = rows => { g.rows = rows; recompute(); if (g.sel.r >= nRows()) g.sel = { r: 0, c: g.sel.c, r2: 0, c2: g.sel.c }; renderBody(true); };
  g.refresh = () => { recompute(); renderBody(true); };
  g.focus = () => box.focus({ preventScroll: true });
  g.selected = selRows;
  renderHead();
  return g;
}
window.Grid = Grid;
window.colLetter = letter;
})();
