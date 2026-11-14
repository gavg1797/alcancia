/* Alcancía · lógica pura (sin interfaz): lectura de estados de cuenta, categorías,
 * movimientos automáticos, totales y combinación con Google Sheets.
 * Funciona en el navegador (window.Core) y en Node (pruebas). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TIPOS = ["ingreso", "gasto", "ahorro", "inversion"];
  const TIPO_NOMBRE = { ingreso: "Ingreso", gasto: "Gasto", ahorro: "Ahorro", inversion: "Inversión" };
  const CAMPOS = ["id", "fecha", "tipo", "categoria", "descripcion", "monto", "moneda", "cuenta", "origen", "nota", "actualizado"];
  const CAMPOS_AUTO = ["id", "descripcion", "tipo", "categoria", "monto", "moneda", "cuenta", "frecuencia", "inicio", "fin", "ultima", "activo"];

  const CATEGORIAS = {
    gasto: ["Supermercado", "Restaurantes", "Transporte", "Servicios", "Vivienda", "Salud", "Educación", "Entretenimiento", "Compras", "Bancos y comisiones", "Transferencias", "Efectivo", "Otros gastos"],
    ingreso: ["Salario", "Intereses", "Transferencias recibidas", "Ventas", "Otros ingresos"],
    ahorro: ["Ahorro a la vista", "Ahorro programado", "Fondo de emergencia", "Otros ahorros"],
    inversion: ["Certificado a plazo", "Fondos de inversión", "Acciones", "Pensión voluntaria", "Otras inversiones"]
  };

  /* ---------- texto, números, fechas ---------- */
  const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const diasMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hoyISO = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const sumarDias = (f, n) => { const d = new Date(f + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const nuevoId = p => (p || "m") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function parseAmount(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v == null ? "" : v).trim();
    if (!s) return null;
    let neg = /^\(.*\)$/.test(s) || /^[-−–]/.test(s) || /[-−–]$/.test(s) || /\bDB\b/i.test(s);
    s = s.replace(/[^\d.,]/g, "");
    if (!/\d/.test(s)) return null;
    const lc = s.lastIndexOf(","), lp = s.lastIndexOf(".");
    let dec = -1;
    if (lc >= 0 && lp >= 0) dec = Math.max(lc, lp);
    else if (lc >= 0 || lp >= 0) {
      const i = Math.max(lc, lp), ch = s[i], veces = s.split(ch).length - 1, tras = s.length - i - 1;
      if (veces === 1 && !(tras === 3 && i <= 3 && i > 0)) dec = i;   // "12,50" decimal; "1,234" miles
    }
    const entero = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, "");
    const frac = dec >= 0 ? s.slice(dec + 1).replace(/[.,]/g, "") : "";
    const n = parseFloat((entero || "0") + (frac ? "." + frac : ""));
    return isFinite(n) ? (neg ? -n : n) : null;
  }

  const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  function fechaValida(y, m, d) {
    if (y < 100) y += 2000;
    if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= diasMes(y, m))) return null;
    return iso(y, m, d);
  }
  function parseDate(v, anioDefecto) {
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === "number") {            // número de serie de Excel / Sheets
      if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
      return null;
    }
    const s = norm(v);
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return fechaValida(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/))) return fechaValida(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})[-/. ]+(?:de )?([a-z]{3})[a-z]*\.?(?:[-/., ]+(?:de )?(\d{4}|\d{2}))?(?!\d)/)) && MESES[m[2]])
      return m[3] || anioDefecto ? fechaValida(+(m[3] || anioDefecto), MESES[m[2]], +m[1]) : null;
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})(?![\d/-])/)) && anioDefecto) return fechaValida(+anioDefecto, +m[2], +m[1]);
    return null;
  }

  function detectarMoneda(texto) {
    const t = norm(texto);
    const crc = (t.match(/₡|¢|\bcrc\b|colon(es)?\b/g) || []).length;
    const usd = (t.match(/\$|\busd\b|dolar(es)?\b/g) || []).length;
    if (!crc && !usd) return null;
    return usd > crc ? "USD" : "CRC";
  }

  /* ---------- clasificación ---------- */
  const DICC = [
    ["Supermercado", "walmart|mas x menos|masxmenos|auto mercado|automercado|maxi pali|maxipali|\\bpali\\b|pricesmart|perimercado|megasuper|mega super|fresh market|supermerc|\\bsuper\\b|am pm|vindi|mini super|minisuper|abastecedor"],
    ["Restaurantes", "restaur|\\brest\\b|\\bsoda\\b|pizza|mcdonald|\\bkfc\\b|burger|\\bcafe\\b|cafeteria|starbucks|uber ?eats|rappi|didi food|pollo|taco bell|subway|spoon|rostipollo|sushi|panaderia|musmanni|heladeria|\\bpops\\b|\\bbar\\b"],
    ["Transporte", "\\buber\\b|\\bdidi\\b|indrive|gasolin|servicentro|estacion de servicio|\\bdelta\\b|parqueo|peaje|riteve|dekra|marchamo|\\bbus\\b|\\btaxi\\b|autopista|\\bcombustible\\b|llantas|taller|repuestos"],
    ["Servicios", "\\bice\\b|kolbi|cnfl|\\baya\\b|liberty|\\bclaro\\b|\\btigo\\b|telecable|cabletica|jasec|esph|coopelesca|coopeguanacaste|coopesantos|internet|electricidad|acueducto|municipalidad|recibo"],
    ["Vivienda", "alquiler|hipotec|condomin|\\brenta\\b|mantenimiento|ferreteria|\\bepa\\b|construplaza"],
    ["Salud", "farmacia|fischel|sucre|la bomba|clinica|hospital|ccss|medic|dental|odonto|laboratorio|optica|veterinari|gimnasio|\\bgym\\b|smart fit"],
    ["Educación", "universidad|colegio|escuela|matricula|\\bcurso|udemy|platzi|coursera|libreria|\\bucr\\b|\\btec\\b|\\buned\\b|\\bulatina\\b"],
    ["Entretenimiento", "netflix|spotify|disney|\\bhbo\\b|\\bmax\\b|\\bcine|cinepolis|nova cinemas|steam|playstation|xbox|nintendo|youtube|prime video|apple\\.com|google play|teatro|concierto"],
    ["Compras", "amazon|aliexpress|temu|shein|tienda|ekono|siman|universal|gollo|monge|el rey|pequeno mundo|aliss|zara|\\bcemaco\\b|multiplaza|\\bmall\\b|office depot"],
    ["Bancos y comisiones", "comision|cargo por|impuesto|\\biva\\b|interes(es)? (corriente|morator)|\\bseguro\\b|\\bins\\b|anualidad|membresia|cuota de manejo"],
    ["Efectivo", "retiro|\\batm\\b|cajero|\\bath\\b"],
    ["Transferencias", "sinpe|transferencia|\\btef\\b|\\btft\\b|traslado"]
  ];
  const DICC_ING = [
    ["Salario", "salario|planilla|nomina|pago de salarios|aguinaldo|quincena"],
    ["Intereses", "interes|rendimiento|excedente|dividendo"],
    ["Transferencias recibidas", "sinpe|transferencia|\\btef\\b|deposito|credito de"]
  ];
  const RE_AHORRO = /ahorro|navideno|marchamo ahorro|capitalizacion|fondo de emergencia/;
  const RE_INVERSION = /inversion|\bcdp\b|certificado|deposito a plazo|plazo fijo|fondo de inv|puesto de bolsa|\bsafi\b|\bbolsa\b|pension voluntaria|\bropc?\b voluntari/;
  const RE_CREDITO = /deposito|salario|planilla|abono|intereses? ganad|credito|recibid[ao]|reintegro|devolucion|reverso|aguinaldo|excedente/;

  /* tipo (ingreso/gasto/ahorro/inversion) a partir del sentido bancario y la descripción */
  function tipoDe(desc, sentido) {
    const d = norm(desc);
    if (sentido === "credito") return "ingreso";
    if (RE_INVERSION.test(d)) return "inversion";
    if (RE_AHORRO.test(d)) return "ahorro";
    return "gasto";
  }
  function categorizar(desc, tipo, reglas) {
    const d = norm(desc);
    for (const r of reglas || []) if (r && r.clave && (!r.tipo || r.tipo === tipo) && d.includes(norm(r.clave))) return r.categoria;
    if (tipo === "ahorro") return /navid|program|plazo/.test(d) ? "Ahorro programado" : /emergenc/.test(d) ? "Fondo de emergencia" : "Ahorro a la vista";
    if (tipo === "inversion") return /certific|cdp|plazo/.test(d) ? "Certificado a plazo" : /fondo|safi/.test(d) ? "Fondos de inversión" : /pension|rop/.test(d) ? "Pensión voluntaria" : /accion|bolsa/.test(d) ? "Acciones" : "Otras inversiones";
    for (const [cat, re] of tipo === "ingreso" ? DICC_ING : DICC) if (new RegExp(re).test(d)) return cat;
    return tipo === "ingreso" ? "Otros ingresos" : "Otros gastos";
  }
  /* palabra clave para recordar una corrección del usuario: el comercio sin números ni fechas */
  function claveDe(desc) {
    return norm(desc).replace(/[\d*#/.,:-]+/g, " ").replace(/\b(compra|pago|pos|tarjeta|debito|credito|sinpe movil|sinpe|transferencia|tef|cr|sj|san jose|costa rica)\b/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
  }

  /* ---------- lectura de tablas (Excel / CSV) ---------- */
  const COLS = {
    fecha: /^fecha|^date|^dia$/,
    desc: /descrip|detalle|concepto|transacci|movimiento|comercio|establecimiento|glosa|referencia y desc|description/,
    debito: /debito|debitos|cargo|retiro|egreso|salida|debit/,
    credito: /credito|creditos|abono|deposito|ingreso|entrada|credit/,
    monto: /monto|importe|valor|amount|total/,
    saldo: /saldo|balance|disponible/,
    ref: /refer|document|numero|comprobante|n° ?doc|no\.? ?doc|\bdoc\b/,
    tipo: /^tipo|^t\/m$|^d\/c$|^db\/cr$|naturaleza/
  };
  function mapearEncabezado(fila) {
    const m = {};
    fila.forEach((c, i) => {
      const t = norm(c);
      if (!t || t.length > 40) return;
      for (const k of Object.keys(COLS)) if (m[k] == null && COLS[k].test(t)) {
        if (k === "desc" && /^fecha/.test(t)) continue;
        if (k === "monto" && (COLS.debito.test(t) || COLS.credito.test(t))) continue;
        m[k] = i; break;
      }
    });
    return m;
  }
  function anioEnTexto(t) { const m = String(t).match(/\b(20[0-4]\d)\b/); return m ? +m[1] : null; }

  function parseTabla(filas, opc) {
    opc = opc || {};
    filas = (filas || []).map(f => Array.isArray(f) ? f : []);
    let hi = -1, cols = null;
    for (let i = 0; i < Math.min(filas.length, 60); i++) {
      const m = mapearEncabezado(filas[i]);
      if (m.fecha != null && (m.debito != null || m.credito != null || m.monto != null)) { hi = i; cols = m; break; }
    }
    const cabecera = filas.slice(0, hi < 0 ? 8 : hi + 1).map(f => f.join(" ")).join(" ");
    if (!cols) {        // sin encabezado: adivinar por contenido
      const n = Math.max(0, ...filas.map(f => f.length)), cf = [], cn = [], ct = [];
      for (let c = 0; c < n; c++) {
        let f = 0, nu = 0, tx = 0;
        for (const r of filas.slice(0, 80)) {
          const v = r[c]; if (v == null || v === "") continue;
          if (typeof v !== "number" && parseDate(v, 2000)) f++;
          else if (typeof v === "number" || (/^[\s₡$¢(-]*\d[\d.,]*\)?-?$/.test(String(v)) && parseAmount(v) != null)) nu++;
          else tx += String(v).length;
        }
        cf.push(f); cn.push(nu); ct.push(tx);
      }
      const max = a => a.indexOf(Math.max(...a));
      if (!n || !Math.max(...cf)) return { filas: [], moneda: detectarMoneda(cabecera), columnas: {} };
      cols = { fecha: max(cf), desc: max(ct) };
      const nums = cn.map((v, i) => [v, i]).filter(x => x[0] > 0 && x[1] !== cols.fecha).map(x => x[1]);
      if (nums.length >= 3) { cols.debito = nums[0]; cols.credito = nums[1]; cols.saldo = nums[nums.length - 1]; }
      else if (nums.length === 2) { cols.monto = nums[0]; cols.saldo = nums[1]; }
      else if (nums.length === 1) cols.monto = nums[0];
    }
    const anio = opc.anio || anioEnTexto(cabecera) || new Date().getFullYear();
    const out = [];
    let saldoPrev = null;
    for (let i = hi + 1; i < filas.length; i++) {
      const r = filas[i], g = k => (cols[k] != null ? r[cols[k]] : null);
      const fecha = parseDate(g("fecha"), anio);
      const desc = String(g("desc") == null ? "" : g("desc")).replace(/\s+/g, " ").trim();
      const saldo = cols.saldo != null ? parseAmount(g("saldo")) : null;
      if (!fecha) { continue; }
      let monto = null, sentido = null;
      const deb = cols.debito != null ? parseAmount(g("debito")) : null;
      const cre = cols.credito != null ? parseAmount(g("credito")) : null;
      if (deb) { monto = Math.abs(deb); sentido = "debito"; }
      else if (cre) { monto = Math.abs(cre); sentido = "credito"; }
      else if (cols.monto != null) {
        const v = parseAmount(g("monto"));
        if (v) {
          monto = Math.abs(v);
          const t = norm(g("tipo"));
          if (/^(d|db|deb|debito|cargo|retiro|egreso|-)/.test(t)) sentido = "debito";
          else if (/^(c|cr|cre|credito|abono|deposito|ingreso|\+)/.test(t)) sentido = "credito";
          else if (saldo != null && saldoPrev != null && Math.abs(saldoPrev - monto - saldo) < 0.011) sentido = "debito";
          else if (saldo != null && saldoPrev != null && Math.abs(saldoPrev + monto - saldo) < 0.011) sentido = "credito";
          else if (v < 0) sentido = "debito";
          else sentido = RE_CREDITO.test(norm(desc)) ? "credito" : (opc.positivoEsCredito ? "credito" : "debito");
        }
      }
      if (saldo != null) saldoPrev = saldo;
      if (!monto || /saldo (anterior|inicial|final)|^total/.test(norm(desc))) continue;
      out.push({ fecha, descripcion: desc || "(sin descripción)", monto, sentido, referencia: String(g("ref") == null ? "" : g("ref")).trim(), saldo });
    }
    return { filas: out, moneda: detectarMoneda(cabecera), columnas: cols };
  }

  /* ---------- lectura de PDF (líneas con posiciones) ---------- */
  const RE_MONTO = /(?<![\d.,/])[-(]?[₡$¢]?\s?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+[.,]\d{2})(?![\d/])\)?(?:\s?-(?!\d)|\s?(?:CR|DB)\b)?/g;
  const RE_FECHA_INI = /^\D{0,3}(?:\d{6,}\s+)?(\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/ ](?:ene|feb|mar|abr|may|jun|jul|ago|set|sep|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?(?:[-/ ]\d{2,4})?|\d{1,2}[-/]\d{1,2})(?=\s|$)/i;

  /* lineas: [{ items: [{ str, x, w }] }] en orden de lectura. */
  function parsePdfLineas(lineas, opc) {
    opc = opc || {};
    const txt = l => l.items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
    const todo = lineas.slice(0, 60).map(txt).join(" ");
    const anio = opc.anio || anioEnTexto(todo) || new Date().getFullYear();
    let colX = null;                      // posición (borde derecho) de columnas débito / crédito / saldo
    const out = [];
    let saldoPrev = null, ultimo = null;
    for (const l of lineas) {
      const t = txt(l), tn = norm(t);
      if (!t) continue;
      if (/fecha/.test(tn) && (/debito|credito|cargo|abono|monto|retiro|deposito/.test(tn))) {
        const x = {};
        for (const it of l.items) {
          const s = norm(it.str), der = it.x + (it.w || 0);
          if (COLS.saldo.test(s)) x.saldo = der;
          else if (COLS.debito.test(s) && !COLS.credito.test(s)) x.debito = der;
          else if (COLS.credito.test(s) && !COLS.debito.test(s)) x.credito = der;
          else if (COLS.monto.test(s)) x.monto = der;
        }
        if (x.debito != null && x.credito != null) colX = x;
        ultimo = null; continue;
      }
      const mf = t.match(RE_FECHA_INI);
      const fecha = mf ? parseDate(mf[1], anio) : null;
      if (!fecha) {
        const sa = tn.match(/saldo (anterior|inicial)/);
        if (sa) { const ms = t.match(RE_MONTO); if (ms) saldoPrev = Math.abs(parseAmount(ms[ms.length - 1])); ultimo = null; }
        else if (ultimo && !t.match(RE_MONTO) && t.length < 70 && !/pagina|page|saldo|total|estado de cuenta/.test(tn) && ultimo.extra < 2) {
          ultimo.descripcion += " " + t; ultimo.extra++;
        } else ultimo = null;
        continue;
      }
      // montos con su posición aproximada
      const montos = [];
      for (const it of l.items) {
        let m; RE_MONTO.lastIndex = 0;
        while ((m = RE_MONTO.exec(it.str))) {
          if (parseDate(m[0].trim(), null)) continue;
          const v = parseAmount(m[0]);
          if (v == null) continue;
          const fin = (m.index + m[0].length) / Math.max(1, it.str.length);
          montos.push({ v, crudo: m[0], x: it.x + (it.w || 0) * fin });
        }
      }
      if (!montos.length) { ultimo = null; continue; }
      let desc = t.replace(mf[0], " ");
      for (const m of montos) desc = desc.replace(m.crudo, " ");
      desc = desc.replace(/^\s*\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\s/, " ").replace(/\s+/g, " ").trim();
      if (/saldo (anterior|inicial|final|actual)|^total/.test(norm(desc))) { saldoPrev = Math.abs(montos[montos.length - 1].v); ultimo = null; continue; }

      let monto = null, sentido = null, saldo = null;
      if (colX) {
        const cerca = m => { let b = null, bd = 1e9; for (const k of ["debito", "credito", "saldo"]) if (colX[k] != null) { const d = Math.abs(colX[k] - m.x); if (d < bd) { bd = d; b = k; } } return b; };
        for (const m of montos) {
          const k = cerca(m);
          if (k === "saldo") saldo = m.v;
          else if (m.v && monto == null) { monto = Math.abs(m.v); sentido = k; }
        }
      }
      if (monto == null) {
        const p = montos[0];
        monto = Math.abs(p.v);
        if (montos.length >= 2) saldo = montos[montos.length - 1].v;
        if (saldo != null && saldoPrev != null && Math.abs(saldoPrev - monto - Math.abs(saldo)) < 0.011) sentido = "debito";
        else if (saldo != null && saldoPrev != null && Math.abs(saldoPrev + monto - Math.abs(saldo)) < 0.011) sentido = "credito";
        else if (/CR\b/.test(p.crudo)) sentido = "credito";
        else if (p.v < 0) sentido = "debito";
        else sentido = RE_CREDITO.test(norm(desc)) ? "credito" : "debito";
      }
      if (saldo != null) saldoPrev = Math.abs(saldo);
      if (!monto) { ultimo = null; continue; }
      ultimo = { fecha, descripcion: desc || "(sin descripción)", monto, sentido, referencia: "", saldo, extra: 0 };
      out.push(ultimo);
    }
    out.forEach(o => delete o.extra);
    return { filas: out, moneda: detectarMoneda(todo), columnas: colX || {} };
  }

  /* fila de estado → movimiento */
  function aMovimiento(f, ctx) {
    const tipo = tipoDe(f.descripcion, f.sentido);
    return {
      id: nuevoId("m"), fecha: f.fecha, tipo, categoria: categorizar(f.descripcion, tipo, ctx.reglas),
      descripcion: f.descripcion, monto: Math.round(f.monto * 100) / 100, moneda: ctx.moneda || "CRC",
      cuenta: ctx.cuenta || "", origen: ctx.origen || "estado", nota: f.referencia ? "Ref. " + f.referencia : "", actualizado: Date.now()
    };
  }
  const huella = m => [m.fecha, (+m.monto).toFixed(2), m.moneda, norm(m.descripcion).slice(0, 40), norm(m.cuenta)].join("|");

  /* ---------- movimientos automáticos ---------- */
  function fechasPendientes(r, hasta) {
    const out = [];
    if (!r.inicio || !(+r.activo)) return out;
    const fin = r.fin && r.fin < hasta ? r.fin : hasta;
    const tras = r.ultima || sumarDias(r.inicio, -1);
    const ok = f => f > tras && f >= r.inicio && f <= fin;
    const [y0, m0, d0] = r.inicio.split("-").map(Number);
    if (r.frecuencia === "unica") { if (ok(r.inicio)) out.push(r.inicio); }
    else if (r.frecuencia === "semanal" || r.frecuencia === "bisemanal") {
      const paso = r.frecuencia === "semanal" ? 7 : 14;
      for (let f = r.inicio, n = 0; f <= fin && n < 3000; f = sumarDias(f, paso), n++) if (ok(f)) out.push(f);
    } else if (r.frecuencia === "anual") {
      for (let y = y0; y <= +fin.slice(0, 4); y++) { const f = iso(y, m0, Math.min(d0, diasMes(y, m0))); if (ok(f)) out.push(f); }
    } else {
      for (let y = y0, m = m0, n = 0; iso(y, m, 1) <= fin && n < 1200; n++) {
        const dias = r.frecuencia === "quincenal" ? [15, diasMes(y, m)] : [Math.min(d0, diasMes(y, m))];
        for (const d of dias) { const f = iso(y, m, d); if (ok(f)) out.push(f); }
        if (++m > 12) { m = 1; y++; }
      }
    }
    return out;
  }
  /* genera los movimientos que tocan hasta hoy; devuelve { nuevos, reglas } */
  function aplicarAutomaticos(reglas, hoy) {
    const nuevos = [], cambiadas = [];
    for (const r of reglas) {
      const fs = fechasPendientes(r, hoy);
      if (!fs.length) continue;
      for (const f of fs) nuevos.push({
        id: "a-" + r.id + "-" + f, fecha: f, tipo: r.tipo, categoria: r.categoria, descripcion: r.descripcion,
        monto: +r.monto, moneda: r.moneda, cuenta: r.cuenta || "", origen: "automatico", nota: "", actualizado: Date.now()
      });
      r.ultima = fs[fs.length - 1]; cambiadas.push(r.id);
    }
    return { nuevos, cambiadas };
  }

  /* ---------- totales ---------- */
  const convertir = (monto, de, a, tc) => de === a ? monto : a === "CRC" ? monto * tc : monto / tc;
  function filtrar(movs, f) {
    return movs.filter(m => (!f.desde || m.fecha >= f.desde) && (!f.hasta || m.fecha <= f.hasta) && (!f.cuenta || m.cuenta === f.cuenta));
  }
  function resumen(movs, moneda, tc) {
    const t = { ingreso: 0, gasto: 0, ahorro: 0, inversion: 0 };
    for (const m of movs) if (t[m.tipo] != null) t[m.tipo] += convertir(+m.monto || 0, m.moneda, moneda, tc);
    t.disponible = t.ingreso - t.gasto - t.ahorro - t.inversion;
    t.creditos = t.ingreso; t.debitos = t.gasto + t.ahorro + t.inversion;
    t.tasaAhorro = t.ingreso > 0 ? (t.ahorro + t.inversion) / t.ingreso : null;
    t.pctGasto = t.ingreso > 0 ? t.gasto / t.ingreso : null;
    return t;
  }
  function porCategoria(movs, tipo, moneda, tc) {
    const m = new Map();
    for (const x of movs) if (x.tipo === tipo) m.set(x.categoria || "Sin categoría", (m.get(x.categoria || "Sin categoría") || 0) + convertir(+x.monto || 0, x.moneda, moneda, tc));
    return [...m].map(([categoria, total]) => ({ categoria, total })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  }
  function serie(movs, grano, moneda, tc) {
    const corte = grano === "dia" ? 10 : grano === "mes" ? 7 : 4, m = new Map();
    for (const x of movs) {
      if (!x.fecha || !TIPOS.includes(x.tipo)) continue;
      const k = x.fecha.slice(0, corte);
      if (!m.has(k)) m.set(k, { clave: k, ingreso: 0, gasto: 0, ahorro: 0, inversion: 0 });
      m.get(k)[x.tipo] += convertir(+x.monto || 0, x.moneda, moneda, tc);
    }
    return [...m.values()].sort((a, b) => a.clave < b.clave ? -1 : 1);
  }

  /* ---------- combinación con la hoja de Google ---------- */
  /* remoto manda, salvo lo que cambió aquí (sucios) o se borró aquí (borrados).
   * Lo local que ya no está en la hoja y no está sucio se borró en otro lado. */
  function combinar(local, remoto, sucios, borrados) {
    const S = new Set(sucios), B = new Set(borrados), L = new Map(local.map(m => [m.id, m])), out = [], vistos = new Set();
    for (const r of remoto) {
      if (B.has(r.id) || vistos.has(r.id)) continue;
      vistos.add(r.id);
      const l = L.get(r.id);
      out.push(l && S.has(r.id) && (+l.actualizado || 0) >= (+r.actualizado || 0) ? l : r);
    }
    for (const l of local) if (!vistos.has(l.id) && S.has(l.id)) out.push(l);
    return out;
  }
  function aFila(o, campos) { return campos.map(c => o[c] == null ? "" : o[c]); }
  /* filas de la hoja → objetos. Devuelve también los ids de filas escritas a mano (sin id). */
  function deFilas(filas, campos, validar) {
    const out = [], sinId = [];
    if (!filas || !filas.length) return { items: out, sinId };
    const enc = filas[0].map(norm), idx = campos.map(c => enc.indexOf(norm(c)));
    for (const f of filas.slice(1)) {
      const o = {};
      campos.forEach((c, i) => { o[c] = idx[i] >= 0 && f[idx[i]] != null ? f[idx[i]] : ""; });
      if (!validar(o)) continue;
      if (!o.id) { o.id = nuevoId("h"); sinId.push(o.id); }
      o.id = String(o.id);
      out.push(o);
    }
    return { items: out, sinId };
  }
  function limpiarMov(o) {
    o.fecha = parseDate(o.fecha, null);
    o.monto = parseAmount(o.monto);
    const t = norm(o.tipo);
    o.tipo = t.startsWith("ing") ? "ingreso" : t.startsWith("aho") ? "ahorro" : t.startsWith("inv") ? "inversion" : t.startsWith("gas") ? "gasto" : "";
    o.moneda = /usd|\$|dolar/.test(norm(o.moneda)) ? "USD" : "CRC";
    o.actualizado = +o.actualizado || 0;
    for (const k of ["categoria", "descripcion", "cuenta", "origen", "nota"]) o[k] = String(o[k] == null ? "" : o[k]);
    return !!(o.fecha && o.monto != null && o.tipo);
  }
  function limpiarAuto(o) {
    o.inicio = parseDate(o.inicio, null); o.fin = parseDate(o.fin, null) || ""; o.ultima = parseDate(o.ultima, null) || "";
    o.monto = parseAmount(o.monto);
    o.activo = (o.activo === "" || +o.activo || /^(si|sí|true|x)$/i.test(String(o.activo))) ? 1 : 0;
    o.moneda = /usd|\$|dolar/.test(norm(o.moneda)) ? "USD" : "CRC";
    if (!["unica", "semanal", "bisemanal", "quincenal", "mensual", "anual"].includes(o.frecuencia)) o.frecuencia = "mensual";
    return !!(o.inicio && o.monto && TIPOS.includes(o.tipo));
  }

  return {
    TIPOS, TIPO_NOMBRE, CAMPOS, CAMPOS_AUTO, CATEGORIAS,
    norm, hoyISO, sumarDias, nuevoId, diasMes, iso,
    parseAmount, parseDate, detectarMoneda, tipoDe, categorizar, claveDe,
    parseTabla, parsePdfLineas, aMovimiento, huella,
    fechasPendientes, aplicarAutomaticos,
    convertir, filtrar, resumen, porCategoria, serie,
    combinar, aFila, deFilas, limpiarMov, limpiarAuto
  };
});
