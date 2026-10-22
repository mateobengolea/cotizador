/* Parsers y cálculos puros (sin DOM). Funcionan en navegador (window.P) y en Node (module.exports). */
(function (root) {
  const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

  // ---------- utilidades ----------
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!s || /^[#-]/.test(s) && !/^-\d/.test(s)) return null;
    if (/^-?[\d.]+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');      // 1.234,56
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');             // 1.234.567
    else if (/^-?[\d,]+\.\d+$/.test(s)) s = s.replace(/,/g, '');                   // 1,234.56
    else s = s.replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  const txt = v => (v === null || v === undefined) ? '' : String(v).trim();
  const codigo = v => { const n = num(v); return (n !== null && Number.isInteger(n)) ? String(n) : txt(v); };
  function fechaDe(s) {               // "30/09/2026 - 10:00hs" | Date | serial excel
    if (!s) return null;
    if (s instanceof Date) return s.toISOString().slice(0, 10);
    if (typeof s === 'number' && s > 20000 && s < 80000) { const d = new Date(Math.round((s - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    const m = String(s).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  const procesoKey = s => { const m = String(s || '').match(/(\d{5,7})/); return m ? m[1] : norm(s); };
  const rows = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });

  // ---------- cálculos de negocio ----------
  // Costo META = PSL × (1 − dcto acordado s/PSL) si hay dcto, si no COSTO de lista.
  function costoMeta(it, base) {
    const b = base || it;
    const d = num(it.dcto_psl);
    if (d && b.psl) return b.psl * (1 - d / 100);
    return num(b.costo);
  }
  const margenDe = (costo, precio) => (costo != null && precio) ? 1 - costo / precio : null;
  const precioDe = (costo, margen) => (costo != null && margen != null && margen < 1) ? Math.round(costo / (1 - margen)) : null;

  // ---------- Excel acumulado ----------
  // Columnas de las hojas mensuales (fila 1 = encabezado)
  const C = { r: 0, cant: 1, lista: 2, cod: 3, det: 4, mono: 5, lab: 6, pvp: 7, psl: 8, dtocpa: 9, costo: 10, stock: 11, obs: 12, plazo: 13,
    dpvp: 14, dpsl: 15, margen: 19, punit: 20, pventa: 21, proceso: 23, apertura: 24, oc: 25, cond: 26, mant: 27, vto: 28 };

  function itemDeFila(r, C2) {
    const c = C2 || C;
    const pv = num(r[c.pventa]) ?? (num(r[c.punit]) != null ? Math.round(num(r[c.punit])) : null);
    return {
      renglon: num(r[c.r]), cantidad: num(r[c.cant]), lista: txt(r[c.lista]), codigo: codigo(r[c.cod]), detalle: txt(r[c.det]),
      monodroga: txt(r[c.mono]), laboratorio: txt(r[c.lab]), pvp: num(r[c.pvp]), psl: num(r[c.psl]), dtocpa: num(r[c.dtocpa]),
      costo: num(r[c.costo]), stock: txt(r[c.stock]), obs: txt(r[c.obs]), plazo: num(r[c.plazo]),
      dcto_pvp: num(r[c.dpvp]), dcto_psl: num(r[c.dpsl]), margen: num(r[c.margen]), precio_unit: pv,
    };
  }

  function parseAcumulado(XLSX, wb) {
    const cots = new Map();           // proceso -> {cot, items[]}
    const ocs = [];                   // {oc, items[]}
    const avisos = [];
    for (const name of wb.SheetNames) {
      const N = norm(name);
      const ws = wb.Sheets[name];
      if (MESES.includes(N)) {
        const R = rows(XLSX, ws);
        let orden = 0;
        for (const r of R.slice(1)) {
          if (!r || r[C.cod] == null || r[C.cod] === '' || norm(r[C.r]) === 'R') continue;
          const proc = txt(r[C.proceso]);
          if (!proc || norm(proc) === 'PROCESO') continue;
          const key = norm(proc);
          if (!cots.has(key)) cots.set(key, { cot: { proceso: proc, apertura: txt(r[C.apertura]), fecha: fechaDe(r[C.apertura]), hoja: name.trim(),
            oc: txt(r[C.oc]) || null, condicion: txt(r[C.cond]) || null, mant_oferta: txt(r[C.mant]) || null, vto_oferta: fechaDe(r[C.vto]), estado: 'presentada' }, items: [] });
          const g = cots.get(key);
          if (!g.cot.oc && txt(r[C.oc])) g.cot.oc = txt(r[C.oc]);
          const it = itemDeFila(r); it.orden = ++orden;
          g.items.push(it);
        }
      } else if (/^OC\s*\d+/.test(N)) {
        const R = rows(XLSX, ws);
        const its = [];
        for (const r of R.slice(1)) {
          if (!r || r[C.cod] == null || r[C.cod] === '' || norm(r[C.r]) === 'R') continue;
          its.push(itemDeFila(r));
        }
        ocs.push({ oc: N.replace(/^OC\s*/, ''), items: its });
      }
    }
    // Hoja COMPARATIVAS (histórico de resultados)
    const hist = [];
    const wsC = wb.Sheets[wb.SheetNames.find(n => norm(n) === 'COMPARATIVAS')];
    if (wsC) {
      const R = rows(XLSX, wsC);
      const drogs = new Set(R.slice(1).map(r => r && norm(r[28])).filter(x => x && x !== '0' && x !== 'META'));
      const H = { proceso: 0, apertura: 1, r: 2, cant: 3, lista: 4, cod: 5, det: 6, mono: 7, lab: 8, pvp: 9, psl: 10, dtocpa: 11, costo: 12, stock: 13, obs: 14, plazo: 15,
        dpvp: 16, dpsl: 17, margen: 21, punit: 22, pventa: 23, ptotal: 24, d1: 25, l1: 26, p1: 27, gan: 28, d2: 29, l2: 30, p2: 31, d3: 32, l3: 33, p3: 34, pos: 35 };
      for (const r of R.slice(1)) {
        if (!r || !txt(r[H.proceso]) || r[H.cod] == null) continue;
        const it = itemDeFila(r, { ...H, cant: H.cant });
        const ofertas = [];
        const ganKey = norm(r[H.d1]);       // GANADOR (ganó otro) | META (ganamos)
        const gan = txt(r[H.gan]);
        const nuestroTotal = num(r[H.ptotal]);
        if (nuestroTotal) ofertas.push({ proveedor: 'Meta', estado: 'Cotizó', precio_total: nuestroTotal, marca: it.laboratorio, es_propio: true, adjudicado: ganKey === 'META' });
        if (ganKey === 'GANADOR' && num(r[H.p1])) {
          const l1 = txt(r[H.l1]) === '0' ? '' : txt(r[H.l1]);
          let prov = gan && !/^meta$/i.test(gan) && gan !== '0' ? gan : '';
          let marca = l1;
          if (!prov && drogs.has(norm(l1))) { prov = l1; marca = ''; }
          ofertas.push({ proveedor: prov || 'Sin dato', estado: 'Cotizó', precio_total: num(r[H.p1]), marca, es_propio: false, adjudicado: true });
        }
        for (const [d, l, p] of [[H.d2, H.l2, H.p2], [H.d3, H.l3, H.p3]]) {
          const pr = num(r[p]);
          if (pr && txt(r[d]) && !/META|GANADOR/.test(norm(r[d]))) ofertas.push({ proveedor: txt(r[d]), estado: 'Cotizó', precio_total: pr, marca: txt(r[l]), es_propio: false, adjudicado: false });
        }
        hist.push({ proceso: txt(r[H.proceso]), apertura: txt(r[H.apertura]), fecha: fechaDe(r[H.apertura]), item: it, posicion: num(r[H.pos]), ofertas });
      }
    }
    // marcar adjudicados según hojas OC (código + renglón + precio)
    const todos = [...cots.values()].flatMap(g => g.items.map(it => ({ it, g })));
    let ocOk = 0, ocNo = 0;
    for (const o of ocs) for (const x of o.items) {
      const cands = todos.filter(t => t.it.codigo === x.codigo && t.it.renglon === x.renglon && (!x.precio_unit || Math.abs((t.it.precio_unit || 0) - x.precio_unit) <= 1));
      cands.sort((a, b) => String(b.g.cot.fecha).localeCompare(String(a.g.cot.fecha)));
      if (cands[0]) { const it = cands[0].it; it.adjudicado = true; const prev = String(it.oc || '').split(/[\s,\/;]+/).filter(Boolean); if (!prev.includes(o.oc)) prev.push(o.oc); it.oc = prev.join(', '); cands[0].g.cot.oc = cands[0].g.cot.oc || o.oc; x._it = it; o.proceso = o.proceso || cands[0].g.cot.proceso; ocOk++; } else ocNo++;
    }
    if (ocNo) avisos.push(`${ocNo} renglones de hojas OC no se pudieron asociar a una cotización (se ignoran).`);
    return { cotizaciones: [...cots.values()], ocs, hist, avisos, ocOk };
  }

  // ---------- Archivo de costos (detección flexible de columnas) ----------
  const ALIAS = {
    codigo: ['CODIGO', 'COD', 'COD.', 'CODIGO PRODUCTO'],
    lista: ['LISTA', 'LISTAPRE', 'LISTA PRECIO', 'LISTA DE PRECIOS'],
    detalle: ['DETALLE', 'DESCRIPCION', 'PRODUCTO', 'MARCA'],
    monodroga: ['MONODROGA', 'DROGA'],
    laboratorio: ['LABORATORIO', 'LABORATORI', 'LAB'],
    pvp: ['PVP'],
    psl: ['PSL'],
    dtocpa: ['DTOCPA', 'DTO CPA', 'DESCUENTO', 'DTO'],
    costo: ['COSTO', 'COSTO META', 'COSTO FINAL'],
  };
  function detectarColumnas(R) {
    for (let i = 0; i < Math.min(R.length, 30); i++) {
      const h = (R[i] || []).map(norm);
      if (!h.includes('CODIGO') && !h.includes('COD')) continue;
      const map = {};
      for (const [k, al] of Object.entries(ALIAS)) {
        for (const a of al) { const j = h.indexOf(a); if (j >= 0 && !Object.values(map).includes(j)) { map[k] = j; break; } }
      }
      if (map.codigo != null && (map.costo != null || map.psl != null)) return { fila: i, map, headers: R[i] };
    }
    return null;
  }
  function parseCostos(XLSX, wb, listaPorDefecto) {
    const out = []; const listas = new Set(); let hoja = null, det = null, best = null;
    for (const name of wb.SheetNames) {           // la hoja con más filas útiles
      const R = rows(XLSX, wb.Sheets[name]);
      const d = detectarColumnas(R);
      const bonus = /PRECIO|LISTA|VLOOKUP|COSTO/i.test(name) || (d && d.headers.map(norm).includes('LISTAPRE')) ? 1e6 : 0;
      if (d && (!best || R.length - d.fila + bonus > best.n)) best = { name, R, d, n: R.length - d.fila + bonus };
    }
    if (best) {
      const { R, d } = best; hoja = best.name; det = d;
      for (const r of R.slice(d.fila + 1)) {
        if (!r) continue;
        const cod = codigo(r[d.map.codigo]);
        if (!cod) continue;
        const g = k => d.map[k] != null ? r[d.map[k]] : null;
        const lista = txt(g('lista')) || listaPorDefecto || '';
        listas.add(lista);
        out.push({ codigo: cod, lista, detalle: txt(g('detalle')), monodroga: txt(g('monodroga')), laboratorio: txt(g('laboratorio')),
          pvp: num(g('pvp')), psl: num(g('psl')), dtocpa: num(g('dtocpa')), costo: num(g('costo')) });
      }
    }
    // sin duplicados codigo+lista (gana la última)
    const m = new Map(); for (const c of out) m.set(c.codigo + '|' + c.lista, c);
    return { filas: [...m.values()], listas: [...listas], hoja, columnas: det && Object.fromEntries(Object.entries(det.map).map(([k, j]) => [k, det.headers[j]])) };
  }

  // ---------- Acta comparativa (xlsx generado desde el PDF: hoja "Detalle") ----------
  function parseActa(XLSX, wb) {
    const name = wb.SheetNames.find(n => norm(n) === 'DETALLE');
    if (!name) throw new Error('El archivo no tiene la hoja "Detalle". Usá el Excel de acta generado a partir del PDF.');
    const R = rows(XLSX, wb.Sheets[name]);
    const h = R[0].map(norm);
    const ix = k => h.findIndex(x => x.startsWith(k));
    const I = { it: ix('ITEM'), desc: ix('DESCRIPCION'), cr: ix('C.R'), prov: ix('PROVEEDOR'), grupo: ix('GRUPO'), est: ix('ESTADO'), pt: ix('PRECIO TOTAL'), marca: ix('MARCA') };
    const ren = new Map();
    for (const r of R.slice(1)) {
      if (!r || r[I.it] == null) continue;
      const k = num(r[I.it]);
      if (!ren.has(k)) ren.set(k, { renglon: k, descripcion: txt(r[I.desc]), cantidad: num(r[I.cr]), ofertas: [] });
      ren.get(k).ofertas.push({ proveedor: txt(r[I.prov]), grupo: txt(r[I.grupo]), estado: txt(r[I.est]), precio_total: num(r[I.pt]), marca: txt(r[I.marca]) });
    }
    let titulo = '';
    const wsT = wb.Sheets[wb.SheetNames.find(n => norm(n) === 'COMPARATIVA') || wb.SheetNames[0]];
    if (wsT && wsT.A1) titulo = txt(wsT.A1.v);
    const m = titulo.match(/EXPTE\.?\s*(\d{5,7})/i);
    return { titulo, proceso: m ? 'EXPTE ' + m[1] : '', renglones: [...ren.values()] };
  }

  // ---------- Acta comparativa directo desde el PDF (pdf.js) ----------
  // Lee la grilla por posición: encabezados de proveedores = columnas, número de ítem = filas
  // (las celdas están alineadas abajo, así que cada fila va desde su número hasta el de arriba).
  function celdaActa(s) {
    s = s.replace(/\s+/g, ' ').trim();
    let m = s.match(/^\$?\s*([\d.]+(?:,\d+)?)\s*\((.*)\)\s*$/);
    if (m) return { estado: 'Cotizó', precio_total: num(m[1]), marca: m[2].trim() };
    m = s.match(/^(.*?)\s*\((.*)\)\s*$/);
    let st = m ? m[1] : s, br = m ? m[2] : '';
    st = /^NC$/i.test(st) ? 'No cotiza' : /^DESESTIM/i.test(st) ? st.toLowerCase().replace(/(^|\s|\/)(\S)/g, (a, b, c) => b + c.toUpperCase()) : st;
    return { estado: st || 'Sin dato', precio_total: null, marca: br.trim() };
  }
  async function parseActaPDF(pdfjs, data) {
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    const ren = new Map(); let titulo = '';
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const pg = await doc.getPage(pn);
      const items = (await pg.getTextContent()).items.filter(i => i.str && i.str.trim())
        .map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) || 2, cx: i.transform[4] + i.width / 2 }));
      if (!items.length) continue;
      // todas las tolerancias van en proporción al tamaño de letra (las actas vienen en distintas escalas)
      const hs = items.map(i => i.h).sort((p, q) => p - q); const H = hs[Math.floor(hs.length / 2)] || 2; const LG = H * 1.3;
      if (!titulo) { const t = items.find(i => /EXPTE|Cotizaci[oó]n/i.test(i.s) && /\d{5,}/.test(i.s)); if (t) titulo = t.s.replace(/^.*?(Cotizaci)/i, 'Pedido de $1'); }
      const hCR = items.find(i => /^C\.?R\.?$/i.test(i.s)); const hDesc = items.find(i => /^DESCRIPCI[OÓ]N$/i.test(i.s));
      const hItem = items.find(i => /^ITEM/i.test(i.s));
      if (!hCR) continue;
      const Yh = hCR.y;                                    // línea base de los encabezados
      const hdr = items.filter(i => i.x > hCR.x + hCR.w && i.y >= Yh - 0.5 * LG && i.y <= Yh + 2.6 * LG && !/COMPRE|NEUQUINO|ACTA COMPARATIVA|EXPEDIENTE|AFILIADO/i.test(i.s) && !/^\$|^\d+$|^\(|^NC$/.test(i.s)).sort((p, q) => p.cx - q.cx);
      const cols = [];
      for (const h of hdr) {
        const c = cols.find(c => h.x < c.x1 && h.x + h.w > c.x0);
        if (c) { c.parts.push(h); c.x0 = Math.min(c.x0, h.x); c.x1 = Math.max(c.x1, h.x + h.w); } else cols.push({ x0: h.x, x1: h.x + h.w, parts: [h] });
      }
      if (!cols.length) continue;
      cols.forEach(c => { c.name = c.parts.sort((p, q) => q.y - p.y || p.x - q.x).map(p => p.s).join(' '); c.cx = (c.x0 + c.x1) / 2; });
      cols.sort((p, q) => p.cx - q.cx);
      const gSin = items.find(i => /^SIN COMPRE/i.test(i.s)), gCon = items.find(i => /^CON COMPRE/i.test(i.s));
      let kCon = 0;
      if (gSin && gCon && cols.length > 1) {
        let best = Infinity; const avg = a => a.reduce((s, c) => s + c.cx, 0) / a.length;
        for (let k = 1; k < cols.length; k++) { const e = Math.abs(avg(cols.slice(0, -k)) - gSin.cx) + Math.abs(avg(cols.slice(-k)) - gCon.cx); if (e < best) { best = e; kCon = k; } }
      }
      cols.forEach((c, i) => { c.grupo = gCon ? (i >= cols.length - kCon ? 'Con compre neuquino' : 'Sin compre neuquino') : ''; });
      const lim = [(hCR.cx + cols[0].cx) / 2];
      for (let i = 1; i < cols.length; i++) lim.push((cols[i - 1].cx + cols[i].cx) / 2);
      lim.push(Infinity);
      const colDe = cx => { for (let i = 0; i < cols.length; i++) if (cx >= lim[i] && cx < lim[i + 1]) return i; return -1; };
      const xDescFin = hDesc ? (hDesc.cx + hCR.cx) / 2 : hCR.x - 2;
      const xNumFin = hDesc ? hDesc.x - H * 0.3 : (hItem ? hItem.x + hItem.w + 4 * H : hCR.x - 1);
      const yTop = Yh - 0.5 * LG;
      const nums = items.filter(i => /^\d+$/.test(i.s) && i.y < yTop && i.x < xNumFin).sort((p, q) => q.y - p.y);
      for (let k = 0; k < nums.length; k++) {
        const yb = nums[k].y - 0.6 * LG, yt = k ? nums[k - 1].y - 0.6 * LG : yTop;
        const enFila = items.filter(i => i.y >= yb && i.y < yt).sort((p, q) => q.y - p.y || p.x - q.x);
        const desc = enFila.filter(i => i !== nums[k] && i.cx > nums[k].x + nums[k].w && i.cx < xDescFin).map(i => i.s).join(' ');
        const cr = enFila.find(i => i.cx >= xDescFin && i.cx < lim[0] && /^[\d.]+$/.test(i.s));
        const celdas = cols.map(() => []);
        for (const i of enFila) { if (i.cx < lim[0]) continue; const c = colDe(i.cx); if (c >= 0) celdas[c].push(i.s); }
        const r = +nums[k].s;
        if (!desc && !cr) continue;
        ren.set(r, { renglon: r, descripcion: desc, cantidad: cr ? num(cr.s) : null,
          ofertas: cols.map((c, i) => ({ proveedor: c.name, grupo: c.grupo, ...celdaActa(celdas[i].join(' ')) })) });
      }
    }
    if (!ren.size) throw new Error('No reconocí la grilla del acta en el PDF (¿es un PDF escaneado?).');
    const m = titulo.match(/EXPTE\.?\s*(\d{5,7})/i) || titulo.match(/\bE\s?(\d{6})\b/);
    return { titulo, proceso: m ? 'EXPTE ' + m[1] : '', renglones: [...ren.values()].sort((a, b) => a.renglon - b.renglon) };
  }

  // ---------- Pedido de cotización, formato nuevo "Reporte de cotización" (Bionexo) ----------
  async function parsePedidoReporte(pdfjs, doc) {
    const rows = []; const cab = { titulo: '', vencimiento: '', terminos: '', pago: '', observaciones: '', contacto: '' };
    let pend = null;   // renglón cuyo bloque quedó cortado al final de una página
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const pg = await doc.getPage(pn);
      const items = (await pg.getTextContent()).items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || 9 }));
      const H = (items.map(i => i.h).sort((a, b) => a - b)[Math.floor(items.length / 2)]) || 9;
      const lab = re => items.find(i => re.test(i.s));
      const valorDe = (re) => { const l = lab(re); if (!l) return ''; const dosp = items.find(i => i.s === ':' && Math.abs(i.y - l.y) < 1 && i.x > l.x && i.x < l.x + l.w + 8); const x0 = (dosp || l).x + (dosp || l).w; return items.filter(i => Math.abs(i.y - l.y) < 1 && i.x > x0 - 0.5 && i.x < x0 + 420 && i !== dosp).sort((a, b) => a.x - b.x).map(i => i.s).join(' ').split(/\s+\|\s+/)[0].trim(); };
      const bloqueBajo = (re, x1) => { const l = lab(re); if (!l) return ''; return items.filter(i => i.y < l.y - 1 && i.y > l.y - 6 * H && i.x >= l.x && i.x < (x1 || l.x + 280)).sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ').trim(); };
      if (pn === 1) {
        cab.titulo = valorDe(/^T[íi]tulo$/i);
        cab.idPedido = valorDe(/^ID$/);
        cab.contacto = valorDe(/^Contacto$/i).replace(/\s*\(\)\s*$/, '');
        const v = lab(/^Vencimiento$/i); if (v) { const vv = items.find(i => i.y < v.y - 1 && i.y > v.y - 2.2 * H && Math.abs(i.x - v.x) < 3); cab.vencimiento = vv ? vv.s : ''; }
        const tc = lab(/^T[ée]rminos y condiciones$/i), ob = lab(/^Observaciones$/i);
        cab.terminos = tc ? bloqueBajo(/^T[ée]rminos y condiciones$/i, 600) : '';
        cab.observaciones = ob ? bloqueBajo(/^Observaciones$/i, tc ? tc.x - 5 : ob.x + 290) : '';
        const fp = lab(/^Formas? de pago$/i); if (fp) cab.pago = valorDe(/^Formas? de pago$/i);
      }
      const hdrArt = items.filter(i => /^Art[íi]culo$/i.test(i.s)).sort((a, b) => b.y - a.y);
      const xM = (lab(/^Marca Solicitada$/i) || {}).x, xC = (lab(/^Cant\.? solicitada$/i) || {}).x, xE = (lab(/^Embalaje$/i) || {}).x;
      // texto antes del primer "Artículo" de la página: continuación del renglón pendiente
      if (pend && hdrArt.length >= 0) {
        const tope = hdrArt.length ? hdrArt[0].y + 1.5 * H : -1e9;
        const cont = items.filter(i => i.y > tope && i.y < 790 && i.x >= 35 && i.x < 560 && !/^\d{11}$/.test(i.s) && !/Reporte de cotizaci|Fecha del reporte|Drogueria Meta/i.test(i.s));
        if (cont.length) { asignar(pend, cont); }
        rows.push(fin(pend)); pend = null;
      }
      for (let k = 0; k < hdrArt.length; k++) {
        const a = hdrArt[k];
        const num = items.find(i => /^\d{1,4}$/.test(i.s) && Math.abs(i.y - a.y) < 1 && i.x < a.x);
        const yBot = hdrArt[k + 1] ? hdrArt[k + 1].y + 1.5 * H : -1e9;
        const vals = items.filter(i => i.y < a.y - 1 && i.y > yBot && i.x >= a.x - 2 && !(i === num));
        const r = { n: num ? +num.s : null, desc: [], marca: [], cant: [], emb: [] };
        const asignarLocal = list => asignar(r, list);
        asignarLocal(vals);
        if (!hdrArt[k + 1] && !vals.length) { pend = r; continue; }
        if (!hdrArt[k + 1]) { pend = r; continue; }   // el último de la página puede seguir en la siguiente
        rows.push(fin(r));
      }
      function asignar(r, list) {
        for (const i of list) {
          if (xE != null && i.x >= xE - 3) r.emb.push(i);
          else if (xC != null && i.x >= xC - 3) r.cant.push(i);
          else if (xM != null && i.x >= xM - 3) r.marca.push(i);
          else r.desc.push(i);
        }
      }
    }
    if (pend) rows.push(fin(pend));
    function fin(r) {
      const j = a => a.sort((p, q) => q.y - p.y || p.x - q.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
      let d = j(r.desc); const m = d.match(/^([A-Z]{2,}\d{2,})\s*-\s*(.*)$/);
      const marca = j(r.marca);
      return { renglon: r.n, cod_cliente: m ? m[1] : '', descripcion: m ? m[2] : d, cantidad: num(j(r.cant)), unidad: j(r.emb), marcas: marca === '-' ? '' : marca.trim() };
    }
    const out = rows.filter(r => r.renglon != null && (r.descripcion || r.cod_cliente));
    if (!out.length) throw new Error('No reconocí renglones en el reporte de cotización.');
    out.sort((a, b) => a.renglon - b.renglon);
    const mE = cab.titulo.match(/EXPTE\.?\s*(\d{5,7})/i) || cab.titulo.match(/\bE\s?(\d{6})\b/);
    const mH = (cab.vencimiento || '').match(/(\d{1,2}\/\d{1,2}\/\d{2,4}).*?(\d{1,2}):(\d{2})/);
    const plan = cab.titulo.replace(/^Pedido de cotizaci[oó]n\s*-?\s*/i, '').replace(/EXPTE\.?\s*\d{5,7}\s*/i, '').trim();
    return { ...cab, titulo: 'ID: ' + (cab.idPedido || '') + ' - ' + cab.titulo, plan, proceso: mE ? 'EXPTE ' + mE[1] : '', apertura: mH ? `${mH[1]} - ${mH[2]}:${mH[3]}hs` : (cab.vencimiento || ''), fecha: fechaDe(cab.vencimiento), idPedido: cab.idPedido || '', renglones: out, formato: 'reporte' };
  }

  // ---------- Pedido de cotización (Bionexo) desde PDF ----------
  async function parsePedidoPDF(pdfjs, data) {
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    {   // ¿formato nuevo "Reporte de cotización"?
      const t = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
      if (/Reporte de cotizaci/i.test(t) && /Cant\.? solicitada/i.test(t)) return parsePedidoReporte(pdfjs, doc);
    }
    const rows = []; const cab = {}; const textoCab = [];
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const pg = await doc.getPage(pn);
      const items = (await pg.getTextContent()).items.filter(i => i.str && i.str.trim())
        .map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width }));
      // cabecera (página 1)
      if (pn === 1) {
        const lab = (re) => { const l = items.find(i => re.test(i.s)); if (!l) return ''; return items.filter(i => i !== l && i.x > l.x + l.w - 1 && i.x < l.x + 260 && Math.abs(i.y - l.y) < 9 && !/:$/.test(i.s)).sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' '); };
        const t = items.find(i => /^ID:\s*\d+/.test(i.s));
        cab.titulo = t ? t.s : '';
        const venc = items.find(i => /^Vencimiento:?$/.test(i.s));
        if (venc) { const v = items.filter(i => Math.abs(i.y - venc.y) < 1.5 && i.x > venc.x && i.x < venc.x + 250).sort((a, b) => a.x - b.x).map(i => i.s).join(' '); cab.vencimiento = v; }
        cab.terminos = lab(/^Términos y Condiciones:?$/i); cab.pago = lab(/^Formas de pago:?$/i); cab.observaciones = lab(/^Observaciones:?$/i); cab.contacto = lab(/^Contacto:?$/i);
      }
      // columnas por encabezados "Item" y "Cant."
      const hItems = items.filter(i => i.s === 'Item').sort((a, b) => a.x - b.x);
      const hCant = items.filter(i => /^Cant\.?$/.test(i.s)).sort((a, b) => a.x - b.x);
      let cols;
      if (hItems.length && hCant.length) cols = hItems.map((h, k) => ({ x0: h.x - 12, x1: hItems[k + 1] ? hItems[k + 1].x - 12 : 1e9, num1: h.x + 22, cant0: (hCant[k] || hCant[0]).x - 16 }));
      else {   // páginas sin encabezado: usar las de la página 1
        cols = parsePedidoPDF._cols; if (!cols) continue;
      }
      parsePedidoPDF._cols = cols;
      let topY = 1e9;
      if (hItems.length) { const y0 = hItems[0].y; topY = Math.min(...items.filter(i => Math.abs(i.y - y0) < 7 && /^(Item|Articulo|Art[ií]culo|Cant\.?|Precio|Unitario)$/i.test(i.s)).map(i => i.y)) - 1; parsePedidoPDF._top = true; }
      for (const col of cols) {
        const ci = items.filter(i => i.x >= col.x0 && i.x < col.x1 && i.y < topY);
        const nums = ci.filter(i => i.x < col.num1 && /^\d{1,4}$/.test(i.s)).sort((a, b) => b.y - a.y);
        if (!nums.length) continue;
        const R = nums.map(n => ({ n: +n.s, y: n.y, desc: [], qty: [], marcas: '', med: '' }));
        const owner = y => { let best = null; for (const r of R) if (r.y <= y + 9.5 && (!best || r.y > best.y)) best = r; return best; };
        const ownerAbove = y => { let best = null; for (const r of R) if (r.y >= y - 0.5 && (!best || r.y < best.y)) best = r; return best; };
        const near = y => R.reduce((a, r) => Math.abs(r.y - y) < Math.abs(a.y - y) ? r : a, R[0]);
        const marcasY = new Set();
        for (const i of ci) if (/^Marcas preferidas/i.test(i.s)) { const r = ownerAbove(i.y); if (r) { marcasY.add(i.y.toFixed(1)); const v = ci.filter(j => Math.abs(j.y - i.y) < 1 && j.x > i.x && j.x < col.cant0 + 5).map(j => j.s).join(' ') || i.s.replace(/^Marcas preferidas:?\s*/i, ''); r.marcas = v.trim(); } }
        for (const i of ci) {
          if (nums.includes(i) || /^Marcas preferidas/i.test(i.s) || marcasY.has(i.y.toFixed(1)) && i.x < col.cant0) continue;
          if (/^imprimir|^cerrar|^https?:/i.test(i.s)) continue;
          if (/^Código:?/i.test(i.s)) { const r = owner(i.y); const m = i.s.match(/(MED\w+|[A-Z]{2,}\d+)/); if (r && m) r.med = m[1]; continue; }
          if (/^(MED\d+|[A-Z]{3}\d{3,})$/.test(i.s)) { const r = owner(i.y); if (r && !r.med) r.med = i.s; continue; }
          if (i.x >= col.cant0 && (/^\d[\d.,]*(\s|$)/.test(i.s) || /^[A-Za-zÁÉÍÓÚáéíóúñÑ]+$/.test(i.s))) { const r = near(i.y); if (/^\d/.test(i.s) || r.qty.length) { r.qty.push(i); continue; } }
          const r = owner(i.y); if (r) r.desc.push(i);
        }
        for (const r of R) {
          const qtxt = r.qty.sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ');
          const m = qtxt.match(/^([\d.,]+)\s*(.*)$/);
          rows.push({ renglon: r.n, descripcion: r.desc.sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim(),
            cod_cliente: r.med, cantidad: m ? num(m[1]) : null, unidad: m ? m[2].trim() : qtxt, marcas: r.marcas === '-' ? '' : r.marcas });
        }
      }
    }
    delete parsePedidoPDF._cols;
    if (!rows.length) throw new Error('No reconocí renglones en el PDF. ¿Es un pedido de cotización de Bionexo?');
    rows.sort((a, b) => a.renglon - b.renglon);
    const mE = cab.titulo.match(/\bE\s?(\d{5,7})\b/) || cab.titulo.match(/EXPTE\.?\s*(\d{5,7})/i);
    const mH = (cab.vencimiento || '').match(/(\d{1,2}\/\d{1,2}\/\d{2,4}).*?(\d{1,2}):(\d{2})/);
    const plan = (cab.titulo.match(/Pedido de Cotizaci[oó]n\s*-\s*(.*)$/i) || [])[1] || '';
    return { ...cab, plan: plan.trim(), proceso: mE ? 'EXPTE ' + mE[1] : '', apertura: mH ? `${mH[1]} - ${mH[2]}:${mH[3]}hs` : (cab.vencimiento || ''), fecha: fechaDe(cab.vencimiento), idPedido: (cab.titulo.match(/^ID:\s*(\d+)/) || [])[1] || '', renglones: rows };
  }

  // ---------- Sugerir producto para una descripción de pedido ----------
  const STOP = new Set(['MG', 'ML', 'MCG', 'UI', 'GR', 'G', 'X', 'COMP', 'COMPR', 'COMPRIMIDOS', 'REC', 'CAPS', 'CAP', 'CAPSULAS', 'AMP', 'AMPOLLA', 'VIAL', 'VIALES', 'JGA', 'JGAS', 'JER', 'JERINGA', 'PRELL', 'PRELLENADA', 'PREL', 'LAP', 'LAPIC', 'INY', 'INYECTABLE', 'FCO', 'F', 'A', 'FA', 'SC', 'IV', 'LP', 'CART', 'CARTUCHO', 'SOL', 'ORAL', 'POLVO', 'PVO', 'CON', 'DE', 'EN', 'POR', 'PARA', 'ENV', 'ENVASE', 'UNIDADES', 'AUTOINY', 'DISP', 'KIT', 'LIOF', 'DESC', 'APLIC', 'SIN', 'MAS', 'NAS', 'TAB', 'ACETATO', 'GENERI', 'GENERICO']);
  const palabras = s => norm(s).replace(/[^A-Z0-9., ]/g, ' ').split(/[\s.,]+/).filter(w => w.length >= 3 && !/^\d/.test(w) && !STOP.has(w));
  const nums = s => { const out = []; norm(s).replace(/(\d+(?:[.,]\d+)?)/g, (m) => { out.push(+m.replace(',', '.')); return m; }); return out; };
  const GENERICAS = new Set(['CARBONATO', 'HUMANA', 'HUMANO', 'RECOMBINANTE', 'SODICA', 'SODICO', 'CLORHIDRATO', 'ACIDO', 'MESILATO', 'SULFATO', 'FOSFATO', 'CITRATO', 'MALEATO', 'TARTRATO', 'BROMHIDRATO', 'POTASICO', 'CALCICO', 'MAGNESICO', 'DIHIDRATO', 'MONOHIDRATO', 'BASE', 'ASOC', 'ASOCIADO', 'COMPUESTO', 'PEGILADO', 'ALFA', 'BETA', 'TIPO']);
  const SINON = [['GAMMAGLOBULINA', 'INMUNOGLOBULINA'], ['SOMATOTROFINA', 'SOMATROPINA', 'SOMATOTROPINA', 'SOMAOTROFINA'], ['ROMISPLOSTIN', 'ROMIPLOSTIM']];
  function lev(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  const parecida = (a, b) => a === b || SINON.some(g => g.includes(a) && g.includes(b)) || (a.length >= 6 && b.length >= 6 && a.slice(0, 4) === b.slice(0, 4) && lev(a, b) <= 2);
  const enD = (w, D) => D.some(x => parecida(w, x));
  const concentraciones = s => { const out = []; norm(s).replace(/(\d+(?:[.,]\d+)?)\s*(MG|MCG|UI|GR|G|ML|%)(?![A-Z])/g, (m, n, u) => { let v = +n.replace(',', '.'); if (u === 'GR' || u === 'G') v *= 1000; if (u !== 'ML') out.push(v); return m; }); return out; };
  // candidatos: [{codigo, detalle, monodroga, laboratorio, lista, costo..., fuente:'hist'|'costos', fecha, veces}]
  function sugerir(desc, cands, max = 6) {
    const D = palabras(desc), N = nums(desc), K = concentraciones(desc);
    if (!D.length) return [];
    const res = [];
    for (const c of cands) {
      const mono = palabras(c.monodroga).filter(w => !GENERICAS.has(w)), det = palabras(c.detalle);
      const d0 = det[0];
      const monoHits = mono.filter(w => enD(w, D)).length;
      const brandHit = d0 && !mono.includes(d0) && enD(d0, D);
      if (!monoHits && !brandHit) continue;
      let s = 0;
      if (monoHits) s += 6 + monoHits;
      if (brandHit) s += 6;
      if (monoHits && mono.length > 1 && mono.some(w => !enD(w, D)) && !brandHit) s -= 2;   // combinación distinta (A+B vs A)
      const NC = nums(c.detalle), KC = concentraciones(c.detalle);
      let nm = 0; for (const n of N) if (NC.some(x => Math.abs(x - n) < 1e-9)) nm++;
      s += nm * 2;
      if (K.length && KC.length) s += KC.some(x => Math.abs(x - K[0]) < 1e-9) ? 3 : -4;     // concentración principal
      if (c.fuente === 'hist') s += 3 + Math.min(2, (c.veces || 1) - 1) * 0.5;
      if (c.fuente === 'cliente') s += 30;           // mismo código del cliente (MED…) que ya cotizamos antes
      if (c.costo) s += 0.5;
      res.push({ ...c, score: s });
    }
    res.sort((a, b) => b.score - a.score || String(b.fecha || '').localeCompare(String(a.fecha || '')));
    const seen = new Set(); const out = [];
    for (const r of res) { if (seen.has(r.codigo)) continue; seen.add(r.codigo); out.push(r); if (out.length >= max) break; }
    return out;
  }

  // ---------- Orden de compra / provisión (ISSN) desde PDF ----------
  async function parseOCPDF(pdfjs, data) {
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    const lineas = []; let texto = '';
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const pg = await doc.getPage(pn);
      const items = (await pg.getTextContent()).items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width }));
      texto += ' ' + items.sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ');
      const hCant = items.find(i => /^CANTIDAD$/i.test(i.s)), hDesc = items.find(i => /^DESCRIPCI[OÓ]N$/i.test(i.s)), hPre = items.find(i => /^PRECIO/i.test(i.s)), hImp = items.find(i => /^IMPORTE/i.test(i.s));
      if (!hCant || !hDesc || !hPre) continue;
      const yTop = hCant.y - 1;
      const fin = items.find(i => /^(SUBTOTAL|TOTAL)$/i.test(i.s) && i.y < yTop);
      const yBot = fin ? fin.y + 4 : -1e9;
      const zona = items.filter(i => i.y < yTop && i.y > yBot);
      const anchors = zona.filter(i => i.x < hCant.x - 2 && /^[A-Z]{2,}\d{2,}$/.test(i.s)).sort((a, b) => b.y - a.y);
      anchors.forEach((a, k) => {
        const yNext = anchors[k + 1] ? anchors[k + 1].y + 1 : yBot;
        const fila = zona.filter(i => i.y <= a.y + 1.5 && i.y > yNext);
        const enLinea = fila.filter(i => Math.abs(i.y - a.y) < 1.5);
        const nearX = (h, arr) => arr.filter(i => /^[\d.,]+$/.test(i.s)).sort((p, q) => Math.abs(p.x + p.w - (h.x + h.w)) - Math.abs(q.x + q.w - (h.x + h.w)))[0];
        const cant = enLinea.find(i => /^[\d.,]+$/.test(i.s) && i.x < hDesc.x);
        const nums2 = enLinea.filter(i => /^[\d.,]+$/.test(i.s) && i.x > hDesc.x + 50);
        const pre = nearX(hPre, nums2), imp = hImp ? nearX(hImp, nums2.filter(i => i !== pre)) : null;
        const desc = fila.filter(i => i !== a && i !== cant && i !== pre && i !== imp && i.x >= hDesc.x - 40 && i.x < hPre.x - 5).sort((p, q) => q.y - p.y || p.x - q.x).map(i => i.s).join(' ').replace(/\s+\.$/, '').replace(/\s+/g, ' ').trim();
        lineas.push({ cod_cliente: a.s, cantidad: cant ? num(cant.s) : null, descripcion: desc, precio: pre ? num(pre.s) : null, importe: imp ? num(imp.s) : null });
      });
    }
    if (!lineas.length) throw new Error('No reconocí renglones en la orden de compra.');
    const t = texto.replace(/\s+/g, ' ');
    const mOC = t.match(/Orden de (?:Provisi[oó]n|Compra)\s*:?\s*(?:(\d+)\s*-\s*)?(\d+)/i);
    const mF = t.match(/Orden de (?:Provisi[oó]n|Compra)[^]*?Fecha\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const mE = t.match(/\bEXPTE\.?\s*(\d{5,7})/i) || t.match(/Expediente\s*:?\s*(\d{6})/i);
    const mPlan = t.match(/EXPTE\.?\s*\d{5,7}\s+(.*?)\s+ITEM\b/i);
    const mCond = t.match(/COND\.?\s*DE VENTA\s*:?\s*([^]*?)(?:I\.V\.A|SEÑOR|$)/i);
    const mExp = t.match(/Fecha de expiraci[oó]n\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const mTot = t.match(/SUBTOTAL\s+TOTAL\s+([\d.,]+)/i);
    return { numero: mOC ? mOC[2] : '', serie: mOC && mOC[1] ? mOC[1] : '', fecha: mF ? fechaDe(mF[1]) : null, proceso: mE ? 'EXPTE ' + mE[1] : '', plan: mPlan ? mPlan[1].trim() : '',
      condicion: mCond ? mCond[1].trim() : '', vence: mExp ? fechaDe(mExp[1]) : null, total: mTot ? num(mTot[1]) : lineas.reduce((s, l) => s + (l.importe || 0), 0), lineas };
  }
  // Empareja líneas de OC con renglones cotizados. Devuelve [lineIndex] -> item | null
  function matchOC(lineas, items) {
    const pares = [];
    lineas.forEach((l, i) => items.forEach(it => {
      let s = 0;
      if (l.cod_cliente && it.cod_cliente && l.cod_cliente.toUpperCase() === it.cod_cliente.toUpperCase()) s += 10;
      if (l.precio && it.precio_unit && Math.abs(l.precio - it.precio_unit) <= 1) s += 7;
      else if (l.precio && it.precio_unit && Math.abs(l.precio / it.precio_unit - 1) < 0.02) s += 3;
      if (l.cantidad != null && it.cantidad === l.cantidad) s += 2;
      const D = palabras(l.descripcion); const mono = palabras(it.monodroga), det = palabras(it.detalle);
      if (mono.some(w => D.includes(w)) || (det[0] && D.includes(det[0]))) s += 3;
      if (s >= 6) pares.push({ i, it, s });
    }));
    pares.sort((a, b) => b.s - a.s);
    const res = lineas.map(() => null), usados = new Set();
    for (const p of pares) { if (res[p.i] || usados.has(p.it)) continue; res[p.i] = p.it; usados.add(p.it); }
    return res;
  }

  // ---------- Vinculación renglón de acta ↔ ítem cotizado ----------
  const primeraPalabra = s => norm(s).split(/[ +\-\/(]/).filter(w => w.length > 2)[0] || '';
  const numeros = s => (norm(s).match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.'));
  function puntaje(ren, it, ofertaPropia) {
    let p = 0;
    const mono = primeraPalabra(it.monodroga);
    const d = norm(ren.descripcion);
    if (mono && d.includes(mono)) p += 4;
    if (it.desc_cliente && norm(it.desc_cliente) === d) p += 8;
    if (it.renglon === ren.renglon) p += 3;
    if (ren.cantidad != null && it.cantidad === ren.cantidad) p += 2;
    const nd = numeros(ren.descripcion), ni = numeros(it.detalle);
    if (nd.length && nd.some(x => ni.includes(x))) p += 1;
    if (ofertaPropia && it.precio_unit && it.cantidad && Math.abs(ofertaPropia - it.precio_unit * it.cantidad) <= Math.max(5, ofertaPropia * 0.001)) p += 6;
    return p;
  }
  // devuelve [{renglonIndex, item, puntaje}] — asignación golosa sin repetir ítems
  function vincular(renglones, items, esPropio) {
    const pares = [];
    renglones.forEach((ren, i) => {
      const prop = (ren.ofertas || []).find(o => esPropio(o.proveedor) && o.precio_total);
      items.forEach(it => { const s = puntaje(ren, it, prop && prop.precio_total); if (s >= 5) pares.push({ i, it, s }); });
    });
    pares.sort((a, b) => b.s - a.s);
    const usadosR = new Set(), usadosI = new Set(), res = [];
    for (const p of pares) {
      if (usadosR.has(p.i) || usadosI.has(p.it)) continue;
      usadosR.add(p.i); usadosI.add(p.it); res.push(p);
    }
    return res;
  }

  // ---------- Análisis de un renglón de comparativa ----------
  // ofertas: [{proveedor, estado, precio_total, es_propio, adjudicado}]
  function analizarRenglon(ofertas, cantidad) {
    const validas = ofertas.filter(o => o.precio_total > 0 && (!o.estado || /cotiz/i.test(o.estado)));
    const orden = [...validas].sort((a, b) => a.precio_total - b.precio_total);
    const propia = validas.find(o => o.es_propio) || null;
    const comp = orden.filter(o => !o.es_propio);
    const adj = ofertas.find(o => o.adjudicado && !o.es_propio && o.precio_total > 0);
    const mejorComp = adj || comp[0] || null;           // si hay adjudicación conocida, manda
    const ganador = ofertas.find(o => o.adjudicado) || orden[0] || null;
    const pos = propia ? orden.indexOf(propia) + 1 : null;
    const q = cantidad || 1;
    return {
      ofertasValidas: orden.length, propia, mejorComp, ganador, posicion: pos,
      ganamos: ganador ? !!ganador.es_propio : null,
      unitComp: mejorComp ? mejorComp.precio_total / q : null,
      unitPropio: propia ? propia.precio_total / q : null,
    };
  }

  // ---------- nombres de proveedores ----------
  const ALIAS_PROV = [[/^PROVEEDORES HOSP/, 'Proveedores Hospitalarios'], [/^ASIST/, 'Asistencia Farmacéutica'], [/^AVI[SC]ENA/, 'Avicena'],
    [/^DISTRIFAR/, 'Distrifar'], [/^C ?& ?C/, 'C&C Medicals'], [/^REDFARM/, 'Redfarm'], [/^SALVADO/, 'Salvado Hnos'], [/^DIGMA/, 'Digma'],
    [/^DROFAR/, 'Drofar de Redimer'], [/^GLM/, 'GLM Group'], [/^ITAL ?FARMA/, 'Ital Farma'], [/^ORIEN/, 'Orien Argentina'], [/^GLOBAL MEDICA/, 'Global Medica']];
  function canonProv(n) {
    let s = norm(n).replace(/[.,]/g, ' ').replace(/\b(DROGUERIA|DROG|S ?A|S ?R ?L|SAU|SACIFIA)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s === 'SIN DATO') return 'Sin dato';
    for (const [re, v] of ALIAS_PROV) if (re.test(s)) return v;
    return s.split(' ').map(w => w.length <= 3 && w !== 'META' ? w : w[0] + w.slice(1).toLowerCase()).join(' ').replace(/\(.*$/, '').trim();
  }

  const api = { parseOCPDF, matchOC, parsePedidoPDF, sugerir, palabras, canonProv, parseActaPDF, celdaActa, norm, num, txt, codigo, fechaDe, procesoKey, costoMeta, margenDe, precioDe, parseAcumulado, parseCostos, parseActa, detectarColumnas, vincular, puntaje, analizarRenglon, MESES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.P = api;
})(typeof window !== 'undefined' ? window : globalThis);
