/* Arche Salud — pedidos (vanilla JS). Misma base Supabase que el cotizador y Comparativas. */
(() => {
'use strict';
const CFG = window.CONFIG || {};
const FORCE_DEMO = /[?&]demo\b/.test(location.search);
const DEMO = FORCE_DEMO || !(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const money = n => n == null || !isFinite(n) ? '—' : '$ ' + nf2.format(n);
const money0 = n => n == null || !isFinite(n) ? '—' : '$ ' + nf0.format(n);
const pct = f => f == null || !isFinite(f) ? '—' : (f * 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
const fdate = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '';
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const MES3 = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const toast = (m, ms = 2600) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); };

// texto normalizado
const clean = s => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const nkey = s => clean(s).toUpperCase();                                   // como TRIM(UPPER()) del Excel
const fold = s => nkey(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); // sin acentos, para buscar
const matchQ = (texto, q) => { const t = fold(texto); return fold(q).split(' ').filter(Boolean).every(w => /^\d+([.,]\d+)?$/.test(w) ? new RegExp('(^|[^\\d.,])' + w.replace(/[.,]/, '[.,]') + '(?![\\d]|[.,]\\d)').test(t) : t.includes(w)); };
const titleCase = s => clean(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// ======================================================================
//  Datos: Supabase (tablas ah_) o modo demo (localStorage)
// ======================================================================
const TABLES = ['ah_pedidos', 'ah_config'];
let sb = null;
const db = DEMO ? (() => {
  const mem = {}; let seq = Date.now() % 100000;
  for (const t of TABLES) { try { mem[t] = JSON.parse(localStorage.getItem('ahdemo_' + t) || '[]'); } catch { mem[t] = []; } }
  const save = t => { try { localStorage.setItem('ahdemo_' + t, JSON.stringify(mem[t])); } catch { /* lleno */ } };
  return {
    async all(t) { return mem[t].map(r => ({ ...r })); },
    async ins(t, rows) { const out = rows.map(r => ({ ...r, id: r.id ?? ++seq, created_at: new Date().toISOString() })); mem[t].push(...out); save(t); return out.map(r => ({ ...r })); },
    async upd(t, id, patch) { const r = mem[t].find(x => x.id === id); Object.assign(r, patch); save(t); return { ...r }; },
    async del(t, col, vals) { const s = new Set(vals); mem[t] = mem[t].filter(x => !s.has(x[col])); save(t); },
    async ups(t, rows, keys) { for (const r of rows) { const k = keys.map(x => r[x]).join('|'); const e = mem[t].find(x => keys.map(y => x[y]).join('|') === k); if (e) Object.assign(e, r); else mem[t].push({ id: ++seq, ...r }); } save(t); },
  };
})() : (() => {
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const chk = ({ data, error }) => { if (error) { const e = new Error(error.message); e.code = error.code; throw e; } return data; };
  return {
    async all(t) { let out = [], i = 0; for (;;) { const d = chk(await sb.from(t).select('*').order(t === 'ah_config' ? 'clave' : 'id').range(i, i + 999)); out = out.concat(d); if (d.length < 1000) return out; i += 1000; } },
    async ins(t, rows) { let out = []; for (const c of chunk(rows, 500)) out = out.concat(chk(await sb.from(t).insert(c).select())); return out; },
    async upd(t, id, patch) { return chk(await sb.from(t).update(patch).eq('id', id).select())[0]; },
    async del(t, col, vals) { for (const c of chunk(vals, 300)) chk(await sb.from(t).delete().in(col, c)); },
    async ups(t, rows, keys) { for (const c of chunk(rows, 500)) chk(await sb.from(t).upsert(c, { onConflict: keys.join(',') })); },
  };
})();

// Catálogo del cotizador (kv_store, lectura pública con la anon key, igual que el cotizador)
async function kvGet(key) {
  const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/kv_store?key=eq.' + encodeURIComponent(key) + '&select=value', {
    headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY } });
  if (!r.ok) throw new Error('Cotizador ' + r.status);
  const j = await r.json();
  if (!j.length) return null;
  const v = j[0].value;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

// ======================================================================
//  Estado
// ======================================================================
const S = { user: null, peds: [], dirs: [], cfg: {}, cat: [], catOk: false, catErr: '', ppl: null, faltaSchema: false };
const CFG_DEF = { factor: 0.93, lista_costo: 'CLINIC/SAN', cliente: '71346 · ARCHESALUD', plan: 'Plan Novo', aut: 'Receta Solidaria', despachado: '', entrega: 'Domicilio', fijas: [] };
const conf = k => (S.cfg[k] ?? CFG_DEF[k]);
const I = {};
const who = () => S.user?.email || (DEMO ? 'demo' : '');

async function loadAll() {
  try {
    const [peds, cfg] = await Promise.all(TABLES.map(t => db.all(t)));
    Object.assign(S, { peds, faltaSchema: false });
    S.cfg = Object.fromEntries(cfg.map(r => [r.clave, r.valor]));
  } catch (e) {
    if (/ah_pedidos|ah_config|does not exist|schema cache|permission denied/i.test(e.message)) { S.faltaSchema = true; S.schemaErr = e.message; } else throw e;
  }
  reindex();
}
async function loadCatalogo() {
  S.catErr = '';
  try {
    const base = await kvGet('cotizador:base-marcas');
    S.cat = (Array.isArray(base) ? base : []).filter(x => x && (x.marca || x.monodroga)).map(x => ({
      codigo: x.codigo != null ? String(x.codigo) : '', monodroga: clean(x.monodroga), laboratorio: clean(x.laboratorio),
      marca: clean(x.marca || x.monodroga), costo: num(x.costo), pvp: num(x.pvp), stock: x.stock ?? null, venc: x.vencimiento || '' }));
    S.catOk = true;
    if (nkey(conf('lista_costo')) !== 'CLINIC/SAN') await loadPPL();
  } catch (e) { S.catOk = false; S.catErr = e.message; S.cat = []; }
  reindexCat();
}
async function loadPPL() {
  if (S.ppl) return;
  try { const y = await kvGet('cotizador:precios-por-lista'); S.ppl = Array.isArray(y) ? y : []; } catch { S.ppl = []; }
  reindexCat();
}
const num = v => v == null || v === '' || !isFinite(Number(v)) ? null : Number(v);

function reindex() {
  I.byName = new Map();          // nkey(nombre) -> [pedidos]
  I.ini = new Map();             // nkey(nombre) -> iniciales (la primera vista)
  I.nombre = new Map();          // nkey -> nombre como se escribió
  const ord = [...S.peds].sort((a, b) => (a.numero ?? 1e9) - (b.numero ?? 1e9) || a.id - b.id);
  for (const p of ord) {
    const k = nkey(p.afiliado); if (!k) continue;
    if (!I.byName.has(k)) { I.byName.set(k, []); I.nombre.set(k, clean(p.afiliado)); }
    I.byName.get(k).push(p);
    if (p.iniciales && !I.ini.has(k)) I.ini.set(k, p.iniciales);
  }
  I.prodCount = new Map();
  for (const p of S.peds) { const k = nkey(p.producto); if (k) I.prodCount.set(k, (I.prodCount.get(k) || 0) + 1); }
  reindexCat();
}
function reindexCat() {
  I.catByMarca = new Map(); I.catByCod = new Map();
  for (const c of S.cat) { const k = nkey(c.marca); if (!I.catByMarca.has(k)) I.catByMarca.set(k, c); if (c.codigo) I.catByCod.set(c.codigo, c); }
  I.pplCosto = new Map();
  const lista = nkey(conf('lista_costo'));
  if (S.ppl && lista !== 'CLINIC/SAN') for (const y of S.ppl) if (nkey(y.lista) === lista) I.pplCosto.set(String(y.codigo), num(y.costo));
}

// ---------- catálogo: búsqueda y precios ----------
function matchCat(prod, codigo) {
  if (codigo && I.catByCod?.get(String(codigo))) return I.catByCod.get(String(codigo));
  const k = nkey(prod); if (!k || !S.cat.length) return null;
  if (I.catByMarca.has(k)) return I.catByMarca.get(k);
  // tolerante: mismo primer término + mismos números (dosis/volumen)
  const toks = k.split(/[\s/]+/).filter(Boolean);
  const nums = (k.match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.'));
  const cands = S.cat.filter(c => { const m = nkey(c.marca); return m.startsWith(toks[0]) && nums.every(n => (m.match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.')).includes(n)); });
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) return cands.sort((a, b) => Math.abs(nkey(a.marca).length - k.length) - Math.abs(nkey(b.marca).length - k.length))[0];
  return null;
}
function costoDe(c) {
  if (!c) return null;
  if (I.pplCosto.size && c.codigo && I.pplCosto.has(c.codigo)) return I.pplCosto.get(c.codigo);
  return c.costo;
}
function precioInfo(prod, codigo) {
  const c = matchCat(prod, codigo);
  const factor = Number(conf('factor')) || 0.93;
  const pvp = c ? c.pvp : null, costo = costoDe(c);
  const precio = pvp != null ? round2(pvp * factor) : null;
  const margen = precio && costo != null ? 1 - costo / precio : null;
  return { c, pvp, costo, precio, margen, factor, gan: precio != null && costo != null ? precio - costo : null };
}
const round2 = n => Math.round(n * 100) / 100;
const clsMargen = m => m == null ? '' : m < 0 ? 'bad' : m < 0.03 ? 'warn' : 'ok';

// presentaciones habituales agrupadas por familia (primera palabra: WEGOVY, MOUNJARO…)
function familias() {
  const fam = new Map();
  const add = (k, c, n) => {
    const nombre = c ? c.marca : clean(k); const f = nkey(nombre).split(' ')[0];
    if (!fam.has(f)) fam.set(f, new Map());
    const m = fam.get(f); const key = c ? 'c:' + (c.codigo || nkey(c.marca)) : 'p:' + k;
    const prev = m.get(key); if (prev) prev.n += n; else m.set(key, { nombre, c, n });
  };
  for (const [k, n] of I.prodCount) add(k, matchCat(k), n);
  for (const cod of conf('fijas') || []) { const c = I.catByCod.get(String(cod)); if (c) add(nkey(c.marca), c, 0); }
  // todas las presentaciones del catálogo de las mismas familias (ej. todas las dosis de WEGOVY)
  const usadas = new Set(fam.keys());
  for (const c of S.cat) { const f = nkey(c.marca).split(' ')[0]; if (usadas.has(f)) add(nkey(c.marca), c, 0); }
  const out = [];
  for (const [f, m] of fam) {
    const items = [...m.values()].sort((a, b) => dosis(a.nombre) - dosis(b.nombre) || a.nombre.localeCompare(b.nombre));
    out.push({ f, items, n: items.reduce((s, x) => s + x.n, 0) });
  }
  return out.sort((a, b) => b.n - a.n);
}
const dosis = s => { const m = nkey(s).match(/(\d+(?:[.,]\d+)?)\s*MG/); return m ? parseFloat(m[1].replace(',', '.')) : 999; };
const dosisLbl = s => { const m = nkey(s).match(/(\d+(?:[.,]\d+)?)\s*MG/); return m ? m[1] + ' mg' : clean(s).split(' ').slice(1, 3).join(' '); };

// ---------- iniciales y receta (mismas reglas que el Excel) ----------
const baseIni = nombre => clean(nombre).split(' ').slice(0, 5).map(w => w[0] || '').join('').toUpperCase();
function inicialesPara(nombre) {
  const k = nkey(nombre); if (!k) return '';
  if (I.ini.has(k)) return I.ini.get(k);
  const base = baseIni(nombre);
  // cuántas personas DISTINTAS ya tienen las mismas iniciales base → se agrega el número siguiente (LC, LC2…)
  let otros = 0; const usadas = new Set();
  for (const [kk, peds] of I.byName) { if (kk === k) continue; if (baseIni(I.nombre.get(kk)) === base) otros++; const ini = I.ini.get(kk) || peds[0]?.iniciales; if (ini) usadas.add(ini.toUpperCase()); }
  let n = otros > 0 ? otros + 1 : 0;
  let ini = base + (n ? n : '');
  while (usadas.has(ini)) { n = (n || 1) + 1; ini = base + n; }
  return ini;
}
const recetaPara = (ini, fecha) => ini ? 'ARCHE-' + ini.toUpperCase() + (fecha ? '-' + MESES[Number(fecha.slice(5, 7)) - 1] : '') : '';
const proxNumero = () => S.peds.reduce((m, p) => Math.max(m, p.numero || 0), 0) + 1;

// ======================================================================
//  Shell, login y ruteo
// ======================================================================
const VIEWS = [['nuevo', 'Nuevo pedido'], ['planilla', 'Planilla'], ['resumen', 'Resumen'], ['precios', 'Precios'], ['ajustes', 'Importar / Ajustes']];
function shell(active) {
  $('#app').innerHTML = `
  <header class="top"><div class="logo">Arche Salud<small>${esc(conf('cliente'))}</small></div>
    <nav>${VIEWS.map(([k, l]) => `<a href="#${k}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="who">${DEMO ? '<span class="demo-badge" title="Los datos quedan solo en este navegador">MODO DEMO</span>' : ''}
      <a class="ext" href="../" title="Volver al cotizador">Cotizador</a>
      <span>${esc(S.user?.email || '')}</span><button id="reload" title="Traer lo último">⟳</button>${DEMO ? '' : '<button id="logout">Salir</button>'}</div></header>
  <main id="main"></main>`;
  $('#reload').onclick = async () => { await Promise.all([loadAll(), loadCatalogo()]); route(); toast('Datos actualizados'); };
  if ($('#logout')) $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  return $('#main');
}
function loginView() {
  $('#app').innerHTML = `<div class="login"><h1>Arche Salud</h1><p class="sub" style="margin-top:-8px">Mismo usuario que Comparativas</p>
    <input class="in" id="em" type="email" placeholder="Email" autocomplete="username">
    <input class="in" id="pw" type="password" placeholder="Contraseña" autocomplete="current-password">
    <button class="btn pri" id="go" style="width:100%">Ingresar</button><div id="err" class="bad small" style="margin-top:10px"></div></div>`;
  const go = async () => {
    $('#err').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) { $('#err').textContent = 'No pude ingresar: ' + error.message; return; }
    S.user = data.user; start();
  };
  $('#go').onclick = go; $('#pw').onkeydown = e => { if (e.key === 'Enter') go(); };
}
async function start() {
  $('#app').innerHTML = '<div class="login"><span class="spin"></span> Cargando…</div>';
  await Promise.all([loadAll(), loadCatalogo()]);
  window.onhashchange = route; route();
}
function route() {
  const v = (location.hash.slice(1) || 'nuevo').split('/')[0];
  $$('.overlay').forEach(o => o.remove());
  const main = shell(v);
  if (S.faltaSchema) { main.innerHTML = `<div class="card"><h2>Falta crear las tablas</h2><p>Entrá a Supabase → proyecto <b>Cotizador</b> → <b>SQL Editor</b>, pegá el contenido de <code>arche/schema.sql</code> y tocá <b>Run</b>. Después recargá esta página.</p>${S.schemaErr ? `<p class="small muted">Detalle técnico: <code>${esc(S.schemaErr)}</code></p>` : ''}</div>`; return; }
  ({ nuevo: viewNuevo, planilla: viewPlanilla, resumen: viewResumen, precios: viewPrecios, ajustes: viewAjustes }[v] || viewNuevo)(main);
}
const catAviso = () => S.catOk ? '' : `<div class="warnbox">No pude leer los costos del cotizador${S.catErr ? ' (' + esc(S.catErr) + ')' : ''}. Los pedidos se cargan igual; el precio aparece cuando vuelva a estar disponible (botón ⟳).</div>`;

// ======================================================================
//  NUEVO PEDIDO
// ======================================================================
function viewNuevo(main) {
  const st = { nombre: '', prod: null, cod: null };
  const hoy = hoyISO();
  const mesAct = hoy.slice(0, 7);
  const delMes = S.peds.filter(p => (p.fecha || '').startsWith(mesAct));
  const pend = S.peds.filter(p => !nkey(p.despachado).startsWith('SI'));
  main.innerHTML = `${catAviso()}
  <div class="np">
    <div>
      <div class="card">
        <div class="step">1 · Afiliado</div>
        <div class="rel"><input class="in xl" id="nom" placeholder="Nombre y apellido" autocomplete="off" spellcheck="false"><div class="sug hide" id="sugN"></div></div>
        <div class="hist" id="hist"></div>
        <div class="step" style="margin-top:18px">2 · Presentación</div>
        <div id="fams"></div>
        <div class="rel" style="margin-top:6px"><input class="in" id="busq" placeholder="Otra presentación: buscar en el catálogo del cotizador (marca o droga)…" style="width:100%" autocomplete="off"><div class="sug hide" id="sugP"></div></div>
        <div class="step" style="margin-top:18px">3 · Se completa solo <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— podés cambiar lo que quieras</span></div>
        <div class="auto">
          <label class="f">N° Pedido<input class="in" id="fNum" type="number"></label>
          <label class="f">Fecha<input class="in" id="fFec" type="date" value="${hoy}"></label>
          <label class="f">Iniciales<input class="in" id="fIni"></label>
          <label class="f">Receta<input class="in" id="fRec"></label>
          <label class="f">Forma de entrega<select class="in" id="fEnt"><option value="">(pendiente)</option><option>Domicilio</option><option>Retira x Arce</option></select></label>
          <label class="f">Despachado<select class="in" id="fDes">${['', 'Si', 'Si OCA', 'No'].map(x => `<option value="${x}">${x || '(pendiente)'}</option>`).join('')}</select></label>
          <label class="f">Plan<input class="in" id="fPlan"></label>
          <label class="f">AUT. RECETASOLIDARIA<input class="in" id="fAut"></label>
        </div>
        <div class="row" style="margin-top:16px"><button class="btn pri big" id="save" disabled>Guardar pedido</button><span class="muted small" id="saveMsg">Escribí el nombre y elegí la presentación.</span></div>
      </div>
    </div>
    <div>
      <div class="price" id="price"></div>
      <div class="kpis" style="margin-top:16px;grid-template-columns:1fr 1fr">
        <div class="kpi"><div class="l">Pedidos ${MES3[Number(mesAct.slice(5)) - 1]}</div><div class="v">${delMes.length}</div><div class="s">${S.peds.length} en total</div></div>
        <div class="kpi"><div class="l">Sin despachar</div><div class="v ${pend.length ? 'warn' : ''}">${pend.length}</div><div class="s"><a href="#planilla/pend">ver</a></div></div>
      </div>
      <div class="card"><h2>Últimos cargados</h2><div id="ult"></div></div>
    </div>
  </div>`;
  const F = id => $('#' + id);
  // defaults
  F('fNum').value = proxNumero(); F('fPlan').value = conf('plan'); F('fAut').value = conf('aut');
  F('fDes').value = conf('despachado'); F('fEnt').value = '';
  let iniAuto = '', recAuto = '';
  const refresh = () => {
    const nombre = clean(F('nom').value); st.nombre = nombre;
    const k = nkey(nombre); const prev = I.byName.get(k) || [];
    // iniciales / receta (solo se pisan si el usuario no las tocó)
    const ini = inicialesPara(nombre);
    if (F('fIni').value === iniAuto) F('fIni').value = ini; iniAuto = ini;
    const rec = recetaPara(F('fIni').value, F('fFec').value);
    if (F('fRec').value === recAuto) F('fRec').value = rec; recAuto = rec;
    // historial
    if (nombre && prev.length) {
      const u = prev[prev.length - 1];
      const dif = [['fEnt', u.entrega], ['fPlan', u.plan], ['fAut', u.aut]].filter(([id, v]) => v && clean(F(id).value) !== clean(v));
      F('hist').innerHTML = `<span class="pill info">ya tiene ${prev.length} pedido${prev.length > 1 ? 's' : ''}</span> Último: <b>${esc(clean(u.producto))}</b> ${u.fecha ? 'el ' + fdate(u.fecha) : ''} · ${esc(u.entrega || '')}`
        + (dif.length ? ` <button class="btn sm" id="usarUlt" title="Completa con los datos del último pedido">Usar como el último: ${dif.map(([, v]) => esc(v)).join(' · ')}</button>` : '');
      if (dif.length) $('#usarUlt').onclick = () => { for (const [id, v] of dif) F(id).value = v; refresh(); };
    } else F('hist').innerHTML = nombre ? '<span class="pill ok">afiliado nuevo</span>' : '';
    const ok = nombre && st.prod;
    F('save').disabled = !ok;
    F('saveMsg').textContent = ok ? (F('fEnt').value ? 'Enter también guarda.' : 'La forma de entrega queda pendiente; la completás después en la Planilla.') : !nombre ? 'Escribí el nombre.' : 'Elegí la presentación.';
    renderPrice();
  };
  const onPerson = () => {
    refresh();
  };
  // chips de presentaciones
  const renderFams = () => {
    const fs = familias();
    F('fams').innerHTML = fs.length ? fs.map(f => `<div class="fam"><div class="fl">${esc(f.f)}</div><div class="chips">${f.items.map(it => {
      const pi = precioInfo(it.nombre, it.c?.codigo); const on = st.prod && nkey(st.prod) === nkey(it.nombre);
      return `<button class="chip ${on ? 'on' : ''}" data-p="${esc(it.nombre)}" data-c="${esc(it.c?.codigo || '')}" title="${esc(it.nombre)}"><div class="d">${esc(dosisLbl(it.nombre))}</div><div class="p">${pi.precio != null ? money0(pi.precio) : '<span class="u">sin precio</span>'}</div>${it.n ? `<div class="u">${it.n} pedidos</div>` : ''}</button>`;
    }).join('')}</div></div>`).join('') : '<p class="muted small">Todavía no hay presentaciones habituales: buscá abajo en el catálogo.</p>';
    $$('.chip', F('fams')).forEach(b => b.onclick = () => { st.prod = b.dataset.p; st.cod = b.dataset.c || null; renderFams(); refresh(); F('save').focus(); });
  };
  const renderPrice = () => {
    const box = F('price');
    if (!st.prod) { box.innerHTML = `<div class="lbl">Precio a sacar el pedido</div><div class="big muted">—</div><p class="small muted" style="margin:8px 0 0">Elegí una presentación para ver costo, PVP y el precio (PVP × ${String(conf('factor')).replace('.', ',')}).</p>`; return; }
    const pi = precioInfo(st.prod, st.cod);
    box.innerHTML = `<div class="lbl">Precio a sacar el pedido</div>
      <div class="big">${money(pi.precio)}</div>
      <div class="small" style="margin-top:4px">${esc(st.prod)}</div>
      <dl><dt>PVP</dt><dd>${money(pi.pvp)}</dd>
      <dt>× factor</dt><dd>${String(pi.factor).replace('.', ',')} <span class="muted" style="font-weight:400">(${pct(1 - pi.factor)} dto.)</span></dd>
      <dt>Costo ${esc(conf('lista_costo'))}</dt><dd>${money(pi.costo)}</dd>
      <dt>Margen</dt><dd class="${clsMargen(pi.margen)}">${pct(pi.margen)} <span style="font-weight:400">· ${money(pi.gan)}</span></dd>
      ${pi.c ? `<dt>Código</dt><dd>${esc(pi.c.codigo)}</dd><dt>Stock</dt><dd>${pi.c.stock ?? '—'}</dd>` : ''}</dl>
      ${!pi.c ? `<p class="small warn" style="margin:10px 0 0">No encontré esta presentación en el catálogo del cotizador.</p>` : ''}`;
  };
  // autocompletar nombre
  const nombres = [...I.nombre.entries()].map(([k, n]) => ({ k, n, f: fold(n) }));
  sugBox(F('nom'), F('sugN'), q => { const f = fold(q); if (!f) return []; const ws = f.split(' ');
    return nombres.filter(x => ws.every(w => x.f.includes(w))).slice(0, 8).map(x => ({ html: `${esc(x.n)} <small>· ${I.ini.get(x.k) || ''} · ${(I.byName.get(x.k) || []).length} ped.</small>`, val: x.n })); },
    v => { F('nom').value = v; onPerson(); });
  F('nom').addEventListener('input', onPerson);
  // buscar en catálogo
  sugBox(F('busq'), F('sugP'), q => { const f = fold(q); if (f.length < 2 || !S.cat.length) return []; const ws = f.split(' ');
    return S.cat.filter(c => matchQ(c.marca + ' ' + c.monodroga + ' ' + c.codigo, q)).slice(0, 25)
      .map(c => { const pi = precioInfo(c.marca, c.codigo); return { html: `<b>${esc(c.marca)}</b> <small>· ${esc(c.monodroga)} · ${esc(c.laboratorio)} · PVP ${money(c.pvp)} → ${money(pi.precio)}</small>`, val: c.marca, c }; }); },
    (v, it) => { st.prod = v; st.cod = it.c.codigo; F('busq').value = ''; renderFams(); refresh(); });
  ['fFec', 'fIni', 'fEnt'].forEach(id => F(id).addEventListener('input', refresh));
  F('fFec').addEventListener('change', refresh); F('fEnt').addEventListener('change', refresh);
  const guardar = async () => {
    if (F('save').disabled) return;
    F('save').disabled = true;
    const pi = precioInfo(st.prod, st.cod);
    const ent = F('fEnt').value;
    const row = {
      numero: Number(F('fNum').value) || proxNumero(), fecha: F('fFec').value || null, afiliado: st.nombre,
      iniciales: clean(F('fIni').value).toUpperCase(), receta: clean(F('fRec').value), producto: pi.c ? pi.c.marca : clean(st.prod), codigo: pi.c?.codigo || null,
      despachado: F('fDes').value || null, entrega: ent || null, plan: clean(F('fPlan').value) || null, aut: clean(F('fAut').value) || null,
      costo: pi.costo, pvp: pi.pvp, precio: pi.precio, created_by: who(),
    };
    if (S.peds.some(p => p.numero === row.numero)) row.numero = proxNumero();
    try {
      const [ins] = await db.ins('ah_pedidos', [row]);
      S.peds.push(ins);
      reindex();
      toast(`Pedido N° ${row.numero} guardado · ${row.receta} · ${money(row.precio)}`, 3500);
      viewNuevo(main); $('#nom').focus();
    } catch (e) { toast('No se pudo guardar: ' + e.message, 5000); F('save').disabled = false; }
  };
  F('save').onclick = guardar;
  main.onkeydown = e => { if (e.key === 'Enter' && !e.target.closest('.rel') && e.target.id !== 'save') { e.preventDefault(); guardar(); } };
  F('nom').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.defaultPrevented && st.prod) { e.preventDefault(); guardar(); } });
  // últimos
  const ult = [...S.peds].sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0)).slice(0, 8);
  F('ult').innerHTML = ult.length ? `<table class="t"><tbody>${ult.map(p => `<tr><td class="nw muted">${p.numero ?? ''}</td><td>${esc(p.afiliado)}<div class="small muted">${esc(dosisLbl(p.producto))} · ${esc(p.entrega || '')}</div></td><td class="n ${p.precio == null ? 'muted' : ''}">${money0(p.precio ?? precioInfo(p.producto, p.codigo).precio)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Todavía no hay pedidos. Podés importar tu Excel en <a href="#ajustes">Importar / Ajustes</a>.</p>';
  renderFams(); refresh(); F('nom').focus();
}

// caja de sugerencias reutilizable
function sugBox(inp, box, fn, pick) {
  let items = [], sel = -1;
  const draw = () => { box.innerHTML = items.map((it, i) => `<div class="${i === sel ? 'on' : ''}" data-i="${i}">${it.html}</div>`).join(''); box.classList.toggle('hide', !items.length);
    $$('div', box).forEach(d => d.onmousedown = e => { e.preventDefault(); const it = items[+d.dataset.i]; close(); pick(it.val, it); }); };
  const close = () => { items = []; sel = -1; box.classList.add('hide'); };
  inp.addEventListener('input', () => { items = fn(inp.value); sel = -1; draw(); });
  inp.addEventListener('blur', () => setTimeout(close, 120));
  inp.addEventListener('keydown', e => {
    if (box.classList.contains('hide')) return;
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items.length) { const it = items[sel < 0 ? 0 : sel]; close(); pick(it.val, it); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Escape') close();
  });
}

// ======================================================================
//  PLANILLA
// ======================================================================
const PF = { mes: null, q: '', desp: '', dia: '' };   // desp: '' todos | 'pend' solo sin despachar | 'ok' ocultar sin despachar
function viewPlanilla(main) {
  if ((location.hash.split('/')[1] || '') === 'pend') { PF.desp = 'pend'; history.replaceState(null, '', '#planilla'); }
  const meses = [...new Set(S.peds.map(p => (p.fecha || '').slice(0, 7)))].sort().reverse();
  if (PF.mes == null) PF.mes = '';
  main.innerHTML = `
  <div class="row" style="margin-bottom:10px"><h1>Planilla</h1><span class="sub" id="cnt"></span><span class="spacer"></span>
    <input class="in" id="q" placeholder="Buscar afiliado, receta, producto…" value="${esc(PF.q)}" style="width:260px">
    <span class="row" style="gap:4px"><input class="in" type="date" id="dia" value="${PF.dia}" title="Ver un solo día"><button class="btn sm" id="hoy">Hoy</button>${PF.dia ? '<button class="btn sm" id="sinDia" title="Quitar el filtro de día">✕</button>' : ''}</span>
    <select class="in" id="desp">${[['', 'Todos (despachados y sin despachar)'], ['pend', 'Solo sin despachar'], ['ok', 'Ocultar sin despachar']].map(([k, l]) => `<option value="${k}" ${PF.desp === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn" id="xls">Exportar a Excel</button><a class="btn pri" href="#nuevo">＋ Nuevo pedido</a></div>
  <div class="tabsm">${[['', 'Todos'], ...meses.map(m => [m || 'none', m ? MES3[Number(m.slice(5)) - 1] + '-' + m.slice(2, 4) : 'Sin fecha'])].map(([k, l]) => `<a href="#" data-m="${k}" class="${!PF.dia && PF.mes === k ? 'on' : ''}">${l}</a>`).join('')}</div>
  <div class="tw"><table class="t"><thead><tr><th>Fecha</th><th class="n">N°</th><th>Afiliado</th><th>Receta</th><th>Producto</th><th>Despachado</th><th>Entrega</th><th>Plan</th><th>AUT.</th><th class="n">Precio a sacar</th><th class="n">Margen</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
  <p class="small muted">El precio queda guardado tal como estaba el día del pedido. Los pedidos sin precio (importados) muestran el de hoy en gris.</p>`;
  const draw = () => {
    const f = fold(PF.q);
    const rows = S.peds.filter(p => (!PF.dia || p.fecha === PF.dia) && (PF.dia || !PF.mes || (PF.mes === 'none' ? !p.fecha : (p.fecha || '').startsWith(PF.mes))) && (!PF.desp || (PF.desp === 'pend') === !nkey(p.despachado).startsWith('SI'))
      && (!f || fold([p.afiliado, p.receta, p.producto, p.numero].join(' ')).includes(f)))
      .sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0));
    $('#cnt').textContent = rows.length + ' pedidos';
    $('#tb').innerHTML = rows.map(p => {
      const vivo = p.precio == null ? precioInfo(p.producto, p.codigo) : null;
      const pr = p.precio ?? vivo?.precio; const mg = p.precio != null ? (p.costo != null && p.precio ? 1 - p.costo / p.precio : null) : vivo?.margen;
      const des = nkey(p.despachado);
      return `<tr data-id="${p.id}"><td class="nw">${fdate(p.fecha) || '<span class="muted">—</span>'}</td><td class="n">${p.numero ?? ''}</td><td class="nw"><a href="#" class="ed">${esc(p.afiliado)}</a></td><td class="nw small">${esc(p.receta)}</td><td class="small" style="min-width:250px">${esc(clean(p.producto))}</td>
        <td><select class="cell des ${des.startsWith('SI') ? 'si' : des === 'NO' ? 'no' : ''}">${['', 'Si', 'Si OCA', 'No', ...(p.despachado && !['Si', 'Si OCA', 'No'].includes(p.despachado) ? [p.despachado] : [])].map(x => `<option value="${esc(x)}" ${x === (p.despachado || '') ? 'selected' : ''}>${x || '—'}</option>`).join('')}</select></td>
        <td><select class="cell ent ${p.entrega ? '' : 'no'}">${['', 'Domicilio', 'Retira x Arce', ...(p.entrega && !['Domicilio', 'Retira x Arce'].includes(p.entrega) ? [p.entrega] : [])].map(x => `<option value="${esc(x)}" ${x === (p.entrega || '') ? 'selected' : ''}>${x || 'pendiente'}</option>`).join('')}</select></td><td class="nw small">${esc(p.plan)}</td><td class="nw small">${esc(p.aut)}</td>
        <td class="n ${p.precio == null ? 'muted' : ''}">${money(pr)}</td><td class="n ${clsMargen(mg)}">${pct(mg)}</td><td class="nw"><button class="btn sm ed">Editar</button></td></tr>`;
    }).join('') || '<tr><td colspan="12" class="muted" style="padding:20px">Sin pedidos para este filtro.</td></tr>';
    $$('#tb tr[data-id]').forEach(tr => {
      const p = S.peds.find(x => x.id === +tr.dataset.id);
      $$('.ed', tr).forEach(a => a.onclick = e => { e.preventDefault(); editarPedido(p, () => draw()); });
      $('.ent', tr).onchange = async e => { const v = e.target.value || null; try { Object.assign(p, await db.upd('ah_pedidos', p.id, { entrega: v })); toast('Guardado'); draw(); } catch (er) { toast('Error: ' + er.message); } };
      $('.des', tr).onchange = async e => { const v = e.target.value || null; try { Object.assign(p, await db.upd('ah_pedidos', p.id, { despachado: v })); toast('Guardado'); draw(); } catch (er) { toast('Error: ' + er.message); } };
    });
  };
  $('#q').oninput = e => { PF.q = e.target.value; draw(); };
  const setDia = d => { PF.dia = d; if (d) PF.mes = ''; viewPlanilla(main); };
  $('#dia').onchange = e => setDia(e.target.value);
  $('#hoy').onclick = () => setDia(hoyISO());
  if ($('#sinDia')) $('#sinDia').onclick = () => setDia('');
  $('#desp').onchange = e => { PF.desp = e.target.value; draw(); };
  $$('.tabsm a').forEach(a => a.onclick = e => { e.preventDefault(); PF.mes = a.dataset.m; PF.dia = ''; viewPlanilla(main); });
  $('#xls').onclick = exportarExcel;
  draw();
}

function editarPedido(p, done) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal"><button class="x">×</button><h2>Pedido N° ${p.numero ?? ''}</h2>
    <div class="grid2">
      <label class="f">N° Pedido<input class="in" id="eNum" type="number" value="${p.numero ?? ''}"></label>
      <label class="f">Fecha<input class="in" id="eFec" type="date" value="${p.fecha || ''}"></label>
      <label class="f">Afiliado<input class="in" id="eAfi" value="${esc(p.afiliado)}"></label>
      <label class="f">Iniciales<input class="in" id="eIni" value="${esc(p.iniciales)}"></label>
      <label class="f">Receta<input class="in" id="eRec" value="${esc(p.receta)}"></label>
      <label class="f">Producto<input class="in" id="ePro" value="${esc(clean(p.producto))}" list="dlP"></label>
      <label class="f">Despachado<input class="in" id="eDes" value="${esc(p.despachado)}" list="dlD"></label>
      <label class="f">Forma de entrega<select class="in" id="eEnt">${['', 'Domicilio', 'Retira x Arce'].map(x => `<option value="${x}" ${x === (p.entrega || '') ? 'selected' : ''}>${x || '(pendiente)'}</option>`).join('')}</select></label>
      <label class="f">Plan<input class="in" id="ePla" value="${esc(p.plan)}"></label>
      <label class="f">AUT.<input class="in" id="eAut" value="${esc(p.aut)}"></label>
      <label class="f">Precio a sacar<input class="in" id="ePre" type="number" step="0.01" value="${p.precio ?? ''}"></label>
      <label class="f">Obs.<input class="in" id="eObs" value="${esc(p.obs)}"></label>
    </div>
    <datalist id="dlP">${[...new Set(familias().flatMap(f => f.items.map(i => i.nombre)))].map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dlD"><option value="Si"><option value="Si OCA"><option value="No"></datalist>
    <div class="row" style="margin-top:14px"><button class="btn pri" id="eSave">Guardar</button><button class="btn" id="ePrecio" title="Recalcular con los costos y PVP de hoy">Actualizar precio a hoy</button><span class="spacer"></span><button class="btn danger" id="eDel">Eliminar</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  $('.x', ov).onclick = close; ov.onclick = e => { if (e.target === ov) close(); };
  let recAuto = recetaPara(p.iniciales, p.fecha);
  const upRec = () => { const r = recetaPara($('#eIni', ov).value, $('#eFec', ov).value); if (!$('#eRec', ov).value || $('#eRec', ov).value === recAuto) $('#eRec', ov).value = r; recAuto = r; };
  $('#eFec', ov).onchange = upRec; $('#eIni', ov).oninput = upRec;
  $('#ePrecio', ov).onclick = () => { const pi = precioInfo($('#ePro', ov).value); if (pi.precio == null) return toast('No encontré precio para ese producto'); $('#ePre', ov).value = pi.precio; ov._pi = pi; toast('Precio actualizado: ' + money(pi.precio)); };
  $('#eSave', ov).onclick = async () => {
    const v = id => clean($(id, ov).value) || null;
    const patch = { numero: Number($('#eNum', ov).value) || null, fecha: $('#eFec', ov).value || null, afiliado: v('#eAfi'), iniciales: (v('#eIni') || '').toUpperCase() || null, receta: v('#eRec'),
      producto: v('#ePro'), despachado: v('#eDes'), entrega: v('#eEnt'), plan: v('#ePla'), aut: v('#eAut'), precio: num($('#ePre', ov).value), obs: v('#eObs') };
    if (!patch.afiliado) return toast('Falta el afiliado');
    if (nkey(patch.producto) !== nkey(p.producto) || ov._pi) { const pi = ov._pi || precioInfo(patch.producto); patch.codigo = pi.c?.codigo || null; patch.costo = pi.costo; patch.pvp = pi.pvp; if (!ov._pi && $('#ePre', ov).value === String(p.precio ?? '')) patch.precio = pi.precio; }
    try { Object.assign(p, await db.upd('ah_pedidos', p.id, patch)); reindex(); toast('Pedido guardado'); close(); done && done(); } catch (e) { toast('Error: ' + e.message, 5000); }
  };
  $('#eDel', ov).onclick = async () => {
    if (!confirm(`¿Eliminar el pedido N° ${p.numero} de ${p.afiliado}?`)) return;
    try { await db.del('ah_pedidos', 'id', [p.id]); S.peds = S.peds.filter(x => x.id !== p.id); reindex(); toast('Pedido eliminado'); close(); done && done(); } catch (e) { toast('Error: ' + e.message, 5000); }
  };
}

// ======================================================================
//  RESUMEN (consumos por persona y por mes)
// ======================================================================
function resumenData() {
  const meses = [...new Set(S.peds.filter(p => p.fecha).map(p => p.fecha.slice(0, 7)))].sort();
  const rows = [];
  for (const [k, peds] of I.byName) {
    const r = { nombre: I.nombre.get(k), ini: I.ini.get(k) || '', total: peds.length, sin: 0, m: {}, ult: '', k };
    for (const p of peds) { if (!p.fecha) r.sin++; else { const m = p.fecha.slice(0, 7); r.m[m] = (r.m[m] || 0) + 1; if (p.fecha > r.ult) r.ult = p.fecha; } }
    rows.push(r);
  }
  return { meses, rows };
}
function viewResumen(main) {
  const { meses, rows } = resumenData();
  const st = { q: '', ord: 'nombre' };
  main.innerHTML = `<div class="row" style="margin-bottom:10px"><h1>Consumos por persona y por mes</h1><span class="sub">${rows.length} afiliados</span><span class="spacer"></span>
    <input class="in" id="q" placeholder="Buscar afiliado…" style="width:220px">
    <select class="in" id="ord"><option value="nombre">Orden: alfabético</option><option value="total">Orden: más pedidos</option><option value="ult">Orden: último pedido</option></select></div>
    <div class="tw"><table class="t"><thead><tr><th class="sticky1">Nombre</th><th>Inic.</th><th class="n">Total</th>${meses.map(m => `<th class="n">${MES3[Number(m.slice(5)) - 1]}-${m.slice(2, 4)}</th>`).join('')}<th class="n">Sin fecha</th><th>Último</th></tr></thead><tbody id="tb"></tbody>
    <tfoot id="tf"></tfoot></table></div>`;
  const draw = () => {
    const f = fold(st.q);
    const rs = rows.filter(r => !f || fold(r.nombre).includes(f)).sort(st.ord === 'total' ? (a, b) => b.total - a.total : st.ord === 'ult' ? (a, b) => b.ult.localeCompare(a.ult) : (a, b) => fold(a.nombre).localeCompare(fold(b.nombre)));
    $('#tb').innerHTML = rs.map(r => `<tr class="click" data-k="${esc(r.k)}"><td class="sticky1 nw">${esc(r.nombre)}</td><td class="small muted">${esc(r.ini)}</td><td class="n"><b>${r.total}</b></td>${meses.map(m => `<td class="n ${r.m[m] ? '' : 'zero'}">${r.m[m] || 0}</td>`).join('')}<td class="n ${r.sin ? '' : 'zero'}">${r.sin}</td><td class="nw small">${fdate(r.ult)}</td></tr>`).join('');
    const tot = m => rs.reduce((s, r) => s + (r.m[m] || 0), 0);
    $('#tf').innerHTML = `<tr><td class="sticky1"><b>Total</b></td><td></td><td class="n"><b>${rs.reduce((s, r) => s + r.total, 0)}</b></td>${meses.map(m => `<td class="n"><b>${tot(m)}</b></td>`).join('')}<td class="n"><b>${rs.reduce((s, r) => s + r.sin, 0)}</b></td><td></td></tr>`;
    $$('#tb tr').forEach(tr => tr.onclick = () => verPersona(tr.dataset.k));
  };
  $('#q').oninput = e => { st.q = e.target.value; draw(); };
  $('#ord').onchange = e => { st.ord = e.target.value; draw(); };
  draw();
}
function verPersona(k) {
  const peds = [...(I.byName.get(k) || [])].reverse();
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal"><button class="x">×</button><h2>${esc(I.nombre.get(k))} <span class="pill info">${esc(I.ini.get(k) || '')}</span></h2>
    <table class="t"><thead><tr><th>Fecha</th><th class="n">N°</th><th>Producto</th><th>Entrega</th><th>Desp.</th><th class="n">Precio</th></tr></thead><tbody>
    ${peds.map(p => `<tr><td class="nw">${fdate(p.fecha) || '—'}</td><td class="n">${p.numero ?? ''}</td><td class="small">${esc(clean(p.producto))}</td><td class="small">${esc(p.entrega)}</td><td class="small">${esc(p.despachado)}</td><td class="n">${money(p.precio)}</td></tr>`).join('')}</tbody></table>
    <div class="row" style="margin-top:12px"><a class="btn pri" href="#nuevo" id="np">＋ Nuevo pedido para esta persona</a></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  $('.x', ov).onclick = close; ov.onclick = e => { if (e.target === ov) close(); };
  $('#np', ov).onclick = () => { close(); setTimeout(() => { const n = $('#nom'); if (n) { n.value = I.nombre.get(k); n.dispatchEvent(new Event('input')); } }, 60); };
}

// ======================================================================
//  PRECIOS
// ======================================================================
function viewPrecios(main) {
  const st = { q: '' };
  main.innerHTML = `${catAviso()}<div class="row" style="margin-bottom:6px"><h1>Precios para sacar los pedidos</h1><span class="spacer"></span>
    <input class="in" id="q" placeholder="Buscar otra presentación en el catálogo…" style="width:300px"></div>
    <p class="sub" style="margin:0 0 12px">Precio a sacar = <b>PVP × ${String(conf('factor')).replace('.', ',')}</b> · Costo: lista <b>${esc(conf('lista_costo'))}</b> del cotizador (se cambia en Ajustes). Se actualiza solo cada vez que subís PRECIOS al cotizador.</p>
    <div class="tw"><table class="t"><thead><tr><th>Código</th><th>Presentación</th><th>Laboratorio</th><th class="n">Stock</th><th class="n">Costo</th><th class="n">PVP</th><th class="n">Precio a sacar</th><th class="n">Margen</th><th class="n">Ganancia</th><th class="n">Pedidos</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const f = fold(st.q);
    let list;
    if (f.length >= 2) { const ws = f.split(' '); list = S.cat.filter(c => matchQ(c.marca + ' ' + c.monodroga + ' ' + c.codigo, st.q)).slice(0, 80).map(c => ({ nombre: c.marca, c, n: I.prodCount.get(nkey(c.marca)) || 0 })); }
    else list = familias().flatMap(fm => fm.items);
    const fijas = new Set((conf('fijas') || []).map(String));
    $('#tb').innerHTML = list.map(it => { const pi = precioInfo(it.nombre, it.c?.codigo); const c = pi.c;
      return `<tr><td class="small muted">${esc(c?.codigo || '')}</td><td><b>${esc(c ? c.marca : clean(it.nombre))}</b>${c ? '' : ' <span class="pill warn">no está en el catálogo</span>'}</td><td class="small">${esc(c?.laboratorio || '')}</td><td class="n">${c?.stock ?? '—'}</td>
      <td class="n">${money(pi.costo)}</td><td class="n">${money(pi.pvp)}</td><td class="n" style="color:var(--gold);font-weight:700;font-size:14.5px">${money(pi.precio)}</td><td class="n ${clsMargen(pi.margen)}">${pct(pi.margen)}</td><td class="n">${money(pi.gan)}</td><td class="n">${it.n || ''}</td>
      <td>${c && c.codigo && !I.prodCount.has(nkey(c.marca)) ? `<button class="btn sm fij" data-c="${esc(c.codigo)}">${fijas.has(c.codigo) ? 'Quitar de habituales' : '＋ Habitual'}</button>` : ''}</td></tr>`; }).join('')
      || `<tr><td colspan="11" class="muted" style="padding:20px">${S.catOk ? 'Sin resultados.' : 'Sin catálogo.'}</td></tr>`;
    $$('.fij').forEach(b => b.onclick = async () => { const s = new Set((conf('fijas') || []).map(String)); s.has(b.dataset.c) ? s.delete(b.dataset.c) : s.add(b.dataset.c); await setConf('fijas', [...s]); draw(); toast('Listo: aparece como botón en Nuevo pedido'); });
  };
  $('#q').oninput = e => { st.q = e.target.value; draw(); };
  draw();
}
async function setConf(k, v) { await db.ups('ah_config', [{ clave: k, valor: v }], ['clave']); S.cfg[k] = v; }

// ======================================================================
//  IMPORTAR / AJUSTES / EXPORTAR
// ======================================================================
function viewAjustes(main) {
  const listas = S.ppl ? [...new Set(S.ppl.map(y => clean(y.lista)))].sort() : null;
  main.innerHTML = `<h1>Importar / Ajustes</h1><p class="sub" style="margin-bottom:14px">${DEMO ? 'Modo demo: los datos quedan solo en este navegador.' : 'Los cambios se guardan para todo el equipo.'}</p>
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
    <div class="card"><h2>Precio a sacar el pedido</h2>
      <div class="grid2">
        <label class="f">Factor sobre PVP<input class="in" id="cFac" type="number" step="0.001" value="${conf('factor')}"></label>
        <label class="f">Costo de la lista<select class="in" id="cLis">${(listas || [conf('lista_costo')]).concat(listas && !listas.map(nkey).includes('CLINIC/SAN') ? ['CLINIC/SAN'] : []).map(l => `<option ${nkey(l) === nkey(conf('lista_costo')) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      </div>
      ${listas ? '' : '<p class="small muted">Para elegir otra lista de costo: <a href="#" id="ldL">cargar las listas del cotizador</a>.</p>'}
      <p class="small muted">PVP × ${conf('factor')} = ${pct(1 - conf('factor'))} de descuento sobre PVP.</p></div>
    <div class="card"><h2>Valores por defecto del pedido</h2>
      <div class="grid2">
        <label class="f">Cliente (encabezado)<input class="in" id="cCli" value="${esc(conf('cliente'))}"></label>
        <label class="f">Plan<input class="in" id="cPla" value="${esc(conf('plan'))}"></label>
        <label class="f">AUT. RECETASOLIDARIA<input class="in" id="cAut" value="${esc(conf('aut'))}"></label>
        <label class="f">Despachado<select class="in" id="cDes">${['', 'Si', 'Si OCA', 'No'].map(x => `<option value="${x}" ${x === conf('despachado') ? 'selected' : ''}>${x || '(pendiente)'}</option>`).join('')}</select></label>
      </div>
      <p class="small muted">La forma de entrega se elige en cada pedido. Si el afiliado ya tiene pedidos, se ofrece un botón para usar los datos del último, sin aplicarlos solos.</p></div>
  </div>
  <div class="row" style="margin-bottom:16px"><button class="btn pri" id="cSave">Guardar ajustes</button></div>
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
    <div class="card"><h2>Importar el Excel de seguimiento</h2>
      <p class="small">Arrastrá <b>Acumulado_Arche_Salud.xlsx</b>. Se cargan los pedidos de la hoja <b>Planilla</b>. Los N° de pedido que ya estén cargados se saltean, así que se puede volver a correr sin duplicar.</p>
      <div class="drop" id="drop">Soltá el Excel acá o hacé click para elegirlo<input type="file" id="file" accept=".xlsx,.xlsm,.xls" class="hide"></div>
      <div id="imp" style="margin-top:10px"></div></div>
    <div class="card"><h2>Exportar</h2><p class="small">Baja un Excel con la Planilla (mismas columnas que el tuyo + precio) y el Resumen por persona y mes.</p>
      <button class="btn" id="xls">Exportar a Excel</button>
      <h2 style="margin-top:18px">Catálogo del cotizador</h2>
      <p class="small">${S.catOk ? `✔ ${S.cat.length.toLocaleString('es-AR')} productos leídos de la Base de marcas del cotizador.` : '<span class="bad">No disponible</span> ' + esc(S.catErr)}</p></div>
  </div>`;
  if ($('#ldL')) $('#ldL').onclick = async e => { e.preventDefault(); e.target.textContent = 'cargando…'; await loadPPL(); viewAjustes(main); };
  $('#cSave').onclick = async () => {
    const fac = Number($('#cFac').value);
    if (!(fac > 0 && fac <= 2)) return toast('El factor tiene que ser un número como 0.93');
    const nuevo = { factor: fac, lista_costo: $('#cLis').value, cliente: clean($('#cCli').value), plan: clean($('#cPla').value), aut: clean($('#cAut').value), despachado: $('#cDes').value };
    try { await db.ups('ah_config', Object.entries(nuevo).map(([clave, valor]) => ({ clave, valor })), ['clave']); Object.assign(S.cfg, nuevo);
      if (nkey(nuevo.lista_costo) !== 'CLINIC/SAN') await loadPPL(); reindexCat(); toast('Ajustes guardados'); route(); } catch (e) { toast('Error: ' + e.message, 5000); }
  };
  $('#xls').onclick = exportarExcel;
  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); }; drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); if (e.dataTransfer.files[0]) importar(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && importar(file.files[0]);
}

function leerExcel(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const shName = wb.SheetNames.find(n => nkey(n) === 'PLANILLA') || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[shName], { header: 1, raw: true, defval: null });
  const hi = aoa.findIndex(r => r && r.some(c => nkey(c) === 'AFILIADO'));
  if (hi < 0) throw new Error('No encontré la fila de títulos (Fecha, N° Pedido, Afiliado…) en la hoja ' + shName);
  const H = aoa[hi].map(nkey);
  const col = (...names) => H.findIndex(h => names.some(n => h === n || h.startsWith(n)));
  const C = { fecha: col('FECHA'), numero: col('N° PEDIDO', 'NRO', 'N°'), afiliado: col('AFILIADO'), receta: col('RECETA'), producto: col('PRODUCTO'), despachado: col('DESPACHADO'), entrega: col('FORMA DE ENTREGA', 'ENTREGA'), plan: col('PLAN'), aut: col('AUT'), direccion: col('DIRECCI'), horario: col('HORARIO'), iniciales: col('INICIALES') };
  const toISO = v => { if (!v) return null; if (v instanceof Date) { const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); } if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; } const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
  const g = (r, k) => C[k] >= 0 ? r[C[k]] : null;
  const peds = [];
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue; const af = clean(g(r, 'afiliado')); if (!af) continue;
    peds.push({ numero: Number(g(r, 'numero')) || null, fecha: toISO(g(r, 'fecha')), afiliado: af, receta: clean(g(r, 'receta')) || null, producto: clean(g(r, 'producto')) || null,
      despachado: clean(g(r, 'despachado')) || null, entrega: clean(g(r, 'entrega')) || null, plan: clean(g(r, 'plan')) || null, aut: clean(g(r, 'aut')) || null,
      iniciales: clean(g(r, 'iniciales')).toUpperCase() || null });
  }
  return { peds, hoja: shName };
}
async function importar(f) {
  const out = $('#imp');
  out.innerHTML = '<span class="spin"></span> Leyendo…';
  try {
    const { peds, hoja } = leerExcel(await f.arrayBuffer());
    const ya = new Set(S.peds.map(p => p.numero).filter(Boolean));
    const nuevos = peds.filter(p => !p.numero || !ya.has(p.numero));
    // iniciales faltantes: se calculan en orden, con la misma regla del Excel
    const tmp = S.peds.slice();
    for (const p of nuevos) {
      if (!p.iniciales) {
        S.peds = tmp; reindex();
        p.iniciales = inicialesPara(p.afiliado);
      }
      tmp.push(p);
    }
    S.peds = tmp.filter(p => p.id); reindex();
    const sinNum = nuevos.filter(p => !p.numero).length;
    out.innerHTML = `Hoja <b>${esc(hoja)}</b>: ${peds.length} pedidos leídos · <b>${nuevos.length}</b> nuevos${peds.length - nuevos.length ? ` · ${peds.length - nuevos.length} ya estaban` : ''}${sinNum ? ` · ${sinNum} sin N° (se numeran)` : ''}.
      <div class="row" style="margin-top:8px"><button class="btn pri" id="go" ${nuevos.length ? '' : 'disabled'}>Importar</button></div>`;
    $('#go').onclick = async () => {
      $('#go').disabled = true; out.insertAdjacentHTML('beforeend', '<div id="st" class="small" style="margin-top:6px"><span class="spin"></span> Guardando…</div>');
      try {
        let n = S.peds.reduce((m, p) => Math.max(m, p.numero || 0), 0);
        for (const p of nuevos) if (!p.numero) p.numero = ++n;
        const precioDe = p => { const c = matchCat(p.producto); return c ? { codigo: c.codigo || null } : {}; };
        if (nuevos.length) await db.ins('ah_pedidos', nuevos.map(p => ({ ...p, ...precioDe(p), created_by: who() })));
        await loadAll();
        $('#st').innerHTML = '<span class="ok">Listo ✔</span>'; toast('Importación terminada'); setTimeout(() => location.hash = '#planilla', 800);
      } catch (e) { $('#st').innerHTML = `<span class="bad">Error: ${esc(e.message)}</span>`; }
    };
  } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
}

function exportarExcel() {
  const wb = XLSX.utils.book_new();
  const ord = [...S.peds].sort((a, b) => (a.numero ?? 1e9) - (b.numero ?? 1e9));
  const cli = conf('cliente').split('·').map(clean);
  const pl = [[null, 'Acumulado Arche Salud', null, null, null, 'Sacar a', cli[0] || '', cli[1] || ''], [],
    ['Fecha', 'N° Pedido', 'Afiliado', 'Receta', 'Producto', 'Despachado', 'Forma de entrega', 'Plan', 'AUT. RECETASOLIDARIA', 'Iniciales', 'Código', 'PVP', 'Precio a sacar', 'Costo'],
    ...ord.map(p => [p.fecha ? new Date(p.fecha + 'T12:00:00') : null, p.numero, p.afiliado, p.receta, clean(p.producto), p.despachado, p.entrega, p.plan, p.aut, p.iniciales, p.codigo, p.pvp, p.precio, p.costo])];
  const ws = XLSX.utils.aoa_to_sheet(pl, { cellDates: true });
  ws['!cols'] = [12, 9, 28, 22, 42, 11, 15, 11, 18, 9, 10, 12, 13, 12].map(w => ({ wch: w }));
  for (let r = 3; r < pl.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c && c.t === 'd') c.z = 'dd/mm/yyyy'; for (const k of [11, 12, 13]) { const x = ws[XLSX.utils.encode_cell({ r, c: k })]; if (x) x.z = '#,##0.00'; } }
  XLSX.utils.book_append_sheet(wb, ws, 'Planilla');
  const { meses, rows } = resumenData();
  const rs = [['Consumos por persona y por mes'], [], ['Nombre', 'Iniciales', 'Total', ...meses.map(m => MES3[Number(m.slice(5)) - 1] + '-' + m.slice(2, 4)), 'Sin fecha'],
    ...rows.sort((a, b) => fold(a.nombre).localeCompare(fold(b.nombre))).map(r => [r.nombre, r.ini, r.total, ...meses.map(m => r.m[m] || 0), r.sin])];
  const w2 = XLSX.utils.aoa_to_sheet(rs); w2['!cols'] = [{ wch: 30 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, w2, 'Resumen');
  XLSX.writeFile(wb, `Acumulado_Arche_Salud_${hoyISO()}.xlsx`);
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
