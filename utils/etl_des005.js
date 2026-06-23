/**
 * etl_des005.js — NexusKPI · KPI-DES-005 · On-Time Delivery (OTD %)
 * Firma: procesarOTD(file, periodoId, onProgress)
 *
 * LÓGICA DEFINITIVA v2 (decision operativa confirmada Jun-2026):
 *   Fuente  : Hoja ALISTAMIENTO del archivo SEGUIMIENTO_CLICK_MES.xlsx
 *
 *   FORMULA OTD:
 *     diasDespacho = FECHA DESPACHO - DIA  (dias calendario)
 *     ontime = diasDespacho <= 2
 *     tardia  = diasDespacho > 2  |  sin FECHA DESPACHO
 *
 *   Razon del cambio: ON-TIME L&S almacenaba (DIA - SOLICITUD) donde SOLICITUD
 *   se llenaba igual a FECHA DESPACHO, resultando siempre <= 0 (100% OTD ficticio).
 *   La fuente correcta y disponible es DIA + FECHA DESPACHO directamente.
 *
 *   STATUS validos: DESPACHADO - ENTREGADO - DEV TIEMPO - EN REPARTO
 *   Deduplicar por Comprobante (un pedido puede tener N filas de SKUs)
 *   Indicador principal c/ semaforo : B2B + B2C  (meta >= 95%)
 *   Otros procesos (TRASLADO, RETAIL, CLICK, MARKETPLACE): informativos sin semaforo
 *   Transportador: SERVIENTREGA / CLICK / L&S
 *   Ciudad - Novedad
 *
 *   ontime_dias en detalle = diasDespacho (FECHA_DESPACHO - DIA, entero >= 0)
 */

// ── Helpers ───────────────────────────────────────────────────────────────

function _parseFechaOtd(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getFullYear();
    const m = String(val.getMonth()+1).padStart(2,'0');
    const d = String(val.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return null;
}

/**
 * Calcula dias calendario entre DIA y FECHA DESPACHO.
 * Retorna: { ontime: bool, dias: int|null }
 *   ontime = diasDespacho <= 2
 *   sin fecha despacho o fecha invalida → tardia (dias = null)
 */
function _calcOtdDespacho(fechaDia, fechaDespacho) {
  if (!fechaDia || !fechaDespacho) return { ontime: false, dias: null };
  const tDia      = new Date(fechaDia      + 'T12:00:00').getTime();
  const tDespacho = new Date(fechaDespacho + 'T12:00:00').getTime();
  if (isNaN(tDia) || isNaN(tDespacho)) return { ontime: false, dias: null };
  const dias = Math.round((tDespacho - tDia) / 86400000);
  return { ontime: dias <= 2, dias };
}

function _isoWeekOtd(dateStr) {
  const d    = new Date(dateStr + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const doy  = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const wn   = Math.ceil((doy + jan4.getDay()) / 7);
  return `Sem ${String(wn).padStart(2,'0')}-${d.getFullYear()}`;
}

function _labelPeriodoOtd(id) {
  if (!id) return 'período desconocido';
  if (typeof CONFIG !== 'undefined' && CONFIG.meses) {
    const m = CONFIG.meses.find(x => x.id === id);
    if (m) return m.label;
  }
  const NOM = {'01':'Enero','02':'Febrero','03':'Marzo','04':'Abril',
               '05':'Mayo','06':'Junio','07':'Julio','08':'Agosto',
               '09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'};
  const [y, m] = id.split('-');
  return `${NOM[m]||m} ${y}`;
}

// Procesos que se miden con semáforo de gestión
const PROCESOS_SEMAFORO = new Set(['B2B', 'B2C']);
// Todos los procesos conocidos (para agrupación)
const TODOS_PROCESOS = ['B2B', 'B2C', 'TRASLADO', 'RETAIL', 'CLICK', 'MARKETPLACE', 'MAQUINAS'];

// ── Función principal ──────────────────────────────────────────────────────

async function procesarOTD(file, periodoId, onProgress) {
  const log = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo Excel…');

  const wb = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        res(XLSX.read(e.target.result, { type:'array', cellDates:true, dateNF:'yyyy-mm-dd' }));
      } catch(err) { rej(new Error('Error leyendo el Excel: ' + err.message)); }
    };
    reader.onerror = () => rej(new Error('Error al leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });

  if (!wb.Sheets['ALISTAMIENTO']) {
    throw new Error('El archivo no tiene hoja "ALISTAMIENTO". Verifica que sea SEGUIMIENTO_CLICK_MES.xlsx.');
  }

  const ws   = wb.Sheets['ALISTAMIENTO'];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, cellDates:true });

  if (rows.length < 2) throw new Error('La hoja ALISTAMIENTO está vacía o solo tiene encabezados.');

  // ── Mapear columnas por nombre ──────────────────────────────────────────
  const headers = rows[0].map(h => h == null ? '' : String(h).trim());
  const col = name => headers.findIndex(h => h.toUpperCase() === name.toUpperCase());

  const iDia        = col('DIA');
  const iComp       = col('Comprobante');
  const iStatus     = col('STATUS');
  const iFechaDesp  = col('FECHA DESPACHO');
  const iProc       = col('PROCESO');
  const iTrans      = col('TRANSPORTADOR');
  const iCiudad     = col('ciudad');
  const iNov        = col('NOVEDAD');

  const missing = [];
  if (iDia < 0)       missing.push('DIA');
  if (iComp < 0)      missing.push('Comprobante');
  if (iStatus < 0)    missing.push('STATUS');
  if (iFechaDesp < 0) missing.push('FECHA DESPACHO');
  if (iProc < 0)      missing.push('PROCESO');
  if (missing.length > 0) {
    throw new Error(`Columnas criticas no encontradas en ALISTAMIENTO: ${missing.join(', ')}.`);
  }

  log(`✅ Columnas mapeadas · ${rows.length-1} filas en ALISTAMIENTO`);

  // ── Verificar periodo ───────────────────────────────────────────────────
  const conteoMes = {};
  for (let i = 1; i < rows.length; i++) {
    const f = _parseFechaOtd(rows[i][iDia]);
    if (f) { const ym = f.slice(0,7); conteoMes[ym] = (conteoMes[ym]||0)+1; }
  }

  const mesDominante    = Object.entries(conteoMes).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const filasDelPeriodo = conteoMes[periodoId] || 0;

  if (filasDelPeriodo === 0) {
    const disponibles = Object.entries(conteoMes)
      .sort((a,b)=>b[1]-a[1])
      .map(([mes,cnt]) => `${_labelPeriodoOtd(mes)} (${cnt} filas)`)
      .join(', ');
    throw new Error(
      `El archivo no contiene datos de ${_labelPeriodoOtd(periodoId)}. ` +
      `Meses encontrados: ${disponibles}.`
    );
  }

  if (mesDominante !== periodoId) {
    log(`⚠️ El archivo tiene más filas de ${_labelPeriodoOtd(mesDominante)}. ` +
        `Procesando ${_labelPeriodoOtd(periodoId)} (${filasDelPeriodo} filas).`);
  }

  log(`📅 Procesando: ${_labelPeriodoOtd(periodoId)} · ${filasDelPeriodo} filas`);

  // ── Paso 1: Construir pedidos únicos ───────────────────────────────────
  // STATUS válidos confirmados
  const STATUS_OK = new Set(['DESPACHADO', 'ENTREGADO', 'DEV TIEMPO', 'EN REPARTO']);
  const pedidoMap = {};   // comp → { fecha, proceso, trans, ciudad, ontime, diasOT, novedad }

  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const fecha = _parseFechaOtd(r[iDia]);
    if (!fecha || !fecha.startsWith(periodoId)) continue;

    const st = r[iStatus] ? String(r[iStatus]).trim().toUpperCase() : '';
    if (!STATUS_OK.has(st)) continue;

    const comp = r[iComp] ? String(r[iComp]).trim() : '';
    if (!comp || pedidoMap[comp]) continue;   // deduplicar por Comprobante

    const fechaDespacho = _parseFechaOtd(r[iFechaDesp]);
    const { ontime, dias: diasOT } = _calcOtdDespacho(fecha, fechaDespacho);
    const proc   = r[iProc]   ? String(r[iProc]).trim().toUpperCase()   : 'OTRO';
    const trans  = iTrans >= 0 && r[iTrans] ? String(r[iTrans]).trim().toUpperCase() : 'N/A';
    const ciudad = iCiudad >= 0 && r[iCiudad] ? String(r[iCiudad]).trim() : '';
    const novedad= iNov >= 0 && r[iNov]    ? String(r[iNov]).trim()    : '';

    pedidoMap[comp] = { fecha, fechaDespacho, proceso: proc, trans, ciudad, ontime, diasOT, novedad };
  }

  const pedidos = Object.values(pedidoMap);
  log(`📦 ${pedidos.length} pedidos únicos en ${_labelPeriodoOtd(periodoId)}`);

  if (pedidos.length === 0) {
    throw new Error(`No se encontraron pedidos con STATUS válido en ${_labelPeriodoOtd(periodoId)}.`);
  }

  // ── Paso 2: Agregar por proceso ─────────────────────────────────────────
  // Mapa: proceso → { total, atime, tarde }
  const procMap = {};
  const addProc = (key, ontime) => {
    if (!procMap[key]) procMap[key] = { total:0, atime:0, tarde:0 };
    procMap[key].total++;
    if (ontime) procMap[key].atime++; else procMap[key].tarde++;
  };

  for (const p of pedidos) {
    addProc(p.proceso, p.ontime);
    // Agregar también a B2B+B2C si corresponde
    if (p.proceso === 'B2B' || p.proceso === 'B2C') addProc('B2B+B2C', p.ontime);
    // Global
    addProc('GLOBAL', p.ontime);
  }

  // Construir rowsProceso
  const rowsProceso = [];
  const buildProcRow = (proc, key) => {
    const d = procMap[key];
    if (!d) return null;
    return {
      periodo_id:    periodoId,
      proceso:       proc,   // null para global
      total_pedidos: d.total,
      pedidos_atime: d.atime,
      pedidos_tarde: d.tarde,
      otd_pct:       d.total > 0 ? Math.round(d.atime/d.total*10000)/100 : 0,
    };
  };

  // Global (proceso = null)
  const globalRow = buildProcRow(null, 'GLOBAL');
  if (globalRow) rowsProceso.push(globalRow);
  // B2B+B2C
  const b2b2cRow = buildProcRow('B2B+B2C', 'B2B+B2C');
  if (b2b2cRow) rowsProceso.push(b2b2cRow);
  // Procesos individuales
  for (const pr of TODOS_PROCESOS) {
    if (procMap[pr]) rowsProceso.push(buildProcRow(pr, pr));
  }
  // Procesos no contemplados en TODOS_PROCESOS
  for (const [k, d] of Object.entries(procMap)) {
    if (k === 'GLOBAL' || k === 'B2B+B2C' || TODOS_PROCESOS.includes(k)) continue;
    rowsProceso.push(buildProcRow(k, k));
  }

  log(`📊 ${rowsProceso.length} registros de proceso calculados`);

  // ── Paso 3: Agregar por transportador ───────────────────────────────────
  const transMap = {};
  for (const p of pedidos) {
    if (!transMap[p.trans]) transMap[p.trans] = { total:0, atime:0, tarde:0 };
    transMap[p.trans].total++;
    if (p.ontime) transMap[p.trans].atime++; else transMap[p.trans].tarde++;
  }

  const rowsTrans = Object.entries(transMap).map(([t, d]) => ({
    periodo_id:    periodoId,
    transportador: t,
    total_pedidos: d.total,
    pedidos_atime: d.atime,
    pedidos_tarde: d.tarde,
    otd_pct:       d.total > 0 ? Math.round(d.atime/d.total*10000)/100 : 0,
  }));

  log(`🚚 ${rowsTrans.length} transportadores`);

  // ── Paso 4: Agregar diario (solo B2B+B2C para el gráfico principal) ────
  const diaMap = {};
  for (const p of pedidos) {
    if (p.proceso !== 'B2B' && p.proceso !== 'B2C') continue;
    if (!diaMap[p.fecha]) diaMap[p.fecha] = { total:0, atime:0, tarde:0 };
    diaMap[p.fecha].total++;
    if (p.ontime) diaMap[p.fecha].atime++; else diaMap[p.fecha].tarde++;
  }

  const rowsDiario = Object.entries(diaMap).sort(([a],[b])=>a<b?-1:1).map(([fecha, d]) => ({
    periodo_id:    periodoId,
    fecha,
    semana:        _isoWeekOtd(fecha),
    total_pedidos: d.total,
    pedidos_atime: d.atime,
    pedidos_tarde: d.tarde,
    otd_pct:       d.total > 0 ? Math.round(d.atime/d.total*10000)/100 : 0,
  }));

  log(`📅 ${rowsDiario.length} días (B2B+B2C)`);

  // ── Paso 5: Detalle pedido a pedido ────────────────────────────────────
  const rowsDetalle = Object.entries(pedidoMap).map(([comp, p]) => ({
    periodo_id:    periodoId,
    fecha:         p.fecha,
    comprobante:   comp,
    proceso:       p.proceso,
    transportador: p.trans,
    ciudad:        p.ciudad,
    ontime:        p.ontime,
    ontime_dias:   p.diasOT,   // dias calendario FECHA_DESPACHO - DIA
    novedad:       p.novedad || null,
  }));

  // ── Paso 6: Limpieza silenciosa ─────────────────────────────────────────
  log(`🧹 Borrando datos previos de ${_labelPeriodoOtd(periodoId)}…`);
  try {
    await sb.rest('DELETE',`kpi_otd_proceso?periodo_id=eq.${periodoId}`, null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_otd_trans?periodo_id=eq.${periodoId}`,   null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_otd_diario?periodo_id=eq.${periodoId}`,  null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_otd_detalle?periodo_id=eq.${periodoId}`, null,{'Prefer':'return=minimal'});
  } catch(e) {
    throw new Error(`Error al limpiar datos anteriores de ${_labelPeriodoOtd(periodoId)}.`);
  }

  // ── Paso 7: Upserts ─────────────────────────────────────────────────────
  const LOTE = 100;

  log(`⬆️ Subiendo procesos…`);
  await sb.rest('POST','kpi_otd_proceso', rowsProceso, {'Prefer':'resolution=merge-duplicates,return=minimal'});

  log(`⬆️ Subiendo transportadores…`);
  await sb.rest('POST','kpi_otd_trans', rowsTrans, {'Prefer':'resolution=merge-duplicates,return=minimal'});

  log(`⬆️ Subiendo ${rowsDiario.length} días…`);
  await sb.rest('POST','kpi_otd_diario', rowsDiario, {'Prefer':'resolution=merge-duplicates,return=minimal'});

  log(`⬆️ Subiendo ${rowsDetalle.length} registros de detalle…`);
  for (let i = 0; i < rowsDetalle.length; i += LOTE) {
    await sb.rest('POST','kpi_otd_detalle', rowsDetalle.slice(i, i+LOTE),
      {'Prefer':'return=minimal'});
    log(`  ✓ Detalle ${i+1}–${Math.min(i+LOTE, rowsDetalle.length)}`);
  }

  const b2b2c = procMap['B2B+B2C'] || { total:0, atime:0, tarde:0 };
  const otdB2 = b2b2c.total > 0 ? Math.round(b2b2c.atime/b2b2c.total*10000)/100 : 0;
  log(`✅ ${_labelPeriodoOtd(periodoId)}: OTD B2B+B2C ${otdB2}% · ${b2b2c.atime}/${b2b2c.total} pedidos`);

  return {
    periodoId,
    label:         _labelPeriodoOtd(periodoId),
    totalPedidos:  pedidos.length,
    b2b2cTotal:    b2b2c.total,
    b2b2cAtime:    b2b2c.atime,
    b2b2cTarde:    b2b2c.tarde,
    otdB2B2C:      otdB2,
    dias:          rowsDiario.length,
  };
}

window.procesarOTD = procesarOTD;
