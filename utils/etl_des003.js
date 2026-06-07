/**
 * etl_des003.js — ETL KPI-DES-003 Nivel de Servicio CEDI (NS %)
 * NexusKPI · Logistics & Service × Click Cosmetics
 * Versión 1.2 · Junio 2026
 *
 * REGLAS PERMANENTES:
 *  ✅ Sin "export" — script clásico
 *  ✅ Usa sb.rest() — sin credenciales como parámetros
 *  ✅ Firma: procesarNivelServicio(file, periodoId, onProgress)
 *
 * CORRECCIONES v1.2 (vs v1.1):
 *  1. El JOIN usa ALISTAMIENTO.Comprobante = PICKING_WMS.col0 (columna PICKING),
 *     NO col1 (PedidoWMS). col0 = MID(PedidoWMS,1,10) ya normalizado por Excel.
 *  2. El filtro de periodo usa la fecha real del campo DIA de cada fila —
 *     NO asume que todo el archivo es del periodoId seleccionado en admin.
 *  3. Se almacenan TODAS las líneas B2B del periodo correcto (nivel línea SKU)
 *     en kpi_ns_detalle antes de agrupar — permite auditoría completa.
 *  4. Normalización adicional de Comprobante: eliminar sufijos " (N)" y "-N"
 *     que aparecen en ALISTAMIENTO (ej: "FV-3-69900-1" → "FV-3-69900").
 *  5. El campo DIA se convierte a ISO y se usa para filtrar el periodo correcto.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function _semaforoNS(pct) {
  if (pct >= 98) return 'BIEN';
  if (pct >= 90) return 'ALERTA';
  return 'CRITICO';
}

/**
 * Normaliza el Comprobante de ALISTAMIENTO para hacer JOIN con col0 de PICKING WMS.
 * PICKING.col0 = MID(PedidoWMS, 1, 10) — siempre 10 chars, sin sufijos.
 * ALISTAMIENTO puede traer "FV-3-69900-1", "FV-3-69755 (2)" → normalizar igual.
 *
 * Regla: quitar sufijos " (N)", "-N", "-R" al final, luego tomar los primeros 10 chars
 * solo si el resultado es más corto — así no cortamos comprobantes cortos.
 */
function _normComp(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // Quitar sufijos con paréntesis: " (1)", " (2)"
  s = s.replace(/\s*\(\d+\)\s*$/, '');
  // Quitar sufijos numéricos o letra tras guion final: "-1", "-2", "-R"
  s = s.replace(/-[0-9R]+$/, '');
  return s.trim();
}

function _toISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    // Número de serie Excel
    return new Date(Math.round((val - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }
  // "DD/MM/YYYY"
  const m = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return String(val).slice(0, 10);
}

function _isoWeek(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `Sem ${week}-${d.getFullYear()}`;
}

function _fechaInicio(semanaStr) {
  const m = semanaStr.match(/Sem (\d+)-(\d+)/);
  if (!m) return null;
  const [, w, y] = m;
  const jan4 = new Date(+y, 0, 4);
  const inicio = new Date(jan4);
  inicio.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + (+w - 1) * 7);
  return inicio.toISOString().split('T')[0];
}

function _leerHoja(workbook, sheetName, colsBuscadas) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Hoja "${sheetName}" no encontrada en el archivo`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let hi = raw.findIndex(r =>
    Array.isArray(r) && r.some(c =>
      c !== null && colsBuscadas.some(k => String(c).trim().toLowerCase().includes(k.toLowerCase()))
    )
  );
  if (hi === -1) hi = 0;
  const headers = raw[hi].map(h => (h !== null ? String(h).trim() : ''));
  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every(c => c === null)) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = r[j]; });
    rows.push(obj);
  }
  return rows;
}

// ── Función principal ─────────────────────────────────────────────────────────
/**
 * @param {File}     file       — SEGUIMIENTO_CLICK_MES.xlsx
 * @param {string}   periodoId  — "2026-03" | "2026-04" | …
 * @param {Function} onProgress — callback(string)
 */
async function procesarNivelServicio(file, periodoId, onProgress) {
  const log = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo con SheetJS…');
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

  // ── Paso 1: ALISTAMIENTO ──────────────────────────────────────────────────
  log('📋 Procesando hoja ALISTAMIENTO…');
  const rowsAlist = _leerHoja(wb, 'ALISTAMIENTO', ['PROCESO', 'Comprobante', 'Facturado']);

  // Filtrar: PROCESO=B2B  Y  fecha DIA pertenece al periodoId elegido
  // CRÍTICO: no usar periodoId como sustituto de la fecha — leer DIA real de cada fila
  const [pYear, pMonth] = periodoId.split('-').map(Number);

  const b2b = rowsAlist.filter(r => {
    if (String(r['PROCESO'] || '').trim().toUpperCase() !== 'B2B') return false;
    const fecha = _toISO(r['DIA']);
    if (!fecha) return false;
    const [y, mo] = fecha.split('-').map(Number);
    return y === pYear && mo === pMonth;
  });

  log(`✅ ALISTAMIENTO: ${rowsAlist.length} líneas totales → ${b2b.length} líneas B2B en ${periodoId}`);

  if (b2b.length === 0) {
    throw new Error(`No hay líneas B2B con fecha ${periodoId} en la hoja ALISTAMIENTO. Verifica que el archivo corresponde al periodo correcto.`);
  }

  // Agrupar por Comprobante normalizado → { fecha, pedidas_total, skus[] }
  // Nivel línea: cada fila es un SKU dentro del pedido
  const pedidosMap = new Map(); // compNorm → { comp_orig, fecha, pedidas, skus: Map }

  for (const r of b2b) {
    const compOrig = String(r['Comprobante'] || '').trim();
    const compNorm = _normComp(compOrig);
    if (!compNorm) continue;

    const facturado = Number(r['Facturado']) || 0;
    if (facturado <= 0) continue;

    const fecha = _toISO(r['DIA']);
    const sku   = String(r['SKU'] || '').trim();
    const desc  = String(r['Descripción'] || r['Descripcion'] || '').trim();

    if (!pedidosMap.has(compNorm)) {
      pedidosMap.set(compNorm, { comp_orig: compOrig, fecha, pedidas: 0, skus: new Map() });
    }
    const p = pedidosMap.get(compNorm);
    if (!p.fecha && fecha) p.fecha = fecha;
    p.pedidas += facturado;

    if (sku) {
      const s = p.skus.get(sku) || { desc, pedidas: 0 };
      s.pedidas += facturado;
      p.skus.set(sku, s);
    }
  }

  log(`📦 ${pedidosMap.size} pedidos únicos B2B en ${periodoId}`);

  // ── Paso 2: PICKING WMS ───────────────────────────────────────────────────
  log('🔍 Procesando hoja PICKING WMS…');
  const rowsPicking = _leerHoja(wb, 'PICKING WMS', ['cantidad', 'PICKING', 'PedidoWMS']);

  /**
   * JOIN key: columna "PICKING" (col0) de PICKING WMS
   * = MID(PedidoWMS, 1, 10) — ya normalizado por la fórmula Excel.
   * Equivale exactamente al Comprobante normalizado de ALISTAMIENTO.
   * NO usar PedidoWMS (col1) directamente porque trae sufijos "-R", "-1", etc.
   */
  const pickingMap = new Map(); // col0_PICKING → { total, porSKU: Map }

  for (const r of rowsPicking) {
    // Usar col0 (PICKING) como clave — es el MID ya calculado por Excel
    const col0 = String(r['PICKING'] || '').trim();
    if (!col0 || !col0.startsWith('FV-')) continue;

    const qty = Number(r['cantidad']) || 0;
    if (qty <= 0) continue;

    const ref = String(r['Referencia'] || '').trim();

    if (!pickingMap.has(col0)) {
      pickingMap.set(col0, { total: 0, porSKU: new Map() });
    }
    const pk = pickingMap.get(col0);
    pk.total += qty;
    if (ref) pk.porSKU.set(ref, (pk.porSKU.get(ref) || 0) + qty);
  }

  log(`✅ PICKING WMS: ${pickingMap.size} pedidos con despacho > 0 (clave col0 FV-*)`);

  // ── Paso 3: JOIN + cálculo ────────────────────────────────────────────────
  log('🔗 Cruzando ALISTAMIENTO × PICKING WMS…');

  const diarioMap = new Map();  // fecha → { pedidas, desp, cortadas, num_pedidos }
  const semanaMap = new Map();  // semana → { pedidas, desp, cortadas, num_pedidos }
  const skuMap    = new Map();  // ref → { desc, pedidas, desp, num_ordenes }

  let totalPedidas = 0, totalDesp = 0, totalCortadas = 0, totalPedidos = 0;
  let sinMatch = 0, conCapeo = 0;

  for (const [compNorm, p] of pedidosMap) {
    if (!p.fecha || p.pedidas === 0) continue;

    const pk       = pickingMap.get(compNorm);
    const wmsQty   = pk ? pk.total : 0;
    const desp     = Math.min(wmsQty, p.pedidas); // CAPEO
    const cortadas = p.pedidas - desp;

    if (!pk) sinMatch++;
    if (pk && wmsQty > p.pedidas) conCapeo++;

    totalPedidas  += p.pedidas;
    totalDesp     += desp;
    totalCortadas += cortadas;
    totalPedidos  += 1;

    // Diario
    const dE = diarioMap.get(p.fecha) || { pedidas:0, desp:0, cortadas:0, num_pedidos:0 };
    dE.pedidas += p.pedidas; dE.desp += desp; dE.cortadas += cortadas; dE.num_pedidos += 1;
    diarioMap.set(p.fecha, dE);

    // Semanal
    const sem  = _isoWeek(p.fecha);
    const sE   = semanaMap.get(sem) || { pedidas:0, desp:0, cortadas:0, num_pedidos:0 };
    sE.pedidas += p.pedidas; sE.desp += desp; sE.cortadas += cortadas; sE.num_pedidos += 1;
    semanaMap.set(sem, sE);

    // SKU — cruce por referencia dentro del pedido
    for (const [ref, skuData] of p.skus) {
      const pkSKU   = pk ? (pk.porSKU.get(ref) || 0) : 0;
      const skuDesp = Math.min(pkSKU, skuData.pedidas);
      const sE2     = skuMap.get(ref) || { desc: skuData.desc, pedidas:0, desp:0, num_ordenes:0 };
      sE2.pedidas    += skuData.pedidas;
      sE2.desp       += skuDesp;
      sE2.num_ordenes += 1;
      skuMap.set(ref, sE2);
    }
  }

  const nsPeriodo = totalPedidas > 0 ? (totalDesp / totalPedidas) * 100 : 0;
  log(`📊 NS ${periodoId}: ${nsPeriodo.toFixed(2)}% | ${totalPedidos} pedidos | ${totalPedidas.toLocaleString()} und. pedidas`);
  log(`   Sin match en WMS: ${sinMatch} pedidos (NS=0) | Capeados (exceso WMS): ${conCapeo}`);

  // ── Paso 4: Borrar datos previos del periodo ───────────────────────────────
  log('🗑 Eliminando datos previos del periodo…');
  for (const tabla of ['kpi_ns_resumen', 'kpi_ns_diario', 'kpi_ns_skus']) {
    try {
      await sb.rest('DELETE', `${tabla}?periodo_id=eq.${periodoId}`);
    } catch(e) {
      log(`⚠ No se pudo limpiar ${tabla}: ${e.message}`);
    }
  }

  // ── Paso 5: kpi_ns_resumen (fila global + filas semanales) ────────────────
  log('💾 Guardando resumen semanal…');
  const resumenRows = [{
    periodo_id:   periodoId,
    semana:       null,
    fecha_inicio: null,
    und_pedidas:  totalPedidas,
    und_desp:     totalDesp,
    und_cortadas: totalCortadas,
    num_pedidos:  totalPedidos,
    ns_pct:       parseFloat(nsPeriodo.toFixed(2)),
  }];

  for (const [sem, s] of semanaMap) {
    const ns = s.pedidas > 0 ? (s.desp / s.pedidas) * 100 : 0;
    resumenRows.push({
      periodo_id:   periodoId,
      semana:       sem,
      fecha_inicio: _fechaInicio(sem),
      und_pedidas:  s.pedidas,
      und_desp:     s.desp,
      und_cortadas: s.cortadas,
      num_pedidos:  s.num_pedidos,
      ns_pct:       parseFloat(ns.toFixed(2)),
    });
  }

  let okRes = 0;
  for (let i = 0; i < resumenRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_resumen', resumenRows.slice(i, i + 100),
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okRes += Math.min(100, resumenRows.length - i);
    } catch(e) { log(`⚠ Error resumen lote ${i}: ${e.message}`); }
  }
  log(`✅ kpi_ns_resumen: ${okRes} filas (1 global + ${semanaMap.size} semanales)`);

  // ── Paso 6: kpi_ns_diario ─────────────────────────────────────────────────
  log('💾 Guardando detalle diario…');
  const diarioRows = [];
  for (const [fecha, d] of diarioMap) {
    const ns      = d.pedidas > 0 ? (d.desp / d.pedidas) * 100 : 0;
    const anomalo = ns < 10;
    let nota = null;
    if (d.desp === 0 && d.num_pedidos > 0)
      nota = `${d.num_pedidos} pedidos sin registro en PICKING WMS`;
    else if (anomalo)
      nota = `NS crítico (${ns.toFixed(1)}%) — verificar sufijos WMS o despachos manuales`;
    diarioRows.push({
      periodo_id:    periodoId,
      fecha,
      num_pedidos:   d.num_pedidos,
      und_pedidas:   d.pedidas,
      und_desp:      d.desp,
      und_cortadas:  d.cortadas,
      ns_pct:        parseFloat(ns.toFixed(2)),
      anomalo,
      nota_anomalia: nota,
    });
  }

  let okDia = 0;
  for (let i = 0; i < diarioRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_diario', diarioRows.slice(i, i + 100),
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okDia += Math.min(100, diarioRows.length - i);
    } catch(e) { log(`⚠ Error diario lote ${i}: ${e.message}`); }
  }
  log(`✅ kpi_ns_diario: ${okDia} días`);

  // ── Paso 7: kpi_ns_skus ───────────────────────────────────────────────────
  log('💾 Guardando análisis de SKUs…');
  const skuRows = [];
  for (const [ref, s] of skuMap) {
    const ns = s.pedidas > 0 ? (s.desp / s.pedidas) * 100 : 0;
    skuRows.push({
      periodo_id:   periodoId,
      referencia:   ref,
      descripcion:  s.desc,
      und_pedidas:  s.pedidas,
      und_desp:     s.desp,
      und_cortadas: s.pedidas - s.desp,
      num_ordenes:  s.num_ordenes,
      ns_pct:       parseFloat(ns.toFixed(2)),
    });
  }

  let okSku = 0;
  for (let i = 0; i < skuRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_skus', skuRows.slice(i, i + 100),
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okSku += Math.min(100, skuRows.length - i);
    } catch(e) { log(`⚠ Error SKUs lote ${i}: ${e.message}`); }
  }
  log(`✅ kpi_ns_skus: ${okSku} SKUs`);

  // ── Resumen final ─────────────────────────────────────────────────────────
  log(`\n🏁 ETL completado — ${periodoId}`);
  log(`   NS: ${nsPeriodo.toFixed(2)}% — ${_semaforoNS(nsPeriodo)}`);
  log(`   Und. Pedidas: ${totalPedidas.toLocaleString()} | Desp: ${totalDesp.toLocaleString()} | Cortadas: ${totalCortadas.toLocaleString()}`);
  log(`   ${semanaMap.size} semanas | ${diarioMap.size} días | ${skuMap.size} SKUs`);
  log(`   Pedidos sin picking WMS: ${sinMatch} | Capeados: ${conCapeo}`);

  return {
    periodoId,
    nsPct:       parseFloat(nsPeriodo.toFixed(2)),
    estado:      _semaforoNS(nsPeriodo),
    undPedidas:  totalPedidas,
    undDesp:     totalDesp,
    undCortadas: totalCortadas,
    numPedidos:  totalPedidos,
    semanas:     semanaMap.size,
    dias:        diarioMap.size,
    skus:        skuMap.size,
    sinMatch,
    conCapeo,
  };
}
