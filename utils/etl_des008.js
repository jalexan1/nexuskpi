/**
 * etl_des008.js — NexusKPI · KPI-DES-008 · Ciclo de Pedido (Lead Time Interno)
 * Firma: procesarLeadTime(file, periodoId, onProgress)
 *
 * FUENTE: Hoja ALISTAMIENTO del archivo SEGUIMIENTO_CLICK_MES.xlsx
 * Homologación confirmada:
 *   hora_recibo   → DIA        (timestamp ingreso pedido al WMS)
 *   hora_despacho → SOLICITUD  (timestamp generación guía / despacho físico)
 *   ID pedido     → PICKING (fallback: Comprobante) — deduplica por pedido único
 *   proceso       → PROCESO  (B2B, B2C, CLICK, TRASLADO, RETAIL, MARKETPLACE, MAQUINAS)
 *   transportador → TRANSPORTADOR (SERVIENTREGA / L&S / CLICK)
 *
 * CÁLCULO:
 *   CP (h) = SOLICITUD − DIA, en horas hábiles (Lun–Sáb 07:00–17:00,
 *            excluye domingos y festivos colombianos — CONFIG.jornada.festivos)
 *   Pedidos sin SOLICITUD (pendientes de despacho) se excluyen del cálculo.
 *
 * INDICADOR PRINCIPAL c/ semáforo: B2B + B2C (meta < 24 h)
 *   🟢 BIEN    < 24 h
 *   🟡 ALERTA  24–28 h
 *   🔴 CRÍTICO > 28 h
 * Otros procesos (TRASLADO, RETAIL, CLICK, MARKETPLACE, MAQUINAS): informativos.
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function _parseFechaHoraDes008(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val;
  }
  if (typeof val === 'number') {
    const ms = (val - 25569) * 86400000; // serial Excel → epoch ms
    const d  = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const d = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function _fechaStrDes008(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function _isoWeekDes008(dateStr) {
  if (!dateStr) return null;
  const d    = new Date(dateStr + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const doy  = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const wn   = Math.ceil((doy + jan4.getDay()) / 7);
  return `Sem ${String(wn).padStart(2,'0')}-${d.getFullYear()}`;
}

function _labelPeriodoDes008(id) {
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

// Festivos colombianos 2026 (fallback si CONFIG no está disponible)
const FESTIVOS_DES008 = new Set([
  '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-18','2026-06-08','2026-06-29','2026-07-20',
  '2026-08-07','2026-08-17','2026-10-12','2026-11-02','2026-11-16',
  '2026-12-08','2026-12-25',
]);

function _getFestivosDes008() {
  if (typeof CONFIG !== 'undefined' && CONFIG.jornada && CONFIG.jornada.festivos) {
    return CONFIG.jornada.festivos;
  }
  return FESTIVOS_DES008;
}

/**
 * Horas hábiles entre dos timestamps.
 * Jornada: Lun–Sáb 07:00–17:00 (10 h/día). Excluye domingos y festivos.
 * Si hasta <= desde → 0.
 */
function _horasHabilesDes008(desde, hasta) {
  if (!desde || !hasta) return null;
  if (hasta.getTime() <= desde.getTime()) return 0;

  const festivos = _getFestivosDes008();
  const INI_H = 7, FIN_H = 17;

  function esHabil(dateObj) {
    const dow = dateObj.getDay(); // 0 = domingo
    const fs  = _fechaStrDes008(dateObj);
    return dow !== 0 && !festivos.has(fs);
  }

  let totalH = 0;
  const curDay = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const finDay = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());

  while (curDay <= finDay) {
    if (esHabil(curDay)) {
      const isPrimero = curDay.getTime() === new Date(desde.getFullYear(), desde.getMonth(), desde.getDate()).getTime();
      const isUltimo  = curDay.getTime() === finDay.getTime();

      let hIni = INI_H, hFin = FIN_H;
      if (isPrimero) {
        const hh = desde.getHours() + desde.getMinutes()/60 + desde.getSeconds()/3600;
        hIni = Math.max(INI_H, Math.min(hh, FIN_H));
      }
      if (isUltimo) {
        const hh = hasta.getHours() + hasta.getMinutes()/60 + hasta.getSeconds()/3600;
        hFin = Math.max(INI_H, Math.min(hh, FIN_H));
      }
      totalH += Math.max(0, hFin - hIni);
    }
    curDay.setDate(curDay.getDate() + 1);
  }
  return Math.round(totalH * 100) / 100;
}

function _estadoSemaforo(cpProm) {
  if (cpProm == null) return null;
  if (cpProm < 24) return 'BIEN';
  if (cpProm <= 28) return 'ALERTA';
  return 'CRITICO';
}

function _mediana(arrSorted) {
  const n = arrSorted.length;
  if (!n) return 0;
  const mid = Math.floor(n/2);
  return n % 2 === 0 ? (arrSorted[mid-1] + arrSorted[mid]) / 2 : arrSorted[mid];
}

// Agrega una lista de cp_horas a un resumen estadístico
function _agregar(items) {
  const cps = items.map(p => p.cp_horas).sort((a,b) => a-b);
  const total = cps.length;
  if (total === 0) {
    return { total_pedidos:0, cp_prom:0, cp_min:0, cp_max:0, cp_mediana:0, ok_24h:0, pct_24h:0, pct_8h:0 };
  }
  const sum   = cps.reduce((a,b)=>a+b, 0);
  const ok24  = cps.filter(v => v < 24).length;
  const ok8   = cps.filter(v => v < 8).length;
  return {
    total_pedidos: total,
    cp_prom:       Math.round(sum/total*100)/100,
    cp_min:        Math.round(cps[0]*100)/100,
    cp_max:        Math.round(cps[total-1]*100)/100,
    cp_mediana:    Math.round(_mediana(cps)*100)/100,
    ok_24h:        ok24,
    pct_24h:       Math.round(ok24/total*10000)/100,
    pct_8h:        Math.round(ok8/total*10000)/100,
  };
}

const PROCESOS_SEMAFORO = new Set(['B2B', 'B2C']);
const TODOS_PROCESOS_DES008 = ['B2B', 'B2C', 'TRASLADO', 'RETAIL', 'CLICK', 'MARKETPLACE', 'MAQUINAS'];

// ── Función principal ───────────────────────────────────────────────────

async function procesarLeadTime(file, periodoId, onProgress) {
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

  const iDia    = col('DIA');
  const iSol    = col('SOLICITUD');
  const iPick   = col('PICKING');
  const iComp   = col('Comprobante');
  const iProc   = col('PROCESO');
  const iTrans  = col('TRANSPORTADOR');

  const missing = [];
  if (iDia < 0) missing.push('DIA');
  if (iSol < 0) missing.push('SOLICITUD');
  if (iPick < 0 && iComp < 0) missing.push('PICKING o Comprobante');
  if (iProc < 0) missing.push('PROCESO');
  if (missing.length > 0) {
    throw new Error(`Columnas críticas no encontradas en ALISTAMIENTO: ${missing.join(', ')}.`);
  }

  log(`✅ Columnas mapeadas · ${rows.length-1} filas en ALISTAMIENTO`);

  // ── Verificar período ───────────────────────────────────────────────────
  const conteoMes = {};
  for (let i = 1; i < rows.length; i++) {
    const f = _parseFechaHoraDes008(rows[i][iDia]);
    if (f) { const ym = _fechaStrDes008(f).slice(0,7); conteoMes[ym] = (conteoMes[ym]||0)+1; }
  }

  const mesDominante    = Object.entries(conteoMes).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const filasDelPeriodo = conteoMes[periodoId] || 0;

  if (filasDelPeriodo === 0) {
    const disponibles = Object.entries(conteoMes)
      .sort((a,b)=>b[1]-a[1])
      .map(([mes,cnt]) => `${_labelPeriodoDes008(mes)} (${cnt} filas)`)
      .join(', ');
    throw new Error(
      `El archivo no contiene datos de ${_labelPeriodoDes008(periodoId)}. ` +
      `Meses encontrados: ${disponibles}.`
    );
  }

  if (mesDominante !== periodoId) {
    log(`⚠️ El archivo tiene más filas de ${_labelPeriodoDes008(mesDominante)}. ` +
        `Procesando ${_labelPeriodoDes008(periodoId)} (${filasDelPeriodo} filas).`);
  }

  log(`📅 Procesando: ${_labelPeriodoDes008(periodoId)} · ${filasDelPeriodo} filas`);

  // ── Paso 1: Construir pedidos únicos (dedupe por PICKING / Comprobante) ──
  const pedidoMap = {};
  let excluidosPendientes = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fecha = _parseFechaHoraDes008(r[iDia]);
    if (!fecha) continue;
    const fechaStr = _fechaStrDes008(fecha);
    if (!fechaStr.startsWith(periodoId)) continue;

    const pickingId = (iPick >= 0 && r[iPick]) ? String(r[iPick]).trim()
                     : (iComp >= 0 && r[iComp]) ? String(r[iComp]).trim()
                     : null;
    if (!pickingId || pedidoMap[pickingId]) continue;

    const fechaSolicitud = _parseFechaHoraDes008(r[iSol]);
    if (!fechaSolicitud) { excluidosPendientes++; continue; } // pedido pendiente, sin despacho

    const cpH = _horasHabilesDes008(fecha, fechaSolicitud);
    if (cpH === null || cpH < 0) { excluidosPendientes++; continue; }

    const proceso = r[iProc] ? String(r[iProc]).trim().toUpperCase() : 'B2B';
    const trans   = iTrans >= 0 && r[iTrans] ? String(r[iTrans]).trim().toUpperCase() : 'N/A';

    pedidoMap[pickingId] = {
      fecha:       fechaStr,
      semana:      _isoWeekDes008(fechaStr),
      proceso,
      transportador: trans,
      cp_horas:    cpH,
      estado_semaforo: _estadoSemaforo(cpH),
    };
  }

  const pedidos = Object.values(pedidoMap);
  log(`📦 ${pedidos.length} pedidos únicos en ${_labelPeriodoDes008(periodoId)} · ${excluidosPendientes} pendientes excluidos`);

  if (pedidos.length === 0) {
    throw new Error(`No se encontraron pedidos despachados (con SOLICITUD) en ${_labelPeriodoDes008(periodoId)}.`);
  }

  // ── Paso 2: Agregar por proceso ─────────────────────────────────────────
  const rowsProceso = [];

  // Global
  const globalAgg = _agregar(pedidos);
  rowsProceso.push({ periodo_id: periodoId, proceso: null, ...globalAgg, estado: _estadoSemaforo(globalAgg.cp_prom) });

  // B2B+B2C (indicador principal)
  const b2b2cPedidos = pedidos.filter(p => PROCESOS_SEMAFORO.has(p.proceso));
  const b2b2cAgg = _agregar(b2b2cPedidos);
  rowsProceso.push({ periodo_id: periodoId, proceso: 'B2B+B2C', ...b2b2cAgg, estado: _estadoSemaforo(b2b2cAgg.cp_prom) });

  // Procesos individuales conocidos
  for (const pr of TODOS_PROCESOS_DES008) {
    const items = pedidos.filter(p => p.proceso === pr);
    if (!items.length) continue;
    const agg = _agregar(items);
    rowsProceso.push({ periodo_id: periodoId, proceso: pr, ...agg, estado: _estadoSemaforo(agg.cp_prom) });
  }
  // Procesos no contemplados (por si aparece alguno nuevo)
  const conocidos = new Set([...TODOS_PROCESOS_DES008]);
  const otrosNombres = new Set(pedidos.map(p=>p.proceso).filter(p=>!conocidos.has(p)));
  for (const pr of otrosNombres) {
    const items = pedidos.filter(p => p.proceso === pr);
    const agg = _agregar(items);
    rowsProceso.push({ periodo_id: periodoId, proceso: pr, ...agg, estado: _estadoSemaforo(agg.cp_prom) });
  }

  log(`📊 ${rowsProceso.length} registros de proceso calculados`);

  // ── Paso 3: Agregar por transportador (solo B2B+B2C) ─────────────────────
  const transMap = {};
  for (const p of b2b2cPedidos) {
    if (!transMap[p.transportador]) transMap[p.transportador] = [];
    transMap[p.transportador].push(p);
  }
  const rowsTrans = Object.entries(transMap).map(([t, items]) => {
    const agg = _agregar(items);
    return { periodo_id: periodoId, transportador: t, total_pedidos: agg.total_pedidos, cp_prom: agg.cp_prom };
  });

  log(`🚚 ${rowsTrans.length} transportadores (B2B+B2C)`);

  // ── Paso 4: Agregar diario (solo B2B+B2C) ────────────────────────────────
  const diaMap = {};
  for (const p of b2b2cPedidos) {
    if (!diaMap[p.fecha]) diaMap[p.fecha] = [];
    diaMap[p.fecha].push(p);
  }
  const rowsDiario = Object.entries(diaMap).sort(([a],[b]) => a<b?-1:1).map(([fecha, items]) => {
    const agg = _agregar(items);
    return {
      periodo_id:    periodoId,
      fecha,
      semana:        _isoWeekDes008(fecha),
      total_pedidos: agg.total_pedidos,
      cp_prom:       agg.cp_prom,
      cp_min:        agg.cp_min,
      cp_max:        agg.cp_max,
      pct_24h:       agg.pct_24h,
    };
  });

  log(`📅 ${rowsDiario.length} días (B2B+B2C)`);

  // ── Paso 5: Detalle pedido a pedido ──────────────────────────────────────
  const rowsDetalle = Object.entries(pedidoMap).map(([picking, p]) => ({
    periodo_id:      periodoId,
    fecha:           p.fecha,
    semana:          p.semana,
    picking_id:      picking,
    proceso:         p.proceso,
    transportador:   p.transportador,
    cp_horas:        p.cp_horas,
    estado_semaforo: p.estado_semaforo,
  }));

  // ── Paso 6: Limpieza silenciosa ───────────────────────────────────────────
  log(`🧹 Borrando datos previos de ${_labelPeriodoDes008(periodoId)}…`);
  try {
    await sb.rest('DELETE',`kpi_des008_proceso?periodo_id=eq.${periodoId}`, null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_des008_trans?periodo_id=eq.${periodoId}`,   null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_des008_diario?periodo_id=eq.${periodoId}`,  null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_des008_detalle?periodo_id=eq.${periodoId}`, null,{'Prefer':'return=minimal'});
  } catch(e) {
    throw new Error(`Error al limpiar datos anteriores de ${_labelPeriodoDes008(periodoId)}.`);
  }

  // ── Paso 7: Upserts ───────────────────────────────────────────────────────
  const LOTE = 100;

  log('⬆️ Subiendo procesos…');
  await sb.rest('POST','kpi_des008_proceso', rowsProceso, {'Prefer':'resolution=merge-duplicates,return=minimal'});

  log('⬆️ Subiendo transportadores…');
  if (rowsTrans.length) {
    await sb.rest('POST','kpi_des008_trans', rowsTrans, {'Prefer':'resolution=merge-duplicates,return=minimal'});
  }

  log(`⬆️ Subiendo ${rowsDiario.length} días…`);
  if (rowsDiario.length) {
    await sb.rest('POST','kpi_des008_diario', rowsDiario, {'Prefer':'resolution=merge-duplicates,return=minimal'});
  }

  log(`⬆️ Subiendo ${rowsDetalle.length} registros de detalle…`);
  for (let i = 0; i < rowsDetalle.length; i += LOTE) {
    await sb.rest('POST','kpi_des008_detalle', rowsDetalle.slice(i, i+LOTE),
      {'Prefer':'return=minimal'});
    log(`  ✓ Detalle ${i+1}–${Math.min(i+LOTE, rowsDetalle.length)}`);
  }

  log(`✅ ${_labelPeriodoDes008(periodoId)}: CP Prom B2B+B2C ${b2b2cAgg.cp_prom}h · ${b2b2cAgg.ok_24h}/${b2b2cAgg.total_pedidos} ≤24h (${b2b2cAgg.pct_24h}%)`);

  return {
    periodoId,
    label:        _labelPeriodoDes008(periodoId),
    totalPedidos: pedidos.length,
    b2b2cTotal:   b2b2cAgg.total_pedidos,
    cpPromB2B2C:  b2b2cAgg.cp_prom,
    pct24B2B2C:   b2b2cAgg.pct_24h,
    ok24B2B2C:    b2b2cAgg.ok_24h,
    estadoB2B2C:  _estadoSemaforo(b2b2cAgg.cp_prom),
    dias:         rowsDiario.length,
  };
}

window.procesarLeadTime = procesarLeadTime;
