/* Cotizaciones directas + Comparativas — app (vanilla JS) */
(() => {
'use strict';
const CFG = window.CONFIG || {};
const DEMO = !(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => n == null || !isFinite(n) ? '—' : '$ ' + (Math.abs(n) >= 1000 ? nf0 : nf2).format(n);
const pct = (f, d = 1) => f == null || !isFinite(f) ? '—' : (f * 100).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
const fdate = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(2, 4) : '—';
const MES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const toast = window.toast = (m, ms = 2600) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); };
const canonPropio = P.canonProv(CFG.NOMBRE_PROPIO || 'Meta');
const esPropio = name => P.canonProv(name) === canonPropio;

// ======================================================================
//  Capa de datos: Supabase o modo demo (memoria + localStorage)
// ======================================================================
const TABLES = ['cc_cotizaciones', 'cc_items', 'cc_costos', 'cc_cargas_costos', 'cc_comparativas', 'cc_comp_renglones', 'cc_comp_ofertas', 'cc_config', 'cc_ocs', 'cc_oc_items'];
let sb = null;
const db = DEMO ? (() => {
  const mem = {}; let seq = Date.now() % 100000;
  for (const t of TABLES) { try { mem[t] = JSON.parse(localStorage.getItem('demo_' + t) || '[]'); } catch { mem[t] = []; } }
  const save = t => { try { localStorage.setItem('demo_' + t, JSON.stringify(mem[t])); } catch { /* cuota llena: queda en memoria */ } };
  return {
    async all(t) { return mem[t].map(r => ({ ...r })); },
    async ins(t, rows) { const out = rows.map(r => ({ ...r, id: r.id ?? ++seq, created_at: new Date().toISOString() })); mem[t].push(...out); save(t); return out.map(r => ({ ...r })); },
    async upd(t, id, patch) { const r = mem[t].find(x => x.id === id); Object.assign(r, patch); save(t); return { ...r }; },
    async updIn(t, col, vals, patch) { const s = new Set(vals); mem[t].filter(x => s.has(x[col])).forEach(r => Object.assign(r, patch)); save(t); },
    async del(t, col, vals) { const s = new Set(vals); mem[t] = mem[t].filter(x => !s.has(x[col])); save(t); },
    async ups(t, rows, keys) { for (const r of rows) { const k = keys.map(x => r[x]).join('|'); const e = mem[t].find(x => keys.map(y => x[y]).join('|') === k); if (e) Object.assign(e, r); else mem[t].push({ ...r }); } save(t); },
    async delStaleCostos(listas, ts) { const s = new Set(listas); mem.cc_costos = mem.cc_costos.filter(x => !(s.has(x.lista) && x.actualizado < ts)); save('cc_costos'); },
  };
})() : (() => {
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async all(t) { let out = [], i = 0; for (;;) { const d = chk(await sb.from(t).select('*').range(i, i + 999)); out = out.concat(d); if (d.length < 1000) return out; i += 1000; } },
    async ins(t, rows) { let out = []; for (const c of chunk(rows, 500)) out = out.concat(chk(await sb.from(t).insert(c).select())); return out; },
    async upd(t, id, patch) { return chk(await sb.from(t).update(patch).eq('id', id).select())[0]; },
    async updIn(t, col, vals, patch) { for (const c of chunk(vals, 300)) chk(await sb.from(t).update(patch).in(col, c)); },
    async del(t, col, vals) { for (const c of chunk(vals, 300)) chk(await sb.from(t).delete().in(col, c)); },
    async ups(t, rows, keys) { for (const c of chunk(rows, 500)) chk(await sb.from(t).upsert(c, { onConflict: keys.join(',') })); },
    async delStaleCostos(listas, ts) { chk(await sb.from('cc_costos').delete().in('lista', listas).lt('actualizado', ts)); },
  };
})();

// ======================================================================
//  Estado e índices
// ======================================================================
const S = { user: null, loaded: false, cots: [], items: [], costos: [], cargas: [], comps: [], rens: [], ofs: [], cfg: {}, ocs: [], ocItems: [], cat: [], cot: null };
const I = {};
const CFG_DEF = { margenObjetivo: 0.04, cercania: 0.03 };
const conf = k => (S.cfg[k] ?? CFG_DEF[k]);

// ---------- Costos directos del cotizador (misma base Supabase, tabla kv_store, solo lectura) ----------
const KV_PRECIOS = 'cotizador:precios-por-lista', KV_BASE = 'cotizador:base-marcas';
async function cargarCostosCotizador() {
  if (DEMO) return null;
  try {
    const url = CFG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/kv_store?select=key,value,updated_at&key=in.(' + encodeURIComponent('"' + KV_PRECIOS + '","' + KV_BASE + '"') + ')';
    const r = await fetch(url, { headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    const pre = rows.find(x => x.key === KV_PRECIOS), base = rows.find(x => x.key === KV_BASE);
    const lista = pre && Array.isArray(pre.value) ? pre.value : [];
    const cat = base && Array.isArray(base.value) ? base.value : [];
    return { lista, cat, updated: pre ? pre.updated_at : null, updatedBase: base ? base.updated_at : null, ok: lista.length > 0 };
  } catch (e) { console.warn('Costos del cotizador:', e.message); return { ok: false, error: e.message, lista: [], cat: [] }; }
}
function armarCatalogo() {
  // Une: precios por lista del cotizador (fuente principal) + datos del catálogo del cotizador + costos manuales como respaldo
  const usar = conf('fuenteCostos') !== 'manual' && S.cot && S.cot.ok;
  const man = new Map(); for (const c of S.costos) man.set(c.codigo + '|' + c.lista, c);
  const manCod = new Map(); for (const c of S.costos) if (!manCod.has(c.codigo)) manCod.set(c.codigo, c);
  if (!usar) { S.cat = S.costos; return; }
  const base = new Map(); for (const b of S.cot.cat) if (b && b.codigo != null) base.set(String(b.codigo).trim(), b);
  const out = [], vistos = new Set();
  for (const p of S.cot.lista) {
    if (!p || p.codigo == null || !p.lista) continue;
    const codigo = String(p.codigo).trim(), lista = String(p.lista).trim();
    const b = base.get(codigo) || {}, m = man.get(codigo + '|' + lista) || manCod.get(codigo) || {};
    vistos.add(codigo + '|' + lista);
    out.push({ codigo, lista, detalle: b.marca || m.detalle || '', monodroga: b.monodroga || m.monodroga || '', laboratorio: b.laboratorio || m.laboratorio || '',
      pvp: b.pvp ?? m.pvp ?? null, psl: p.psl ?? null, dtocpa: p.descuento ?? null, costo: p.costo, stockCot: b.stock ?? null, actualizado: S.cot.updated, fuente: 'cotizador' });
  }
  for (const c of S.costos) if (!vistos.has(c.codigo + '|' + c.lista)) out.push({ ...c, fuente: 'manual' });
  S.cat = out;
}
async function loadAll() {
  const opcional = new Set(['cc_ocs', 'cc_oc_items']);   // tablas nuevas: si todavía no se corrió schema.sql, la app igual arranca
  const [cots, items, costos, cargas, comps, rens, ofs, cfg, ocs, ocItems] = await Promise.all(TABLES.map(t => opcional.has(t) ? db.all(t).catch(() => { S.faltaSchema = true; return []; }) : db.all(t)));
  Object.assign(S, { cots, items, costos, cargas, comps, rens, ofs, ocs, ocItems, loaded: true });
  S.cfg = Object.fromEntries(cfg.map(r => [r.clave, r.valor]));
  S.cot = await cargarCostosCotizador();
  armarCatalogo();
  reindex();
}
function reindex() {
  const by = (arr, k) => { const m = new Map(); for (const x of arr) { const v = x[k]; if (!m.has(v)) m.set(v, []); m.get(v).push(x); } return m; };
  I.cot = new Map(S.cots.map(c => [c.id, c]));
  I.item = new Map(S.items.map(i => [i.id, i]));
  I.itemsByCot = by(S.items, 'cotizacion_id');
  for (const a of I.itemsByCot.values()) a.sort((x, y) => (x.orden ?? 1e9) - (y.orden ?? 1e9) || (x.renglon ?? 0) - (y.renglon ?? 0) || x.id - y.id);
  I.oc = new Map(S.ocs.map(o => [String(o.numero), o]));
  I.ocLines = by(S.ocItems, 'oc_id');
  I.ocLinesByItem = by(S.ocItems.filter(l => l.item_id), 'item_id');
  I.comp = new Map(S.comps.map(c => [c.id, c]));
  I.compsByCot = by(S.comps.filter(c => c.cotizacion_id), 'cotizacion_id');
  I.rensByComp = by(S.rens, 'comparativa_id');
  for (const a of I.rensByComp.values()) a.sort((x, y) => (x.renglon ?? 0) - (y.renglon ?? 0));
  I.rensByItem = by(S.rens.filter(r => r.item_id), 'item_id');
  I.ofsByRen = by(S.ofs, 'renglon_id');
  I.costo = new Map(); I.costoCod = new Map();
  for (const c of (S.cat.length ? S.cat : S.costos)) { I.costo.set(c.codigo + '|' + c.lista, c); if (!I.costoCod.has(c.codigo)) I.costoCod.set(c.codigo, c); }
  // análisis por renglón + índices de inteligencia competitiva
  I.ana = new Map(); I.porCodigo = new Map(); I.porMono = new Map(); if (typeof LM !== 'undefined') LM.clear();
  for (const r of S.rens) {
    const ofs = (I.ofsByRen.get(r.id) || []).map(o => ({ ...o, es_propio: o.es_propio || esPropio(o.proveedor) }));
    const a = P.analizarRenglon(ofs, r.cantidad);
    I.ana.set(r.id, a);
    const it = r.item_id && I.item.get(r.item_id);
    if (it && it.codigo) { if (!I.porCodigo.has(it.codigo)) I.porCodigo.set(it.codigo, []); I.porCodigo.get(it.codigo).push(r); }
    const mono = monoKey(it ? it.monodroga : r.descripcion);
    if (mono) { if (!I.porMono.has(mono)) I.porMono.set(mono, []); I.porMono.get(mono).push(r); }
  }
}
const monoKey = s => P.norm(s).split(/[ +\-\/(.,]/).filter(w => w.length > 2 && !/^\d/.test(w))[0] || '';
const fechaRen = r => { const c = I.comp.get(r.comparativa_id); return (c && (c.fecha || (c.cotizacion_id && I.cot.get(c.cotizacion_id)?.fecha))) || ''; };
const cotDeRen = r => { const c = I.comp.get(r.comparativa_id); return c && c.cotizacion_id ? I.cot.get(c.cotizacion_id) : null; };

// costos vigentes
const costoRow = it => I.costo.get(it.codigo + '|' + (it.lista || '')) || I.costoCod.get(it.codigo) || null;
const costoMetaCot = it => P.costoMeta(it);
const costoMetaAct = it => { const r = costoRow(it); return r ? P.costoMeta(it, r) : null; };
// Si el costo de lista difiere mucho del cotizado, casi seguro hubo un costo especial negociado:
// en ese caso no se usa el de lista para los cálculos (se avisa en pantalla).
const SALTO = 0.3;
const saltoRaro = it => { const a = costoMetaAct(it), c = costoMetaCot(it); return a != null && c ? Math.abs(a / c - 1) > SALTO : false; };
const costoVig = it => { const a = costoMetaAct(it); return a != null && !saltoRaro(it) ? a : costoMetaCot(it); };

// inteligencia por ítem
function intel(it) {
  const cotId = it.cotizacion_id;
  const fila = r => {
    const a = I.ana.get(r.id); const cot = cotDeRen(r);
    return { r, a, fecha: fechaRen(r), proceso: cot ? cot.proceso : (I.comp.get(r.comparativa_id)?.proceso || ''), cot };
  };
  const propias = (I.rensByItem.get(it.id) || []).map(fila);             // resultado de ESTA cotización
  const ex = (I.porCodigo.get(it.codigo) || []).filter(r => r.item_id !== it.id && cotDeRen(r)?.id !== cotId).map(fila);
  const exIds = new Set(ex.map(x => x.r.id));
  const sim = (I.porMono.get(monoKey(it.monodroga)) || []).filter(r => !exIds.has(r.id) && r.item_id !== it.id && cotDeRen(r)?.id !== cotId).map(fila);
  const ord = (a, b) => String(b.fecha).localeCompare(String(a.fecha));
  ex.sort(ord); sim.sort(ord);
  // Si ya está el acta de ESTA cotización, manda ella (aunque ningún competidor haya cotizado):
  // no se usa el ganador de un proceso anterior para calcular el margen.
  const actual = propias.find(x => x.a.unitComp) || propias.find(x => x.a.ofertasValidas) || propias[0] || null;
  const ultimo = ex.find(x => x.a.unitComp) || null;
  return { propias, ex, sim, actual, ultimo, ref: actual ? (actual.a.unitComp ? actual : null) : ultimo };
}
function margenParaGanar(it, unitComp) {
  if (!unitComp) return null;
  const c = costoVig(it);
  return c == null ? null : 1 - c / unitComp;
}
const clsMargen = m => m == null ? '' : m < 0 ? 'bad' : m < conf('margenObjetivo') ? 'warn' : 'ok';

// ======================================================================
//  Shell, login y ruteo
// ======================================================================
const app = $('#app');
const VIEWS = [['planilla', 'Planilla'], ['cotizaciones', 'Cotizaciones'], ['comparativas', 'Comparativas'], ['buscar', 'Buscar producto'], ['costos', 'Costos'], ['resumen', 'Resumen'], ['importar', 'Importar / Ajustes']];
function shell(inner, o = {}) {
  const v = (location.hash.slice(1).split('/')[0]) || 'planilla';
  const cur = { cot: 'planilla', comp: 'comparativas' }[v] || v;
  app.innerHTML = `<header class="top"><div class="logo">▤ <span>Cotizaciones · Comparativas</span></div>
    <nav>${VIEWS.map(([k, l]) => `<a href="#${k}" class="${k === cur ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="who">${DEMO ? '<span class="demo-badge" title="Sin Supabase configurado: los datos quedan solo en este navegador">MODO DEMO</span>' : ''}
      <span>${esc(S.user?.email || '')}</span><button id="reload" title="Traer los últimos datos">⟳</button>${DEMO ? '' : '<button id="logout">Salir</button>'}</div></header>
    <main id="main" class="${o.full ? 'full' : ''}">${inner}</main>`;
  $('#reload').onclick = async () => { await loadAll(); route(); toast('Datos actualizados'); };
  if ($('#logout')) $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
}
function loginView(msg = '') {
  app.innerHTML = `<form class="login" id="lf"><h1>Cotizaciones · Comparativas</h1>
    <input class="in" type="email" id="em" placeholder="Email" autocomplete="username" required>
    <input class="in" type="password" id="pw" placeholder="Contraseña" autocomplete="current-password" required>
    <button class="btn pri" style="width:100%">Ingresar</button><p class="small bad">${esc(msg)}</p>
    <p class="small muted">Los usuarios los da de alta el administrador en Supabase (Authentication → Users).</p></form>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) return loginView('No se pudo ingresar: ' + error.message);
    S.user = data.user; start();
  };
}
async function start() {
  app.innerHTML = '<div class="login"><span class="spin"></span> Cargando datos…</div>';
  try { await loadAll(); } catch (e) { app.innerHTML = `<div class="login"><h1>Error</h1><p class="bad">${esc(e.message)}</p><p class="small">¿Corriste schema.sql en Supabase?</p></div>`; return; }
  route();
}
window.addEventListener('hashchange', () => S.loaded && route());
function route() {
  const [v, id] = location.hash.slice(1).split('/');
  const keep = window.scrollY;
  ({ planilla: () => vPlanilla(id ? decodeURIComponent(id) : ''), cotizaciones: vCots, cot: () => vCot(+id), comp: () => vComp(+id), comparativas: vComps, buscar: vBuscar, costos: vCostos, resumen: vResumen, importar: vImportar }[v] || (() => vPlanilla('')))();
  if (route._last === location.hash) window.scrollTo(0, keep);
  route._last = location.hash;
}

// modales
function modal(html, { side = false } = {}) {
  const o = document.createElement('div'); o.className = 'overlay' + (side ? '' : ' center');
  o.innerHTML = `<div class="${side ? 'drawer' : 'modal'}"><button class="x" data-close>×</button>${html}</div>`;
  o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) o.remove(); });
  document.body.appendChild(o);
  const k = e => { if (e.key === 'Escape') { o.remove(); document.removeEventListener('keydown', k); } }; document.addEventListener('keydown', k);
  return o;
}
function pickFile(accept, cb) { const f = document.createElement('input'); f.type = 'file'; f.accept = accept; f.onchange = () => f.files[0] && cb(f.files[0]); f.click(); }
async function readWb(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array', cellDates: false, raw: /\.csv$/i.test(file.name) });
}
function dropZone(el, accept, cb) {
  el.onclick = () => pickFile(accept, cb);
  el.ondragover = e => { e.preventDefault(); el.classList.add('on'); };
  el.ondragleave = () => el.classList.remove('on');
  el.ondrop = e => { e.preventDefault(); el.classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) cb(f); };
}
const who = () => S.user?.email || (DEMO ? 'demo' : '');

// ======================================================================
//  Vista: lista de cotizaciones
// ======================================================================
const ESTADOS = ['abierta', 'presentada', 'adjudicada', 'parcial', 'perdida', 'desierta'];
const pillEstado = e => `<span class="pill ${{ adjudicada: 'ok', parcial: 'ok', perdida: 'bad', desierta: 'bad', abierta: 'warn', presentada: 'info' }[e] || ''}">${esc(e)}</span>`;
let fCots = { q: '', mes: '', estado: '' };
function resumenCot(c) {
  const its = I.itemsByCot.get(c.id) || [];
  let total = 0, costo = 0, gan = 0, conAna = 0, adj = 0;
  for (const it of its) {
    total += (it.precio_unit || 0) * (it.cantidad || 0); costo += (costoMetaCot(it) || 0) * (it.cantidad || 0);
    if (it.adjudicado) adj++;
    const r = (I.rensByItem.get(it.id) || []).map(r => I.ana.get(r.id)).find(a => a && a.ofertasValidas);
    if (r) { conAna++; if (r.posicion === 1 || r.ganamos) gan++; }
  }
  return { n: its.length, total, margen: total ? 1 - costo / total : null, gan, conAna, adj, comps: (I.compsByCot.get(c.id) || []).length };
}
function vCots() {
  const meses = [...new Set(S.cots.map(c => (c.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = P.norm(fCots.q);
  const list = S.cots.filter(c => (!fCots.mes || (c.fecha || '').startsWith(fCots.mes)) && (!fCots.estado || c.estado === fCots.estado)
    && (!q || P.norm(c.proceso + ' ' + (c.obs || '') + ' ' + (c.oc || '')).includes(q) || (I.itemsByCot.get(c.id) || []).some(i => P.norm(i.detalle + ' ' + i.monodroga + ' ' + i.codigo).includes(q))))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id);
  shell(`<div class="row" style="margin-bottom:14px"><div><h1>Cotizaciones</h1><div class="sub">${S.cots.length} procesos · ${S.items.length} renglones</div></div><span class="spacer"></span>
    <input class="in" id="q" placeholder="Buscar expediente, producto, monodroga…" value="${esc(fCots.q)}" style="width:280px">
    <select class="in" id="mes"><option value="">Todos los meses</option>${meses.map(m => `<option value="${m}" ${m === fCots.mes ? 'selected' : ''}>${MES[+m.slice(5)]} ${m.slice(0, 4)}</option>`).join('')}</select>
    <select class="in" id="est"><option value="">Todos los estados</option>${ESTADOS.map(e => `<option ${e === fCots.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>
    <button class="btn pri" id="ped" title="Pedido de cotización, acta comparativa u orden de compra: se detecta solo">Importar PDF</button><button class="btn" id="nueva">+ Nueva cotización</button></div>
    <div class="tw"><table class="t"><thead><tr><th>Proceso</th><th>Apertura</th><th class="n">Renglones</th><th class="n">Total cotizado</th><th class="n">Margen</th><th>Estado</th><th>OC</th><th>Comparativa</th><th class="n">1° lugar</th></tr></thead><tbody>
    ${list.map(c => { const r = resumenCot(c); return `<tr class="click" data-go="#cot/${c.id}"><td><b>${esc(c.proceso)}</b>${c.obs ? `<div class="small muted">${esc(c.obs)}</div>` : ''}</td><td>${esc(c.apertura || fdate(c.fecha))}</td>
      <td class="n">${r.n}</td><td class="n">${money(r.total)}</td><td class="n">${pct(r.margen)}</td><td>${pillEstado(c.estado)}</td><td>${esc(c.oc || '')}</td>
      <td>${r.comps ? `<span class="pill info">${r.comps} vinculada${r.comps > 1 ? 's' : ''}</span>` : '<span class="muted small">—</span>'}</td>
      <td class="n">${r.conAna ? `${r.gan}/${r.conAna}` : '—'}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">No hay cotizaciones. Importá el Excel histórico desde "Importar / Ajustes" o creá una nueva.</td></tr>'}
    </tbody></table></div>`);
  const upd = () => { fCots.q = $('#q').value; fCots.mes = $('#mes').value; fCots.estado = $('#est').value; const p = $('#q').selectionStart; vCots(); $('#q').focus(); $('#q').setSelectionRange(p, p); };
  $('#q').oninput = upd; $('#mes').onchange = upd; $('#est').onchange = upd;
  $('#nueva').onclick = nuevaCot;
  $('#ped').onclick = () => pickFile('.pdf', importarPDF);
  $$('tr[data-go]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.go);
}
function nuevaCot() {
  const o = modal(`<h2>Nueva cotización</h2><div class="grid2">
    <label class="f">Proceso / expediente<input class="in" id="np" placeholder="EXPTE 251500" required></label>
    <label class="f">Apertura<input class="in" id="na" placeholder="dd/mm/aaaa - 10:00hs"></label>
    <label class="f">Cliente<input class="in" id="nc" value="ISSN"></label></div>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Crear</button></div>`);
  $('#ok', o).onclick = async () => {
    const proceso = $('#np', o).value.trim(); if (!proceso) return;
    if (S.cots.some(c => P.norm(c.proceso) === P.norm(proceso))) return toast('Ese proceso ya existe');
    const ap = $('#na', o).value.trim();
    const [c] = await db.ins('cc_cotizaciones', [{ proceso, apertura: ap, fecha: P.fechaDe(ap) || new Date().toISOString().slice(0, 10), hoja: hojaActual(), cliente: $('#nc', o).value.trim(), estado: 'abierta', updated_by: who() }]);
    S.cots.push(c); reindex(); o.remove(); location.hash = '#cot/' + c.id;
  };
}

// ======================================================================
//  Vista: detalle de cotización (la pantalla para cotizar)
// ======================================================================
// ======================================================================
//  Planilla tipo Excel (la usan "Planilla" y el detalle de cada cotización)
// ======================================================================
const MESES_N = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const hojaDe = c => c.hoja || (c.fecha ? MESES_N[+c.fecha.slice(5, 7) - 1] + ' ' + c.fecha.slice(0, 4) : 'SIN FECHA');
const hojaActual = () => { const d = new Date(); return MESES_N[d.getMonth()] + ' ' + d.getFullYear(); };
const LM = new Map();
function live(it) {
  let x = LM.get(it.id); if (x) return x;
  const n = intel(it); const ref = n.ref;
  x = { cc: costoMetaCot(it), ca: costoMetaAct(it), raro: saltoRaro(it), act: n.actual ? n.actual.a : null, ult: n.ultimo, mg: ref ? margenParaGanar(it, ref.a.unitComp) : null };
  LM.set(it.id, x); return x;
}
const n2 = v => v == null || v === '' ? '' : nf2.format(v);
const n0 = v => v == null || v === '' ? '' : nf0.format(v);
const pc2 = v => v == null ? '' : pct(v, 2);
const nG = v => v == null || v === '' ? '' : typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 4 }) : v;
function planCols(sin = []) {
  const cot = r => I.cot.get(r.cotizacion_id) || {};
  const L = live, N = 'num', T = 'text';
  const cols = [
    { key: 'renglon', title: 'R', w: 40, type: N, edit: 1, get: r => r.renglon },
    { key: 'cantidad', title: 'CANT. ENV', w: 64, type: N, edit: 1, get: r => r.cantidad, fmt: n0 },
    { key: 'lista', title: 'LISTA', w: 84, type: T, edit: 1, get: r => r.lista },
    { key: 'codigo', title: 'CODIGO', w: 100, type: T, edit: 1, get: r => r.codigo, tip: 'Al escribir un código se completan detalle, laboratorio, PVP, PSL, DTOCPA y COSTO desde Costos (como el BUSCARX del Excel)' },
    { key: 'detalle', title: 'DETALLE', w: 250, type: T, edit: 1, get: r => r.detalle, tip: 'Doble click: historial de precios y competencia' , onOpen: r => historial(r) },
    { key: 'monodroga', title: 'MONODROGA', w: 140, type: T, edit: 1, get: r => r.monodroga },
    { key: 'laboratorio', title: 'LABORATORIO', w: 160, type: T, edit: 1, get: r => r.laboratorio },
    { key: 'desc_cliente', title: 'Descripción pedido', w: 200, type: T, edit: 1, get: r => r.desc_cliente || '', tip: 'Como figura el renglón en el pedido de cotización' },
    { key: 'cod_cliente', title: 'Cód. cliente', w: 76, type: T, edit: 1, get: r => r.cod_cliente || '', tip: 'Código del cliente (MED…). Sirve para que el próximo pedido proponga el mismo producto' },
    { key: 'pvp', title: 'PVP', w: 96, type: N, edit: 1, get: r => r.pvp, fmt: n2 },
    { key: 'psl', title: 'PSL', w: 96, type: N, edit: 1, get: r => r.psl, fmt: n2 },
    { key: 'dtocpa', title: 'DTOCPA', w: 60, type: N, edit: 1, get: r => r.dtocpa, fmt: nG },
    { key: 'costo', title: 'COSTO', w: 96, type: N, edit: 1, get: r => r.costo, fmt: n2 },
    { key: 'stock', title: 'STOCK', w: 58, type: T, edit: 1, get: r => r.stock },
    { key: 'obs', title: 'OBS', w: 150, type: T, edit: 1, get: r => r.obs },
    { key: 'plazo', title: 'PLAZO', w: 54, type: N, edit: 1, get: r => r.plazo, fmt: nG },
    { key: 'dcto_pvp', title: 'Dcto. Acord SOBRE PVP', w: 76, type: N, edit: 1, get: r => r.dcto_pvp, fmt: nG },
    { key: 'dcto_psl', title: 'Dcto. Acord SOBRE PSL', w: 76, type: N, edit: 1, get: r => r.dcto_psl, fmt: nG, tip: 'Si tiene valor: Costo META = PSL × (100 − dcto) / 100' },
    { key: 'costo_meta', title: 'Costo META', w: 100, type: N, get: r => L(r).cc, fmt: n2, formula: (n, C) => `=SI(${C('dcto_psl')}${n}="";${C('costo')}${n};${C('psl')}${n}*(100-${C('dcto_psl')}${n})/100)` },
    { key: 'costo_total', title: 'Costo Total', w: 116, type: N, get: r => L(r).cc != null ? L(r).cc * (r.cantidad || 0) : null, fmt: n0, formula: (n, C) => `=${C('costo_meta')}${n}*${C('cantidad')}${n}` },
    { key: 'margen', title: 'R [%]', w: 66, type: 'pct', edit: 1, get: r => r.margen, fmt: pc2, raw: r => r.margen == null ? null : +(r.margen * 100).toFixed(4), tip: 'Margen sobre precio de venta. Escribí 5 para 5 %' },
    { key: 'punit', title: 'P. Unit (C/Decimales)', w: 104, type: N, get: r => { const c = L(r).cc; return c != null && r.margen != null && r.margen < 1 ? c / (1 - r.margen) : null; }, fmt: n2, formula: (n, C) => `=${C('costo_meta')}${n}/(1-${C('margen')}${n})` },
    { key: 'precio_unit', title: 'Pcio. VENTA', w: 100, type: N, edit: 1, get: r => r.precio_unit, fmt: n0, tip: 'Redondeo del P. Unit. Si lo cambiás a mano se recalcula el R [%]' },
    { key: 'precio_total', title: 'Precio Total', w: 118, type: N, get: r => r.precio_unit != null ? r.precio_unit * (r.cantidad || 0) : null, fmt: n0, formula: (n, C) => `=${C('precio_unit')}${n}*${C('cantidad')}${n}` },
    { key: 'proceso', title: 'Proceso', w: 108, type: T, edit: 1, get: r => cot(r).proceso, onOpen: r => location.hash = '#cot/' + r.cotizacion_id, tip: 'Cambiarlo mueve el renglón a ese proceso (si no existe se crea). Doble click: abre la cotización' },
    { key: 'apertura', title: 'Apertura', w: 140, type: T, edit: 1, get: r => cot(r).apertura },
    { key: 'oc', title: 'OC', w: 64, type: T, edit: 1, get: r => r.oc || '' },
    { key: 'condicion', title: 'CONDICION', w: 92, type: T, edit: 1, get: r => cot(r).condicion },
    { key: 'adjudicado', title: 'Adj.', w: 46, type: T, edit: 1, get: r => r.adjudicado == null ? '' : r.adjudicado ? 'Sí' : 'No', cls: v => v === 'Sí' ? 'ok b' : v === 'No' ? 'bad' : '', tip: 'Sí / No' },
    // ---- en vivo ----
    { key: 'costo_act', title: 'Costo actual', w: 100, type: N, live: 1, get: r => L(r).ca, fmt: (v, r) => v == null ? '' : L(r).raro ? `<span class="g">${nf2.format(v)}</span>` : nf2.format(v), tip: 'Costo META con los costos cargados hoy' },
    { key: 'stock_cot', title: 'Stock (cotizador)', w: 70, type: N, live: 1, get: r => { const k = costoRow(r); return k && k.stockCot != null ? k.stockCot : null; }, fmt: n0, tip: 'Stock del catálogo del cotizador' },
    { key: 'control', title: 'Control costo', w: 92, type: T, live: 1, get: r => { const x = L(r); if (x.ca == null) return 'SIN DATO'; if (x.raro) return '¿ESPECIAL?'; return x.cc && Math.abs(x.ca / x.cc - 1) > 0.0005 ? 'ACTUALIZAR' : 'IGUAL'; },
      cls: v => v === 'IGUAL' ? 'ok' : v === 'ACTUALIZAR' ? 'warn b' : v === '¿ESPECIAL?' ? 'bad' : 'g', titleOf: (v, r) => { const x = L(r); return x.ca != null && x.cc ? `Costo actual vs cotizado: ${x.ca > x.cc ? '+' : ''}${pct(x.ca / x.cc - 1)}${x.raro ? ' — diferencia muy grande, probable costo especial: no se usa en los cálculos' : ''}` : ''; } },
    { key: 'r_act', title: 'R [%] con costo actual', w: 76, type: 'pct', live: 1, get: r => { const x = L(r); return x.ca != null && !x.raro && r.precio_unit ? 1 - x.ca / r.precio_unit : null; }, fmt: pc2, cls: v => clsMargen(v), formula: (n, C) => `=1-${C('costo_act')}${n}/${C('precio_unit')}${n}` },
    { key: 'pos', title: 'Posición en acta', w: 72, type: N, live: 1, get: r => L(r).act ? L(r).act.posicion : null, fmt: (v, r) => v ? `${v}° de ${L(r).act.ofertasValidas}` : (L(r).act ? 'no cotiz.' : ''), cls: v => v === 1 ? 'ok b' : v ? 'bad' : '' },
    { key: 'mejor', title: 'Mejor competidor', w: 140, type: T, live: 1, get: r => { const a = L(r).act; return a ? (a.mejorComp ? P.canonProv(a.mejorComp.proveedor) : 'Sin competencia') : ''; }, cls: v => v === 'Sin competencia' ? 'ok' : '', titleOf: v => v === 'Sin competencia' ? 'En el acta de este proceso ningún otro proveedor cotizó este renglón' : '' },
    { key: 'marca_comp', title: 'Marca competidor', w: 130, type: T, live: 1, get: r => { const a = L(r).act; return a && a.mejorComp ? a.mejorComp.marca || '' : ''; } },
    { key: 'unit_comp', title: 'Unit. competidor', w: 100, type: N, live: 1, get: r => L(r).act ? L(r).act.unitComp : null, fmt: n0 },
    { key: 'dif', title: 'Dif. vs competidor', w: 76, type: 'pct', live: 1, get: r => { const a = L(r).act; return a && a.unitComp && r.precio_unit ? r.precio_unit / a.unitComp - 1 : null; }, fmt: v => v == null ? '' : (v > 0 ? '+' : '') + pct(v), cls: v => v == null ? '' : v > 0 ? 'bad' : 'ok' },
    { key: 'ult', title: 'Últ. ganador histórico', w: 170, type: T, live: 1, get: r => { const u = L(r).ult; return u ? `${P.canonProv(u.a.mejorComp.proveedor)} · ${fdate(u.fecha)}` : ''; }, titleOf: (v, r) => { const u = L(r).ult; return u ? `${u.proceso} · marca ${u.a.mejorComp.marca || '—'}${u.a.posicion ? ` · fuimos ${u.a.posicion}°` : ''}` : ''; } },
    { key: 'ult_unit', title: 'Unit. histórico', w: 96, type: N, live: 1, get: r => L(r).ult ? L(r).ult.a.unitComp : null, fmt: n0 },
    { key: 'mg', title: 'Margen p/ganar', w: 80, type: 'pct', live: 1, get: r => L(r).mg, fmt: pc2, cls: v => clsMargen(v) + ' b', tip: 'Margen al que había que ir (con el costo actual) para igualar al mejor competidor de este proceso, o al último ganador histórico si todavía no hay acta' },
  ];
  return cols.filter(c => !sin.includes(c.key));
}
const UNDO = [];
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k] ?? null]));
function aplicarCampo(it, key, value, patch, cotPatch, setMove) {
  const v = String(value ?? '').trim();
  const cur = () => ({ ...it, ...patch });
  const nn = () => v === '' ? null : P.num(v.replace('%', ''));
  const reprice = () => { const c = cur(); const cm = P.costoMeta(c); if (c.margen != null && cm != null) patch.precio_unit = P.precioDe(cm, c.margen); };
  switch (key) {
    case 'renglon': patch.renglon = v === '' ? null : Math.round(P.num(v)); break;
    case 'cantidad': case 'plazo': case 'dtocpa': case 'dcto_pvp': case 'pvp': patch[key] = nn(); break;
    case 'psl': case 'costo': case 'dcto_psl': patch[key] = nn(); reprice(); break;
    case 'margen': patch.margen = v === '' ? null : nn() / 100; reprice(); break;
    case 'precio_unit': patch.precio_unit = v === '' ? null : Math.round(nn()); patch.margen = P.margenDe(P.costoMeta(cur()), patch.precio_unit); break;
    case 'codigo': {
      patch.codigo = v;
      const c = cur(); const k = I.costo.get(v + '|' + (c.lista || '')) || I.costoCod.get(v);
      if (k) { Object.assign(patch, { lista: c.lista || k.lista, detalle: k.detalle, monodroga: k.monodroga, laboratorio: k.laboratorio, pvp: k.pvp, psl: k.psl, dtocpa: k.dtocpa, costo: k.costo }); if (c.margen == null) patch.margen = conf('margenObjetivo'); reprice(); }
      else if (v) toast(`El código ${v} no está en Costos: completá los datos a mano`);
      break;
    }
    case 'adjudicado': patch.adjudicado = v === '' ? null : /^(s|si|sí|1|x|true|y)$/i.test(v); break;
    case 'proceso': if (v) setMove(v); break;
    case 'apertura': cotPatch.apertura = v; cotPatch.fecha = P.fechaDe(v) || (I.cot.get(it.cotizacion_id) || {}).fecha || null; break;
    case 'condicion': cotPatch.condicion = v; break;
    default: patch[key] = v;
  }
}
async function cotPorProceso(proceso, hoja) {
  const k = P.norm(proceso);
  let c = S.cots.find(x => P.norm(x.proceso) === k) || S.cots.find(x => P.procesoKey(x.proceso) === P.procesoKey(proceso) && /^\d{5,7}$/.test(P.procesoKey(proceso)));
  if (c) return c;
  const pr = /^\d+$/.test(proceso.trim()) ? 'EXPTE ' + proceso.trim() : proceso.trim();
  [c] = await db.ins('cc_cotizaciones', [{ proceso: pr, estado: 'abierta', fecha: new Date().toISOString().slice(0, 10), hoja: hoja || hojaActual(), cliente: 'ISSN', updated_by: who() }]);
  S.cots.push(c); reindex(); toast(`Se creó la cotización ${pr}`);
  return c;
}
async function editarItems(changes) {
  const por = new Map();
  for (const ch of changes) { if (!por.has(ch.row)) por.set(ch.row, []); por.get(ch.row).push(ch); }
  const undo = [];
  for (const [it, chs] of por) {
    const patch = {}, cotPatch = {}; let mover = null;
    for (const { col, value } of chs) aplicarCampo(it, col.key, value, patch, cotPatch, x => mover = x);
    if (mover) { const c = await cotPorProceso(mover); if (c.id !== it.cotizacion_id) patch.cotizacion_id = c.id; }
    if (Object.keys(patch).length) { undo.push({ t: 'item', id: it.id, before: pick(it, Object.keys(patch)) }); Object.assign(it, await db.upd('cc_items', it.id, patch)); }
    if (Object.keys(cotPatch).length) { const c = I.cot.get(it.cotizacion_id); undo.push({ t: 'cot', id: c.id, before: pick(c, Object.keys(cotPatch)) }); Object.assign(c, await db.upd('cc_cotizaciones', c.id, { ...cotPatch, updated_by: who() })); }
  }
  if (undo.length) UNDO.push(undo);
  reindex();
}
async function nuevaFila(cells, procDef, hoja) {
  const pc = cells.find(x => x.col.key === 'proceso');
  const proceso = (pc && pc.value.trim()) || procDef();
  if (!proceso) { toast('Escribí primero el Proceso de la fila nueva'); return; }
  const cot = await cotPorProceso(proceso, hoja);
  const its = I.itemsByCot.get(cot.id) || [];
  const base = { cotizacion_id: cot.id, renglon: Math.max(0, ...its.map(i => i.renglon || 0)) + 1, orden: Math.max(0, ...its.map(i => i.orden || 0)) + 1, margen: conf('margenObjetivo') };
  const patch = {}, cp = {};
  for (const { col, value } of cells) if (col.key !== 'proceso') aplicarCampo(base, col.key, value, patch, cp, () => {});
  const [it] = await db.ins('cc_items', [{ ...base, ...patch }]);
  S.items.push(it);
  if (Object.keys(cp).length) Object.assign(cot, await db.upd('cc_cotizaciones', cot.id, cp));
  UNDO.push([{ t: 'ins', id: it.id }]); reindex();
  return it;
}
async function borrarFilas(rows) {
  if (!confirm(rows.length === 1 ? `¿Eliminar el renglón ${rows[0].renglon ?? ''} · ${rows[0].detalle}?` : `¿Eliminar ${rows.length} renglones?`)) return false;
  await db.del('cc_items', 'id', rows.map(r => r.id));
  const ids = new Set(rows.map(r => r.id));
  S.items = S.items.filter(i => !ids.has(i.id));
  UNDO.push([{ t: 'del', rows: rows.map(r => ({ ...r })) }]);
  reindex(); toast(`${rows.length} renglón(es) eliminado(s) — Ctrl+Z para deshacer`); return true;
}
async function deshacer() {
  const u = UNDO.pop(); if (!u) { toast('Nada para deshacer'); return; }
  for (const x of [...u].reverse()) {
    if (x.t === 'item') { const it = I.item.get(x.id); if (it) Object.assign(it, await db.upd('cc_items', x.id, x.before)); }
    else if (x.t === 'cot') { const c = I.cot.get(x.id); if (c) Object.assign(c, await db.upd('cc_cotizaciones', x.id, x.before)); }
    else if (x.t === 'ins') { await db.del('cc_items', 'id', [x.id]); S.items = S.items.filter(i => i.id !== x.id); }
    else if (x.t === 'del') { const rows = await db.ins('cc_items', x.rows.map(({ id, created_at, updated_at, ...r }) => r)); S.items.push(...rows); }
  }
  reindex(); toast('Deshecho');
}
function menuFilas(rows, row) {
  const comps = (I.rensByItem.get(row.id) || []).map(r => r.comparativa_id);
  return [
    { label: 'Ver historial y competencia', run: () => historial(row) },
    { label: `Abrir cotización ${(I.cot.get(row.cotizacion_id) || {}).proceso || ''}`, run: () => { location.hash = '#cot/' + row.cotizacion_id; } },
    ...(comps.length ? [{ label: 'Abrir acta comparativa', run: () => { location.hash = '#comp/' + comps[0]; } }] : []),
    '-',
    { label: 'Agregar renglón a este proceso', run: async () => { await nuevaFila([], () => (I.cot.get(row.cotizacion_id) || {}).proceso); } },
    { label: 'Duplicar fila', run: async () => { const { id, created_at, updated_at, ...r } = row; const [n] = await db.ins('cc_items', [{ ...r, orden: (r.orden || 0) + 1 }]); S.items.push(n); UNDO.push([{ t: 'ins', id: n.id }]); reindex(); } },
    '-',
    { label: rows.length > 1 ? `Eliminar ${rows.length} filas` : 'Eliminar fila', danger: true, run: () => borrarFilas(rows) },
  ];
}
function ordenPlanilla(a, b) {
  const ca = I.cot.get(a.cotizacion_id) || {}, cb = I.cot.get(b.cotizacion_id) || {};
  return String(ca.fecha || '').localeCompare(String(cb.fecha || '')) || (ca.id - cb.id) || ((a.orden ?? 1e9) - (b.orden ?? 1e9)) || ((a.renglon ?? 0) - (b.renglon ?? 0)) || a.id - b.id;
}
const ocultasDe = id => { const v = conf('colsOcultas'); return (v && Array.isArray(v[id])) ? v[id] : []; };
async function setOcultas(id, keys) { const v = { ...(conf('colsOcultas') || {}) }; v[id] = [...new Set(keys)]; await db.ups('cc_config', [{ clave: 'colsOcultas', valor: v }], ['clave']); S.cfg.colsOcultas = v; }
const filaOculta = r => !!(((r._base || r).fmt) || {}).__oculta;
async function ocultarFilas(rows, ocultar) {
  const undo = []; const vistos = new Set();
  for (const r of rows) {
    const it = r._base || r; if (vistos.has(it)) continue; vistos.add(it);
    const f = { ...(it.fmt || {}) }; if (ocultar) f.__oculta = 1; else delete f.__oculta;
    undo.push({ t: 'item', id: it.id, before: { fmt: it.fmt || null } });
    try { Object.assign(it, await db.upd('cc_items', it.id, { fmt: Object.keys(f).length ? f : null })); }
    catch (e) { if (/fmt/.test(e.message)) { toast('Para ocultar filas, corré de nuevo schema.sql en Supabase.', 7000); return; } throw e; }
  }
  if (undo.length) UNDO.push(undo);
  toast(ocultar ? `${undo.length} fila(s) oculta(s)` : `${undo.length} fila(s) visibles de nuevo`);
}
function montarGrilla(host, rowsFn, { id, sin = [], procDef, hoja, sinNuevas }) {
  const full = planCols(sin); full.forEach((c, i) => c.L = colLetter(i));
  const ocultas = new Set(ocultasDe(id).filter(k => full.some(c => c.key === k)));
  const cols = []; let pend = [];
  for (const c of full) { if (ocultas.has(c.key)) { pend.push(c); continue; } c.hidBefore = pend; pend = []; cols.push(c); }
  const remount = () => route();
  let grid;
  const firsts = () => { const s = new Set(); let prev = null; for (const r of grid.view) { if (prev !== null && r.cotizacion_id !== prev) s.add(r.id); prev = r.cotizacion_id; } return s; };
  let fs = new Set();
  grid = Grid(host, {
    id, cols, frozen: cols.filter(c => ['renglon', 'cantidad', 'lista', 'codigo', 'detalle'].includes(c.key)).length,
    letterOf: key => (full.find(c => c.key === key) || {}).L || '?',
    rowHidden: filaOculta,
    onShowRows: async rows => { await ocultarFilas(rows, false); },
    onHideRows: async rows => { await ocultarFilas(rows, true); },
    hiddenColsCount: () => ocultas.size,
    onHideCols: async keys => { if (keys.length >= cols.length) return toast('No se pueden ocultar todas las columnas'); await setOcultas(id, [...ocultas, ...keys]); remount(); },
    onShowCols: async keys => { await setOcultas(id, keys ? [...ocultas].filter(k => !keys.includes(k)) : []); remount(); },
    onEdit: async ch => {
      const lin = ch.filter(c => c.row._line && c.col.key === 'cantidad');
      for (const c of lin) { const v = P.num(c.value); Object.assign(c.row._line, await db.upd('cc_oc_items', c.row._line.id, { cantidad: v, importe: v != null && c.row._line.precio != null ? v * c.row._line.precio : null })); }
      await editarItems(ch.filter(c => !lin.includes(c)).map(c => ({ ...c, row: c.row._base || c.row })));
      reindex(); grid.setRows(rowsFn()); fs = firsts();
    },
    onNewRow: sinNuevas ? undefined : async cells => { await nuevaFila(cells, procDef, hoja); grid.setRows(rowsFn()); fs = firsts(); },
    onDelete: async rows => { const ok = rows[0] && rows[0]._line ? await quitarDeOC(rows) : await borrarFilas(rows.map(r => r._base || r)); if (ok) grid.setRows(rowsFn()); return ok; },
    onUndo: async () => { await deshacer(); grid.setRows(rowsFn()); },
    ghostText: c => c.key === 'proceso' ? (procDef() || '') : c.key === 'detalle' ? 'escribí acá para agregar…' : '',
    menu: (rows, row) => {
      const its = menuFilas(rows.map(r => r._base || r), row._base || row);
      const extra = [{ label: rows.length > 1 ? `Ocultar ${rows.length} filas` : 'Ocultar fila', run: () => ocultarFilas(rows, true) }];
      if (grid.nHidden) extra.push({ label: `Mostrar filas ocultas (${grid.nHidden})`, run: () => ocultarFilas(grid.rows.filter(filaOculta), false) });
      const k = its.findIndex(x => x === '-');
      its.splice(k + 1, 0, ...extra, '-');
      return its;
    },
    fmtOf: (r, c) => { const f = (r._base || r).fmt; return f && f[c.key] || null; },
    onFormat: async cells => {
      const por = new Map();
      for (const x of cells) { const it = x.row._base || x.row; if (!por.has(it)) por.set(it, []); por.get(it).push(x); }
      const undo = [];
      for (const [it, xs] of por) {
        const f = { ...(it.fmt || {}) };
        for (const x of xs) { if (Object.keys(x.fmt).length) f[x.col.key] = x.fmt; else delete f[x.col.key]; }
        undo.push({ t: 'item', id: it.id, before: { fmt: it.fmt || null } });
        try { Object.assign(it, await db.upd('cc_items', it.id, { fmt: Object.keys(f).length ? f : null })); }
        catch (e) { if (/fmt/.test(e.message)) { toast('Para guardar formatos, corré de nuevo schema.sql en Supabase.', 7000); return; } throw e; }
      }
      UNDO.push(undo);
    },
    rowClass: r => fs.has(r.id) ? 'grp' : '',
  });
  grid.setRows(rowsFn()); fs = firsts(); grid.setRows(rowsFn());
  host._grid = grid; grid._cols = cols;
  return grid;
}
function exportGrilla(grid, nombre) {
  const cols = grid._cols;
  const data = [cols.map(c => c.title)].concat(grid.view.map(r => cols.map(c => { const v = c.get(r); return v == null ? '' : v; })));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = cols.map(c => ({ wpx: c.w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 30).replace(/[\\/?*[\]:]/g, ' '));
  XLSX.writeFile(wb, nombre.replace(/[^\w]+/g, '_') + '.xlsx');
}
const AYUDA = `<div class="xlhelp">Como en Excel: flechas para moverte · escribí para reemplazar · <kbd>F2</kbd> o doble click para editar · <kbd>Enter</kbd>/<kbd>Tab</kbd> confirman · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copian y pegan con Excel · <kbd>Supr</kbd> borra · <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace · click derecho en una fila para más opciones · click en un título ordena · la fila de filtro acepta texto o &gt;n, &lt;n. Columnas celestes = calculadas, amarillas = en vivo (costos de hoy y competencia).</div>`;

// ---------- Vista: Planilla con pestañas por mes ----------
const ESPECIALES = t => t === 'TODAS' || t === 'ADJ' || /^OC /.test(t);
const hojasGuardadas = () => (Array.isArray(conf('hojas')) ? conf('hojas') : []);
async function guardarHojas(lista) { const v = [...new Set(lista.filter(Boolean))]; await db.ups('cc_config', [{ clave: 'hojas', valor: v }], ['clave']); S.cfg.hojas = v; }
function siguienteHoja(lista) {
  // propone el mes siguiente a la hoja más nueva ("OCTUBRE 2026" → "NOVIEMBRE 2026")
  let best = null;
  for (const h of lista) { const m = h.match(/^([A-Z]+) (\d{4})$/); if (!m) continue; const i = MESES_N.indexOf(m[1]); if (i < 0) continue; const k = +m[2] * 12 + i; if (best == null || k > best) best = k; }
  if (best == null) return hojaActual();
  best++; return MESES_N[best % 12] + ' ' + Math.floor(best / 12);
}
function pedirNombre(titulo, valor, cb) {
  const o = modal(`<h2>${esc(titulo)}</h2><input class="in" id="hn" value="${esc(valor)}" style="width:100%">
    <p class="small muted">Para que se ordenen solas, usá "MES AÑO" (ej. NOVIEMBRE 2026), pero puede ser cualquier nombre.</p>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Aceptar</button></div>`);
  const inp = $('#hn', o); inp.focus(); inp.select();
  const go = async () => { const v = inp.value.trim().toUpperCase().replace(/\s+/g, ' '); if (!v) return; if (ESPECIALES(v)) return toast('Ese nombre está reservado'); o.remove(); await cb(v); };
  $('#ok', o).onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
}
function vPlanilla(tab) {
  const hojas = new Map();
  for (const h of hojasGuardadas()) hojas.set(h, '');
  for (const c of S.cots) { const h = hojaDe(c); if (!hojas.get(h) || String(c.fecha || '') > hojas.get(h)) hojas.set(h, String(c.fecha || '')); }
  const clave = h => { const m = h.match(/^([A-Z]+) (\d{4})$/); const i = m ? MESES_N.indexOf(m[1]) : -1; return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}-99` : (hojas.get(h) || '9999'); };
  const lista = [...hojas.keys()].sort((a, b) => clave(b).localeCompare(clave(a)));
  const ocs = [...new Set([...S.items.flatMap(i => ocsDe(i)), ...S.ocs.map(o => String(o.numero))])].sort((a, b) => (+b || 0) - (+a || 0));
  tab = tab || lista[0] || 'TODAS';
  const rowsFn = () => {
    let r;
    if (tab === 'TODAS') r = S.items;
    else if (tab === 'ADJ') r = S.items.filter(i => i.adjudicado);
    else if (tab.startsWith('OC ')) r = filasOC(tab.slice(3));
    else r = S.items.filter(i => hojaDe(I.cot.get(i.cotizacion_id) || {}) === tab);
    return [...r].sort(ordenPlanilla);
  };
  const t = (k, l, hoja) => `<a href="#planilla/${encodeURIComponent(k)}" class="${k === tab ? 'on' : ''}" ${hoja ? `data-hoja="${esc(k)}" title="Doble click para renombrar · click derecho para más opciones"` : ''}>${esc(l)}</a>`;
  const vacia = !ESPECIALES(tab) && !rowsFn().length;
  shell(`<div class="xltop"><span class="ttl">Planilla</span><span class="sub">Hoja <b>${esc(tab === 'ADJ' ? 'Adjudicados' : tab === 'TODAS' ? 'Todas' : tab)}</b></span><span class="spacer"></span>
    <button class="btn pri" id="ped" title="Pedido de cotización, acta comparativa u orden de compra: se detecta solo">Importar PDF</button><button class="btn" id="nc">+ Nueva cotización</button><button class="btn" id="xls">Exportar hoja a Excel</button></div>
    ${tab.startsWith('OC ') && I.oc.get(tab.slice(3)) ? (() => { const o = I.oc.get(tab.slice(3)); return `<div class="card" style="padding:8px 14px;margin-bottom:8px" class="small">Orden de provisión <b>${esc(o.serie ? o.serie + ' - ' : '')}${esc(o.numero)}</b> · ${fdate(o.fecha)} · ${esc(o.proceso || '')} ${esc(o.plan || '')} · Cond. ${esc(o.condicion || '—')} · vence ${fdate(o.vence)} · Total <b>${money(o.total)}</b> <button class="btn sm danger" id="delOC" style="margin-left:10px">Eliminar OC</button></div>`; })() : ''}
    ${vacia ? `<div class="card" style="padding:10px 14px;margin-bottom:8px">Hoja vacía. Escribí en la fila <b>＋</b> empezando por la columna <b>Proceso</b> (ej. EXPTE 252000): se crea la cotización en esta hoja y después cargás los renglones debajo.</div>` : ''}
    <div id="gh"></div>
    <div class="xltabs"><a href="#" id="addHoja" title="Nueva hoja" style="font-weight:700">＋</a>${lista.map(h => t(h, h, true)).join('')}<span class="sep"></span>${t('TODAS', 'Todas')}${t('ADJ', 'Adjudicados')}${ocs.length ? '<span class="sep"></span>' + ocs.slice(0, 30).map(o => t('OC ' + o, 'OC ' + o)).join('') : ''}</div>${AYUDA}`, { full: true });
  const host = $('#gh'); host.style.height = `calc(100vh - ${vacia ? 265 : tab.startsWith('OC ') && I.oc.get(tab.slice(3)) ? 255 : 205}px)`;
  const procDef = () => { const g = host._grid; const v = g ? g.view : []; const last = v[v.length - 1]; return last ? (I.cot.get(last.cotizacion_id) || {}).proceso : ''; };
  const g = montarGrilla(host, rowsFn, { id: 'plan', procDef, hoja: ESPECIALES(tab) ? null : tab, sinNuevas: tab.startsWith('OC ') || tab === 'ADJ' });
  $('#nc').onclick = nuevaCot;
  $('#ped').onclick = () => pickFile('.pdf', importarPDF);
  host.addEventListener('dragover', e => e.preventDefault());
  host.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f && /\.pdf$/i.test(f.name)) { e.preventDefault(); importarPDF(f); } });
  if ($('#delOC')) $('#delOC').onclick = () => eliminarOC(I.oc.get(tab.slice(3)));
  $('#xls').onclick = () => exportGrilla(g, 'Planilla ' + (tab === 'ADJ' ? 'Adjudicados' : tab));
  // ---- hojas: agregar / renombrar / eliminar ----
  $('#addHoja').onclick = e => { e.preventDefault(); pedirNombre('Nueva hoja', siguienteHoja(lista), async v => {
    if (lista.includes(v)) { location.hash = '#planilla/' + encodeURIComponent(v); return; }
    await guardarHojas([...hojasGuardadas(), v]); location.hash = '#planilla/' + encodeURIComponent(v); toast(`Hoja ${v} creada`);
  }); };
  const renombrar = vieja => pedirNombre(`Renombrar hoja ${vieja}`, vieja, async nueva => {
    if (nueva === vieja) return;
    const ids = S.cots.filter(c => hojaDe(c) === vieja).map(c => c.id);
    if (ids.length) await db.updIn('cc_cotizaciones', 'id', ids, { hoja: nueva });
    S.cots.forEach(c => { if (ids.includes(c.id)) c.hoja = nueva; });
    await guardarHojas(hojasGuardadas().map(h => h === vieja ? nueva : h).concat(hojasGuardadas().includes(vieja) ? [] : []));
    reindex(); location.hash = '#planilla/' + encodeURIComponent(nueva); toast('Hoja renombrada');
  });
  const eliminar = async h => {
    const cs = S.cots.filter(c => hojaDe(c) === h);
    if (!cs.length) {
      if (!confirm(`¿Eliminar la hoja ${h}?`)) return;
      await guardarHojas(hojasGuardadas().filter(x => x !== h)); location.hash = '#planilla'; toast('Hoja eliminada'); return;
    }
    const nIt = cs.reduce((n, c) => n + (I.itemsByCot.get(c.id) || []).length, 0);
    const otras = lista.filter(x => x !== h);
    const o = modal(`<h2>Eliminar hoja ${esc(h)}</h2>
      <p>La hoja tiene <b>${cs.length}</b> cotización(es) con <b>${nIt}</b> renglones: ${cs.map(c => esc(c.proceso)).join(', ')}.</p>
      <label class="row" style="margin:12px 0 6px"><input type="radio" name="dh" value="mover" checked> Mover las cotizaciones a la hoja
        <select class="in" id="dest" style="margin-left:6px">${otras.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
      <label class="row"><input type="radio" name="dh" value="borrar"> <span class="bad">Borrar también las cotizaciones y sus renglones</span> (no se puede deshacer)</label>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Eliminar hoja</button></div>`);
    if (!otras.length) { $('input[value=borrar]', o).checked = true; $('#dest', o).disabled = true; }
    $('#ok', o).onclick = async () => {
      const modo = $('input[name=dh]:checked', o).value;
      const ids = cs.map(c => c.id);
      if (modo === 'mover') { const d = $('#dest', o).value; await db.updIn('cc_cotizaciones', 'id', ids, { hoja: d }); }
      else { if (!confirm(`Se van a borrar ${cs.length} cotización(es) y ${nIt} renglones. ¿Seguro?`)) return; await db.del('cc_items', 'cotizacion_id', ids); await db.del('cc_cotizaciones', 'id', ids); }
      await guardarHojas(hojasGuardadas().filter(x => x !== h));
      o.remove(); await loadAll();
      location.hash = '#planilla' + (modo === 'mover' ? '/' + encodeURIComponent($('#dest', o).value) : '');
      toast(modo === 'mover' ? 'Cotizaciones movidas y hoja eliminada' : 'Hoja y cotizaciones eliminadas');
    };
  };
  $$('[data-hoja]').forEach(a => {
    a.ondblclick = e => { e.preventDefault(); renombrar(a.dataset.hoja); };
    a.oncontextmenu = e => {
      e.preventDefault(); const h = a.dataset.hoja;
      const m = document.createElement('div'); m.className = 'xlmenu';
      m.innerHTML = '<div data-a="ren">Cambiar nombre</div><div data-a="new">Insertar hoja nueva</div><hr><div data-a="del" class="danger">Eliminar hoja</div>';
      m.style.left = Math.min(e.clientX, innerWidth - 230) + 'px'; m.style.top = (e.clientY - 110) + 'px';
      document.body.appendChild(m);
      const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); };
      const out = ev => { if (!m.contains(ev.target)) close(); };
      setTimeout(() => document.addEventListener('mousedown', out, true));
      m.onclick = ev => { const d = ev.target.closest('[data-a]'); if (!d) return; close(); ({ ren: () => renombrar(h), new: () => $('#addHoja').click(), del: () => eliminar(h) })[d.dataset.a](); };
    };
  });
  g.focus();
}

// ======================================================================
//  Vista: detalle de cotización
// ======================================================================
function vCot(id) {
  const c = I.cot.get(id); if (!c) return vCots();
  const its = I.itemsByCot.get(id) || [];
  const comps = I.compsByCot.get(id) || [];
  const R = resumenCot(c);
  let costoAct = 0, totAct = 0, desact = 0, raros = 0;
  for (const it of its) { const ca = costoMetaAct(it); const cc = costoMetaCot(it); if (ca == null) continue; if (saltoRaro(it)) { raros++; continue; } costoAct += ca * (it.cantidad || 0); totAct += (it.precio_unit || 0) * (it.cantidad || 0); if (cc && Math.abs(ca - cc) / cc > 0.001) desact++; }
  shell(`<div class="row" style="margin-bottom:8px"><a href="#planilla/${encodeURIComponent(hojaDe(c))}" class="small">← Planilla ${esc(hojaDe(c))}</a><span class="muted small">·</span><a href="#cotizaciones" class="small">Lista de cotizaciones</a></div>
  <div class="card" style="padding:12px 16px"><div class="row"><div><h1>${esc(c.proceso)}</h1><div class="sub">${esc(c.cliente || '')} · Apertura ${esc(c.apertura || fdate(c.fecha))}${c.updated_by ? ' · últ. cambio ' + esc(c.updated_by) : ''}</div></div><span class="spacer"></span>
    <button class="btn" id="actCost" ${desact ? '' : 'disabled'}>Actualizar costos${desact ? ` (${desact})` : ''}</button>
    <button class="btn" id="impActa">Cargar comparativa</button><button class="btn" id="xls">Exportar Excel</button><button class="btn danger" id="delCot">Eliminar</button></div>
    <div class="grid2" style="margin-top:10px">
      <label class="f">Estado<select class="in" data-c="estado">${ESTADOS.map(e => `<option ${e === c.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <label class="f">Apertura<input class="in" data-c="apertura" value="${esc(c.apertura || '')}"></label>
      <label class="f">OC<input class="in" data-c="oc" value="${esc(c.oc || '')}"></label>
      <label class="f">Condición<input class="in" data-c="condicion" value="${esc(c.condicion || '')}"></label>
      <label class="f">Mant. oferta<input class="in" data-c="mant_oferta" value="${esc(c.mant_oferta || '')}"></label>
      <label class="f">Hoja (mes)<input class="in" data-c="hoja" value="${esc(hojaDe(c))}"></label>
      <label class="f">Observaciones<input class="in" data-c="obs" value="${esc(c.obs || '')}"></label></div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Total cotizado</div><div class="v">${money(R.total)}</div><div class="s">${R.n} renglones</div></div>
    <div class="kpi"><div class="l">Margen cotizado</div><div class="v">${pct(R.margen)}</div><div class="s">sobre precio de venta</div></div>
    <div class="kpi"><div class="l">Margen con costo actual</div><div class="v ${totAct ? clsMargen(1 - costoAct / totAct) : ''}">${totAct ? pct(1 - costoAct / totAct) : '—'}</div><div class="s">${desact ? `<span class="warn">${desact} renglones con costo distinto</span>` : 'costos al día'}${raros ? `<br><span class="bad">${raros} con diferencia &gt; ${pct(SALTO, 0)} (¿costo especial?) no se cuentan</span>` : ''}</div></div>
    <div class="kpi"><div class="l">Resultado comparativa</div><div class="v">${R.conAna ? `${R.gan} / ${R.conAna}` : '—'}</div><div class="s">${comps.length ? comps.map(x => `<a href="#comp/${x.id}">${esc((x.titulo || x.proceso || 'comparativa').slice(0, 60))}</a>`).join('<br>') : 'sin comparativa vinculada'}</div></div>
  </div>
  <div id="gh"></div>${AYUDA}`, { full: true });
  $$('[data-c]').forEach(el => el.onchange = async () => { const p = { [el.dataset.c]: el.value, updated_by: who() }; if (el.dataset.c === 'apertura') p.fecha = P.fechaDe(el.value) || c.fecha; Object.assign(c, await db.upd('cc_cotizaciones', c.id, p)); reindex(); toast('Guardado'); });
  const host = $('#gh'); host.style.height = 'calc(100vh - 150px)'; host.style.minHeight = '420px';
  const g = montarGrilla(host, () => [...(I.itemsByCot.get(id) || [])].sort(ordenPlanilla), { id: 'cot', sin: ['proceso', 'apertura', 'condicion'], procDef: () => c.proceso, hoja: hojaDe(c) });
  $('#actCost').onclick = () => actualizarCostos(c);
  $('#impActa').onclick = () => pickFile('.pdf,.xlsx,.xls', f => importarActa(f, c.id));
  $('#xls').onclick = () => exportGrilla(g, c.proceso);
  $('#delCot').onclick = async () => { if (!confirm(`¿Eliminar ${c.proceso} con sus ${its.length} renglones? Las comparativas quedan, pero desvinculadas.`)) return; await db.del('cc_items', 'cotizacion_id', [c.id]); await db.del('cc_cotizaciones', 'id', [c.id]); await loadAll(); location.hash = '#cotizaciones'; };
}
function filaHist(x, it) {
  const a = x.a, m = a.mejorComp;
  const mg = a.unitComp ? margenParaGanar(it, a.unitComp) : null;
  const r = x.r;
  return `<tr><td>${fdate(x.fecha)}</td><td>${x.cot ? `<a href="#cot/${x.cot.id}">${esc(x.proceso)}</a>` : esc(x.proceso)}<div class="small muted">R${r.renglon ?? '?'} · ${esc((r.descripcion || I.item.get(r.item_id)?.detalle || '').slice(0, 40))}</div></td>
    <td class="n">${nf0.format(r.cantidad || 0)}</td><td>${m ? `${esc(P.canonProv(m.proveedor))}<div class="small muted">${esc(m.marca || '')}</div>` : '—'}</td>
    <td class="n">${money(a.unitComp)}</td><td class="n">${money(a.unitPropio)}</td>
    <td class="c">${a.posicion ? `<span class="pill ${a.posicion === 1 ? 'ok' : 'bad'}">${a.posicion}°</span>` : '<span class="muted small">no cot.</span>'}</td>
    <td class="n ${clsMargen(mg)}">${pct(mg)}</td></tr>`;
}
function historial(it) {
  const x = intel(it);
  const cr = costoRow(it);
  const head = '<tr><th>Fecha</th><th>Proceso</th><th class="n">Cant.</th><th>Mejor competidor</th><th class="n">Unit. comp.</th><th class="n">Unit. nuestro</th><th class="c">Pos.</th><th class="n">Margen p/ganar hoy</th></tr>';
  const nuestras = S.items.filter(i => i.codigo === it.codigo && i.id !== it.id).map(i => ({ i, c: I.cot.get(i.cotizacion_id) })).sort((a, b) => String(b.c?.fecha).localeCompare(String(a.c?.fecha)));
  modal(`<h2>${esc(it.detalle)}</h2><div class="sub">${esc(it.codigo)} · ${esc(it.monodroga)} · ${esc(it.laboratorio)}</div>
    <div class="kpis" style="margin-top:14px"><div class="kpi"><div class="l">Costo cotizado</div><div class="v">${money(costoMetaCot(it))}</div></div>
    <div class="kpi"><div class="l">Costo actual</div><div class="v">${money(costoMetaAct(it))}</div><div class="s">${cr ? `PSL ${money(cr.psl)} · dto ${cr.dtocpa ?? '—'}%` : 'sin costo cargado'}</div></div>
    <div class="kpi"><div class="l">Precio cotizado</div><div class="v">${money(it.precio_unit)}</div><div class="s">margen ${pct(it.margen)}</div></div></div>
    ${x.propias.length ? `<h2>Resultado de este proceso</h2>${x.propias.map(p => ofertasTabla(p.r)).join('')}` : ''}
    <h2 style="margin-top:16px">Antecedentes del mismo código (${x.ex.length})</h2>
    <div class="tw" style="max-height:none"><table class="t">${head}${x.ex.map(y => filaHist(y, it)).join('') || '<tr><td colspan="8" class="muted">Sin antecedentes.</td></tr>'}</table></div>
    <h2 style="margin-top:16px">Misma monodroga, otra presentación/marca (${x.sim.length})</h2>
    <div class="tw" style="max-height:none"><table class="t">${head}${x.sim.slice(0, 40).map(y => filaHist(y, it)).join('') || '<tr><td colspan="8" class="muted">Sin antecedentes.</td></tr>'}</table></div>
    <p class="legend">Ojo: en “misma monodroga” la presentación puede ser distinta (mg, unidades por caja), comparar con cuidado.</p>
    <h2 style="margin-top:16px">Cómo lo cotizamos antes (${nuestras.length})</h2>
    <div class="tw" style="max-height:none"><table class="t"><tr><th>Fecha</th><th>Proceso</th><th class="n">Cant.</th><th class="n">Precio unit.</th><th class="n">Margen</th><th>Adj.</th></tr>
    ${nuestras.slice(0, 30).map(({ i, c }) => `<tr><td>${fdate(c?.fecha)}</td><td><a href="#cot/${c?.id}">${esc(c?.proceso)}</a></td><td class="n">${nf0.format(i.cantidad || 0)}</td><td class="n">${money(i.precio_unit)}</td><td class="n">${pct(i.margen)}</td><td>${i.adjudicado ? '<span class="pill ok">Sí</span>' : i.adjudicado === false ? '<span class="pill bad">No</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Primera vez.</td></tr>'}</table></div>`, { side: true });
}
function ofertasTabla(r) {
  const ofs = (I.ofsByRen.get(r.id) || []).map(o => ({ ...o, prop: o.es_propio || esPropio(o.proveedor) }));
  const val = ofs.filter(o => o.precio_total > 0).sort((a, b) => a.precio_total - b.precio_total);
  const resto = ofs.filter(o => !(o.precio_total > 0));
  const q = r.cantidad || 1;
  return `<div class="tw" style="max-height:none;margin-bottom:10px"><table class="t"><tr><th>#</th><th>Proveedor</th><th>Marca</th><th class="n">Total</th><th class="n">Unitario</th><th class="n">vs mejor</th></tr>
    ${val.map((o, k) => `<tr style="${o.prop ? 'font-weight:600;background:var(--brand-soft)' : ''}"><td>${k + 1}</td><td>${esc(P.canonProv(o.proveedor))}${o.grupo && /con/i.test(o.grupo) ? ' <span class="pill warn" title="Compre neuquino">CN</span>' : ''}${o.adjudicado ? ' <span class="pill ok">adj.</span>' : ''}</td><td class="small">${esc(o.marca || '')}</td><td class="n">${money(o.precio_total)}</td><td class="n">${money(o.precio_total / q)}</td><td class="n small">${k ? '+' + pct(o.precio_total / val[0].precio_total - 1) : ''}</td></tr>`).join('')}
    ${resto.length ? `<tr><td colspan="6" class="small muted">${resto.map(o => esc(P.canonProv(o.proveedor)) + ': ' + esc(o.estado || 'sin precio')).join(' · ')}</td></tr>` : ''}</table></div>`;
}
function agregarRenglon(c) {
  const its = I.itemsByCot.get(c.id) || [];
  const o = modal(`<h2>Agregar renglón</h2><input class="in" id="qq" placeholder="Buscar en costos por código, nombre o monodroga…" style="width:100%">
    <div id="res" style="margin-top:10px"></div>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="blank">Renglón en blanco</button></div>`);
  const nuevo = async base => {
    const marg = conf('margenObjetivo');
    const r = { cotizacion_id: c.id, renglon: (Math.max(0, ...its.map(i => i.renglon || 0)) + 1), cantidad: 1, orden: its.length + 1, margen: marg, ...base };
    r.precio_unit = P.precioDe(P.costoMeta(r), marg);
    const [it] = await db.ins('cc_items', [r]); S.items.push(it); reindex(); o.remove(); vCot(c.id);
    setTimeout(() => { const n = $(`tr[data-id="${it.id}"] [data-f="renglon"]`); n && n.focus(); }, 30);
  };
  const busca = () => {
    const q = P.norm($('#qq', o).value); if (q.length < 2) { $('#res', o).innerHTML = ''; return; }
    const hits = S.cat.filter(k => P.norm(k.codigo + ' ' + k.detalle + ' ' + k.monodroga).includes(q)).slice(0, 40);
    $('#res', o).innerHTML = `<div class="tw" style="max-height:50vh"><table class="t"><tr><th>Código</th><th>Producto</th><th>Lista</th><th class="n">Costo</th></tr>${hits.map((k, i) => `<tr class="click" data-k="${i}"><td>${esc(k.codigo)}</td><td>${esc(k.detalle)}<div class="small muted">${esc(k.monodroga)} · ${esc(k.laboratorio)}</div></td><td>${esc(k.lista)}</td><td class="n">${money(k.costo)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin resultados en costos cargados.</td></tr>'}</table></div>`;
    $$('tr[data-k]', o).forEach(tr => tr.onclick = () => { const k = hits[+tr.dataset.k]; nuevo({ codigo: k.codigo, lista: k.lista, detalle: k.detalle, monodroga: k.monodroga, laboratorio: k.laboratorio, pvp: k.pvp, psl: k.psl, dtocpa: k.dtocpa, costo: k.costo }); });
  };
  $('#qq', o).oninput = busca; $('#qq', o).focus();
  $('#blank', o).onclick = () => nuevo({ detalle: '(nuevo renglón)' });
}
function actualizarCostos(c) {
  const todos = (I.itemsByCot.get(c.id) || []).filter(it => { const ca = costoMetaAct(it), cc = costoMetaCot(it); return ca != null && cc && Math.abs(ca - cc) / cc > 0.001; });
  const its = todos.filter(it => !saltoRaro(it)); const raros = todos.length - its.length;
  const o = modal(`<h2>Actualizar costos (${its.length} renglones)</h2><p class="sub">Se reemplazan PVP, PSL, dto. y costo de cada renglón por los vigentes.${raros ? ` Se dejan afuera ${raros} renglones con diferencia mayor a ${pct(SALTO, 0)} (probable costo especial); esos se corrigen a mano.` : ''}</p>
    <label class="row" style="margin:10px 0"><input type="radio" name="m" value="margen" checked> Mantener el <b>margen</b> (recalcula el precio)</label>
    <label class="row"><input type="radio" name="m" value="precio"> Mantener el <b>precio</b> (recalcula el margen)</label>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Actualizar</button></div>`);
  $('#ok', o).onclick = async () => {
    const modo = $('input[name=m]:checked', o).value;
    for (const it of its) {
      const k = costoRow(it); const p = { pvp: k.pvp, psl: k.psl, dtocpa: k.dtocpa, costo: k.costo };
      const cm = P.costoMeta({ ...it, ...p });
      if (modo === 'margen') p.precio_unit = P.precioDe(cm, it.margen); else p.margen = P.margenDe(cm, it.precio_unit);
      Object.assign(it, await db.upd('cc_items', it.id, p));
    }
    o.remove(); reindex(); vCot(c.id); toast(`${its.length} renglones actualizados`);
  };
}
function exportCot(c) {
  const its = I.itemsByCot.get(c.id) || [];
  const rows = its.map(it => {
    const x = intel(it); const cm = costoMetaCot(it); const ref = x.ref;
    return { R: it.renglon, 'CANT. ENV': it.cantidad, LISTA: it.lista, CODIGO: it.codigo, DETALLE: it.detalle, MONODROGA: it.monodroga, LABORATORIO: it.laboratorio,
      PVP: it.pvp, PSL: it.psl, DTOCPA: it.dtocpa, COSTO: it.costo, STOCK: it.stock, OBS: it.obs, PLAZO: it.plazo, 'Dcto. Acord SOBRE PVP': it.dcto_pvp, 'Dcto. Acord SOBRE PSL': it.dcto_psl,
      'Costo META': cm, 'Costo Total': cm != null ? cm * (it.cantidad || 0) : null, 'R [%]': it.margen, 'Pcio. VENTA': it.precio_unit, 'Precio Total': (it.precio_unit || 0) * (it.cantidad || 0),
      Proceso: c.proceso, Apertura: c.apertura, OC: it.oc || c.oc, 'Costo actual': costoMetaAct(it),
      'Mejor competidor': ref?.a.mejorComp ? P.canonProv(ref.a.mejorComp.proveedor) : '', 'Unit. competidor': ref?.a.unitComp ?? null, 'Margen p/ganar': ref ? margenParaGanar(it, ref.a.unitComp) : null, Adjudicado: it.adjudicado == null ? '' : it.adjudicado ? 'Sí' : 'No' };
  });
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, c.proceso.slice(0, 30));
  XLSX.writeFile(wb, `${c.proceso.replace(/[^\w]+/g, '_')}.xlsx`);
}

// ======================================================================
//  Comparativas
// ======================================================================
function vComps() {
  const list = [...S.comps].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id);
  shell(`<div class="row" style="margin-bottom:14px"><div><h1>Comparativas</h1><div class="sub">${S.comps.length} actas · ${S.rens.length} renglones · ${S.ofs.length} ofertas</div></div><span class="spacer"></span></div>
  <div class="card"><div class="drop" id="drop"><b>Cargar acta comparativa</b><br><span class="small">Arrastrá el PDF del acta (o el Excel con hoja “Detalle”) o hacé click para elegirlo</span></div></div>
  <div class="tw"><table class="t"><thead><tr><th>Fecha</th><th>Acta</th><th>Cotización vinculada</th><th class="n">Renglones</th><th class="n">Vinculados</th><th class="n">1° lugar</th><th>Origen</th></tr></thead><tbody>
  ${list.map(c => { const rs = I.rensByComp.get(c.id) || []; const g = rs.filter(r => I.ana.get(r.id)?.posicion === 1 || I.ana.get(r.id)?.ganamos).length; const cot = I.cot.get(c.cotizacion_id);
    return `<tr class="click" data-go="#comp/${c.id}"><td>${fdate(c.fecha)}</td><td><b>${esc(c.titulo || c.proceso)}</b><div class="small muted">${esc(c.archivo || '')}</div></td><td>${cot ? esc(cot.proceso) : '<span class="pill warn">sin vincular</span>'}</td><td class="n">${rs.length}</td><td class="n">${rs.filter(r => r.item_id).length}</td><td class="n">${g}</td><td><span class="pill">${esc(c.origen || 'acta')}</span></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Todavía no hay comparativas.</td></tr>'}
  </tbody></table></div>`);
  dropZone($('#drop'), '.pdf,.xlsx,.xls', f => /\.pdf$/i.test(f.name) ? importarPDF(f) : importarActa(f));
  $$('tr[data-go]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.go);
}
// ======================================================================
//  Importar pedido de cotización (PDF de Bionexo) → cotización nueva
// ======================================================================
function candidatosPedido() {
  const hist = new Map(), cli = new Map(), porDesc = new Map();
  for (const it of S.items) {
    if (!it.codigo) continue;
    const c = I.cot.get(it.cotizacion_id) || {}; const f = c.fecha || '';
    const h = hist.get(it.codigo);
    if (!h || f > h.fecha) hist.set(it.codigo, { ...it, fecha: f, fuente: 'hist', veces: (h ? h.veces : 0) + 1 }); else h.veces++;
    if (it.cod_cliente) { const k = it.cod_cliente.toUpperCase(); const x = cli.get(k); if (!x || f > x.fecha) cli.set(k, { ...it, fecha: f, fuente: 'cliente' }); }
    if (it.desc_cliente) { const k = P.norm(it.desc_cliente); const x = porDesc.get(k); if (!x || f > x.fecha) porDesc.set(k, { ...it, fecha: f, fuente: 'cliente' }); }
  }
  // descripciones de actas ya vinculadas a un renglón nuestro
  for (const r of S.rens) { if (!r.item_id) continue; const it = I.item.get(r.item_id); if (!it || !it.codigo) continue; const k = P.norm(r.descripcion); const f = fechaRen(r); const x = porDesc.get(k); if (!x || f > x.fecha) porDesc.set(k, { ...it, fecha: f, fuente: 'cliente' }); }
  const base = [...hist.values()];
  const ya = new Set(); for (const k of S.cat) if (!hist.has(k.codigo) && !ya.has(k.codigo)) { ya.add(k.codigo); base.push({ ...k, fuente: 'costos' }); }
  return { base, cli, porDesc };
}
function sugerirRenglon(r, C) {
  const out = [];
  const a = r.cod_cliente && C.cli.get(r.cod_cliente.toUpperCase());
  const b = C.porDesc.get(P.norm(r.descripcion));
  for (const x of [a, b]) if (x && !out.some(o => o.codigo === x.codigo)) out.push({ ...x, fuente: 'cliente', score: 99 });
  for (const s of P.sugerir(r.descripcion, C.base, 8)) if (!out.some(o => o.codigo === s.codigo)) out.push(s);
  return out.slice(0, 8);
}
function datosProducto(c) {
  // datos vigentes del producto (costos de hoy si están cargados) + último margen usado
  const k = I.costo.get(c.codigo + '|' + (c.lista || '')) || I.costoCod.get(c.codigo) || c;
  return { codigo: c.codigo, lista: c.lista || k.lista || '', detalle: k.detalle || c.detalle, monodroga: k.monodroga || c.monodroga, laboratorio: k.laboratorio || c.laboratorio,
    pvp: k.pvp ?? c.pvp, psl: k.psl ?? c.psl, dtocpa: k.dtocpa ?? c.dtocpa, costo: k.costo ?? c.costo, dcto_psl: c.fuente !== 'costos' ? c.dcto_psl ?? null : null, plazo: c.plazo ?? null,
    margenPrev: c.fuente !== 'costos' ? c.margen : null, fechaPrev: c.fuente !== 'costos' ? c.fecha : null };
}
const hojaDeFecha = f => f ? MESES_N[+f.slice(5, 7) - 1] + ' ' + f.slice(0, 4) : hojaActual();
async function importarPedido(file) {
  toast('Leyendo el pedido…');
  let ped;
  try { ped = await P.parsePedidoPDF(await pdfjsLib(), new Uint8Array(await file.arrayBuffer())); }
  catch (e) { return toast(e.message, 6000); }
  const C = candidatosPedido();
  const filas = ped.renglones.map(r => { const sug = sugerirRenglon(r, C); return { r, sug, sel: sug[0] || null, on: !!sug[0] }; });
  const existe = S.cots.find(c => P.procesoKey(c.proceso) === P.procesoKey(ped.proceso) && ped.proceso);
  const yaRen = new Set(existe ? (I.itemsByCot.get(existe.id) || []).map(i => i.renglon) : []);
  if (existe) filas.forEach(f => { if (yaRen.has(f.r.renglon)) f.on = false; });
  const mant = (ped.terminos.match(/MANTENIMIENTO DE OFERTA\s*([^-]*)/i) || [])[1] || '';
  let modoMargen = 'ultimo';
  const precioFila = f => {
    if (!f.sel) return { cm: null, m: null, p: null };
    const d = datosProducto(f.sel); const cm = P.costoMeta(d);
    const m = modoMargen === 'ultimo' && d.margenPrev != null ? d.margenPrev : conf('margenObjetivo');
    return { d, cm, m, p: P.precioDe(cm, m) };
  };
  const badge = s => s ? `<span class="pill ${s.fuente === 'cliente' ? 'ok' : s.fuente === 'hist' ? 'info' : ''}" title="${s.fuente === 'cliente' ? 'Mismo código/descripción del cliente que ya cotizamos' : s.fuente === 'hist' ? 'Producto que ya cotizamos antes' : 'Sugerido desde la lista de costos'}">${s.fuente === 'cliente' ? 'ya cotizado' : s.fuente === 'hist' ? 'historial' : 'costos'}</span>` : '<span class="pill warn">sin producto</span>';
  const filaHTML = (f, i) => {
    const x = precioFila(f); const u = f.sel ? intel({ codigo: f.sel.codigo, monodroga: f.sel.monodroga, id: -1, cotizacion_id: -1 }).ultimo : null;
    return `<tr data-i="${i}" style="${yaRen.has(f.r.renglon) ? 'opacity:.55' : ''}"><td class="c"><input type="checkbox" data-on ${f.on ? 'checked' : ''}></td><td class="n">${f.r.renglon}</td>
      <td class="wrap"><b>${esc(f.r.descripcion)}</b><div class="small muted">${esc(f.r.cod_cliente)} · ${esc(f.r.unidad || '')}${f.r.marcas ? ' · ' + esc(f.r.marcas) : ''}${yaRen.has(f.r.renglon) ? ' · <b>ya está en la cotización</b>' : ''}</div></td>
      <td class="n">${nf0.format(f.r.cantidad || 0)}</td>
      <td><select class="in" data-sel style="max-width:300px;font-size:12.5px;padding:3px 6px">${f.sug.map((s, k) => `<option value="${k}" ${s === f.sel ? 'selected' : ''}>${esc(s.detalle)} · ${esc(s.codigo)}</option>`).join('')}<option value="-1" ${!f.sel ? 'selected' : ''}>— sin producto (cargar a mano) —</option></select><div style="margin-top:2px">${badge(f.sel)}</div></td>
      <td class="n">${money(x.cm)}</td><td class="n">${x.m != null ? pct(x.m) : '—'}</td><td class="n"><b>${money(x.p)}</b></td>
      <td class="small">${u ? `${money(u.a.unitComp)} ${esc(P.canonProv(u.a.mejorComp.proveedor))}<div class="muted">${fdate(u.fecha)}</div>` : '<span class="muted">—</span>'}</td></tr>`;
  };
  const o = modal(`<h2>Importar pedido de cotización</h2><p class="sub">${esc(ped.titulo)}</p>
    <div class="grid2" style="margin:10px 0">
      <label class="f">Proceso<input class="in" id="pp" value="${esc(ped.proceso)}"></label>
      <label class="f">Apertura<input class="in" id="pa" value="${esc(ped.apertura)}"></label>
      <label class="f">Hoja<input class="in" id="ph" value="${esc(existe ? hojaDe(existe) : hojaDeFecha(ped.fecha))}"></label>
      <label class="f">Condición<input class="in" id="pc" value="${esc(ped.pago)}"></label>
      <label class="f">Mant. oferta<input class="in" id="pm" value="${esc(mant.trim())}"></label>
      <label class="f">Observaciones<input class="in" id="po" value="${esc([ped.plan.replace(/\s*T\d+\s*E\d+\s*$/, ''), ped.observaciones].filter(Boolean).join(' · '))}"></label></div>
    ${existe ? `<p class="warn small">${esc(existe.proceso)} ya existe con ${yaRen.size} renglones: se agregan solo los que marques (los que ya están vienen destildados).</p>` : ''}
    <div class="row" style="margin:6px 0 10px"><span id="cnt" class="small"></span><span class="spacer"></span>
      <label class="small row" style="gap:4px"><input type="radio" name="mm" value="ultimo" checked> Margen: el último usado para ese producto</label>
      <label class="small row" style="gap:4px"><input type="radio" name="mm" value="obj"> el objetivo (${pct(conf('margenObjetivo'), 0)}) para todos</label>
      <button class="btn sm" id="todos">Tildar todos</button><button class="btn sm" id="ninguno">Destildar todos</button></div>
    <div class="tw" style="max-height:52vh"><table class="t"><thead><tr><th class="c">Cotizar</th><th class="n">R</th><th>Renglón del pedido</th><th class="n">Cant.</th><th>Producto propuesto</th><th class="n">Costo</th><th class="n">Margen</th><th class="n">Precio unit.</th><th>Últ. ganador</th></tr></thead><tbody id="pt">${filas.map(filaHTML).join('')}</tbody></table></div>
    <p class="legend">Revisá sobre todo los que no dicen “ya cotizado”. Los renglones sin producto se cargan igual (con la descripción del pedido) si los dejás tildados, para completarlos a mano en la planilla. Lo que elijas acá queda aprendido para el próximo pedido.</p>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Crear cotización</button></div>`, { side: true });
  $('.drawer', o).style.width = 'min(1250px,100%)';
  const cnt = () => { const n = filas.filter(f => f.on).length, s = filas.filter(f => f.on && f.sel).length; $('#cnt', o).innerHTML = `<b>${n}</b> de ${filas.length} renglones a cotizar · ${s} con producto · ${filas.filter(f => f.sel && f.sel.fuente === 'cliente').length} reconocidos de pedidos anteriores`; };
  const redraw = i => { const tr = $(`tr[data-i="${i}"]`, o); tr.outerHTML = filaHTML(filas[i], i); cnt(); };
  $('#pt', o).addEventListener('change', e => {
    const i = +e.target.closest('tr').dataset.i; const f = filas[i];
    if (e.target.matches('[data-on]')) { f.on = e.target.checked; cnt(); return; }
    if (e.target.matches('[data-sel]')) { const k = +e.target.value; f.sel = k >= 0 ? f.sug[k] : null; if (f.sel) f.on = true; redraw(i); }
  });
  $$('input[name=mm]', o).forEach(r => r.onchange = () => { modoMargen = r.value; $('#pt', o).innerHTML = filas.map(filaHTML).join(''); });
  $('#todos', o).onclick = () => { filas.forEach(f => f.on = true); $('#pt', o).innerHTML = filas.map(filaHTML).join(''); cnt(); };
  $('#ninguno', o).onclick = () => { filas.forEach(f => f.on = false); $('#pt', o).innerHTML = filas.map(filaHTML).join(''); cnt(); };
  cnt();
  $('#ok', o).onclick = async () => {
    const sel = filas.filter(f => f.on); if (!sel.length) return toast('No hay renglones tildados');
    const btn = $('#ok', o); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Creando';
    try {
      const proceso = $('#pp', o).value.trim() || ped.proceso || ('PEDIDO ' + ped.idPedido);
      const ap = $('#pa', o).value.trim(), hoja = $('#ph', o).value.trim().toUpperCase() || hojaDeFecha(ped.fecha);
      let cot = S.cots.find(c => P.norm(c.proceso) === P.norm(proceso));
      const cab = { apertura: ap, fecha: P.fechaDe(ap) || ped.fecha, hoja, condicion: $('#pc', o).value.trim() || null, mant_oferta: $('#pm', o).value.trim() || null, obs: $('#po', o).value.trim() || null, cliente: 'ISSN', updated_by: who() };
      if (!cot) [cot] = await db.ins('cc_cotizaciones', [{ proceso, estado: 'abierta', ...cab }]);
      else Object.assign(cot, await db.upd('cc_cotizaciones', cot.id, { hoja, apertura: ap || cot.apertura, fecha: cab.fecha || cot.fecha }));
      if (!hojasGuardadas().includes(hoja)) await guardarHojas([...hojasGuardadas(), hoja]);
      const rows = sel.map(f => {
        const base = { cotizacion_id: cot.id, renglon: f.r.renglon, orden: f.r.renglon, cantidad: f.r.cantidad, cod_cliente: f.r.cod_cliente || null, desc_cliente: f.r.descripcion, obs: f.r.marcas && !/acepta alternativa/i.test(f.r.marcas) ? 'Marcas: ' + f.r.marcas : null };
        if (!f.sel) return { ...base, detalle: f.r.descripcion, margen: conf('margenObjetivo') };
        const x = precioFila(f); const { margenPrev, fechaPrev, ...d } = x.d;
        return { ...base, ...d, margen: x.m, precio_unit: x.p };
      });
      const ins = await db.ins('cc_items', rows);
      S.items.push(...ins); if (!S.cots.includes(cot)) S.cots.push(cot); reindex();
      UNDO.push([...ins.map(i => ({ t: 'ins', id: i.id }))]);
      o.remove(); toast(`${ins.length} renglones cargados en ${proceso}`);
      location.hash = '#planilla/' + encodeURIComponent(hoja);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Crear cotización';
      toast(/cod_cliente|desc_cliente|hoja/.test(e.message) ? 'Falta actualizar la base: corré de nuevo schema.sql en Supabase (SQL Editor) y reintentá.' : 'Error: ' + e.message, 8000);
    }
  };
}

// ======================================================================
//  Órdenes de compra / provisión
// ======================================================================
const ocsDe = it => String(it.oc || '').split(/[\s,\/;]+/).filter(Boolean);
const ocMerge = (txt, n) => { const a = String(txt || '').split(/[\s,\/;]+/).filter(Boolean); if (!a.includes(String(n))) a.push(String(n)); return a.join(', '); };
const ocQuitar = (txt, n) => String(txt || '').split(/[\s,\/;]+/).filter(x => x && x !== String(n)).join(', ') || null;
function filasOC(num) {
  const o = I.oc.get(String(num));
  if (!o) return S.items.filter(i => ocsDe(i).includes(String(num)));
  return (I.ocLines.get(o.id) || []).map(l => { const it = I.item.get(l.item_id); return it ? { ...it, cantidad: l.cantidad, _base: it, _line: l } : null; }).filter(Boolean);
}
async function desadjudicar(items, numero) {
  for (const it of items) {
    const quedan = (I.ocLinesByItem.get(it.id) || []).filter(l => { const o = S.ocs.find(x => x.id === l.oc_id); return o && String(o.numero) !== String(numero); });
    Object.assign(it, await db.upd('cc_items', it.id, { oc: ocQuitar(it.oc, numero), adjudicado: quedan.length ? true : null }));
  }
}
async function quitarDeOC(rows) {
  if (!confirm(`¿Quitar ${rows.length} renglón(es) de esta orden de compra? (no se borran de la cotización)`)) return false;
  const o = S.ocs.find(x => x.id === rows[0]._line.oc_id);
  await db.del('cc_oc_items', 'id', rows.map(r => r._line.id));
  S.ocItems = S.ocItems.filter(l => !rows.some(r => r._line.id === l.id)); reindex();
  await desadjudicar(rows.map(r => r._base), o ? o.numero : '');
  reindex(); toast('Quitado de la OC'); return true;
}
async function eliminarOC(o) {
  if (!o || !confirm(`¿Eliminar la OC ${o.numero}? Los renglones quedan en la cotización pero sin adjudicar por esta OC.`)) return;
  const its = (I.ocLines.get(o.id) || []).map(l => I.item.get(l.item_id)).filter(Boolean);
  await db.del('cc_oc_items', 'oc_id', [o.id]); S.ocItems = S.ocItems.filter(l => l.oc_id !== o.id); reindex();
  await desadjudicar(its, o.numero);
  await db.del('cc_ocs', 'id', [o.id]);
  await loadAll(); location.hash = '#planilla'; toast(`OC ${o.numero} eliminada`);
}
async function importarPDF(file) {
  let t = '';
  try { const pj = await pdfjsLib(); const d = await pj.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 }).promise; t = (await (await d.getPage(1)).getTextContent()).items.map(i => i.str).join(' '); }
  catch (e) { return toast('No pude leer el PDF: ' + e.message, 6000); }
  if (/Orden de (Provisi[oó]n|Compra)/i.test(t)) return importarOC(file);
  if (/Pedido de Cotizaci/i.test(t) && /Marcas preferidas|Código:/i.test(t)) return importarPedido(file);
  return importarActa(file);
}
async function importarOC(file) {
  if (S.faltaSchema) return toast('Falta actualizar la base: corré de nuevo schema.sql en Supabase (SQL Editor) y recargá la página.', 8000);
  toast('Leyendo la orden de compra…');
  let oc;
  try { oc = await P.parseOCPDF(await pdfjsLib(), new Uint8Array(await file.arrayBuffer())); } catch (e) { return toast(e.message, 6000); }
  if (oc.numero && I.oc.get(String(oc.numero))) {
    const m = modal(`<h2>OC ${esc(oc.numero)} ya cargada</h2><p>Esta orden de compra ya está en la web.</p><div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-close>Cerrar</button><a class="btn pri" href="#planilla/${encodeURIComponent('OC ' + oc.numero)}" data-close>Ver la OC</a></div>`); return;
  }
  let cot = S.cots.find(c => oc.proceso && P.procesoKey(c.proceso) === P.procesoKey(oc.proceso));
  let filas = [];
  const armar = () => {
    const its = cot ? (I.itemsByCot.get(cot.id) || []) : [];
    const m = P.matchOC(oc.lineas, its);
    filas = oc.lineas.map((l, i) => ({ l, it: m[i] }));
  };
  armar();
  const opts = () => [...S.cots].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(c => `<option value="${c.id}" ${cot && c.id === cot.id ? 'selected' : ''}>${esc(c.proceso)} · ${fdate(c.fecha)}</option>`).join('');
  const filaHTML = (f, i) => {
    const its = cot ? (I.itemsByCot.get(cot.id) || []) : [];
    const it = f.it; const dp = it && it.precio_unit && f.l.precio ? f.l.precio / it.precio_unit - 1 : null;
    return `<tr data-i="${i}"><td>${esc(f.l.cod_cliente)}</td><td class="wrap">${esc(f.l.descripcion)}</td><td class="n">${nf0.format(f.l.cantidad || 0)}</td><td class="n">${money(f.l.precio)}</td><td class="n">${money(f.l.importe)}</td>
      <td><select class="in" data-sel style="max-width:330px;font-size:12.5px;padding:3px 6px">${its.map(x => `<option value="${x.id}" ${x === it ? 'selected' : ''}>R${x.renglon ?? '?'} · ${esc((x.detalle || '').slice(0, 40))} · ${money(x.precio_unit)}</option>`).join('')}<option value="0" ${!it ? 'selected' : ''}>— crear renglón nuevo en la cotización —</option></select></td>
      <td class="small">${!it ? '<span class="pill warn">nuevo</span>' : dp != null && Math.abs(dp) < 0.0005 ? '<span class="pill ok">precio OK</span>' : `<span class="pill bad">precio ${dp > 0 ? '+' : ''}${pct(dp)}</span>`}${it && it.cantidad !== f.l.cantidad ? `<div class="warn">cotizado: ${nf0.format(it.cantidad || 0)}</div>` : ''}</td></tr>`;
  };
  const o = modal(`<h2>Cargar orden de compra ${esc(oc.serie ? oc.serie + ' - ' : '')}${esc(oc.numero)}</h2>
    <p class="sub">Fecha ${fdate(oc.fecha)} · ${esc(oc.proceso)} ${esc(oc.plan)} · Cond. ${esc(oc.condicion || '—')} · Vence ${fdate(oc.vence)} · Total <b>${money(oc.total)}</b></p>
    <label class="f" style="margin:10px 0">Cotización<select class="in" id="oc_cot"><option value="">— elegir —</option>${opts()}</select></label>
    ${!cot ? '<p class="warn small">No encontré la cotización de ese expediente: elegila arriba.</p>' : ''}
    <div class="tw" style="max-height:48vh"><table class="t"><thead><tr><th>Cód.</th><th>Descripción OC</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th><th>Nuestro renglón</th><th>Control</th></tr></thead><tbody id="ot">${filas.map(filaHTML).join('')}</tbody></table></div>
    <label class="row small" style="margin-top:10px"><input type="checkbox" id="oc_resto" checked> Marcar como <b>No adjudicados</b> los demás renglones de la cotización que no estén en otra OC</label>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Cargar OC</button></div>`, { side: true });
  $('.drawer', o).style.width = 'min(1100px,100%)';
  $('#oc_cot', o).onchange = e => { cot = I.cot.get(+e.target.value) || null; armar(); $('#ot', o).innerHTML = filas.map(filaHTML).join(''); };
  $('#ot', o).addEventListener('change', e => { if (!e.target.matches('[data-sel]')) return; const i = +e.target.closest('tr').dataset.i; filas[i].it = I.item.get(+e.target.value) || null; e.target.closest('tr').outerHTML = filaHTML(filas[i], i); });
  $('#ok', o).onclick = async () => {
    if (!cot) return toast('Elegí la cotización');
    const btn = $('#ok', o); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Cargando';
    try {
      const its = I.itemsByCot.get(cot.id) || [];
      let next = Math.max(0, ...its.map(i => i.renglon || 0)), ord = Math.max(0, ...its.map(i => i.orden || 0));
      const nuevos = filas.filter(f => !f.it);
      if (nuevos.length) {
        const ins = await db.ins('cc_items', nuevos.map(f => ({ cotizacion_id: cot.id, renglon: ++next, orden: ++ord, cantidad: f.l.cantidad, detalle: f.l.descripcion, desc_cliente: f.l.descripcion, cod_cliente: f.l.cod_cliente, precio_unit: f.l.precio, adjudicado: true, oc: String(oc.numero), lista: its[0] ? its[0].lista : null })));
        nuevos.forEach((f, k) => f.it = ins[k]); S.items.push(...ins);
      }
      const [reg] = await db.ins('cc_ocs', [{ numero: String(oc.numero), serie: oc.serie || null, fecha: oc.fecha, proceso: cot.proceso, cotizacion_id: cot.id, condicion: oc.condicion || null, vence: oc.vence, total: oc.total, plan: oc.plan || null, archivo: file.name, created_by: who() }]);
      await db.ins('cc_oc_items', filas.map(f => ({ oc_id: reg.id, item_id: f.it.id, cod_cliente: f.l.cod_cliente, descripcion: f.l.descripcion, cantidad: f.l.cantidad, precio: f.l.precio, importe: f.l.importe })));
      const adj = new Set(filas.map(f => f.it.id));
      for (const f of filas) if (!nuevos.includes(f)) Object.assign(f.it, await db.upd('cc_items', f.it.id, { adjudicado: true, oc: ocMerge(f.it.oc, oc.numero), cod_cliente: f.it.cod_cliente || f.l.cod_cliente }));
      if ($('#oc_resto', o).checked) for (const it of its) if (!adj.has(it.id) && !ocsDe(it).length && it.adjudicado !== false) Object.assign(it, await db.upd('cc_items', it.id, { adjudicado: false }));
      const todos = I.itemsByCot.get(cot.id) || its;
      const nAdj = [...todos, ...nuevos.map(f => f.it)].filter(i => i.adjudicado).length, nTot = todos.length + nuevos.length;
      Object.assign(cot, await db.upd('cc_cotizaciones', cot.id, { oc: ocMerge(cot.oc, oc.numero), estado: nAdj >= nTot ? 'adjudicada' : 'parcial', updated_by: who() }));
      await loadAll(); o.remove(); toast(`OC ${oc.numero} cargada: ${filas.length} renglones adjudicados`);
      location.hash = '#planilla/' + encodeURIComponent('OC ' + oc.numero);
    } catch (e) { btn.disabled = false; btn.textContent = 'Cargar OC'; toast(/cc_oc|relation|does not exist/i.test(e.message) ? 'Falta actualizar la base: corré de nuevo schema.sql en Supabase.' : 'Error: ' + e.message, 8000); }
  };
}

let _pdfjs = null;
async function pdfjsLib() {
  if (!_pdfjs) { _pdfjs = await import('./lib/pdf.min.mjs'); _pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.mjs', location.href).href; }
  return _pdfjs;
}
async function importarActa(file, cotId) {
  let acta;
  toast('Leyendo el acta…');
  try {
    acta = /\.pdf$/i.test(file.name) ? await P.parseActaPDF(await pdfjsLib(), new Uint8Array(await file.arrayBuffer())) : P.parseActa(XLSX, await readWb(file));
  } catch (e) {
    if (/\.pdf$/i.test(file.name)) { try { const pj = await pdfjsLib(); const d = await pj.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; const t = (await (await d.getPage(1)).getTextContent()).items.map(i => i.str).join(' '); if (/Pedido de Cotizaci/i.test(t) && /Marcas preferidas|Código:/i.test(t)) { toast('Esto es un pedido de cotización, no un acta: lo abro como pedido'); return importarPedido(file); } } catch { /* */ } }
    return toast(e.message, 6000);
  }
  const key = P.procesoKey(acta.proceso);
  const sug = cotId || (S.cots.find(c => P.procesoKey(c.proceso) === key) || {}).id || '';
  const opts = [...S.cots].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(c => `<option value="${c.id}" ${c.id === sug ? 'selected' : ''}>${esc(c.proceso)} · ${fdate(c.fecha)}</option>`).join('');
  const nOf = acta.renglones.reduce((s, r) => s + r.ofertas.length, 0);
  const provs = [...new Set(acta.renglones.flatMap(r => r.ofertas.map(o => o.proveedor)))];
  const propio = provs.find(esPropio);
  const prev = () => { const id = +$('#cs', o).value; const its = I.itemsByCot.get(id) || []; const v = P.vincular(acta.renglones, its, esPropio); $('#pv', o).innerHTML = id ? `Se van a vincular <b>${v.length}</b> de ${acta.renglones.length} renglones con los ${its.length} renglones cotizados.` : 'Sin cotización: se guarda igual y la podés vincular después.'; return v; };
  const ya = sug && (I.compsByCot.get(+sug) || []).filter(c => c.origen !== 'historico');
  const o = modal(`<h2>Cargar comparativa</h2><p class="sub">${esc(acta.titulo || file.name)}</p>
    <p>${acta.renglones.length} renglones · ${provs.length} proveedores · ${nOf} ofertas. ${propio ? `Nuestra oferta aparece como <b>${esc(propio)}</b>.` : `<span class="warn">No encontré nuestra droguería (“${esc(CFG.NOMBRE_PROPIO)}”) entre los proveedores.</span>`}</p>
    <label class="f">Vincular a la cotización<select class="in" id="cs"><option value="">— ninguna —</option>${opts}</select></label>
    <p class="small" id="pv"></p>${ya && ya.length ? `<p class="small warn">Esa cotización ya tiene ${ya.length} comparativa(s) cargada(s). Si es la misma acta, eliminá la anterior desde su pantalla.</p>` : ''}
    <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>`);
  $('#cs', o).onchange = prev; prev();
  $('#ok', o).onclick = async () => {
    $('#ok', o).disabled = true; $('#ok', o).innerHTML = '<span class="spin"></span> Guardando';
    try {
      const cid = +$('#cs', o).value || null;
      const v = cid ? prev() : [];
      const link = new Map(v.map(p => [p.i, p.it.id]));
      const cot = cid && I.cot.get(cid);
      const [comp] = await db.ins('cc_comparativas', [{ cotizacion_id: cid, proceso: acta.proceso || cot?.proceso || '', fecha: cot?.fecha || null, titulo: acta.titulo.slice(0, 200), archivo: file.name, origen: 'acta', created_by: who() }]);
      const rens = await db.ins('cc_comp_renglones', acta.renglones.map((r, i) => ({ comparativa_id: comp.id, renglon: r.renglon, descripcion: r.descripcion, cantidad: r.cantidad, item_id: link.get(i) || null })));
      const ofs = []; rens.forEach((rr, i) => acta.renglones[i].ofertas.forEach(of => ofs.push({ renglon_id: rr.id, ...of, es_propio: esPropio(of.proveedor) })));
      await db.ins('cc_comp_ofertas', ofs);
      if (cot && cot.estado === 'abierta') await db.upd('cc_cotizaciones', cot.id, { estado: 'presentada' });
      await loadAll(); o.remove(); location.hash = '#comp/' + comp.id; toast('Comparativa cargada');
    } catch (e) { toast('Error: ' + e.message, 6000); $('#ok', o).disabled = false; $('#ok', o).textContent = 'Guardar'; }
  };
}
function vComp(id) {
  const c = I.comp.get(id); if (!c) return vComps();
  const rs = I.rensByComp.get(id) || [];
  const cot = I.cot.get(c.cotizacion_id);
  const its = cot ? (I.itemsByCot.get(cot.id) || []) : [];
  const opts = [...S.cots].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(x => `<option value="${x.id}" ${x.id === c.cotizacion_id ? 'selected' : ''}>${esc(x.proceso)} · ${fdate(x.fecha)}</option>`).join('');
  shell(`<div class="row" style="margin-bottom:12px"><a href="#comparativas" class="small">← Comparativas</a></div>
  <div class="card"><div class="row"><div><h1>${esc(c.titulo || c.proceso)}</h1><div class="sub">${esc(c.archivo || '')} · ${esc(c.origen || '')}</div></div><span class="spacer"></span>
    <label class="f">Cotización vinculada<select class="in" id="cs"><option value="">— ninguna —</option>${opts}</select></label>
    <button class="btn" id="relink" ${cot ? '' : 'disabled'}>Re-vincular automático</button><button class="btn" id="xlsC">Exportar Excel</button>${cot ? `<a class="btn" href="#cot/${cot.id}">Abrir cotización</a>` : ''}<button class="btn danger" id="del">Eliminar</button></div></div>
  <div class="kpis" id="compKpis">${kpisCompHTML(rs)}</div>
  <div class="xltabs" style="border-radius:6px;border-top:1px solid #c8c8c8;margin-bottom:8px;display:inline-flex"><a href="#" data-m="planilla" class="${compMode === 'planilla' ? 'on' : ''}">Planilla del acta</a><a href="#" data-m="vinc" class="${compMode === 'vinc' ? 'on' : ''}">Vínculos y márgenes</a></div>
  ${compMode === 'planilla' ? `<div id="gh"></div><div class="xlhelp">Las celdas de precio y marca se pueden corregir a mano: escribí el <b>precio total</b> del renglón (como figura en el acta) o <b>NC</b> si no cotizó; Supr deja la celda como NC. Ctrl+Z deshace. Al cambiar un precio se recalculan al instante la posición, el mejor competidor y los márgenes en toda la web.</div>` : `
  <div class="tw"><table class="t" id="cg"><thead><tr><th class="n">R</th><th>Descripción del acta</th><th class="n">Cant.</th><th>Nuestro renglón</th><th class="n">Nuestro unit.</th><th class="c">Pos.</th><th>Mejor competidor</th><th class="n">Unit. comp.</th><th class="n">Diferencia</th><th class="n">Margen p/igualar (costo cotizado)</th><th class="n">Margen p/igualar (costo actual)</th></tr></thead><tbody>
  ${rs.map(r => { const a = I.ana.get(r.id); const it = r.item_id && I.item.get(r.item_id); const m = a.mejorComp;
    const mc = it && a.unitComp ? 1 - costoMetaCot(it) / a.unitComp : null; const ma = it && a.unitComp && costoMetaAct(it) != null && !saltoRaro(it) ? 1 - costoMetaAct(it) / a.unitComp : null;
    return `<tr data-r="${r.id}" class="click"><td class="n">${r.renglon ?? ''}</td><td class="wrap">${esc(r.descripcion)}</td><td class="n">${nf0.format(r.cantidad || 0)}</td>
    <td><select class="in" data-link style="max-width:260px;padding:3px 6px;font-size:12.5px"><option value="">— sin vínculo —</option>${its.map(i => `<option value="${i.id}" ${i.id === r.item_id ? 'selected' : ''}>R${i.renglon} · ${esc(i.detalle.slice(0, 38))}</option>`).join('')}</select></td>
    <td class="n">${money(a.unitPropio)}</td><td class="c">${a.posicion ? `<span class="pill ${a.posicion === 1 ? 'ok' : 'bad'}">${a.posicion}°/${a.ofertasValidas}</span>` : '<span class="small muted">—</span>'}</td>
    <td>${m ? `${esc(P.canonProv(m.proveedor))}<div class="small muted">${esc(m.marca || '')}</div>` : '<span class="muted small">—</span>'}</td><td class="n">${money(a.unitComp)}</td>
    <td class="n">${a.unitPropio && a.unitComp ? `<span class="${a.unitPropio > a.unitComp ? 'bad' : 'ok'}">${a.unitPropio > a.unitComp ? '+' : ''}${pct(a.unitPropio / a.unitComp - 1)}</span>` : '—'}</td>
    <td class="n ${clsMargen(mc)}">${pct(mc)}</td><td class="n ${clsMargen(ma)}">${pct(ma)}</td></tr>`; }).join('')}
  </tbody></table></div><p class="legend">“Mejor competidor” = la oferta válida más baja que no es nuestra (si en el histórico figura quién fue adjudicado, se usa ese). Click en una fila para ver todas las ofertas.</p>`}`, { full: compMode === 'planilla' });
  $$('[data-m]').forEach(a => a.onclick = e => { e.preventDefault(); compMode = a.dataset.m; vComp(id); });
  if (compMode === 'planilla') { const host = $('#gh'); host.style.height = 'calc(100vh - 150px)'; host.style.minHeight = '420px'; const acols = actaCols(rs); const g = Grid(host, { id: 'acta', cols: acols, frozen: 3,
      onEdit: async ch => { await editarActa(ch, c, UNDO_ACTA); g.setRows(I.rensByComp.get(id) || rs); refrescarKpisComp(id); toast('Guardado'); },
      onUndo: async () => { await deshacerActa(); g.setRows(I.rensByComp.get(id) || rs); refrescarKpisComp(id); } });
    host._grid = g; g._cols = acols; g.setRows(rs); g.focus(); }
  $('#cs').onchange = async e => { const v = +e.target.value || null; await db.upd('cc_comparativas', c.id, { cotizacion_id: v, fecha: v ? I.cot.get(v).fecha : c.fecha }); c.cotizacion_id = v; await relink(c, true); };
  $('#relink').onclick = () => relink(c, false);
  $('#xlsC').onclick = () => exportComp(c);
  $('#del').onclick = async () => { if (!confirm('¿Eliminar esta comparativa con todas sus ofertas?')) return; await db.del('cc_comparativas', 'id', [c.id]); await loadAll(); location.hash = '#comparativas'; };
  if ($('#cg')) $('#cg').addEventListener('change', async e => { if (!e.target.matches('[data-link]')) return; const rid = +e.target.closest('tr').dataset.r; const v = +e.target.value || null; await db.upd('cc_comp_renglones', rid, { item_id: v, vinculo_manual: true }); S.rens.find(x => x.id === rid).item_id = v; reindex(); vComp(c.id); toast('Vínculo guardado'); });
  if ($('#cg')) $('#cg').addEventListener('click', e => { if (e.target.closest('select')) return; const tr = e.target.closest('tr[data-r]'); if (!tr) return; const r = S.rens.find(x => x.id === +tr.dataset.r); modal(`<h2>R${r.renglon} · ${esc(r.descripcion)}</h2><p class="sub">Cantidad ${nf0.format(r.cantidad || 0)}</p>${ofertasTabla(r)}`); });
}
function kpisCompHTML(rs) {
  let gan = 0, cot1 = 0, cerca = 0, perdido = 0, ahorro = 0;
  for (const r of rs) { const a = I.ana.get(r.id); if (!a.propia) continue; cot1++; if (a.posicion === 1) gan++; else if (a.unitComp) { const d = a.unitPropio / a.unitComp - 1; if (d < conf('cercania')) cerca++; perdido += a.propia.precio_total; ahorro += a.propia.precio_total - a.mejorComp.precio_total; } }
  return `<div class="kpi"><div class="l">Renglones</div><div class="v">${rs.length}</div><div class="s">${rs.filter(r => r.item_id).length} vinculados a la cotización</div></div>
    <div class="kpi"><div class="l">Cotizamos</div><div class="v">${cot1}</div></div>
    <div class="kpi"><div class="l">1° lugar</div><div class="v ok">${gan}</div><div class="s">${cot1 ? pct(gan / cot1, 0) : ''}</div></div>
    <div class="kpi"><div class="l">Perdidos por menos de ${pct(conf('cercania'), 0)}</div><div class="v warn">${cerca}</div><div class="s">oportunidades cercanas</div></div>
    <div class="kpi"><div class="l">Monto perdido</div><div class="v">${money(perdido)}</div><div class="s">había que bajar ${money(ahorro)} en total</div></div>`;
}
function refrescarKpisComp(id) { const el = $('#compKpis'); if (el) el.innerHTML = kpisCompHTML(I.rensByComp.get(id) || []); }
let compMode = 'planilla';
const UNDO_ACTA = [];
async function editarActa(changes, comp, undoList) {
  const undo = [];
  for (const { row: r, col, value } of changes) {
    const v = String(value ?? '').trim();
    if (col.key === 'desc' || col.key === 'cr') {
      const patch = col.key === 'desc' ? { descripcion: v } : { cantidad: v === '' ? null : P.num(v) };
      undo.push({ t: 'ren', id: r.id, before: { descripcion: r.descripcion, cantidad: r.cantidad } });
      Object.assign(r, await db.upd('cc_comp_renglones', r.id, patch));
      continue;
    }
    if (!col.prov) continue;
    let patch;
    if (col.key.startsWith('m')) patch = { marca: v };
    else if (v === '' || /^n\/?c\.?$/i.test(v) || /^no cotiz/i.test(v)) patch = { precio_total: null, estado: 'No cotiza' };
    else { const n = P.num(v.replace(/\$/g, '')); patch = n != null && n >= 0 ? { precio_total: n, estado: 'Cotizó' } : { precio_total: null, estado: v }; }
    let o = (I.ofsByRen.get(r.id) || []).find(x => x.proveedor === col.prov);
    if (o) { undo.push({ t: 'of', id: o.id, before: { precio_total: o.precio_total, estado: o.estado, marca: o.marca } }); Object.assign(o, await db.upd('cc_comp_ofertas', o.id, patch)); }
    else { const [n] = await db.ins('cc_comp_ofertas', [{ renglon_id: r.id, proveedor: col.prov, es_propio: esPropio(col.prov), estado: 'No cotiza', ...patch }]); S.ofs.push(n); undo.push({ t: 'ofNew', id: n.id }); }
  }
  if (undo.length && undoList) undoList.push(undo);
  reindex();
}
async function deshacerActa() {
  const u = UNDO_ACTA.pop(); if (!u) { toast('Nada para deshacer'); return; }
  for (const x of [...u].reverse()) {
    if (x.t === 'ren') { const r = S.rens.find(q => q.id === x.id); if (r) Object.assign(r, await db.upd('cc_comp_renglones', x.id, x.before)); }
    else if (x.t === 'of') { const o = S.ofs.find(q => q.id === x.id); if (o) Object.assign(o, await db.upd('cc_comp_ofertas', x.id, x.before)); }
    else if (x.t === 'ofNew') { await db.del('cc_comp_ofertas', 'id', [x.id]); S.ofs = S.ofs.filter(q => q.id !== x.id); }
  }
  reindex(); toast('Deshecho');
}
function actaCols(rs) {
  const provs = [];
  for (const r of rs) for (const o of (I.ofsByRen.get(r.id) || []).sort((a, b) => a.id - b.id)) if (!provs.includes(o.proveedor)) provs.push(o.proveedor);
  const of = (r, p) => (I.ofsByRen.get(r.id) || []).find(o => o.proveedor === p);
  const n2 = v => v == null || v === '' ? '' : typeof v === 'number' ? nf2.format(v) : v;
  const it = r => r.item_id ? I.item.get(r.item_id) : null;
  const cols = [
    { key: 'renglon', title: 'Ítem', w: 44, type: 'num', get: r => r.renglon },
    { key: 'desc', title: 'Descripción', w: 240, type: 'text', edit: 1, get: r => r.descripcion, onOpen: r => modal(`<h2>R${r.renglon} · ${esc(r.descripcion)}</h2><p class="sub">Cantidad ${nf0.format(r.cantidad || 0)}</p>${ofertasTabla(r)}`) },
    { key: 'cr', title: 'C.R.', w: 52, type: 'num', edit: 1, get: r => r.cantidad, fmt: v => v == null ? '' : nf0.format(v) },
  ];
  provs.forEach((p, i) => {
    const prop = esPropio(p);
    cols.push({ key: 'p' + i, prov: p, title: P.canonProv(p) + ' · Precio', tip: p + ' — precio TOTAL del renglón. Escribí el número, o NC si no cotizó', w: 108, type: 'num', edit: 1, live: prop, get: r => { const o = of(r, p); return o ? (o.precio_total ?? (o.estado === 'No cotiza' ? 'NC' : o.estado || '')) : ''; }, fmt: v => typeof v === 'number' ? nf2.format(v) : `<span class="g">${esc(v)}</span>`,
      cls: (v, r) => { if (typeof v !== 'number') return ''; const a = I.ana.get(r.id); const min = Math.min(...(I.ofsByRen.get(r.id) || []).filter(o => o.precio_total > 0).map(o => o.precio_total)); return (v === min ? 'best ' : '') + (prop ? 'prop' : ''); } });
    cols.push({ key: 'm' + i, prov: p, title: P.canonProv(p) + ' · Marca', w: 120, type: 'text', edit: 1, live: prop, get: r => { const o = of(r, p); return o ? o.marca || '' : ''; } });
  });
  cols.push(
    { key: 'mejor', title: 'Mejor competidor', w: 140, type: 'text', live: 1, get: r => { const a = I.ana.get(r.id); return a.mejorComp ? P.canonProv(a.mejorComp.proveedor) : ''; } },
    { key: 'ucomp', title: 'Unit. competidor', w: 100, type: 'num', live: 1, get: r => I.ana.get(r.id).unitComp, fmt: n0 },
    { key: 'uprop', title: 'Nuestro unit.', w: 100, type: 'num', live: 1, get: r => I.ana.get(r.id).unitPropio, fmt: n0 },
    { key: 'pos', title: 'Posición', w: 66, type: 'num', live: 1, get: r => I.ana.get(r.id).posicion, fmt: (v, r) => v ? `${v}° de ${I.ana.get(r.id).ofertasValidas}` : '', cls: v => v === 1 ? 'ok b' : v ? 'bad' : '' },
    { key: 'dif', title: 'Dif. vs mejor', w: 74, type: 'pct', live: 1, get: r => { const a = I.ana.get(r.id); return a.unitPropio && a.unitComp ? a.unitPropio / a.unitComp - 1 : null; }, fmt: v => v == null ? '' : (v > 0 ? '+' : '') + pct(v), cls: v => v == null ? '' : v > 0 ? 'bad' : 'ok' },
    { key: 'item', title: 'Nuestro renglón', w: 200, type: 'text', live: 1, get: r => { const x = it(r); return x ? `R${x.renglon} · ${x.detalle}` : ''; } },
    { key: 'mc', title: 'Margen p/igualar (costo cotizado)', w: 92, type: 'pct', live: 1, get: r => { const x = it(r), a = I.ana.get(r.id); return x && a.unitComp && costoMetaCot(x) != null ? 1 - costoMetaCot(x) / a.unitComp : null; }, fmt: pc2, cls: v => clsMargen(v) },
    { key: 'ma', title: 'Margen p/igualar (costo actual)', w: 92, type: 'pct', live: 1, get: r => { const x = it(r), a = I.ana.get(r.id); return x && a.unitComp && costoMetaAct(x) != null && !saltoRaro(x) ? 1 - costoMetaAct(x) / a.unitComp : null; }, fmt: pc2, cls: v => clsMargen(v) + ' b' });
  return cols;
}
function exportComp(c) {
  const rs = I.rensByComp.get(c.id) || [];
  const provs = [...new Set(rs.flatMap(r => (I.ofsByRen.get(r.id) || []).map(o => o.proveedor)))];
  const wide = rs.map(r => {
    const a = I.ana.get(r.id); const row = { 'Ítem': r.renglon, 'Descripción': r.descripcion, 'C.R.': r.cantidad };
    for (const p of provs) { const o = (I.ofsByRen.get(r.id) || []).find(x => x.proveedor === p); row[p + ' · Precio'] = o ? (o.precio_total ?? o.estado) : ''; row[p + ' · Marca'] = o ? o.marca || '' : ''; }
    row['Mejor competidor'] = a.mejorComp ? P.canonProv(a.mejorComp.proveedor) : ''; row['Unit. competidor'] = a.unitComp; row['Nuestro unit.'] = a.unitPropio; row['Posición'] = a.posicion;
    return row;
  });
  const det = rs.flatMap(r => (I.ofsByRen.get(r.id) || []).map(o => ({ 'Ítem': r.renglon, 'Descripción': r.descripcion, 'C.R.': r.cantidad, Proveedor: o.proveedor, Grupo: o.grupo || '', Estado: o.estado || '', 'Precio total': o.precio_total, 'Precio unitario': o.precio_total && r.cantidad ? o.precio_total / r.cantidad : null, 'Marca / laboratorio': o.marca || '' })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wide), 'Comparativa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(det), 'Detalle');
  XLSX.writeFile(wb, `Acta_${(c.proceso || 'comparativa').replace(/[^\w]+/g, '_')}.xlsx`);
}
async function relink(c, todo) {
  const rs = I.rensByComp.get(c.id) || [];
  const its = c.cotizacion_id ? (I.itemsByCot.get(c.cotizacion_id) || []) : [];
  const libres = rs.filter(r => todo || !r.vinculo_manual);
  const v = P.vincular(libres.map(r => ({ ...r, ofertas: I.ofsByRen.get(r.id) || [] })), its.filter(i => todo || !rs.some(r => r.vinculo_manual && r.item_id === i.id)), esPropio);
  const m = new Map(v.map(p => [libres[p.i].id, p.it.id]));
  for (const r of libres) { const nv = m.get(r.id) || null; if (nv !== r.item_id || (todo && r.vinculo_manual)) { await db.upd('cc_comp_renglones', r.id, { item_id: nv, vinculo_manual: false }); r.item_id = nv; r.vinculo_manual = false; } }
  reindex(); vComp(c.id); toast(`${m.size} renglones vinculados`);
}

// ======================================================================
//  Buscar producto
// ======================================================================
let qBus = '';
function vBuscar() {
  const q = P.norm(qBus);
  let html = '';
  if (q.length >= 2) {
    const prods = new Map();
    for (const it of S.items) if (P.norm(it.codigo + ' ' + it.detalle + ' ' + it.monodroga).includes(q)) { const k = it.codigo || it.detalle; if (!prods.has(k)) prods.set(k, []); prods.get(k).push(it); }
    for (const k of S.cat) if (!prods.has(k.codigo) && P.norm(k.codigo + ' ' + k.detalle + ' ' + k.monodroga).includes(q)) prods.set(k.codigo, [{ ...k, id: -1, _soloCosto: true }]);
    const rensSueltos = S.rens.filter(r => !r.item_id && P.norm(r.descripcion).includes(q));
    html = `<div class="tw"><table class="t"><thead><tr><th>Producto</th><th class="n">Veces cotizado</th><th class="n">Último precio nuestro</th><th class="n">Costo actual</th><th>Último mejor competidor</th><th class="n">Unit. comp.</th><th class="n">Margen p/ganar hoy</th></tr></thead><tbody>
    ${[...prods.values()].slice(0, 150).map(arr => {
      const items = arr.filter(x => !x._soloCosto).sort((a, b) => String(I.cot.get(b.cotizacion_id)?.fecha).localeCompare(String(I.cot.get(a.cotizacion_id)?.fecha)));
      const it = items[0] || arr[0];
      const base = it._soloCosto ? { ...it, dcto_psl: null } : it;
      const ca = costoRow(base) ? P.costoMeta(base, costoRow(base)) : null;
      const x = it._soloCosto ? { ultimo: null } : intel({ ...it, id: -1, cotizacion_id: -1 });
      const u = x.ultimo; const cref = it._soloCosto ? ca : costoVig(it); const mg = u && cref != null ? 1 - cref / u.a.unitComp : null;
      return `<tr class="click" data-i="${it._soloCosto ? '' : it.id}"><td><b>${esc(it.detalle)}</b><div class="small muted">${esc(it.codigo)} · ${esc(it.monodroga)} · ${esc(it.laboratorio)}</div></td>
        <td class="n">${items.length}</td><td class="n">${items[0] ? money(items[0].precio_unit) + `<div class="small muted">${fdate(I.cot.get(items[0].cotizacion_id)?.fecha)}</div>` : '—'}</td><td class="n">${money(ca)}</td>
        <td>${u ? `${esc(P.canonProv(u.a.mejorComp.proveedor))}<div class="small muted">${fdate(u.fecha)} · ${esc(u.proceso)}</div>` : '<span class="muted small">sin datos</span>'}</td><td class="n">${money(u?.a.unitComp)}</td><td class="n ${clsMargen(mg)}">${pct(mg)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Sin resultados.</td></tr>'}
    </tbody></table></div>
    ${rensSueltos.length ? `<h2 style="margin-top:18px">En actas, sin vincular a un renglón nuestro (${rensSueltos.length})</h2><div class="tw"><table class="t"><tr><th>Fecha</th><th>Proceso</th><th>Descripción</th><th class="n">Cant.</th><th>Mejor oferta</th><th class="n">Unitario</th></tr>
      ${rensSueltos.sort((a, b) => fechaRen(b).localeCompare(fechaRen(a))).slice(0, 60).map(r => { const a = I.ana.get(r.id); const m = a.mejorComp; return `<tr><td>${fdate(fechaRen(r))}</td><td><a href="#comp/${r.comparativa_id}">${esc(cotDeRen(r)?.proceso || I.comp.get(r.comparativa_id)?.proceso || '')}</a></td><td>${esc(r.descripcion)}</td><td class="n">${nf0.format(r.cantidad || 0)}</td><td>${m ? esc(P.canonProv(m.proveedor)) + `<div class="small muted">${esc(m.marca || '')}</div>` : '—'}</td><td class="n">${money(a.unitComp)}</td></tr>`; }).join('')}</table></div>` : ''}`;
  }
  shell(`<h1>Buscar producto</h1><div class="sub" style="margin-bottom:12px">Antes de cotizar: cuánto lo pusimos, quién ganó y a qué precio, y a qué margen hay que ir hoy.</div>
    <input class="in" id="q" placeholder="Código, marca o monodroga (ej. abemaciclib)" value="${esc(qBus)}" style="width:min(520px,100%);margin-bottom:14px">${html}`);
  const inp = $('#q'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  let h; inp.oninput = () => { clearTimeout(h); h = setTimeout(() => { qBus = inp.value; vBuscar(); }, 200); };
  $$('tr[data-i]').forEach(tr => tr.onclick = () => tr.dataset.i && historial(I.item.get(+tr.dataset.i)));
}

// ======================================================================
//  Costos
// ======================================================================
let qCost = '';
function vCostos() {
  const porLista = {}; for (const c of S.cat) { const l = c.lista || '(sin lista)'; porLista[l] = porLista[l] || { n: 0, f: '' }; porLista[l].n++; if (c.actualizado > porLista[l].f) porLista[l].f = c.actualizado; }
  const q = P.norm(qCost);
  const hits = q.length >= 2 ? S.cat.filter(k => P.norm(k.codigo + ' ' + k.detalle + ' ' + k.monodroga + ' ' + k.laboratorio).includes(q)).slice(0, 300) : [];
  const fCot = S.cot && S.cot.updated ? new Date(S.cot.updated).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const usandoCot = S.cot && S.cot.ok && conf('fuenteCostos') !== 'manual';
  shell(`<h1>Costos vigentes</h1><div class="sub" style="margin-bottom:12px">Se usan para el “costo actual” y el “margen p/ganar” de todas las pantallas.</div>
  <div class="card"><div class="row"><div><b>Fuente: ${usandoCot ? 'Cotizador (automático)' : 'Carga manual'}</b>
    <div class="small muted">${S.cot && S.cot.ok ? `Precios por lista del cotizador: ${nf0.format(S.cot.lista.length)} · última carga en el cotizador: <b>${fCot}</b> — se leen solos al abrir la página y con ⟳.` : S.cot && S.cot.error ? `No pude leer los costos del cotizador (${esc(S.cot.error)}).` : DEMO ? 'En modo demo no se conecta al cotizador.' : 'El cotizador todavía no tiene precios por lista cargados.'}
    ${usandoCot ? '<br>Los códigos o listas que no estén en el cotizador se completan con la carga manual (si hay).' : ''}</div></div><span class="spacer"></span>
    ${S.cot && S.cot.ok ? `<label class="small row" style="gap:6px"><input type="checkbox" id="fuenteCot" ${usandoCot ? 'checked' : ''}> Usar costos del cotizador</label>` : ''}</div></div>
  <details class="card"><summary class="small" style="cursor:pointer"><b>Carga manual de costos</b> (respaldo, normalmente no hace falta)</summary><div style="margin-top:10px"><div class="drop" id="drop"><b>Cargar archivo de costos</b><br><span class="small">Excel o CSV con columnas CODIGO y COSTO (y si están: LISTA/LISTAPRE, DETALLE, MONODROGA, LABORATORIO, PVP, PSL, DTOCPA). Detecta la fila de encabezados sola.</span></div></div></details>
  <div class="kpis">${Object.entries(porLista).map(([l, v]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${nf0.format(v.n)}</div><div class="s">act. ${v.f ? new Date(v.f).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</div></div>`).join('') || '<div class="kpi"><div class="l">Sin costos cargados</div><div class="v">0</div></div>'}</div>
  <div class="row" style="margin-bottom:10px"><input class="in" id="q" placeholder="Buscar código, producto, monodroga, laboratorio…" value="${esc(qCost)}" style="width:min(420px,100%)"><span class="spacer"></span>
    <span class="small muted">Últimas cargas: ${S.cargas.slice(-3).reverse().map(c => `${esc(c.archivo)} (${nf0.format(c.filas)} filas, ${new Date(c.created_at).toLocaleDateString('es-AR')}${c.usuario ? ', ' + esc(c.usuario) : ''})`).join(' · ') || '—'}</span></div>
  ${q.length >= 2 ? `<div class="tw"><table class="t"><thead><tr><th>Código</th><th>Producto</th><th>Monodroga</th><th>Laboratorio</th><th>Lista</th><th class="n">PVP</th><th class="n">PSL</th><th class="n">Dto.</th><th class="n">Costo</th></tr></thead><tbody>
    ${hits.map(k => `<tr><td>${esc(k.codigo)}</td><td>${esc(k.detalle)}</td><td>${esc(k.monodroga)}</td><td class="small">${esc(k.laboratorio)}</td><td>${esc(k.lista)}</td><td class="n">${money(k.pvp)}</td><td class="n">${money(k.psl)}</td><td class="n">${k.dtocpa ?? ''}</td><td class="n"><b>${money(k.costo)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Sin resultados.</td></tr>'}</tbody></table></div>` : ''}`);
  dropZone($('#drop'), '.xlsx,.xls,.csv', cargarCostos);
  if ($('#fuenteCot')) $('#fuenteCot').onchange = async e => { await db.ups('cc_config', [{ clave: 'fuenteCostos', valor: e.target.checked ? 'cotizador' : 'manual' }], ['clave']); S.cfg.fuenteCostos = e.target.checked ? 'cotizador' : 'manual'; armarCatalogo(); reindex(); vCostos(); toast('Fuente de costos actualizada'); };
  const inp = $('#q'); let h; inp.oninput = () => { clearTimeout(h); h = setTimeout(() => { qCost = inp.value; vCostos(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); };
}
async function cargarCostos(file) {
  let wb; try { wb = await readWb(file); } catch (e) { return toast('No pude leer el archivo: ' + e.message, 5000); }
  const r = P.parseCostos(XLSX, wb, '');
  if (!r.filas.length) return toast('No encontré columnas CODIGO y COSTO en el archivo', 5000);
  const sinLista = r.filas.some(f => !f.lista);
  const o = modal(`<h2>Cargar costos</h2><p class="sub">${esc(file.name)} · hoja “${esc(r.hoja)}”</p>
    <p><b>${nf0.format(r.filas.length)}</b> productos. Columnas detectadas: ${Object.entries(r.columnas).map(([k, v]) => `<span class="pill info">${k} ← ${esc(v)}</span>`).join(' ')}</p>
    <p>Listas en el archivo: ${r.listas.filter(Boolean).map(l => `<span class="pill">${esc(l)}</span>`).join(' ') || '—'}</p>
    ${sinLista ? `<label class="f">El archivo no trae lista: ¿a qué lista corresponde?<input class="in" id="lst" value="ISSN_NQN"></label>` : ''}
    <label class="row" style="margin-top:10px"><input type="checkbox" id="purge" checked> Borrar productos de esas listas que no vengan en este archivo</label>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok">Cargar</button></div>`);
  $('#ok', o).onclick = async () => {
    $('#ok', o).disabled = true; $('#ok', o).innerHTML = '<span class="spin"></span> Cargando';
    try {
      const lst = $('#lst', o)?.value.trim() || '';
      const ts = new Date().toISOString();
      const filas = r.filas.map(f => ({ ...f, lista: f.lista || lst, actualizado: ts }));
      const listas = [...new Set(filas.map(f => f.lista))];
      await db.ups('cc_costos', filas, ['codigo', 'lista']);
      if ($('#purge', o).checked) await db.delStaleCostos(listas, ts);
      await db.ins('cc_cargas_costos', [{ archivo: file.name, filas: filas.length, listas: listas.join(', '), usuario: who() }]);
      await loadAll(); o.remove(); vCostos(); toast(`${nf0.format(filas.length)} costos cargados`);
    } catch (e) { toast('Error: ' + e.message, 6000); $('#ok', o).disabled = false; $('#ok', o).textContent = 'Cargar'; }
  };
}

// ======================================================================
//  Resumen
// ======================================================================
function vResumen() {
  const conAna = S.rens.map(r => ({ r, a: I.ana.get(r.id) })).filter(x => x.a && x.a.propia);
  const gan = conAna.filter(x => x.a.posicion === 1 || x.a.ganamos);
  const comp = new Map();
  const add = (n, f) => { const k = P.canonProv(n); if (!k || /^sin dato$/i.test(k)) return; if (!comp.has(k)) comp.set(k, { n: k, gana: 0, nosGana: 0, ofertas: 0, dif: [] }); f(comp.get(k)); };
  for (const r of S.rens) for (const o of (I.ofsByRen.get(r.id) || [])) if (!esPropio(o.proveedor) && o.precio_total > 0) add(o.proveedor, c => c.ofertas++);
  for (const x of conAna) {
    const m = x.a.mejorComp; if (!m) continue;
    if (x.a.posicion !== 1) add(m.proveedor, c => { c.nosGana++; c.dif.push(x.a.unitPropio / x.a.unitComp - 1); });
    if (x.a.ganador && !x.a.ganador.es_propio) add(x.a.ganador.proveedor, c => c.gana++);
  }
  const lista = [...comp.values()].sort((a, b) => b.nosGana - a.nosGana || b.ofertas - a.ofertas);
  const maxN = Math.max(1, ...lista.map(c => c.nosGana));
  const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const cerca = conAna.filter(x => x.a.posicion > 1 && x.a.unitComp && x.a.unitPropio / x.a.unitComp - 1 < conf('cercania'))
    .map(x => ({ ...x, it: I.item.get(x.r.item_id), f: fechaRen(x.r) })).sort((a, b) => b.f.localeCompare(a.f));
  shell(`<h1>Resumen</h1><div class="sub" style="margin-bottom:14px">Sobre ${conAna.length} renglones con comparativa en los que cotizamos.</div>
  <div class="kpis"><div class="kpi"><div class="l">Renglones cotizados con resultado</div><div class="v">${conAna.length}</div></div>
    <div class="kpi"><div class="l">Salimos 1°</div><div class="v ok">${gan.length}</div><div class="s">${conAna.length ? pct(gan.length / conAna.length, 0) : ''}</div></div>
    <div class="kpi"><div class="l">Perdidos por &lt; ${pct(conf('cercania'), 0)}</div><div class="v warn">${cerca.length}</div><div class="s">los más fáciles de dar vuelta</div></div>
    <div class="kpi"><div class="l">Costos cargados</div><div class="v">${nf0.format(S.cat.length)}</div><div class="s">${S.cot && S.cot.ok && conf('fuenteCostos') !== 'manual' ? 'del cotizador' : 'carga manual'}</div></div></div>
  <div class="card"><h2>Quién nos gana</h2><div class="tw" style="max-height:none"><table class="t"><tr><th>Competidor</th><th class="n">Ofertas vistas</th><th>Veces que fue mejor que nosotros</th><th class="n">Por cuánto (mediana)</th></tr>
  ${lista.slice(0, 25).map(c => `<tr><td><b>${esc(c.n)}</b></td><td class="n">${c.ofertas}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="width:160px"><i style="width:${100 * c.nosGana / maxN}%"></i></div>${c.nosGana}</div></td><td class="n">${c.dif.length ? pct(med(c.dif)) : '—'}</td></tr>`).join('')}</table></div>
  <p class="legend">“Por cuánto”: cuánto más caro estuvo nuestro precio unitario respecto del suyo, en los renglones que perdimos contra él.</p></div>
  <div class="card"><h2>Perdidos por poco (&lt; ${pct(conf('cercania'), 0)})</h2><div class="tw" style="max-height:60vh"><table class="t"><tr><th>Fecha</th><th>Proceso</th><th>Producto</th><th>Ganó</th><th class="n">Nuestro unit.</th><th class="n">Unit. ganador</th><th class="n">Diferencia</th><th class="n">Margen p/ganar hoy</th></tr>
  ${cerca.slice(0, 200).map(x => { const mg = x.it ? margenParaGanar(x.it, x.a.unitComp) : null; const cot = cotDeRen(x.r); return `<tr><td>${fdate(x.f)}</td><td>${cot ? `<a href="#cot/${cot.id}">${esc(cot.proceso)}</a>` : ''}</td><td>${esc(x.it ? x.it.detalle : x.r.descripcion)}</td><td>${esc(P.canonProv(x.a.mejorComp.proveedor))}</td><td class="n">${money(x.a.unitPropio)}</td><td class="n">${money(x.a.unitComp)}</td><td class="n warn">+${pct(x.a.unitPropio / x.a.unitComp - 1)}</td><td class="n ${clsMargen(mg)}">${pct(mg)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Nada por ahora.</td></tr>'}</table></div></div>`);
}

// ======================================================================
//  Importar histórico + ajustes
// ======================================================================
function vImportar() {
  shell(`<h1>Importar / Ajustes</h1>
  <div class="card"><h2>1 · Importar el Excel acumulado (una sola vez)</h2>
    <p class="sub">Lee las hojas de meses (ENERO…DICIEMBRE) como cotizaciones, las hojas “OC …” para marcar renglones adjudicados, la hoja COMPARATIVAS como resultados históricos y la hoja VLOOKUP como costos iniciales. Los procesos que ya existen en la web se saltean, así que se puede repetir sin duplicar.</p>
    <div class="drop" id="drop"><b>Arrastrá “Acumulado - Cotizaciones Directas 2026.xlsx”</b><br><span class="small">o hacé click para elegirlo</span></div><div id="prev"></div></div>
  <div class="card"><h2>2 · Ajustes</h2><div class="grid2">
    <label class="f">Margen objetivo (verde a partir de)<input class="in" id="mo" value="${+(conf('margenObjetivo') * 100).toFixed(2)}"></label>
    <label class="f">“Perdido por poco” si la diferencia es menor a (%)<input class="in" id="ce" value="${+(conf('cercania') * 100).toFixed(2)}"></label></div>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn pri" id="saveCfg">Guardar ajustes</button></div>
    <p class="legend">Nuestra droguería en las actas: <b>${esc(CFG.NOMBRE_PROPIO)}</b> (se cambia en config.js).</p></div>
  <div class="card"><h2>3 · Respaldo</h2><p class="sub">Descarga todos los datos de la web en un Excel (una hoja por tabla).</p><button class="btn" id="bk">Descargar respaldo</button></div>`);
  dropZone($('#drop'), '.xlsx,.xlsm', previewHistorico);
  $('#saveCfg').onclick = async () => {
    const rows = [{ clave: 'margenObjetivo', valor: P.num($('#mo').value) / 100 }, { clave: 'cercania', valor: P.num($('#ce').value) / 100 }];
    await db.ups('cc_config', rows, ['clave']); rows.forEach(r => S.cfg[r.clave] = r.valor); toast('Ajustes guardados');
  };
  $('#bk').onclick = () => {
    const wb = XLSX.utils.book_new();
    for (const [t, a] of [['cotizaciones', S.cots], ['items', S.items], ['comparativas', S.comps], ['comp_renglones', S.rens], ['comp_ofertas', S.ofs], ['ocs', S.ocs], ['oc_items', S.ocItems], ['costos', S.costos]]) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.length ? a : [{}]), t);
    XLSX.writeFile(wb, `respaldo_cotizaciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
}
async function previewHistorico(file) {
  $('#prev').innerHTML = '<p><span class="spin"></span> Leyendo el Excel…</p>';
  await new Promise(r => setTimeout(r, 30));
  let wb; try { wb = await readWb(file); } catch (e) { $('#prev').innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
  const A = P.parseAcumulado(XLSX, wb);
  const C = P.parseCostos(XLSX, wb, 'ISSN_NQN');
  const existe = new Set(S.cots.map(c => P.norm(c.proceso)));
  const nuevas = A.cotizaciones.filter(g => !existe.has(P.norm(g.cot.proceso)));
  const nIt = nuevas.reduce((s, g) => s + g.items.length, 0);
  const procsHist = [...new Set(A.hist.map(h => P.norm(h.proceso)))];
  const yaHist = new Set(S.comps.filter(c => c.origen === 'historico').map(c => P.norm(c.proceso)));
  const histNuevos = A.hist.filter(h => !yaHist.has(P.norm(h.proceso)));
  $('#prev').innerHTML = `<div class="card" style="margin-top:12px;box-shadow:none"><p><b>${A.cotizaciones.length}</b> procesos en el Excel → <b>${nuevas.length}</b> nuevos (${nIt} renglones), ${A.cotizaciones.length - nuevas.length} ya cargados.</p>
    <p>Hojas OC: ${A.ocOk} renglones marcados como adjudicados.${A.avisos.map(a => `<br><span class="warn small">${esc(a)}</span>`).join('')}</p>
    <p>Hoja COMPARATIVAS: ${A.hist.length} resultados de ${procsHist.length} procesos → ${histNuevos.length} por importar.</p>
    <p>Costos (hoja ${esc(C.hoja || '—')}): ${C.filas.length} productos <label class="row" style="display:inline-flex"><input type="checkbox" id="wc" ${S.costos.length || (S.cot && S.cot.ok) ? '' : 'checked'}> importarlos también</label></p>
    <button class="btn pri" id="go" ${nuevas.length || histNuevos.length || C.filas.length ? '' : 'disabled'}>Importar</button> <span id="st" class="small"></span></div>`;
  $('#go').onclick = async () => {
    const st = m => $('#st').innerHTML = '<span class="spin"></span> ' + m;
    $('#go').disabled = true;
    try {
      // 1. cotizaciones nuevas (+ las que solo aparecen en COMPARATIVAS)
      const extra = new Map();
      for (const h of histNuevos) { const k = P.norm(h.proceso); if (!existe.has(k) && !nuevas.some(g => P.norm(g.cot.proceso) === k)) { if (!extra.has(k)) extra.set(k, { cot: { proceso: h.proceso, apertura: h.apertura, fecha: h.fecha, estado: 'presentada' }, items: [] }); extra.get(k).items.push({ ...h.item, orden: extra.get(k).items.length + 1 }); } }
      const grupos = [...nuevas, ...extra.values()];
      st(`Creando ${grupos.length} cotizaciones…`);
      const cs = grupos.length ? await db.ins('cc_cotizaciones', grupos.map(g => ({ proceso: g.cot.proceso, apertura: g.cot.apertura, fecha: g.cot.fecha, hoja: g.cot.hoja ? `${P.norm(g.cot.hoja)} ${(g.cot.fecha || '2026').slice(0, 4)}`.replace('SETIEMBRE', 'SEPTIEMBRE') : null, estado: g.items.some(i => i.adjudicado) ? 'adjudicada' : 'presentada', oc: g.cot.oc, condicion: g.cot.condicion, mant_oferta: g.cot.mant_oferta, vto_oferta: g.cot.vto_oferta, cliente: 'ISSN', updated_by: who() }))) : [];
      const idPorProc = new Map(cs.map(c => [P.norm(c.proceso), c.id]));
      const items = grupos.flatMap(g => g.items.map(it => ({ ...it, adjudicado: it.adjudicado ?? null, oc: it.oc ?? null, cotizacion_id: idPorProc.get(P.norm(g.cot.proceso)) })));
      st(`Guardando ${items.length} renglones…`);
      const insertados = items.length ? await db.ins('cc_items', items) : [];
      const origs = grupos.flatMap(g => g.items); const idDe = new Map(origs.map((x, k) => [x, insertados[k] && insertados[k].id]));
      if (!S.faltaSchema) {
        for (const oo of A.ocs) {
          const ls = oo.items.filter(x => x._it && idDe.get(x._it)); if (!ls.length || I.oc.get(String(oo.oc))) continue;
          st(`Órdenes de compra: OC ${oo.oc}…`);
          const cotId = insertados.find(r => r.id === idDe.get(ls[0]._it))?.cotizacion_id || null;
          try {
            const procs = [...new Set(ls.map(x => { const r = insertados.find(q => q.id === idDe.get(x._it)); const c = r && cs.find(q => q.id === r.cotizacion_id); return c ? c.proceso : null; }).filter(Boolean))];
            const [reg] = await db.ins('cc_ocs', [{ numero: String(oo.oc), proceso: procs.join(', ') || oo.proceso || null, cotizacion_id: procs.length === 1 ? cotId : null, total: ls.reduce((s2, x) => s2 + (x.precio_unit || 0) * (x.cantidad || 0), 0), archivo: file.name + ' (hoja OC ' + oo.oc + ')', created_by: who() }]);
            await db.ins('cc_oc_items', ls.map(x => ({ oc_id: reg.id, item_id: idDe.get(x._it), descripcion: x.detalle, cantidad: x.cantidad, precio: x.precio_unit, importe: (x.precio_unit || 0) * (x.cantidad || 0) })));
          } catch (e) { console.warn('OC', oo.oc, e.message); }
        }
      }
      await loadAll();
      // 2. comparativas históricas
      const porProc = new Map(); for (const h of histNuevos) { const k = P.norm(h.proceso); if (!porProc.has(k)) porProc.set(k, []); porProc.get(k).push(h); }
      let n = 0;
      for (const [k, hs] of porProc) {
        st(`Comparativas históricas ${++n}/${porProc.size}…`);
        const cot = S.cots.find(c => P.norm(c.proceso) === k);
        const its = cot ? (I.itemsByCot.get(cot.id) || []) : [];
        const [comp] = await db.ins('cc_comparativas', [{ cotizacion_id: cot?.id || null, proceso: hs[0].proceso, fecha: hs[0].fecha, titulo: hs[0].proceso + ' (histórico Excel)', archivo: file.name, origen: 'historico', created_by: who() }]);
        const rens = await db.ins('cc_comp_renglones', hs.map(h => { const it = its.find(i => i.renglon === h.item.renglon && i.codigo === h.item.codigo) || its.find(i => i.codigo === h.item.codigo); return { comparativa_id: comp.id, renglon: h.item.renglon, descripcion: h.item.detalle, cantidad: h.item.cantidad, item_id: it?.id || null }; }));
        const ofs = []; rens.forEach((r, i) => hs[i].ofertas.forEach(o => ofs.push({ renglon_id: r.id, ...o })));
        if (ofs.length) await db.ins('cc_comp_ofertas', ofs);
      }
      // 3. costos
      if ($('#wc').checked && C.filas.length) { st('Cargando costos…'); const ts = new Date().toISOString(); await db.ups('cc_costos', C.filas.map(f => ({ ...f, actualizado: ts })), ['codigo', 'lista']); await db.ins('cc_cargas_costos', [{ archivo: file.name + ' (VLOOKUP)', filas: C.filas.length, listas: C.listas.join(', '), usuario: who() }]); }
      await loadAll();
      $('#st').innerHTML = '<span class="ok">Listo ✔</span>'; toast('Importación terminada'); setTimeout(() => location.hash = '#cotizaciones', 900);
    } catch (e) { $('#st').innerHTML = `<span class="bad">Error: ${esc(e.message)}</span>`; $('#go').disabled = false; }
  };
}

// ======================================================================
//  Arranque
// ======================================================================
(async () => {
  if (DEMO) { S.user = { email: 'demo@local' }; return start(); }
  sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  if (data.session) { S.user = data.session.user; start(); } else loginView();
})();
})();
