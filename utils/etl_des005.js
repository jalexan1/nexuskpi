/**
 * etl_des005.js — NexusKPI · KPI-DES-005 On-Time Delivery (OTD %)
 * Firma: procesarOTD(file, periodoId, onProgress)
 *
 * FUENTE: Hoja ALISTAMIENTO del archivo SEGUIMIENTO_CLICK_MES.xlsx
 *
 * HALLAZGOS VERIFICADOS CON openpyxl (SEGUIMIENTO_CLICK_ABR.xlsx):
 *   - ON-TIME L&S (col 42): int.
 *       0   = despachado exactamente a tiempo  → A TIEMPO
 *       1   = despachado con 1 día anticipado  → A TIEMPO
 *       < 0 = días de retraso (ej: -2 = 2 días tarde) → TARDE
 *       '#VALUE!' (5 filas) → tratar como null → TARDE
 *   - STATUS (col 39): 'DESPACHADO' | 'ENTREGADO' | 'DEVOLUCION' | 'PENDIENTE'
 *       Contar DESPACHADO y ENTREGADO (ambos salieron del CEDI)
 *   - Comprobante (col 1): str 'FV-3-XXXXX' — pedido único
 *   - DIA (col 0): datetime con hora — para autodetectar periodo dominante
 *   - SOLICITUD (col 41): datetime — para lead time = FECHA DESPACHO − SOLICITUD
 *   - FECHA DESPACHO (col 36): datetime — fecha real de salida del CEDI
 *
 * LÓGICA: agrupar por Comprobante (pedido único). Un comprobante puede tener
 * N filas (SKUs). Se toma solo la primera fila por comprobante.
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

function _diasEntreOtd(inicio, fin) {
  if (!inicio || !fin) return null;
  const toMs = v => {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  };
  const msI = toMs(inicio), msF = toMs(fin);
  if (msI === null || msF === null) return null;
  const diff = (msF - msI) / 86400000;
  return diff >= 0 ? Math.round(diff * 100) / 100 : null;
}

/**
 * Interpreta ON-TIME L&S.
 * Semántica confirmada: int >= 0 = A TIEMPO; int < 0 = TARDE; '#VALUE!' = TARDE.
 */
function _parseOnTimeOtd(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') return val >= 0;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s.startsWith('#') || s === '') return false;   // errores Excel
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) >= 0;
  // variantes texto para futura compatibilidad
  return s === 'ok' || s === 'si' || s === 'yes' || s === 'a tiempo' || s === 'true';
}

function _isoWeekOtd(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
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

// ── Función principal ──────────────────────────────────────────────────────

async function procesarOTD(file, periodoId, onProgress) {
  const log = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo Excel…');

  const wb = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        res(XLSX.read(e.target.result, {
          type: 'array',
          cellDates: true,
          dateNF: 'yyyy-mm-dd',
        }));
      } catch(err) { rej(new Error('Error leyendo el Excel: ' + err.message)); }
    };
    reader.onerror = () => rej(new Error('Error al leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });

  // ── FUENTE: hoja ALISTAMIENTO ─────────────────────────────────────────
  if (!wb.Sheets['ALISTAMIENTO']) {
    throw new Error(
      'El archivo no tiene hoja "ALISTAMIENTO". ' +
      'Verifica que sea SEGUIMIENTO_CLICK_MES.xlsx.'
    );
  }

  const ws   = wb.Sheets['ALISTAMIENTO'];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, cellDates: true,
  });

  if (rows.length < 2) {
    throw new Error('La hoja ALISTAMIENTO está vacía o solo tiene encabezados.');
  }

  // ── Mapear columnas por nombre ────────────────────────────────────────
  const headers = rows[0].map(h => h == null ? '' : String(h).trim());
  const col = name => headers.indexOf(name);

  const iDia         = col('DIA');
  const iComp        = col('Comprobante');
  const iStatus      = col('STATUS');
  const iFechaDes    = col('FECHA DESPACHO');
  const iSolicitud   = col('SOLICITUD');
  const iOnTime      = col('ON-TIME L&S');

  const missing = [];
  if (iDia < 0)      missing.push('DIA');
  if (iComp < 0)     missing.push('Comprobante');
  if (iStatus < 0)   missing.push('STATUS');
  if (iFechaDes < 0) missing.push('FECHA DESPACHO');
  if (iOnTime < 0)   missing.push('ON-TIME L&S');

  if (missing.length > 0) {
    throw new Error(
      `Columnas críticas no encontradas en ALISTAMIENTO: ${missing.join(', ')}. ` +
      `Verifica que sea SEGUIMIENTO_CLICK_MES.xlsx.`
    );
  }

  log(`✅ Columnas mapeadas · ${rows.length - 1} filas en ALISTAMIENTO`);

  // ── Verificar periodo desde DIA ───────────────────────────────────────
  const conteoMes = {};
  for (let i = 1; i < rows.length; i++) {
    const f = _parseFechaOtd(rows[i][iDia]);
    if (f) {
      const ym = f.slice(0,7);
      conteoMes[ym] = (conteoMes[ym]||0) + 1;
    }
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

  // ── Paso 1: Agrupar pedidos únicos por Comprobante ────────────────────
  // STATUS válidos: DESPACHADO y ENTREGADO (ambos completaron la salida del CEDI)
  const STATUS_OK = new Set(['DESPACHADO', 'ENTREGADO']);
  const pedidoMap = {};  // key = fecha|comp → { fecha, onTime, leadTime }

  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const fecha = _parseFechaOtd(r[iDia]);
    if (!fecha || !fecha.startsWith(periodoId)) continue;

    const st = r[iStatus] ? String(r[iStatus]).trim().toUpperCase() : '';
    if (!STATUS_OK.has(st)) continue;

    const comp = r[iComp] ? String(r[iComp]).trim() : '';
    if (!comp) continue;

    const key = `${fecha}|${comp}`;
    if (pedidoMap[key]) continue;  // ya registrado (SKU adicional del mismo pedido)

    const onTime   = _parseOnTimeOtd(r[iOnTime]);
    const leadTime = _diasEntreOtd(r[iSolicitud], r[iFechaDes]);

    pedidoMap[key] = { fecha, comp, onTime, leadTime };
  }

  const pedidos = Object.values(pedidoMap);
  log(`📦 ${pedidos.length} pedidos únicos DESPACHADOS/ENTREGADOS en ${_labelPeriodoOtd(periodoId)}`);

  if (pedidos.length === 0) {
    throw new Error(
      `No se encontraron pedidos DESPACHADOS o ENTREGADOS en ${_labelPeriodoOtd(periodoId)}. ` +
      `Verifica que el archivo corresponde a este mes.`
    );
  }

  // ── Paso 2: Agregar por día ───────────────────────────────────────────
  const porDia = {};
  for (const p of pedidos) {
    if (!porDia[p.fecha]) {
      porDia[p.fecha] = {
        fecha:  p.fecha,
        semana: _isoWeekOtd(p.fecha),
        total:  0, aTime: 0, tarde: 0, leadTimes: [],
      };
    }
    const d = porDia[p.fecha];
    d.total++;
    if (p.onTime) d.aTime++; else d.tarde++;
    if (p.leadTime !== null && p.leadTime >= 0) d.leadTimes.push(p.leadTime);
  }

  const rowsDiario = Object.values(porDia).sort((a,b) => a.fecha < b.fecha ? -1 : 1).map(d => {
    const otdPct  = d.total > 0 ? Math.round(d.aTime / d.total * 10000) / 100 : 0;
    const ltProm  = d.leadTimes.length
      ? Math.round(d.leadTimes.reduce((s,v)=>s+v,0) / d.leadTimes.length * 100) / 100
      : null;
    return {
      periodo_id:    periodoId,
      fecha:         d.fecha,
      semana:        d.semana,
      total_pedidos: d.total,
      pedidos_atime: d.aTime,
      pedidos_tarde: d.tarde,
      otd_pct:       otdPct,
      lead_time_prom: ltProm,
    };
  });

  log(`📅 ${rowsDiario.length} días calculados`);

  // ── Paso 3: Resumen semanal y global ──────────────────────────────────
  const semMap = {};
  for (const d of rowsDiario) {
    if (!semMap[d.semana]) {
      semMap[d.semana] = { total:0, aTime:0, tarde:0, lts:[], otds:[], fechas:[] };
    }
    const s = semMap[d.semana];
    s.total  += d.total_pedidos;
    s.aTime  += d.pedidos_atime;
    s.tarde  += d.pedidos_tarde;
    s.otds.push(d.otd_pct);
    s.fechas.push(d.fecha);
    if (d.lead_time_prom !== null) s.lts.push(d.lead_time_prom);
  }

  const rowsResumen = [];
  for (const [semana, v] of Object.entries(semMap)) {
    const otdPct = v.total > 0 ? Math.round(v.aTime / v.total * 10000) / 100 : 0;
    const ltProm = v.lts.length
      ? Math.round(v.lts.reduce((a,b)=>a+b,0) / v.lts.length * 100) / 100 : null;
    rowsResumen.push({
      periodo_id:    periodoId,
      semana,
      fecha_inicio:  v.fechas.sort()[0] || null,
      total_pedidos: v.total,
      pedidos_atime: v.aTime,
      pedidos_tarde: v.tarde,
      otd_pct:       otdPct,
      lead_time_prom: ltProm,
      mejor_dia_otd: v.otds.length ? Math.max(...v.otds) : null,
      peor_dia_otd:  v.otds.length ? Math.min(...v.otds) : null,
    });
  }

  // Fila global (semana = null)
  const gTotal = rowsDiario.reduce((s,d)=>s+d.total_pedidos, 0);
  const gATime = rowsDiario.reduce((s,d)=>s+d.pedidos_atime, 0);
  const gTarde = rowsDiario.reduce((s,d)=>s+d.pedidos_tarde, 0);
  const gLTs   = rowsDiario.filter(d=>d.lead_time_prom!==null).map(d=>d.lead_time_prom);
  const gOtds  = rowsDiario.map(d=>d.otd_pct);
  const globalOtd = gTotal > 0 ? Math.round(gATime / gTotal * 10000) / 100 : 0;

  rowsResumen.unshift({
    periodo_id:    periodoId,
    semana:        null,
    fecha_inicio:  rowsDiario[0]?.fecha || null,
    total_pedidos: gTotal,
    pedidos_atime: gATime,
    pedidos_tarde: gTarde,
    otd_pct:       globalOtd,
    lead_time_prom: gLTs.length ? Math.round(gLTs.reduce((a,b)=>a+b,0)/gLTs.length*100)/100 : null,
    mejor_dia_otd: gOtds.length ? Math.max(...gOtds) : null,
    peor_dia_otd:  gOtds.length ? Math.min(...gOtds) : null,
  });

  log(`📊 Resumen: 1 global + ${rowsResumen.length-1} semanas`);

  // ── Paso 4: Limpieza silenciosa ───────────────────────────────────────
  log(`🧹 Borrando datos previos de ${_labelPeriodoOtd(periodoId)}…`);
  try {
    await sb.rest('DELETE', `kpi_otd_diario?periodo_id=eq.${periodoId}`,  null, {'Prefer':'return=minimal'});
    await sb.rest('DELETE', `kpi_otd_resumen?periodo_id=eq.${periodoId}`, null, {'Prefer':'return=minimal'});
  } catch(e) {
    throw new Error(`Error al limpiar datos anteriores de ${_labelPeriodoOtd(periodoId)}.`);
  }

  // ── Paso 5: Upsert diario ─────────────────────────────────────────────
  log(`⬆️ Subiendo ${rowsDiario.length} días…`);
  const LOTE = 100;
  for (let i = 0; i < rowsDiario.length; i += LOTE) {
    try {
      await sb.rest('POST', 'kpi_otd_diario', rowsDiario.slice(i, i+LOTE),
        {'Prefer':'resolution=merge-duplicates,return=minimal'});
    } catch(e) {
      throw new Error(`Error guardando datos diarios de ${_labelPeriodoOtd(periodoId)}: ${e.message}.`);
    }
    log(`  ✓ Días ${i+1}–${Math.min(i+LOTE, rowsDiario.length)} guardados`);
  }

  // ── Paso 6: Upsert resumen ────────────────────────────────────────────
  log(`⬆️ Subiendo ${rowsResumen.length} registros de resumen…`);
  try {
    await sb.rest('POST', 'kpi_otd_resumen', rowsResumen,
      {'Prefer':'resolution=merge-duplicates,return=minimal'});
  } catch(e) {
    throw new Error(`Error guardando el resumen de ${_labelPeriodoOtd(periodoId)}: ${e.message}.`);
  }

  log(`✅ ${_labelPeriodoOtd(periodoId)}: OTD ${globalOtd}% · ${gATime}/${gTotal} pedidos a tiempo · ${rowsDiario.length} días`);

  return {
    periodoId,
    label:       _labelPeriodoOtd(periodoId),
    dias:        rowsDiario.length,
    totalPedidos: gTotal,
    pedidosATime: gATime,
    pedidosTarde: gTarde,
    otdPct:      globalOtd,
    leadTimeProm: rowsResumen[0]?.lead_time_prom ?? null,
    mejorDiaOtd:  rowsResumen[0]?.mejor_dia_otd ?? null,
    peorDiaOtd:   rowsResumen[0]?.peor_dia_otd  ?? null,
  };
}

window.procesarOTD = procesarOTD;
