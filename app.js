/* Alcancía · interfaz, gráficos y conexión con Google Sheets. La lógica pura está en core.js. */
(function () {
  "use strict";
  const C = window.Core, CFG = window.ALCANCIA_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLOR = { ingreso: "var(--s-ingreso)", gasto: "var(--s-gasto)", ahorro: "var(--s-ahorro)", inversion: "var(--s-inversion)", disponible: "var(--s-neutral)" };
  const PLURAL = { ingreso: "Ingresos", gasto: "Gastos", ahorro: "Ahorros", inversion: "Inversiones" };
  const FREC = { semanal: "Cada semana", bisemanal: "Cada 2 semanas", quincenal: "Quincenal (15 y fin de mes)", mensual: "Cada mes", anual: "Cada año" };

  /* ---------- estado local ---------- */
  const LS = "alcancia.v1";
  const S = Object.assign({
    movs: [], autos: [], sucios: [], borrados: [], autosSucio: 0, ajSucio: 0,
    aj: { tc: CFG.tipoCambio || 500, moneda: "CRC", reglas: [] },
    hojaId: null, cuenta: null, ultimaSync: 0
  }, leer());
  function leer() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  function guardar() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { toast("No se pudo guardar en este dispositivo (memoria llena)."); } }

  const UI = { vista: "resumen", periodo: "mes", desde: "", hasta: "", grano: "", series: { gasto: true, ahorro: true, inversion: true, ingreso: false }, dona: "categorias", q: "", ftipo: "", limite: 200, prev: null, cola: [] };

  /* ---------- formato ---------- */
  const nf = {};
  function fmt(n, mon) {
    mon = mon || S.aj.moneda;
    const k = mon + (Math.abs(n) % 1 > 0.004 || mon === "USD" ? "d" : "");
    nf[k] = nf[k] || new Intl.NumberFormat("es-CR", { style: "currency", currency: mon, minimumFractionDigits: k.endsWith("d") ? 2 : 0, maximumFractionDigits: k.endsWith("d") ? 2 : 0 });
    return nf[k].format(n);
  }
  const corto = n => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",") + " M" : a >= 1e3 ? Math.round(n / 1e3) + " mil" : String(Math.round(n)); };
  const pct = x => x == null ? "—" : (x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0).replace(".", ",") + " %";
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
  function etiqueta(clave, largo) {
    const [y, m, d] = clave.split("-");
    if (d) return largo ? `${+d} ${MES[m - 1]} ${y}` : `${+d} ${MES[m - 1]}`;
    if (m) return `${MES[m - 1]} ${largo ? y : y.slice(2)}`;
    return y;
  }
  const fechaLarga = f => new Date(f + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let tT; function toast(t) { const e = $("#toast"); e.textContent = t; e.style.display = "block"; clearTimeout(tT); tT = setTimeout(() => e.style.display = "none", 3800); }

  /* ---------- cambios de datos ---------- */
  function marcar(id) { if (!S.sucios.includes(id)) S.sucios.push(id); }
  function ponerMov(m) {
    m.actualizado = Date.now();
    const i = S.movs.findIndex(x => x.id === m.id);
    if (i >= 0) S.movs[i] = m; else S.movs.push(m);
    marcar(m.id);
  }
  function quitarMov(id) {
    S.movs = S.movs.filter(m => m.id !== id); S.sucios = S.sucios.filter(x => x !== id);
    if (!S.borrados.includes(id)) S.borrados.push(id);
  }
  function cambio() { guardar(); pintar(); programarSync(); }
  function correrAutomaticos() {
    const r = C.aplicarAutomaticos(S.autos, C.hoyISO());
    if (!r.nuevos.length) return 0;
    const ids = new Set(S.movs.map(m => m.id)), borr = new Set(S.borrados);
    let n = 0;
    for (const m of r.nuevos) if (!ids.has(m.id) && !borr.has(m.id)) { S.movs.push(m); marcar(m.id); n++; }
    S.autosSucio = Date.now();
    return n;
  }
  const cuentas = () => [...new Set(["Efectivo", "BCR", "Coopenae", ...S.movs.map(m => m.cuenta).filter(Boolean)])];
  const catsDe = tipo => [...new Set([...C.CATEGORIAS[tipo], ...S.movs.filter(m => m.tipo === tipo).map(m => m.categoria).filter(Boolean)])];

  /* ---------- periodo ---------- */
  function rango() {
    const h = C.hoyISO(), y = +h.slice(0, 4), m = +h.slice(5, 7);
    switch (UI.periodo) {
      case "mes": return { desde: C.iso(y, m, 1), hasta: C.iso(y, m, C.diasMes(y, m)), grano: "dia" };
      case "mesant": { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { desde: C.iso(yy, mm, 1), hasta: C.iso(yy, mm, C.diasMes(yy, mm)), grano: "dia" }; }
      case "anio": return { desde: y + "-01-01", hasta: y + "-12-31", grano: "mes" };
      case "12m": { let yy = y - 1, mm = m + 1; if (mm > 12) { mm = 1; yy++; } return { desde: C.iso(yy, mm, 1), hasta: h, grano: "mes" }; }
      case "rango": return { desde: UI.desde, hasta: UI.hasta, grano: "mes" };
      default: return { desde: "", hasta: "", grano: "mes" };
    }
  }

  /* ================= vistas ================= */
  function pintar() {
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + UI.vista));
    $$("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === UI.vista));
    ({ resumen: vResumen, movs: vMovs, importar: vImportar, autos: vAutos, ajustes: vAjustes })[UI.vista]();
    pintarSync();
  }

  /* ----- Resumen ----- */
  function vResumen() {
    const el = $("#v-resumen"), r = rango(), mon = S.aj.moneda, tc = +S.aj.tc || 500;
    const movs = C.filtrar(S.movs, r), t = C.resumen(movs, mon, tc);
    const grano = UI.grano || r.grano;
    const fmtT = n => fmt(mon === "CRC" ? Math.round(n) : n, mon);
    const tile = (k, nombre, nota) => `<div class="tile"><div class="k"><i style="background:${COLOR[k]}"></i>${nombre}</div><div class="v">${fmtT(t[k])}</div><div class="n">${nota}</div></div>`;
    el.innerHTML = `
      <div class="filters">
        <select id="fPer" aria-label="Periodo">
          ${[["mes", "Este mes"], ["mesant", "Mes pasado"], ["anio", "Este año"], ["12m", "Últimos 12 meses"], ["todo", "Todo el histórico"], ["rango", "Fechas a elegir"]].map(o => `<option value="${o[0]}" ${UI.periodo === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}
        </select>
        ${UI.periodo === "rango" ? `<input type="date" id="fDes" value="${esc(UI.desde)}" aria-label="Desde"><input type="date" id="fHas" value="${esc(UI.hasta)}" aria-label="Hasta">` : ""}
        <div class="seg" id="fMon" role="group" aria-label="Moneda">
          <button data-m="CRC" class="${mon === "CRC" ? "on" : ""}">₡ Colones</button><button data-m="USD" class="${mon === "USD" ? "on" : ""}">$ Dólares</button>
        </div>
      </div>
      ${!S.movs.length ? `<div class="card empty"><h2>Todavía no hay movimientos</h2><p>Sube un estado de cuenta en <b>Estados</b> o toca <b>+</b> para anotar un gasto en efectivo.</p></div>` : `
      <div class="tiles">
        ${tile("ingreso", "Ingresos", "créditos del periodo")}
        ${tile("gasto", "Gastos", t.pctGasto == null ? "sin ingresos registrados" : pct(t.pctGasto) + " del ingreso")}
        ${tile("ahorro", "Ahorros", t.ingreso > 0 ? pct(t.ahorro / t.ingreso) + " del ingreso" : "apartado")}
        ${tile("inversion", "Inversiones", t.ingreso > 0 ? pct(t.inversion / t.ingreso) + " del ingreso" : "invertido")}
        <div class="tile wide"><div class="k"><i style="background:${COLOR.disponible}"></i>Disponible</div><div class="v">${fmtT(t.disponible)}</div><div class="n">ingresos − débitos (${fmt(t.debitos, mon)})</div></div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <h2>${UI.dona === "categorias" ? "En qué se van los gastos" : "A dónde va el ingreso"}</h2>
          <div class="seg" id="fDona"><button data-d="categorias" class="${UI.dona === "categorias" ? "on" : ""}">Por categoría</button><button data-d="destino" class="${UI.dona === "destino" ? "on" : ""}">Gasto / ahorro</button></div>
        </div>
        <div id="gDona"></div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <h2>Montos por ${grano === "dia" ? "día" : grano === "mes" ? "mes" : "año"}</h2>
          <div class="seg" id="fGrano">${[["dia", "Día"], ["mes", "Mes"], ["anio", "Año"]].map(g => `<button data-g="${g[0]}" class="${grano === g[0] ? "on" : ""}">${g[1]}</button>`).join("")}</div>
        </div>
        <div class="chips" id="fSeries" style="margin-bottom:10px">${["gasto", "ahorro", "inversion", "ingreso"].map(k => `<button class="chip ${UI.series[k] ? "on" : ""}" data-s="${k}" aria-pressed="${!!UI.series[k]}"><i style="background:${COLOR[k]}"></i>${PLURAL[k]}</button>`).join("")}</div>
        <div id="gBarras"></div>
      </div>`}`;
    $("#fPer").onchange = e => { UI.periodo = e.target.value; UI.grano = ""; if (UI.periodo === "rango" && !UI.desde) { UI.hasta = C.hoyISO(); UI.desde = C.sumarDias(UI.hasta, -90); } pintar(); };
    if ($("#fDes")) { $("#fDes").onchange = e => { UI.desde = e.target.value; pintar(); }; $("#fHas").onchange = e => { UI.hasta = e.target.value; pintar(); }; }
    $$("#fMon button").forEach(b => b.onclick = () => { S.aj.moneda = b.dataset.m; S.ajSucio = Date.now(); cambio(); });
    if (!S.movs.length) return;
    $$("#fDona button").forEach(b => b.onclick = () => { UI.dona = b.dataset.d; pintar(); });
    $$("#fGrano button").forEach(b => b.onclick = () => { UI.grano = b.dataset.g; pintar(); });
    $$("#fSeries button").forEach(b => b.onclick = () => { UI.series[b.dataset.s] = !UI.series[b.dataset.s]; if (!Object.values(UI.series).some(Boolean)) UI.series.gasto = true; pintar(); });

    let partes;
    if (UI.dona === "categorias") {
      const cs = C.porCategoria(movs, "gasto", mon, tc);
      partes = cs.slice(0, 7).map((c, i) => ({ nombre: c.categoria, valor: c.total, color: `var(--c${i + 1})` }));
      const resto = cs.slice(7).reduce((a, c) => a + c.total, 0);
      if (resto > 0) partes.push({ nombre: `Otras (${cs.length - 7})`, valor: resto, color: "var(--c8)" });
    } else {
      partes = ["gasto", "ahorro", "inversion"].map(k => ({ nombre: PLURAL[k], valor: t[k], color: COLOR[k] }));
      if (t.disponible > 0) partes.push({ nombre: "Disponible", valor: t.disponible, color: COLOR.disponible });
      partes = partes.filter(p => p.valor > 0);
    }
    dona($("#gDona"), partes, mon, UI.dona === "categorias" ? "gastado" : (t.ingreso > 0 && t.disponible >= 0 ? "ingresos" : "salidas"));
    const sr = C.serie(movs, grano === "anio" ? "anio" : grano, mon, tc);
    barras($("#gBarras"), sr, ["gasto", "ahorro", "inversion", "ingreso"].filter(k => UI.series[k]), mon);
  }

  /* ----- gráfico circular ----- */
  function dona(el, partes, mon, pie) {
    const total = partes.reduce((a, p) => a + p.valor, 0);
    if (!total) { el.innerHTML = `<div class="empty">No hay datos en este periodo.</div>`; return; }
    const R = 100, r = 62, cx = 120, cy = 120;
    let a0 = -Math.PI / 2, arcos = "";
    const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    partes.forEach((p, i) => {
      const fr = p.valor / total, a1 = a0 + fr * Math.PI * 2 - (partes.length > 1 ? 0.0001 : 0.0005);
      const g = fr > 0.5 ? 1 : 0, [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
      arcos += `<path data-i="${i}" d="M${x0} ${y0}A${R} ${R} 0 ${g} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${g} 0 ${x3} ${y3}Z" fill="${p.color}" stroke="var(--surface)" stroke-width="2" stroke-linejoin="round"/>`;
      a0 += fr * Math.PI * 2;
    });
    el.innerHTML = `<div class="donut"><div class="chart"><svg viewBox="0 0 240 240" role="img" aria-label="Gráfico circular: porcentaje por parte">${arcos}
      <text class="big" x="${cx}" y="${cy + 2}" text-anchor="middle">${esc(total >= 1e7 ? (mon === "CRC" ? "₡" : "$") + corto(total) : fmt(mon === "CRC" ? Math.round(total) : total, mon))}</text>
      <text x="${cx}" y="${cy + 20}" text-anchor="middle">${pie}</text></svg><div class="tip"></div></div>
      <ul class="legend">${partes.map(p => `<li><i style="background:${p.color}"></i><span class="nm">${esc(p.nombre)}</span><span class="am">${fmt(p.valor, mon)}</span><span class="pc">${pct(p.valor / total)}</span></li>`).join("")}</ul></div>`;
    const tip = $(".tip", el), ch = $(".chart", el);
    $$("path", el).forEach(pa => {
      pa.onpointermove = e => { const p = partes[+pa.dataset.i]; tip.innerHTML = `<b>${esc(p.nombre)}</b>${pct(p.valor / total)} · ${fmt(p.valor, mon)}`; colocar(tip, ch, e); };
      pa.onpointerleave = () => tip.style.display = "none";
    });
  }
  function colocar(tip, cont, e) {
    tip.style.display = "block";
    const b = cont.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(b.width - w, e.clientX - b.left - w / 2)) + "px";
    tip.style.top = Math.max(0, e.clientY - b.top - tip.offsetHeight - 14) + "px";
  }

  /* ----- gráfico de barras ----- */
  function barras(el, datos, claves, mon) {
    if (!datos.length) { el.innerHTML = `<div class="empty">No hay datos en este periodo.</div>`; return; }
    const W = Math.max(300, el.clientWidth || 600), H = 250, mL = 46, mB = 24, mT = 8, pw = W - mL - 4, ph = H - mT - mB;
    const n = claves.length, minG = n * 5 + (n - 1) * 2 + 6, cabe = Math.max(1, Math.floor(pw / minG));
    const vis = datos.slice(-cabe), gW = pw / vis.length, bw = Math.min(22, (gW - Math.min(14, gW * 0.3) - (n - 1) * 2) / n);
    const max = Math.max(1, ...vis.flatMap(d => claves.map(k => d[k])));
    const paso = (() => { const b = Math.pow(10, Math.floor(Math.log10(max))); for (const f of [0.25, 0.5, 1, 2.5, 5, 10]) if (max / (b * f) <= 4) return b * f; return b * 10; })();
    const tope = Math.ceil(max / paso) * paso, y = v => mT + ph - (v / tope) * ph;
    let g = "";
    for (let v = 0; v <= tope + 1e-9; v += paso) g += `<line x1="${mL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${mL - 6}" y="${y(v) + 4}" text-anchor="end">${corto(v)}</text>`;
    const cada = Math.ceil(vis.length / Math.max(1, Math.floor(pw / 52)));
    vis.forEach((d, i) => {
      const x0 = mL + i * gW + (gW - (n * bw + (n - 1) * 2)) / 2;
      claves.forEach((k, j) => {
        const h = Math.max(d[k] > 0 ? 1.5 : 0, (d[k] / tope) * ph), x = x0 + j * (bw + 2), rr = Math.min(4, bw / 2, h);
        if (h > 0) g += `<path d="M${x} ${mT + ph}V${mT + ph - h + rr}q0 ${-rr} ${rr} ${-rr}h${bw - 2 * rr}q${rr} 0 ${rr} ${rr}V${mT + ph}Z" fill="${COLOR[k]}"/>`;
      });
      if (i % cada === 0) g += `<text x="${mL + i * gW + gW / 2}" y="${H - 6}" text-anchor="middle">${etiqueta(d.clave)}</text>`;
      g += `<rect data-i="${i}" x="${mL + i * gW}" y="${mT}" width="${gW}" height="${ph}" fill="transparent"/>`;
    });
    el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras de montos por periodo">${g}</svg><div class="tip"></div></div>
      ${vis.length < datos.length ? `<p class="sub" style="margin:6px 0 0">Se muestran los últimos ${vis.length} de ${datos.length}. Cambia el periodo o agrupa por mes o año para ver más.</p>` : ""}
      <details class="tbl"><summary>Ver como tabla</summary><div class="scroll"><table><thead><tr><th>Periodo</th>${claves.map(k => `<th class="num">${PLURAL[k]}</th>`).join("")}</tr></thead>
      <tbody>${datos.map(d => `<tr><td>${etiqueta(d.clave, true)}</td>${claves.map(k => `<td class="num">${fmt(d[k], mon)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
    const tip = $(".tip", el), ch = $(".chart", el);
    $$("rect", el).forEach(rc => {
      rc.onpointermove = e => { const d = vis[+rc.dataset.i]; tip.innerHTML = `<b>${etiqueta(d.clave, true)}</b>` + claves.map(k => `<span><i style="background:${COLOR[k]}"></i>${PLURAL[k]}: ${fmt(d[k], mon)}</span>`).join(""); colocar(tip, ch, e); };
      rc.onpointerleave = () => tip.style.display = "none";
    });
  }

  /* ----- Movimientos ----- */
  function vMovs() {
    const el = $("#v-movs"), q = C.norm(UI.q);
    let ms = S.movs.filter(m => (!UI.ftipo || m.tipo === UI.ftipo) && (!q || C.norm([m.descripcion, m.categoria, m.cuenta, m.nota].join(" ")).includes(q)));
    ms.sort((a, b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (b.actualizado || 0) - (a.actualizado || 0));
    const total = ms.length; ms = ms.slice(0, UI.limite);
    let html = "", dia = "";
    for (const m of ms) {
      if (m.fecha !== dia) { dia = m.fecha; html += `<li class="day">${esc(fechaLarga(dia))}</li>`; }
      html += `<li><button class="item" data-id="${esc(m.id)}"><i style="background:${COLOR[m.tipo]}"></i><span style="min-width:0"><span class="d" style="display:block">${esc(m.descripcion || m.categoria)}</span><span class="m" style="display:block">${esc(C.TIPO_NOMBRE[m.tipo])} · ${esc(m.categoria)}${m.cuenta ? " · " + esc(m.cuenta) : ""}${m.origen === "automatico" ? " · automático" : ""}</span></span><span class="a">${m.tipo === "ingreso" ? "+" : "−"}${fmt(Math.abs(m.monto), m.moneda)}</span></button></li>`;
    }
    el.innerHTML = `<div class="filters"><input type="search" id="mQ" class="grow" placeholder="Buscar…" value="${esc(UI.q)}" aria-label="Buscar movimientos">
      <select id="mT" aria-label="Tipo"><option value="">Todos</option>${C.TIPOS.map(t => `<option value="${t}" ${UI.ftipo === t ? "selected" : ""}>${PLURAL[t]}</option>`).join("")}</select></div>
      ${total ? `<ul class="list">${html}</ul>${total > ms.length ? `<button class="btn" id="mMas" style="width:100%">Ver más (${total - ms.length} restantes)</button>` : ""}` : `<div class="card empty">${S.movs.length ? "Nada coincide con la búsqueda." : "Aún no hay movimientos. Toca <b>+</b> para agregar el primero."}</div>`}`;
    $("#mQ").oninput = e => { UI.q = e.target.value; const p = e.target.selectionStart; vMovs(); const i = $("#mQ"); i.focus(); i.setSelectionRange(p, p); };
    $("#mT").onchange = e => { UI.ftipo = e.target.value; vMovs(); };
    if ($("#mMas")) $("#mMas").onclick = () => { UI.limite += 300; vMovs(); };
    $$(".item", el).forEach(b => b.onclick = () => formulario("mov", S.movs.find(m => m.id === b.dataset.id)));
  }

  /* ----- formulario (movimiento o automático) ----- */
  function formulario(modo, obj) {
    const nuevo = !obj, auto = modo === "auto", d = $("#dlg");
    const o = Object.assign({ tipo: "gasto", fecha: C.hoyISO(), inicio: C.hoyISO(), fin: "", monto: "", moneda: S.aj.moneda, categoria: "", descripcion: "", cuenta: auto ? "" : "Efectivo", nota: "", frecuencia: "mensual", activo: 1 }, obj || {});
    d.innerHTML = `<form method="dialog" id="frm">
      <h2>${nuevo ? (auto ? "Nuevo movimiento automático" : "Agregar movimiento") : (auto ? "Editar automático" : "Editar movimiento")}</h2>
      <div class="seg" id="fTipo" style="display:grid;grid-template-columns:repeat(4,1fr)">${C.TIPOS.map(t => `<button type="button" data-t="${t}" class="${o.tipo === t ? "on" : ""}">${C.TIPO_NOMBRE[t]}</button>`).join("")}</div>
      <div class="two"><label class="f">Monto<input name="monto" inputmode="decimal" required value="${esc(o.monto)}" placeholder="0" autocomplete="off"></label>
        <label class="f">Moneda<select name="moneda"><option value="CRC" ${o.moneda === "CRC" ? "selected" : ""}>₡ Colones</option><option value="USD" ${o.moneda === "USD" ? "selected" : ""}>$ Dólares</option></select></label></div>
      <label class="f">Descripción<input name="descripcion" value="${esc(o.descripcion)}" placeholder="${auto ? "Ej.: Salario, alquiler, ahorro mensual" : "Ej.: Almuerzo, feria, taxi"}" ${auto ? "required" : ""} autocomplete="off"></label>
      <div class="two"><label class="f">Categoría<input name="categoria" list="dlCat" value="${esc(o.categoria)}" placeholder="Automática" autocomplete="off"><datalist id="dlCat"></datalist></label>
        <label class="f">Cuenta<input name="cuenta" list="dlCta" value="${esc(o.cuenta)}" autocomplete="off"><datalist id="dlCta">${cuentas().map(c => `<option value="${esc(c)}">`).join("")}</datalist></label></div>
      ${auto ? `<label class="f">Se repite<select name="frecuencia">${Object.keys(FREC).map(k => `<option value="${k}" ${o.frecuencia === k ? "selected" : ""}>${FREC[k]}</option>`).join("")}</select></label>
        <div class="two"><label class="f">Desde<input type="date" name="inicio" required value="${esc(o.inicio)}"></label><label class="f">Hasta (opcional)<input type="date" name="fin" value="${esc(o.fin)}"></label></div>
        <label class="row" style="font-size:14px"><input type="checkbox" name="activo" ${+o.activo ? "checked" : ""}> Activo</label>`
        : `<div class="two"><label class="f">Fecha<input type="date" name="fecha" required value="${esc(o.fecha)}"></label><label class="f">Nota (opcional)<input name="nota" value="${esc(o.nota)}" autocomplete="off"></label></div>`}
      <p class="sub" id="fAyuda" style="margin:0"></p>
      <div class="row" style="justify-content:flex-end">
        ${nuevo ? "" : `<button type="button" class="btn danger" id="fDel" style="margin-right:auto">Eliminar</button>`}
        <button type="button" class="btn" id="fCan">Cancelar</button><button class="btn pri" id="fOk">Guardar</button></div></form>`;
    let tipo = o.tipo;
    const f = $("#frm"), ponTipo = () => {
      $$("#fTipo button").forEach(b => b.classList.toggle("on", b.dataset.t === tipo));
      $("#dlCat").innerHTML = catsDe(tipo).map(c => `<option value="${esc(c)}">`).join("");
      $("#fAyuda").textContent = tipo === "ahorro" || tipo === "inversion" ? "Para un retiro, escribe el monto en negativo (por ejemplo −50000)." : "";
    };
    $$("#fTipo button").forEach(b => b.onclick = () => { tipo = b.dataset.t; ponTipo(); });
    ponTipo();
    $("#fCan").onclick = () => d.close();
    if ($("#fDel")) $("#fDel").onclick = () => {
      if (!confirm(auto ? "¿Eliminar este automático? Los movimientos que ya generó se conservan." : "¿Eliminar este movimiento?")) return;
      if (auto) { S.autos = S.autos.filter(a => a.id !== o.id); S.autosSucio = Date.now(); } else quitarMov(o.id);
      d.close(); cambio(); toast("Eliminado.");
    };
    f.onsubmit = e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f)), monto = C.parseAmount(v.monto);
      if (!monto) { toast("Escribe un monto válido."); return; }
      const desc = v.descripcion.trim();
      const cat = v.categoria.trim() || C.categorizar(desc, tipo, S.aj.reglas);
      if (auto) {
        const r = Object.assign({}, o, { id: o.id || C.nuevoId("r"), tipo, monto, moneda: v.moneda, descripcion: desc, categoria: cat, cuenta: v.cuenta.trim(), frecuencia: v.frecuencia, inicio: v.inicio, fin: v.fin || "", activo: v.activo ? 1 : 0 });
        if (nuevo || r.inicio !== o.inicio) r.ultima = "";
        const i = S.autos.findIndex(a => a.id === r.id); if (i >= 0) S.autos[i] = r; else S.autos.push(r);
        S.autosSucio = Date.now();
        const n = correrAutomaticos();
        d.close(); cambio(); toast(n ? `Guardado. Se agregaron ${n} movimientos pendientes.` : "Guardado.");
      } else {
        if (!nuevo && v.categoria.trim() && v.categoria.trim() !== o.categoria) aprender(desc, tipo, cat);
        ponerMov(Object.assign({}, o, { id: o.id || C.nuevoId("m"), tipo, monto, moneda: v.moneda, descripcion: desc || cat, categoria: cat, cuenta: v.cuenta.trim(), fecha: v.fecha, nota: v.nota.trim(), origen: o.origen || "manual" }));
        d.close(); cambio(); toast("Guardado.");
      }
    };
    d.showModal();
    if (nuevo) f.monto.focus();
  }
  function aprender(desc, tipo, categoria) {
    const clave = C.claveDe(desc);
    if (clave.length < 3) return;
    S.aj.reglas = (S.aj.reglas || []).filter(r => !(r.clave === clave && r.tipo === tipo));
    S.aj.reglas.unshift({ clave, tipo, categoria });
    S.aj.reglas = S.aj.reglas.slice(0, 300);
    S.ajSucio = Date.now();
  }

  /* ----- Estados de cuenta ----- */
  function vImportar() {
    const el = $("#v-importar");
    if (UI.prev) return vPrevia(el);
    el.innerHTML = `<div class="card"><h2>Subir estado de cuenta</h2>
      <p class="sub">PDF, Excel (.xlsx, .xls) o CSV del BCR, Coopenae u otro banco. El archivo se lee en tu dispositivo; no se sube a ningún servidor.</p>
      <label class="drop" id="drop"><input type="file" id="arch" accept=".pdf,.csv,.xls,.xlsx,.txt,application/pdf" multiple hidden>
        <b>Elegir archivos</b><span class="sub">o arrástralos aquí</span></label>
      <p class="note">Antes de guardar verás cada movimiento para revisar si es gasto, ingreso, ahorro o inversión. Si el banco ofrece Excel o CSV, se lee con más precisión que el PDF.</p></div>`;
    const dr = $("#drop"), abrir = fs => { UI.cola = [...fs]; siguienteArchivo(); };
    $("#arch").onchange = e => abrir(e.target.files);
    dr.ondragover = e => { e.preventDefault(); dr.classList.add("over"); };
    dr.ondragleave = () => dr.classList.remove("over");
    dr.ondrop = e => { e.preventDefault(); dr.classList.remove("over"); abrir(e.dataTransfer.files); };
  }
  async function siguienteArchivo() {
    UI.prev = null;
    const f = UI.cola.shift();
    if (!f) { pintar(); return; }
    try {
      toast("Leyendo " + f.name + "…");
      const r = await leerArchivo(f);
      if (!r.filas.length) { toast(`No se encontraron movimientos en ${f.name}.`); return siguienteArchivo(); }
      const pista = C.norm(f.name + " " + r.texto);
      const cuenta = /coopenae/.test(pista) ? "Coopenae" : /\bbcr\b|banco de costa rica/.test(pista) ? "BCR" : /banco nacional|\bbncr\b/.test(pista) ? "BN" : /\bbac\b/.test(pista) ? "BAC" : "";
      UI.prev = { archivo: f.name, cuenta, moneda: r.moneda || "CRC", monedaDetectada: !!r.moneda, filas: r.filas.map(x => ({ f: x, sel: true })) };
      prepararPrevia(true);
    } catch (e) {
      console.error(e);
      toast(e && e.message ? e.message : "No se pudo leer " + f.name);
      return siguienteArchivo();
    }
    pintar();
  }
  function prepararPrevia(todo) {
    const P = UI.prev, hu = new Set(S.movs.map(C.huella));
    for (const x of P.filas) {
      if (todo || !x.mov) { const t = x.mov && x.tocado ? x.mov : null; x.mov = C.aMovimiento(x.f, { moneda: P.moneda, cuenta: P.cuenta, reglas: S.aj.reglas, origen: "estado" }); if (t) { x.mov.tipo = t.tipo; x.mov.categoria = t.categoria; } }
      x.mov.moneda = P.moneda; x.mov.cuenta = P.cuenta;
      const dup = hu.has(C.huella(x.mov));
      if (dup && !x.dup) x.sel = false;
      x.dup = dup;
    }
  }
  async function leerArchivo(f) {
    const ext = (f.name.split(".").pop() || "").toLowerCase(), buf = await f.arrayBuffer();
    if (ext === "pdf" || f.type === "application/pdf") {
      if (!window.pdfjsLib) throw new Error("No se pudo cargar el lector de PDF. Revisa tu conexión y recarga.");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      let doc, clave;
      for (let i = 0; ; i++) {
        try { doc = await pdfjsLib.getDocument({ data: buf.slice(0), password: clave }).promise; break; }
        catch (e) {
          if (e && e.name === "PasswordException" && i < 3) { clave = prompt(i ? "Contraseña incorrecta. Inténtalo de nuevo:" : "Este PDF tiene contraseña (los bancos suelen usar tu número de cédula). Escríbela para abrirlo:"); if (clave == null) throw new Error("Se canceló la apertura del PDF."); }
          else throw new Error("No se pudo abrir el PDF.");
        }
      }
      const lineas = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        const its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
        its.sort((a, b) => b.y - a.y || a.x - b.x);
        let act = null;
        for (const it of its) { if (!act || Math.abs(act.y - it.y) > 3) { act = { y: it.y, items: [] }; lineas.push(act); } act.items.push(it); }
      }
      lineas.forEach(l => l.items.sort((a, b) => a.x - b.x));
      const r = C.parsePdfLineas(lineas);
      if (!r.filas.length && !lineas.length) throw new Error("Este PDF es una imagen escaneada y no tiene texto. Descarga el estado en Excel o CSV.");
      r.texto = lineas.slice(0, 25).map(l => l.items.map(i => i.str).join(" ")).join(" ");
      return r;
    }
    if (!window.XLSX) throw new Error("No se pudo cargar el lector de Excel. Revisa tu conexión y recarga.");
    let wb;
    if (ext === "csv" || ext === "txt") {
      let txt; try { txt = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder("windows-1252").decode(buf); }
      wb = XLSX.read(txt, { type: "string", raw: true });
    } else wb = XLSX.read(buf, { type: "array" });
    let mejor = { filas: [] }, texto = "";
    for (const n of wb.SheetNames) {
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
      const r = C.parseTabla(filas);
      if (r.filas.length > mejor.filas.length) { mejor = r; texto = filas.slice(0, 12).map(x => x.join(" ")).join(" "); }
    }
    mejor.texto = texto;
    return mejor;
  }
  function vPrevia(el) {
    const P = UI.prev, sel = P.filas.filter(x => x.sel), tc = +S.aj.tc || 500;
    const deb = sel.filter(x => x.mov.tipo !== "ingreso").reduce((a, x) => a + x.mov.monto, 0), cre = sel.filter(x => x.mov.tipo === "ingreso").reduce((a, x) => a + x.mov.monto, 0);
    const dups = P.filas.filter(x => x.dup).length;
    el.innerHTML = `<div class="card"><h2>Revisar: ${esc(P.archivo)}</h2>
      <p class="sub">${P.filas.length} movimientos encontrados${UI.cola.length ? ` · faltan ${UI.cola.length} archivos` : ""}</p>
      <div class="two" style="margin-bottom:10px"><label class="f">Cuenta o banco<input id="pCta" list="pdl" value="${esc(P.cuenta)}" placeholder="Ej.: BCR colones"><datalist id="pdl">${cuentas().map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
        <label class="f">Moneda del estado<select id="pMon"><option value="CRC" ${P.moneda === "CRC" ? "selected" : ""}>₡ Colones</option><option value="USD" ${P.moneda === "USD" ? "selected" : ""}>$ Dólares</option></select></label></div>
      ${P.monedaDetectada ? "" : `<p class="note warn">No se pudo detectar la moneda del archivo. Confirma que sea la correcta.</p>`}
      ${dups ? `<p class="note">${dups} ya estaban guardados y vienen desmarcados para no duplicarlos.</p>` : ""}
      <div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><div class="k">Débitos seleccionados</div><div class="v">${fmt(deb, P.moneda)}</div></div><div class="tile"><div class="k">Créditos seleccionados</div><div class="v">${fmt(cre, P.moneda)}</div></div></div>
      <div class="row" style="margin-bottom:8px"><button class="btn sm" id="pInv">Invertir débitos ↔ créditos</button><button class="btn sm" id="pTod">${sel.length === P.filas.length ? "Desmarcar todos" : "Marcar todos"}</button></div>
      <ul class="list prev">
      ${P.filas.map((x, i) => `<li class="pr ${x.dup ? "dup" : ""}"><input type="checkbox" data-i="${i}" class="pS" ${x.sel ? "checked" : ""} aria-label="Incluir">
        <div style="min-width:0"><div class="pd">${esc(x.mov.descripcion)} ${x.dup ? `<span class="badge">ya guardado</span>` : ""}</div>
          <div class="m">${esc(etiqueta(x.mov.fecha, true))} · <b>${x.f.sentido === "credito" ? "crédito" : "débito"} ${fmt(x.mov.monto, P.moneda)}</b></div>
          <div class="row" style="margin-top:6px"><select data-i="${i}" class="pT" aria-label="Tipo">${C.TIPOS.map(t => `<option value="${t}" ${x.mov.tipo === t ? "selected" : ""}>${C.TIPO_NOMBRE[t]}</option>`).join("")}</select>
          <select data-i="${i}" class="pC grow" aria-label="Categoría">${[...new Set([x.mov.categoria, ...catsDe(x.mov.tipo)])].map(c => `<option ${x.mov.categoria === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div></div></li>`).join("")}
      </ul>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="pDes">Descartar</button><button class="btn pri" id="pOk" ${sel.length ? "" : "disabled"}>Guardar ${sel.length} movimientos</button></div></div>`;
    void tc;
    $("#pCta").onchange = e => { P.cuenta = e.target.value.trim(); prepararPrevia(false); vPrevia(el); };
    $("#pMon").onchange = e => { P.moneda = e.target.value; P.monedaDetectada = true; prepararPrevia(false); vPrevia(el); };
    $("#pInv").onclick = () => { for (const x of P.filas) { x.f.sentido = x.f.sentido === "credito" ? "debito" : "credito"; x.tocado = false; } prepararPrevia(true); vPrevia(el); };
    $("#pTod").onclick = () => { const v = sel.length !== P.filas.length; P.filas.forEach(x => x.sel = v); vPrevia(el); };
    $$(".pS", el).forEach(c => c.onchange = () => { P.filas[+c.dataset.i].sel = c.checked; vPrevia(el); });
    $$(".pT", el).forEach(s => s.onchange = () => { const x = P.filas[+s.dataset.i]; x.mov.tipo = s.value; x.mov.categoria = C.categorizar(x.mov.descripcion, s.value, S.aj.reglas); x.tocado = true; vPrevia(el); });
    $$(".pC", el).forEach(s => s.onchange = () => {
      const x = P.filas[+s.dataset.i]; x.mov.categoria = s.value; x.tocado = true; aprender(x.mov.descripcion, x.mov.tipo, s.value);
      const k = C.claveDe(x.mov.descripcion);     // misma corrección para los demás del mismo comercio
      if (k.length >= 3) for (const y of P.filas) if (y !== x && !y.tocado && y.mov.tipo === x.mov.tipo && C.claveDe(y.mov.descripcion) === k) y.mov.categoria = s.value;
      vPrevia(el);
    });
    $("#pDes").onclick = () => siguienteArchivo();
    $("#pOk").onclick = () => {
      const n = sel.length; for (const x of sel) ponerMov(x.mov);
      guardar(); programarSync(); toast(`Se guardaron ${n} movimientos.`);
      if (UI.cola.length) siguienteArchivo(); else { UI.prev = null; UI.vista = "resumen"; UI.periodo = "todo"; pintar(); }
    };
  }

  /* ----- Automáticos ----- */
  function vAutos() {
    const el = $("#v-autos"), hoy = C.hoyISO();
    const prox = r => { if (!+r.activo) return "En pausa"; const f = C.fechasPendientes(Object.assign({}, r, { ultima: r.ultima && r.ultima > hoy ? r.ultima : hoy }), C.sumarDias(hoy, 400))[0]; return f ? "Próximo: " + etiqueta(f, true) : "Terminado"; };
    el.innerHTML = `<div class="card"><h2>Movimientos automáticos</h2><p class="sub">Salario, alquiler, ahorro programado, aporte a una inversión… Se agregan solos en la fecha que toca cada vez que abres la app.</p>
      <button class="btn pri" id="aNuevo">Nuevo automático</button></div>
      ${S.autos.length ? `<ul class="list">${S.autos.map(r => `<li><button class="item" data-id="${esc(r.id)}"><i style="background:${COLOR[r.tipo]}"></i><span style="min-width:0"><span class="d" style="display:block">${esc(r.descripcion)}</span><span class="m" style="display:block">${esc(FREC[r.frecuencia])} · ${esc(prox(r))}</span></span><span class="a">${r.tipo === "ingreso" ? "+" : "−"}${fmt(Math.abs(r.monto), r.moneda)}</span></button></li>`).join("")}</ul>` : `<div class="card empty">Aún no tienes automáticos.</div>`}`;
    $("#aNuevo").onclick = () => formulario("auto");
    $$(".item", el).forEach(b => b.onclick = () => formulario("auto", S.autos.find(a => a.id === b.dataset.id)));
  }

  /* ----- Ajustes ----- */
  function vAjustes() {
    const el = $("#v-ajustes"), url = S.hojaId ? "https://docs.google.com/spreadsheets/d/" + S.hojaId : "";
    el.innerHTML = `<div class="card"><h2>Google Sheets</h2>
      ${G.token ? `<p class="sub">Conectado como <b>${esc(S.cuenta || "tu cuenta")}</b>. Cada cambio se guarda en la hoja <b>${esc(CFG.nombreHoja)}</b> de tu Google Drive.</p>
        <div class="row">${url ? `<a class="btn" href="${url}" target="_blank" rel="noopener">Abrir la hoja</a>` : ""}<button class="btn" id="jSync">Sincronizar ahora</button><button class="btn" id="jSalir">Desconectar</button></div>`
        : `<p class="sub">${S.cuenta ? `La sesión de <b>${esc(S.cuenta)}</b> venció.` : "Conecta tu cuenta de Google para guardar todo en una hoja de cálculo de tu Drive y verlo en todos tus dispositivos."}</p><button class="btn pri" id="jCon">Conectar con Google</button>`}
      ${G.error ? `<p class="note warn">${G.error}</p>` : ""}</div>
      <div class="card"><h2>Histórico</h2><p class="sub">${S.movs.length} movimientos guardados${S.sucios.length + S.borrados.length ? ` · ${S.sucios.length + S.borrados.length} cambios sin subir a Google` : ""}.</p>
        <button class="btn pri" id="jXls">Descargar histórico en Excel</button></div>
      <div class="card"><h2>Preferencias</h2>
        <div class="kv"><div>Tipo de cambio<small>Colones por dólar, para sumar las dos monedas</small></div><input type="number" id="jTc" min="1" step="0.01" value="${esc(S.aj.tc)}" style="width:110px"></div>
        <div class="kv"><div>Categorías aprendidas<small>${(S.aj.reglas || []).length} correcciones tuyas que se aplican solas</small></div><button class="btn sm" id="jReg" ${(S.aj.reglas || []).length ? "" : "disabled"}>Olvidar</button></div>
        <div class="kv"><div>Datos en este dispositivo<small>No borra nada de Google Sheets</small></div><button class="btn sm danger" id="jBor">Borrar</button></div></div>`;
    if ($("#jCon")) $("#jCon").onclick = () => conectar();
    if ($("#jSync")) $("#jSync").onclick = () => sincronizar(true);
    if ($("#jSalir")) $("#jSalir").onclick = () => { if (G.token && window.google) try { google.accounts.oauth2.revoke(G.token, () => { }); } catch (e) { } G.token = null; sessionStorage.removeItem("alcancia.tk"); S.cuenta = null; guardar(); pintar(); };
    $("#jXls").onclick = descargarExcel;
    $("#jTc").onchange = e => { const v = +e.target.value; if (v > 0) { S.aj.tc = v; S.ajSucio = Date.now(); cambio(); } };
    $("#jReg").onclick = () => { S.aj.reglas = []; S.ajSucio = Date.now(); cambio(); };
    $("#jBor").onclick = () => { if (!confirm("¿Borrar todos los datos guardados en este dispositivo? Lo que ya está en Google Sheets no se toca.")) return; localStorage.removeItem(LS); sessionStorage.removeItem("alcancia.tk"); location.reload(); };
  }

  function descargarExcel() {
    if (!window.XLSX) { toast("No se pudo cargar el generador de Excel. Revisa tu conexión."); return; }
    const mon = S.aj.moneda, tc = +S.aj.tc || 500, wb = XLSX.utils.book_new();
    const ms = [...S.movs].sort((a, b) => a.fecha < b.fecha ? -1 : 1);
    const hoja = (nombre, filas, anchos) => { const ws = XLSX.utils.aoa_to_sheet(filas); ws["!cols"] = anchos.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, nombre); };
    hoja("Movimientos", [["Fecha", "Tipo", "Categoría", "Descripción", "Monto", "Moneda", "Cuenta", "Origen", "Nota"], ...ms.map(m => [m.fecha, C.TIPO_NOMBRE[m.tipo], m.categoria, m.descripcion, +m.monto, m.moneda, m.cuenta, m.origen, m.nota])], [11, 10, 22, 40, 14, 8, 14, 11, 24]);
    const r2 = n => Math.round(n * 100) / 100;
    hoja("Resumen mensual", [["Mes", "Ingresos", "Gastos", "Ahorros", "Inversiones", "Disponible", "% gastado", "Moneda"], ...C.serie(ms, "mes", mon, tc).map(d => [d.clave, r2(d.ingreso), r2(d.gasto), r2(d.ahorro), r2(d.inversion), r2(d.ingreso - d.gasto - d.ahorro - d.inversion), d.ingreso > 0 ? r2(d.gasto / d.ingreso * 100) : "", mon])], [10, 14, 14, 14, 14, 14, 10, 8]);
    const tg = C.porCategoria(ms, "gasto", mon, tc), tot = tg.reduce((a, c) => a + c.total, 0);
    hoja("Gastos por categoría", [["Categoría", "Total", "% del gasto", "Moneda"], ...tg.map(c => [c.categoria, r2(c.total), r2(c.total / tot * 100), mon])], [24, 14, 12, 8]);
    hoja("Automáticos", [["Descripción", "Tipo", "Categoría", "Monto", "Moneda", "Frecuencia", "Desde", "Hasta", "Activo"], ...S.autos.map(a => [a.descripcion, C.TIPO_NOMBRE[a.tipo], a.categoria, +a.monto, a.moneda, FREC[a.frecuencia], a.inicio, a.fin, +a.activo ? "Sí" : "No"])], [30, 10, 22, 14, 8, 26, 11, 11, 7]);
    XLSX.writeFile(wb, `alcancia-historico-${C.hoyISO()}.xlsx`);
  }

  /* ================= Google ================= */
  const G = { token: null, exp: 0, cliente: null, ocupado: false, otra: false, error: "", estado: "" };
  const ALCANCE = "openid email profile https://www.googleapis.com/auth/drive.file";
  const SH = "https://sheets.googleapis.com/v4/spreadsheets";
  const HOJAS = { Movimientos: C.CAMPOS, Automaticos: C.CAMPOS_AUTO, Ajustes: ["clave", "valor"] };
  try { const t = JSON.parse(sessionStorage.getItem("alcancia.tk")); if (t && t.exp > Date.now() + 60000) { G.token = t.token; G.exp = t.exp; } } catch (e) { }

  function cargarGIS() {
    return G.gis = G.gis || new Promise((ok, no) => {
      if (window.google && google.accounts) return ok();
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = ok; s.onerror = () => { G.gis = null; no(new Error("No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.")); };
      document.head.appendChild(s);
    });
  }
  async function conectar() {
    try {
      if (!CFG.googleClientId) throw new Error("Falta el ID de cliente de Google en config.js.");
      await cargarGIS();
      const resp = await new Promise((ok, no) => {
        G.cliente = google.accounts.oauth2.initTokenClient({ client_id: CFG.googleClientId, scope: ALCANCE, hint: S.cuenta || undefined, callback: r => r && r.access_token ? ok(r) : no(new Error("Google no dio permiso.")), error_callback: e => no(new Error(e && e.type === "popup_closed" ? "Se cerró la ventana de Google." : "No se pudo abrir la ventana de Google. Permite las ventanas emergentes.")) });
        G.cliente.requestAccessToken({ prompt: "" });
      });
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, "https://www.googleapis.com/auth/drive.file")) throw new Error("Falta marcar el permiso de Google Drive al iniciar sesión. Vuelve a conectar y márcalo.");
      G.token = resp.access_token; G.exp = Date.now() + (resp.expires_in || 3600) * 1000;
      sessionStorage.setItem("alcancia.tk", JSON.stringify({ token: G.token, exp: G.exp }));
      const u = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + G.token } })).json();
      if (S.cuenta && u.email && S.cuenta !== u.email && S.movs.length) {
        if (!confirm(`Este dispositivo tiene datos de ${S.cuenta}. ¿Reemplazarlos por los de ${u.email}?`)) { G.token = null; sessionStorage.removeItem("alcancia.tk"); return; }
        Object.assign(S, { movs: [], autos: [], sucios: [], borrados: [], autosSucio: 0, ajSucio: 0, hojaId: null });
      }
      S.cuenta = u.email || S.cuenta; G.error = ""; guardar();
      await sincronizar(true);
    } catch (e) { G.error = esc(e.message || String(e)); toast(e.message || "No se pudo conectar."); pintar(); }
  }
  async function api(url, opc) {
    opc = opc || {};
    const r = await fetch(url, { method: opc.method || "GET", headers: Object.assign({ Authorization: "Bearer " + G.token }, opc.body ? { "Content-Type": "application/json" } : {}), body: opc.body ? JSON.stringify(opc.body) : undefined });
    if (r.ok) return r.json();
    let j = {}; try { j = await r.json(); } catch (e) { }
    const err = new Error((j.error && j.error.message) || "Error " + r.status); err.status = r.status; err.detalle = JSON.stringify(j);
    throw err;
  }
  async function asegurarHoja() {
    if (S.hojaId) {
      try {
        const m = await api(`${SH}/${S.hojaId}?fields=sheets.properties.title`);
        const hay = new Set(m.sheets.map(s => s.properties.title)), faltan = Object.keys(HOJAS).filter(h => !hay.has(h));
        if (faltan.length) {
          await api(`${SH}/${S.hojaId}:batchUpdate`, { method: "POST", body: { requests: faltan.map(t => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })) } });
          await api(`${SH}/${S.hojaId}/values:batchUpdate`, { method: "POST", body: { valueInputOption: "RAW", data: faltan.map(t => ({ range: t + "!A1", values: [HOJAS[t]] })) } });
        }
        return;
      } catch (e) { if (e.status !== 404) throw e; S.hojaId = null; }
    }
    const q = encodeURIComponent(`name='${CFG.nombreHoja.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const l = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime`);
    if (l.files && l.files.length) { S.hojaId = l.files[0].id; return asegurarHoja(); }
    const n = await api(SH, { method: "POST", body: { properties: { title: CFG.nombreHoja, locale: "es_CR" }, sheets: Object.keys(HOJAS).map(t => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })) } });
    S.hojaId = n.spreadsheetId;
    await api(`${SH}/${S.hojaId}/values:batchUpdate`, { method: "POST", body: { valueInputOption: "RAW", data: Object.keys(HOJAS).map(t => ({ range: t + "!A1", values: [HOJAS[t]] })) } });
  }
  let tSync; function programarSync() { clearTimeout(tSync); if (G.token) tSync = setTimeout(() => sincronizar(false), 1500); }
  async function sincronizar(avisar) {
    if (!G.token) return;
    if (G.ocupado) { G.otra = true; return; }
    G.ocupado = true; G.estado = "busy"; pintarSync();
    try {
      if (G.exp < Date.now() + 30000) { const e = new Error("vencida"); e.status = 401; throw e; }
      await asegurarHoja();
      const rg = Object.keys(HOJAS).map(t => "ranges=" + encodeURIComponent(t + "!A:L")).join("&");
      const vr = (await api(`${SH}/${S.hojaId}/values:batchGet?${rg}&valueRenderOption=UNFORMATTED_VALUE`)).valueRanges.map(v => v.values || []);
      const rm = C.deFilas(vr[0], C.CAMPOS, C.limpiarMov);
      rm.sinId.forEach(marcar);
      S.movs = C.combinar(S.movs, rm.items, S.sucios, S.borrados);
      let subir = S.sucios.length > 0 || S.borrados.length > 0;
      if (!S.autosSucio) { const ra = C.deFilas(vr[1], C.CAMPOS_AUTO, C.limpiarAuto); S.autos = ra.items; if (ra.sinId.length) S.autosSucio = Date.now(); }
      if (!S.ajSucio) {
        const kv = Object.fromEntries(vr[2].slice(1).filter(f => f[0]).map(f => [f[0], f[1]]));
        if (+kv.tc > 0) S.aj.tc = +kv.tc;
        if (kv.moneda === "CRC" || kv.moneda === "USD") S.aj.moneda = kv.moneda;
        if (kv.reglas) try { const rr = JSON.parse(kv.reglas); if (Array.isArray(rr)) S.aj.reglas = rr; } catch (e) { }
        if (!vr[2].length || vr[2].length < 2) S.ajSucio = Date.now();
      }
      correrAutomaticos();
      subir = subir || S.sucios.length > 0 || S.autosSucio || S.ajSucio;
      if (subir) {
        const sello = new Map(S.sucios.map(id => { const m = S.movs.find(x => x.id === id); return [id, m ? m.actualizado : 0]; })), borr = S.borrados.slice(), sa = S.autosSucio, sj = S.ajSucio;
        const ms = [...S.movs].sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
        const datos = {
          Movimientos: [C.CAMPOS, ...ms.map(m => C.aFila(m, C.CAMPOS))],
          Automaticos: [C.CAMPOS_AUTO, ...S.autos.map(a => C.aFila(a, C.CAMPOS_AUTO))],
          Ajustes: [["clave", "valor"], ["tc", +S.aj.tc], ["moneda", S.aj.moneda], ["reglas", JSON.stringify(S.aj.reglas || [])]]
        };
        await api(`${SH}/${S.hojaId}/values:batchUpdate`, { method: "POST", body: { valueInputOption: "RAW", data: Object.keys(datos).map(t => ({ range: t + "!A1", values: datos[t] })) } });
        await api(`${SH}/${S.hojaId}/values:batchClear`, { method: "POST", body: { ranges: Object.keys(datos).map(t => `${t}!A${datos[t].length + 1}:Z`) } });
        S.sucios = S.sucios.filter(id => { const m = S.movs.find(x => x.id === id); return !(sello.has(id) && (!m || m.actualizado === sello.get(id))); });
        S.borrados = S.borrados.filter(id => !borr.includes(id));
        if (S.autosSucio === sa) S.autosSucio = 0;
        if (S.ajSucio === sj) S.ajSucio = 0;
      }
      S.ultimaSync = Date.now(); G.estado = "ok"; G.error = ""; guardar();
      if (avisar) toast("Sincronizado con Google Sheets.");
    } catch (e) {
      console.error(e);
      G.estado = "err";
      if (e.status === 401) { G.token = null; sessionStorage.removeItem("alcancia.tk"); G.error = "La sesión de Google venció. Vuelve a conectar."; }
      else if (e.status === 403 && /sheets\.googleapis|has not been used|disabled|SERVICE_DISABLED/i.test(e.message + e.detalle)) G.error = `Falta activar la <b>Google Sheets API</b> en tu proyecto de Google Cloud. <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=${esc(CFG.proyecto || "")}" target="_blank" rel="noopener">Actívala aquí</a> y vuelve a sincronizar.`;
      else G.error = "No se pudo sincronizar: " + esc(e.message || e) + ". Tus datos siguen guardados en este dispositivo.";
      if (avisar) toast(e.status === 401 ? "La sesión venció. Vuelve a conectar." : "No se pudo sincronizar. Mira Ajustes.");
      guardar();
    }
    G.ocupado = false;
    pintar();
    if (G.otra) { G.otra = false; programarSync(); }
  }
  function pintarSync() {
    const b = $("#sync"), pend = S.sucios.length + S.borrados.length;
    b.className = "sync " + (!G.token ? "" : G.estado === "busy" ? "busy" : G.estado === "err" ? "err" : "ok");
    $("#syncTxt").textContent = !G.token ? (S.cuenta ? "Reconectar con Google" : "Conectar con Google") : G.estado === "busy" ? "Sincronizando…" : G.estado === "err" ? "Error al sincronizar" : pend ? "Guardando…" : "Guardado en Google Sheets";
  }

  /* ================= inicio ================= */
  $("#sync").onclick = () => { if (!G.token) conectar(); else if (G.estado === "err") { UI.vista = "ajustes"; pintar(); } else sincronizar(true); };
  $("#fab").onclick = () => formulario("mov");
  $$("nav.tabs button").forEach(b => b.onclick = () => { UI.vista = b.dataset.v; pintar(); window.scrollTo(0, 0); });
  let tR; window.addEventListener("resize", () => { clearTimeout(tR); tR = setTimeout(() => UI.vista === "resumen" && pintar(), 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && G.token && Date.now() - S.ultimaSync > 120000) sincronizar(false); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });

  if (correrAutomaticos()) guardar();
  pintar();
  if (G.token) sincronizar(false);
  window.Alcancia = { S, UI, pintar, sincronizar };
})();
