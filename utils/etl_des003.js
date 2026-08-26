/**
 * etl_des003.js — ETL KPI-DES-003 Nivel de Servicio CEDI (NS %)
 * NexusKPI · Logistics & Service × Click Cosmetics
 * Versión 1.5 · Junio 2026
 *
 * REGLAS PERMANENTES:
 *  ✅ Sin "export" — script clásico, funciones globales
 *  ✅ Usa sb.rest() — sin credenciales como parámetros
 *  ✅ Firmas públicas:
 *       procesarNS(file, periodoId, onProgress)          ← alias principal (cargue_des003)
 *       procesarNivelServicio(file, periodoId, onProgress) ← alias legacy
 *
 * LÓGICA ETL (validada contra datos reales Abril 2026 → NS 98.75%):
 *  JOIN: ALISTAMIENTO.Comprobante = PICKING_WMS.PICKING  (col A, limpia)
 *        Fallback: normalizar PedidoWMS quitando sufijos --, -, -R, (N)
 *  Filtro ALISTAMIENTO: PROCESO = B2B  +  DIA.mes == periodo detectado
 *  Filtro PICKING WMS:  cantidad > 0
 *  Capeo: despachadas = min(wms_qty, pedidas) por pedido
 *  Periodo: autodetectado desde campo DIA — no depende del selector del admin
 *
 * CORRECCIÓN v1.5 — fix bug JOIN sufijos PedidoWMS:
 *  La columna PedidoWMS (col B) en PICKING WMS contiene sufijos como --, -R, (2)
 *  que rompían el match exacto con Comprobante de ALISTAMIENTO.
 *  La columna PICKING (col A) es =MID(PedidoWMS,1,10) guardada como valor calculado,
 *  contiene el comprobante limpio y se usa ahora como clave JOIN principal.
 *  Si PICKING viene null (SheetJS no evalúa fórmulas de tabla estructurada en algunos
 *  archivos), se aplica normalización regex sobre PedidoWMS como fallback.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

const _MESES_ES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function _labelPeriodo(pid) {
  if (!pid) return pid;
  const [y, m] = pid.split('-').map(Number);
  return `${_MESES_ES[m] || m} ${y}`;
}

function _semaforoNS(pct) {
  if (pct >= 98) return 'BIEN';
  if (pct >= 90) return 'ALERTA';
  return 'CRITICO';
}

function _toISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    return new Date(Math.round((val - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }
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
async function procesarNivelServicio(file, periodoId, onProgress) {
  const log = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo con SheetJS…');
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

  // ── Paso 1: ALISTAMIENTO ──────────────────────────────────────────────────
  log('📋 Procesando hoja ALISTAMIENTO…');
  const rowsAlist = _leerHoja(wb, 'ALISTAMIENTO', ['PROCESO', 'Comprobante', 'Facturado']);

  // Autodetectar el periodo desde el campo DIA — ignorar el selector del admin
  const b2bTodas = rowsAlist.filter(r =>
    String(r['PROCESO'] || '').trim().toUpperCase() === 'B2B' && _toISO(r['DIA'])
  );

  const conteoMes = {};
  for (const r of b2bTodas) {
    const mes = _toISO(r['DIA']).slice(0, 7);
    conteoMes[mes] = (conteoMes[mes] || 0) + 1;
  }
  const periodoDetectado = Object.entries(conteoMes).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!periodoDetectado) throw new Error('No se encontraron líneas B2B con campo DIA válido.');

  if (periodoDetectado !== periodoId) {
    log(`⚠ Selector dice "${periodoId}" pero el archivo es de "${periodoDetectado}". Usando ${_labelPeriodo(periodoDetectado)}.`);
    periodoId = periodoDetectado;
  }

  const [pYear, pMonth] = periodoId.split('-').map(Number);
  const b2b = b2bTodas.filter(r => {
    const [y, mo] = _toISO(r['DIA']).split('-').map(Number);
    return y === pYear && mo === pMonth;
  });

  log(`✅ ALISTAMIENTO: ${rowsAlist.length} líneas totales → ${b2b.length} líneas B2B en ${_labelPeriodo(periodoId)}`);
  if (!b2b.length) throw new Error(`No hay líneas B2B para ${_labelPeriodo(periodoId)} en ALISTAMIENTO.`);

  // Agrupar por Comprobante → { fecha, pedidas, skus, fechas }
  // IMPORTANTE: un Comprobante debe tener una única fecha DIA. Si el mismo
  // Comprobante aparece con más de una fecha DIA distinta (pedido duplicado /
  // re-cargado en el archivo fuente — incidencia detectada el 26-27/06/2026),
  // NO se fusiona: se separa a cuarentena para no inflar el denominador de NS.
  const pedidosMapRaw = new Map();
  for (const r of b2b) {
    const comp     = String(r['Comprobante'] || '').trim();
    const facturado = Number(r['Facturado']) || 0;
    if (!comp || facturado <= 0) continue;

    const fecha = _toISO(r['DIA']);
    const sku   = String(r['SKU'] || '').trim();
    const desc  = String(r['Descripción'] || r['Descripcion'] || '').trim();

    if (!pedidosMapRaw.has(comp)) {
      pedidosMapRaw.set(comp, { fecha, pedidas: 0, skus: new Map(), fechas: new Set() });
    }
    const p = pedidosMapRaw.get(comp);
    if (!p.fecha && fecha) p.fecha = fecha;
    if (fecha) p.fechas.add(fecha);
    p.pedidas += facturado;
    if (sku) {
      const s = p.skus.get(sku) || { desc, pedidas: 0 };
      s.pedidas += facturado;
      p.skus.set(sku, s);
    }
  }

  // ── Paso 1b: separar comprobantes con fecha DIA inconsistente (cuarentena) ──
  const pedidosMap  = new Map();
  const cuarentena   = []; // { comprobante, fechas: [...], pedidas, motivo }
  for (const [comp, p] of pedidosMapRaw) {
    if (p.fechas.size > 1) {
      cuarentena.push({
        comprobante: comp,
        periodo_id:  periodoId,
        fechas:      Array.from(p.fechas).sort(),
        pedidas:     p.pedidas,
        motivo:      'Comprobante con más de una fecha DIA distinta en ALISTAMIENTO — no se fusiona, requiere revisión manual del archivo fuente.',
      });
      continue;
    }
    pedidosMap.set(comp, p);
  }

  if (cuarentena.length > 0) {
    log(`⚠️ ${cuarentena.length} comprobante(s) EXCLUIDO(S) por fecha DIA inconsistente (cuarentena) — no se fusionan en el cálculo de NS:`);
    for (const c of cuarentena) {
      log(`   • ${c.comprobante} → fechas: ${c.fechas.join(', ')} · ${c.pedidas} und. pedidas`);
    }
  }

  log(`📦 ${pedidosMap.size} pedidos únicos B2B válidos${cuarentena.length ? ` (+ ${cuarentena.length} en cuarentena)` : ''}`);

  // ── Paso 2: PICKING WMS ───────────────────────────────────────────────────
  log('🔍 Procesando hoja PICKING WMS…');
  const rowsPicking = _leerHoja(wb, 'PICKING WMS', ['cantidad', 'PedidoWMS', 'PICKING']);

  // JOIN key: columna PICKING (col A) contiene el comprobante limpio sin sufijos,
  // coincide directamente con Comprobante de ALISTAMIENTO.
  // Si PICKING viene null (fórmula no evaluada por SheetJS en archivos sin guardar cálculo),
  // se normaliza PedidoWMS eliminando sufijos conocidos: --, -, -R, (N).
  const pickingMap = new Map(); // clave limpia → { total, porSKU }
  for (const r of rowsPicking) {
    const rawKey  = r['PICKING'] != null ? String(r['PICKING']).trim() : null;
    const fallback = String(r['PedidoWMS'] || '').trim()
      .replace(/[-\s]+$/, '')          // quita guiones/espacios al final: FV-3-123-- → FV-3-123
      .replace(/\s*\(\d+\)\s*$/, '')   // quita sufijo (2), (3)…           FV-3-123 (2) → FV-3-123
      .replace(/-[R\d]+$/, '');        // quita sufijo -R, -2, -3…         FV-3-123-R  → FV-3-123
    const ped = (rawKey && rawKey.startsWith('FV-')) ? rawKey : fallback;
    if (!ped) continue;
    const qty = Number(r['cantidad']) || 0;
    if (qty <= 0) continue;
    const ref = String(r['Referencia'] || '').trim();
    if (!pickingMap.has(ped)) pickingMap.set(ped, { total: 0, porSKU: new Map() });
    const pk = pickingMap.get(ped);
    pk.total += qty;
    if (ref) pk.porSKU.set(ref, (pk.porSKU.get(ref) || 0) + qty);
  }
  log(`✅ PICKING WMS: ${pickingMap.size} entradas con cantidad > 0`);

  // ── Paso 3: JOIN + cálculo ────────────────────────────────────────────────
  log('🔗 Cruzando ALISTAMIENTO × PICKING WMS…');

  const diarioMap = new Map();
  const semanaMap = new Map();
  const skuMap    = new Map();
  const detalleRows = []; // NUEVO — grano pedido×SKU, para drill-down (kpi_ns_pedidos_sku_detalle)
  let totalPedidas = 0, totalDesp = 0, totalCortadas = 0, totalPedidos = 0;
  let sinMatch = 0, conCapeo = 0;

  for (const [comp, p] of pedidosMap) {
    if (!p.fecha || p.pedidas === 0) continue;

    // Match directo Comprobante = PedidoWMS
    const pk     = pickingMap.get(comp);
    const wmsQty = pk ? pk.total : 0;
    const desp   = Math.min(wmsQty, p.pedidas);
    const cort   = p.pedidas - desp;

    if (!pk) sinMatch++;
    if (pk && wmsQty > p.pedidas) conCapeo++;

    totalPedidas  += p.pedidas;
    totalDesp     += desp;
    totalCortadas += cort;
    totalPedidos  += 1;

    // Diario
    const dE = diarioMap.get(p.fecha) || { pedidas:0, desp:0, cortadas:0, num_pedidos:0, afectados:0 };
    dE.pedidas += p.pedidas; dE.desp += desp; dE.cortadas += cort; dE.num_pedidos++;
    if (cort > 0) dE.afectados++;   // NUEVO — este pedido tuvo al menos una unidad cortada
    diarioMap.set(p.fecha, dE);

    // Semanal
    const sem = _isoWeek(p.fecha);
    const sE  = semanaMap.get(sem) || { pedidas:0, desp:0, cortadas:0, num_pedidos:0 };
    sE.pedidas += p.pedidas; sE.desp += desp; sE.cortadas += cort; sE.num_pedidos++;
    semanaMap.set(sem, sE);

    // SKU
    for (const [ref, skuData] of p.skus) {
      const pkSKU    = pk ? (pk.porSKU.get(ref) || 0) : 0;
      const skuDesp  = Math.min(pkSKU, skuData.pedidas);
      const skuCort  = skuData.pedidas - skuDesp;
      const sE2 = skuMap.get(ref) || { desc: skuData.desc, pedidas:0, desp:0, num_ordenes:0, afectadas:0 };
      sE2.pedidas += skuData.pedidas; sE2.desp += skuDesp; sE2.num_ordenes++;
      if (skuCort > 0) sE2.afectadas++;   // NUEVO — esta orden tuvo corte de este SKU
      skuMap.set(ref, sE2);

      // NUEVO — fila de detalle granular pedido×SKU para el drill-down.
      // Se guarda SIEMPRE (no solo cuando hay corte) para que la tabla de
      // detalle pueda mostrar también las líneas BIEN de un pedido parcial.
      detalleRows.push({
        periodo_id:    periodoId,
        fecha:         p.fecha,
        comprobante:   comp,
        sku:           ref,
        descripcion:   skuData.desc || null,
        pedidas:       skuData.pedidas,
        despachadas:   skuDesp,
        cortadas:      skuCort,
        estado:        skuCort === 0 ? 'BIEN' : (skuDesp > 0 ? 'PARCIAL' : 'PENDIENTE'),
        sin_match_wms: !pk,
      });
    }
  }

  const nsPeriodo = totalPedidas > 0 ? (totalDesp / totalPedidas) * 100 : 0;
  log(`📊 NS ${_labelPeriodo(periodoId)}: ${nsPeriodo.toFixed(2)}% | ${totalPedidos} pedidos | ${totalPedidas.toLocaleString()} und. pedidas`);
  log(`   Sin match WMS: ${sinMatch} pedidos | Capeados: ${conCapeo}`);

  // ── Paso 4: Borrar datos previos (silencioso) ──────────────────────────────
  log('🗑 Limpiando datos previos…');
  for (const tabla of ['kpi_ns_resumen', 'kpi_ns_diario', 'kpi_ns_skus']) {
    try {
      await sb.rest('DELETE', `${tabla}?periodo_id=eq.${periodoId}`);
    } catch(e) {
      throw new Error(
        `No se pudo limpiar datos anteriores de ${_labelPeriodo(periodoId)}. ` +
        `Vuelve a cargar el archivo de ${_labelPeriodo(periodoId)}. (${e.message})`
      );
    }
  }

  // NUEVAS (migración 013) — no bloqueantes: si el analista aún no corrió la
  // migración en Supabase, el cargue del KPI principal NO se detiene por esto.
  for (const tabla of ['kpi_ns_diario_afectados', 'kpi_ns_skus_afectados', 'kpi_ns_pedidos_sku_detalle']) {
    try {
      await sb.rest('DELETE', `${tabla}?periodo_id=eq.${periodoId}`);
    } catch(e) { /* tabla puede no existir aún (falta migración 013) — no bloquea */ }
  }

  // ── Paso 4b: kpi_ns_cuarentena — comprobantes excluidos por fecha DIA inconsistente
  // No es bloqueante: si la tabla no existe todavía en Supabase (falta la migración)
  // o el insert falla por restricción de clave primaria, NO se detiene el proceso —
  // se registra en el log para que el analista lo revise manualmente.
  try {
    await sb.rest('DELETE', `kpi_ns_cuarentena?periodo_id=eq.${periodoId}`);
  } catch(e) { /* tabla puede no existir aún — no bloquea */ }

  if (cuarentena.length > 0) {
    try {
      await sb.rest('POST', 'kpi_ns_cuarentena', cuarentena.map(c => ({
        periodo_id:  c.periodo_id,
        comprobante: c.comprobante,
        fechas:      c.fechas.join(', '),
        pedidas:     c.pedidas,
        motivo:      c.motivo,
      })), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      log(`🧯 ${cuarentena.length} comprobante(s) enviados a kpi_ns_cuarentena para revisión manual.`);
    } catch(e) {
      // No dejar que un fallo de PK/tabla faltante tumbe el cálculo del KPI.
      // Se excluye igual del cálculo (ya se excluyó arriba) y se informa por log.
      log(`⚠️ No se pudo registrar la cuarentena en Supabase (${e.message}). ` +
          `Los ${cuarentena.length} comprobante(s) igual quedaron EXCLUIDOS del cálculo de NS — repórtalos manualmente:`);
      for (const c of cuarentena) log(`   • ${c.comprobante} (${c.fechas.join(', ')})`);
    }
  }

  // ── Paso 5: kpi_ns_resumen ────────────────────────────────────────────────
  log('💾 Guardando datos en Supabase…');
  const resumenRows = [{
    periodo_id: periodoId, semana: null, fecha_inicio: null,
    und_pedidas: totalPedidas, und_desp: totalDesp, und_cortadas: totalCortadas,
    num_pedidos: totalPedidos, ns_pct: parseFloat(nsPeriodo.toFixed(2)),
  }];
  for (const [sem, s] of semanaMap) {
    const ns = s.pedidas > 0 ? (s.desp / s.pedidas) * 100 : 0;
    resumenRows.push({
      periodo_id: periodoId, semana: sem, fecha_inicio: _fechaInicio(sem),
      und_pedidas: s.pedidas, und_desp: s.desp, und_cortadas: s.cortadas,
      num_pedidos: s.num_pedidos, ns_pct: parseFloat(ns.toFixed(2)),
    });
  }
  let okRes = 0;
  for (let i = 0; i < resumenRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_resumen', resumenRows.slice(i, i + 100),
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okRes += Math.min(100, resumenRows.length - i);
    } catch(e) {
      throw new Error(`Error guardando resumen de ${_labelPeriodo(periodoId)}. Vuelve a cargar el archivo de ${_labelPeriodo(periodoId)}. (${e.message})`);
    }
  }
  log(`✅ kpi_ns_resumen: ${okRes} filas`);

  // ── Paso 6: kpi_ns_diario ─────────────────────────────────────────────────
  const diarioRows = [];
  for (const [fecha, d] of diarioMap) {
    const ns = d.pedidas > 0 ? (d.desp / d.pedidas) * 100 : 0;
    const anomalo = ns < 10;
    diarioRows.push({
      periodo_id: periodoId, fecha,
      num_pedidos: d.num_pedidos, und_pedidas: d.pedidas,
      und_desp: d.desp, und_cortadas: d.cortadas,
      ns_pct: parseFloat(ns.toFixed(2)), anomalo,
      nota_anomalia: d.desp === 0 && d.num_pedidos > 0
        ? `${d.num_pedidos} pedidos sin registro en PICKING WMS`
        : anomalo ? `NS crítico (${ns.toFixed(1)}%) — verificar despachos` : null,
    });
  }
  let okDia = 0;
  for (let i = 0; i < diarioRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_diario', diarioRows.slice(i, i + 100),
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okDia += Math.min(100, diarioRows.length - i);
    } catch(e) {
      throw new Error(`Error guardando detalle diario de ${_labelPeriodo(periodoId)}. Vuelve a cargar el archivo de ${_labelPeriodo(periodoId)}. (${e.message})`);
    }
  }
  log(`✅ kpi_ns_diario: ${okDia} días`);

  // ── Paso 7: kpi_ns_skus ───────────────────────────────────────────────────
  const skuRows = [];
  for (const [ref, s] of skuMap) {
    const ns = s.pedidas > 0 ? (s.desp / s.pedidas) * 100 : 0;
    skuRows.push({
      periodo_id: periodoId, referencia: ref, descripcion: s.desc,
      und_pedidas: s.pedidas, und_desp: s.desp, und_cortadas: s.pedidas - s.desp,
      num_ordenes: s.num_ordenes, ns_pct: parseFloat(ns.toFixed(2)),
    });
  }
  let okSku = 0;
  for (let i = 0; i < skuRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_skus', skuRows.slice(i, i + 100),
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okSku += Math.min(100, skuRows.length - i);
    } catch(e) {
      throw new Error(`Error guardando SKUs de ${_labelPeriodo(periodoId)}. Vuelve a cargar el archivo de ${_labelPeriodo(periodoId)}. (${e.message})`);
    }
  }
  log(`✅ kpi_ns_skus: ${okSku} SKUs`);

  // ── Paso 8: kpi_ns_diario_afectados / kpi_ns_skus_afectados (migración 013) ─
  // No bloqueantes: si la tabla no existe aún, se informa mediante log y el
  // cargue del KPI principal (pasos 5-7, ya completados arriba) queda intacto.
  const diarioAfectadosRows = [];
  for (const [fecha, d] of diarioMap) {
    diarioAfectadosRows.push({ periodo_id: periodoId, fecha, pedidos_afectados: d.afectados });
  }
  try {
    await sb.rest('POST', 'kpi_ns_diario_afectados', diarioAfectadosRows,
      { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    log(`✅ kpi_ns_diario_afectados: ${diarioAfectadosRows.length} días`);
  } catch(e) {
    log(`⚠️ No se pudo guardar kpi_ns_diario_afectados (¿falta correr la migración 013?): ${e.message}`);
  }

  const skusAfectadosRows = [];
  for (const [ref, s] of skuMap) {
    skusAfectadosRows.push({ periodo_id: periodoId, referencia: ref, ordenes_afectadas: s.afectadas });
  }
  try {
    await sb.rest('POST', 'kpi_ns_skus_afectados', skusAfectadosRows,
      { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    log(`✅ kpi_ns_skus_afectados: ${skusAfectadosRows.length} SKUs`);
  } catch(e) {
    log(`⚠️ No se pudo guardar kpi_ns_skus_afectados (¿falta correr la migración 013?): ${e.message}`);
  }

  // ── Paso 9: kpi_ns_pedidos_sku_detalle (migración 013) — detalle granular ──
  let okDetalle = 0;
  try {
    for (let i = 0; i < detalleRows.length; i += 100) {
      await sb.rest('POST', 'kpi_ns_pedidos_sku_detalle', detalleRows.slice(i, i + 100),
        { 'Prefer': 'return=minimal' });
      okDetalle += Math.min(100, detalleRows.length - i);
    }
    log(`✅ kpi_ns_pedidos_sku_detalle: ${okDetalle} líneas (pedido×SKU)`);
  } catch(e) {
    log(`⚠️ No se pudo guardar kpi_ns_pedidos_sku_detalle en la línea ${okDetalle} (¿falta correr la migración 013?): ${e.message}`);
  }

  log(`\n🏁 Completado — ${_labelPeriodo(periodoId)}`);
  log(`   NS: ${nsPeriodo.toFixed(2)}% — ${_semaforoNS(nsPeriodo)}`);
  log(`   ${totalPedidas.toLocaleString()} pedidas | ${totalDesp.toLocaleString()} desp | ${totalCortadas.toLocaleString()} cortadas`);
  if (cuarentena.length > 0) {
    log(`   ⚠️ ${cuarentena.length} comprobante(s) en cuarentena (excluidos del cálculo) — ver kpi_ns_cuarentena.`);
  }

  return {
    periodoId, periodoDetectado,
    nsPct: parseFloat(nsPeriodo.toFixed(2)),
    estado: _semaforoNS(nsPeriodo),
    undPedidas: totalPedidas, undDesp: totalDesp, undCortadas: totalCortadas,
    numPedidos: totalPedidos, semanas: semanaMap.size,
    dias: diarioMap.size, skus: skuMap.size, sinMatch, conCapeo,
    cuarentena,
  };
}

// ── Alias público requerido por cargue_des003.html ────────────────────────
// procesarNS es el punto de entrada oficial; procesarNivelServicio se conserva
// por compatibilidad con llamadas existentes en la plataforma.
function procesarNS(file, periodoId, onProgress) {
  return procesarNivelServicio(file, periodoId, onProgress);
}
