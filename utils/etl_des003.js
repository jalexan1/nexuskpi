/**
 * etl_des003.js — ETL KPI-DES-003 Nivel de Servicio CEDI (NS %)
 * NexusKPI · Logistics & Service × Click Cosmetics
 * Versión 1.1 · Junio 2026
 *
 * REGLAS PERMANENTES (ver Registro de Errores):
 *  ✅ Sin "export" — script clásico, funciones globales
 *  ✅ Sin credenciales como parámetros — usa sb.rest() de auth.js
 *  ✅ Firma: procesarNivelServicio(file, periodoId, onProgress)
 *
 * Lógica:
 *   1. Lee hoja ALISTAMIENTO  → filtra PROCESO=B2B → agrupa por Comprobante → suma Facturado
 *   2. Lee hoja PICKING WMS   → filtra cantidad>0 → normaliza sufijos FV → agrupa → suma cantidad
 *   3. JOIN + capeo min(desp, pedidas)
 *   4. Agrupa: global · semanal ISO · diario · por SKU
 *   5. DELETE previo del periodo → upsert en lotes de 100 via sb.rest()
 *
 * Integración en admin.html:
 *   <script src="../utils/etl_des003.js"></script>
 *   await procesarNivelServicio(file, periodoId, onProgress);
 */

// ─── Semáforo NS ─────────────────────────────────────────────────────────────
function semaforoNS(pct) {
  if (pct >= 98) return 'BIEN';
  if (pct >= 90) return 'ALERTA';
  return 'CRITICO';
}

// ─── Normalizar clave de pedido WMS ──────────────────────────────────────────
// Elimina sufijos "-1", "--2", " -1" que el WMS agrega al número de pedido.
// Ejemplo: "FV-3-69711-1" → "FV-3-69711"   "FV-3-69493" → "FV-3-69493"
function _normalizarPedido(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/[\s\-]+\d+$/, '').trim();
}

// ─── Semana ISO ───────────────────────────────────────────────────────────────
function _isoWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `Sem ${week}-${d.getFullYear()}`;
}

function _fechaInicioPorSemana(semanaStr) {
  const m = semanaStr.match(/Sem (\d+)-(\d+)/);
  if (!m) return null;
  const [, w, y] = m;
  const jan4 = new Date(+y, 0, 4);
  const inicio = new Date(jan4);
  inicio.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + (+w - 1) * 7);
  return inicio.toISOString().split('T')[0];
}

function _toISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    // Número de serie Excel → Date
    return new Date(Math.round((val - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }
  const m = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return String(val).slice(0, 10);
}

// ─── Leer hoja con cabecera dinámica ─────────────────────────────────────────
function _leerHoja(workbook, sheetName, colsBuscadas) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Hoja "${sheetName}" no encontrada`);

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let headerIdx = raw.findIndex(r =>
    Array.isArray(r) && r.some(c =>
      c !== null && colsBuscadas.some(k =>
        String(c).trim().toLowerCase().includes(k.toLowerCase())
      )
    )
  );
  if (headerIdx === -1) headerIdx = 0;

  const headers = raw[headerIdx].map(h => (h !== null ? String(h).trim() : ''));
  const rows = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every(c => c === null)) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = r[j]; });
    rows.push(obj);
  }
  return rows;
}

// ─── Función principal ────────────────────────────────────────────────────────
/**
 * @param {File}     file       — archivo SEGUIMIENTO_CLICK_MES.xlsx
 * @param {string}   periodoId  — "2026-03" | "2026-04" | …
 * @param {Function} onProgress — callback(string) para log en admin.html
 * @returns {Object} resumen con ns_pct, totales y conteos
 */
async function procesarNivelServicio(file, periodoId, onProgress) {
  const log = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo con SheetJS…');
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

  // ── Paso 1: ALISTAMIENTO ──────────────────────────────────────────────────
  log('📋 Procesando hoja ALISTAMIENTO…');
  const rowsAlist = _leerHoja(wb, 'ALISTAMIENTO', ['PROCESO', 'Comprobante', 'Facturado']);

  // Mapa comprobante → { pedidas, fecha, skus: Map<ref, {desc, pedidas}> }
  const pedidosMap = new Map();

  for (const r of rowsAlist) {
    const proceso = String(r['PROCESO'] || '').trim().toUpperCase();
    if (proceso !== 'B2B') continue;

    const comprobante = String(r['Comprobante'] || '').trim();
    if (!comprobante) continue;

    const facturado = Number(r['Facturado']) || 0;
    if (facturado <= 0) continue;

    const fecha = _toISO(r['DIA']);
    const sku   = String(r['SKU'] || '').trim();
    const desc  = String(r['Descripción'] || r['Descripcion'] || '').trim();

    if (!pedidosMap.has(comprobante)) {
      pedidosMap.set(comprobante, { comprobante, fecha, pedidas: 0, skus: new Map() });
    }
    const p = pedidosMap.get(comprobante);
    if (!p.fecha && fecha) p.fecha = fecha;
    p.pedidas += facturado;

    if (sku) {
      const s = p.skus.get(sku) || { desc, pedidas: 0 };
      s.pedidas += facturado;
      p.skus.set(sku, s);
    }
  }

  log(`✅ ALISTAMIENTO: ${pedidosMap.size} pedidos B2B`);

  // ── Paso 2: PICKING WMS ───────────────────────────────────────────────────
  log('📦 Procesando hoja PICKING WMS…');
  const rowsPicking = _leerHoja(wb, 'PICKING WMS', ['cantidad', 'PedidoWMS', 'Picking']);

  // Mapa pedido-normalizado → { total, porSKU: Map<ref, qty> }
  const pickingMap = new Map();

  for (const r of rowsPicking) {
    const pedidoRaw  = r['PedidoWMS'] || r['Pedido'] || r['PICKING'] || '';
    const pedidoNorm = _normalizarPedido(pedidoRaw);
    if (!pedidoNorm) continue;

    const qty = Number(r['cantidad']) || 0;
    if (qty <= 0) continue;

    const ref = String(r['Referencia'] || '').trim();

    if (!pickingMap.has(pedidoNorm)) {
      pickingMap.set(pedidoNorm, { total: 0, porSKU: new Map() });
    }
    const pk = pickingMap.get(pedidoNorm);
    pk.total += qty;
    if (ref) pk.porSKU.set(ref, (pk.porSKU.get(ref) || 0) + qty);
  }

  log(`✅ PICKING WMS: ${pickingMap.size} pedidos con qty > 0`);

  // ── Paso 3: JOIN + cálculo ────────────────────────────────────────────────
  log('🔗 Cruzando ALISTAMIENTO × PICKING WMS…');

  const diarioMap = new Map(); // fecha → { pedidas, desp, cortadas, num_pedidos }
  const semanaMap = new Map(); // semana → { pedidas, desp, cortadas, num_pedidos }
  const skuMap    = new Map(); // ref → { desc, pedidas, desp, num_ordenes }

  let totalPedidas = 0, totalDesp = 0, totalCortadas = 0, totalPedidos = 0;
  let inconsistentes = 0;

  for (const [comp, p] of pedidosMap) {
    if (!p.fecha || p.pedidas === 0) { inconsistentes++; continue; }

    const compNorm = _normalizarPedido(comp);
    const pk = pickingMap.get(compNorm) || pickingMap.get(comp);

    const wmsQty   = pk ? pk.total : 0;
    const desp     = Math.min(wmsQty, p.pedidas); // CAPEO
    const cortadas = p.pedidas - desp;

    totalPedidas  += p.pedidas;
    totalDesp     += desp;
    totalCortadas += cortadas;
    totalPedidos  += 1;

    // Diario
    const dEntry = diarioMap.get(p.fecha) || { pedidas: 0, desp: 0, cortadas: 0, num_pedidos: 0 };
    dEntry.pedidas += p.pedidas; dEntry.desp += desp; dEntry.cortadas += cortadas; dEntry.num_pedidos += 1;
    diarioMap.set(p.fecha, dEntry);

    // Semanal
    const sem = _isoWeek(p.fecha);
    const sEntry = semanaMap.get(sem) || { pedidas: 0, desp: 0, cortadas: 0, num_pedidos: 0 };
    sEntry.pedidas += p.pedidas; sEntry.desp += desp; sEntry.cortadas += cortadas; sEntry.num_pedidos += 1;
    semanaMap.set(sem, sEntry);

    // SKU
    for (const [ref, skuData] of p.skus) {
      const pkSKU   = pk ? (pk.porSKU.get(ref) || 0) : 0;
      const skuDesp = Math.min(pkSKU, skuData.pedidas);
      const sEntry2 = skuMap.get(ref) || { desc: skuData.desc, pedidas: 0, desp: 0, num_ordenes: 0 };
      sEntry2.pedidas += skuData.pedidas; sEntry2.desp += skuDesp; sEntry2.num_ordenes += 1;
      skuMap.set(ref, sEntry2);
    }
  }

  const nsPeriodo = totalPedidas > 0 ? (totalDesp / totalPedidas) * 100 : 0;
  log(`📊 NS ${periodoId}: ${nsPeriodo.toFixed(2)}% · ${totalPedidos} pedidos · ${totalPedidas.toLocaleString()} und.`);
  if (inconsistentes) log(`⚠ ${inconsistentes} pedidos excluidos (sin fecha o sin unidades)`);

  // ── Paso 4: Borrar datos previos del periodo ───────────────────────────────
  log('🗑 Eliminando datos previos del periodo…');
  for (const tabla of ['kpi_ns_resumen', 'kpi_ns_diario', 'kpi_ns_skus']) {
    try {
      await sb.rest('DELETE', `${tabla}?periodo_id=eq.${periodoId}`);
    } catch(e) {
      log(`⚠ No se pudo limpiar ${tabla}: ${e.message}`);
    }
  }

  // ── Paso 5: kpi_ns_resumen (global + semanal) ──────────────────────────────
  log('💾 Guardando resumen semanal…');
  const resumenRows = [];

  // Fila global del periodo (semana = null)
  resumenRows.push({
    periodo_id:   periodoId,
    semana:       null,
    fecha_inicio: null,
    und_pedidas:  totalPedidas,
    und_desp:     totalDesp,
    und_cortadas: totalCortadas,
    num_pedidos:  totalPedidos,
    ns_pct:       parseFloat(nsPeriodo.toFixed(2)),
  });

  for (const [sem, s] of semanaMap) {
    const ns = s.pedidas > 0 ? (s.desp / s.pedidas) * 100 : 0;
    resumenRows.push({
      periodo_id:   periodoId,
      semana:       sem,
      fecha_inicio: _fechaInicioPorSemana(sem),
      und_pedidas:  s.pedidas,
      und_desp:     s.desp,
      und_cortadas: s.cortadas,
      num_pedidos:  s.num_pedidos,
      ns_pct:       parseFloat(ns.toFixed(2)),
    });
  }

  // Upsert en lotes de 100
  let okRes = 0, errRes = 0;
  for (let i = 0; i < resumenRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_resumen', resumenRows.slice(i, i + 100), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okRes += Math.min(100, resumenRows.length - i);
    } catch(e) { errRes++; log(`⚠ Error resumen lote ${i}: ${e.message}`); }
  }
  log(`✅ kpi_ns_resumen: ${okRes} registros · ${errRes} errores`);

  // ── Paso 6: kpi_ns_diario ────────────────────────────────────────────────
  log('💾 Guardando detalle diario…');
  const diarioRows = [];
  for (const [fecha, d] of diarioMap) {
    const ns = d.pedidas > 0 ? (d.desp / d.pedidas) * 100 : 0;
    const anomalo = ns < 10;
    let nota = null;
    if (d.desp === 0 && d.num_pedidos > 0) nota = `${d.num_pedidos} pedidos sin registro en PICKING WMS`;
    else if (anomalo) nota = `NS crítico (${ns.toFixed(1)}%) — verificar sufijos WMS o despachos manuales`;
    diarioRows.push({
      periodo_id:   periodoId,
      fecha,
      num_pedidos:  d.num_pedidos,
      und_pedidas:  d.pedidas,
      und_desp:     d.desp,
      und_cortadas: d.cortadas,
      ns_pct:       parseFloat(ns.toFixed(2)),
      anomalo,
      nota_anomalia: nota,
    });
  }

  let okDia = 0, errDia = 0;
  for (let i = 0; i < diarioRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_diario', diarioRows.slice(i, i + 100), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okDia += Math.min(100, diarioRows.length - i);
    } catch(e) { errDia++; log(`⚠ Error diario lote ${i}: ${e.message}`); }
  }
  log(`✅ kpi_ns_diario: ${okDia} registros · ${errDia} errores`);

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

  let okSku = 0, errSku = 0;
  for (let i = 0; i < skuRows.length; i += 100) {
    try {
      await sb.rest('POST', 'kpi_ns_skus', skuRows.slice(i, i + 100), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      okSku += Math.min(100, skuRows.length - i);
    } catch(e) { errSku++; log(`⚠ Error SKUs lote ${i}: ${e.message}`); }
  }
  log(`✅ kpi_ns_skus: ${okSku} SKUs · ${errSku} errores`);

  // ── Resumen final ─────────────────────────────────────────────────────────
  log(`\n🏁 ETL completado — ${periodoId}`);
  log(`   NS: ${nsPeriodo.toFixed(2)}% — ${semaforoNS(nsPeriodo)}`);
  log(`   Und. Pedidas: ${totalPedidas.toLocaleString()} · Despachadas: ${totalDesp.toLocaleString()} · Cortadas: ${totalCortadas.toLocaleString()}`);
  log(`   ${semanaMap.size} semanas · ${diarioMap.size} días · ${skuMap.size} SKUs`);

  return {
    periodoId,
    nsPct:        parseFloat(nsPeriodo.toFixed(2)),
    estado:       semaforoNS(nsPeriodo),
    undPedidas:   totalPedidas,
    undDesp:      totalDesp,
    undCortadas:  totalCortadas,
    numPedidos:   totalPedidos,
    semanas:      semanaMap.size,
    dias:         diarioMap.size,
    skus:         skuMap.size,
  };
}
