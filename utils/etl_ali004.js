/**
 * etl_ali004.js — NexusKPI · KPI-ALI-004 Productividad de Alistamiento
 * Firma: procesarAlistamiento(file, periodoId, onProgress)
 * Sin export · Sin credenciales · Usa sb.rest() · Autodetecta periodo desde DIA
 *
 * CORRECCIÓN v2:
 * - INICIO PICKING y FIN PICKING solo existen en la PRIMERA fila de cada pedido
 *   (Comprobante). Las demás filas del mismo pedido tienen null en esos campos.
 *   → Agrupar por Comprobante: tomar INICIO/FIN de la primera fila con valor,
 *     sumar Facturado y Cantidad cajas de TODAS las filas del pedido.
 *   → Luego agrupar por día+operario para calcular horas y PA.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

function _toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'string' && val.length >= 10) return val.slice(0, 10);
  return null;
}

function _toYM(val) {
  const s = _toDateStr(val);
  return s ? s.slice(0, 7) : null;
}

function _parseHora(str) {
  // Convierte "HH:MM:SS" o "HH:MM" → horas decimales. Retorna null si inválido.
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  const h = parts[0], m = parts[1] || 0, s = parts[2] || 0;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  return h + m / 60 + s / 3600;
}

function _isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const weekNum = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `Sem ${String(weekNum).padStart(2, '0')}-${d.getFullYear()}`;
}

function _labelPeriodo(periodoId) {
  if (!periodoId) return 'período desconocido';
  if (typeof CONFIG !== 'undefined' && CONFIG.meses) {
    const m = CONFIG.meses.find(x => x.id === periodoId);
    if (m) return m.label;
  }
  const meses = {
    '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril',
    '05':'Mayo','06':'Junio','07':'Julio','08':'Agosto',
    '09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'
  };
  const [y, m] = periodoId.split('-');
  return `${meses[m] || m} ${y}`;
}

// ── Función principal ────────────────────────────────────────────────────

async function procesarAlistamiento(file, periodoId, onProgress) {
  const log = (msg) => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo Excel…');

  // ── Paso 1: Leer con SheetJS ──
  const wb = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(e.target.result, {
          type: 'array',
          cellDates: true,
          dateNF: 'yyyy-mm-dd'
        }));
      } catch (err) {
        reject(new Error('Error leyendo el Excel: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });

  if (!wb.Sheets['ALISTAMIENTO']) {
    throw new Error('El archivo no tiene hoja "ALISTAMIENTO". Verifica que sea SEGUIMIENTO_CLICK_MES.xlsx.');
  }

  const ws   = wb.Sheets['ALISTAMIENTO'];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, cellDates: true
  });

  if (rows.length < 2) {
    throw new Error('La hoja ALISTAMIENTO está vacía o solo tiene encabezados.');
  }

  // ── Paso 2: Mapear columnas por nombre ──
  const headers = rows[0].map(h => (h == null ? '' : String(h).trim()));
  const col = (name) => headers.indexOf(name);

  const iDia       = col('DIA');
  const iComp      = col('Comprobante');
  const iOp        = col('OPERARIO');
  const iInicio    = col('INICIO PICKING');
  const iFin       = col('FIN PICKING');
  const iFacturado = col('Facturado');
  const iCajas     = col('Cantidad cajas');
  const iProceso   = col('PROCESO');

  if (iDia < 0 || iComp < 0 || iOp < 0 || iInicio < 0 || iFin < 0 || iFacturado < 0) {
    throw new Error(
      'No se encontraron columnas críticas en ALISTAMIENTO ' +
      '(DIA, Comprobante, OPERARIO, INICIO PICKING, FIN PICKING, Facturado). ' +
      'Verifica que sea el archivo correcto.'
    );
  }

  log(`✅ Columnas mapeadas. ${rows.length - 1} filas de datos.`);

  // ── Paso 3: Autodetectar periodo dominante desde DIA ──
  const conteoMes = {};
  for (let i = 1; i < rows.length; i++) {
    const ym = _toYM(rows[i][iDia]);
    if (ym) conteoMes[ym] = (conteoMes[ym] || 0) + 1;
  }

  const periodoDetectado = Object.entries(conteoMes)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!periodoDetectado) {
    throw new Error('No se detectó ningún mes válido en la columna DIA del archivo.');
  }

  if (periodoDetectado !== periodoId) {
    log(`⚠️ Selector decía "${_labelPeriodo(periodoId)}" pero el archivo es de ${_labelPeriodo(periodoDetectado)}. Usando ${_labelPeriodo(periodoDetectado)}.`);
  }

  const periodo = periodoDetectado;
  log(`📅 Período detectado: ${_labelPeriodo(periodo)} (${conteoMes[periodo]} filas)`);

  // ── Paso 4: Agrupar por Comprobante ──────────────────────────────────
  //
  // La estructura real del Excel es:
  //   Comprobante FV-3-69373 → 17 filas
  //     Fila 1: DIA, OPERARIO, INICIO PICKING="13:29:39", FIN PICKING="13:55:23", Facturado=60, Cajas=18
  //     Fila 2: DIA, OPERARIO, INICIO PICKING=null,       FIN PICKING=null,       Facturado=72, Cajas=null
  //     Fila 3: ...
  //
  // INICIO y FIN solo existen en la PRIMERA fila de cada pedido.
  // Debemos:
  //   1. Tomar DIA, OPERARIO, INICIO, FIN de la fila que los tiene
  //   2. Sumar Facturado y Cajas de TODAS las filas del mismo Comprobante
  //   3. Calcular la duración del pedido = FIN − INICIO
  //   4. Luego agrupar por fecha+operario para calcular PA
  //
  // compMap[Comprobante] = { fecha, operario, hIni, hFin, unidades, cajas }

  const compMap = {};
  let filasOtroMes = 0;

  for (let i = 1; i < rows.length; i++) {
    const r       = rows[i];
    const fechaStr = _toDateStr(r[iDia]);

    // Filtrar por periodo
    if (!fechaStr || !fechaStr.startsWith(periodo)) {
      filasOtroMes++;
      continue;
    }

    const comp      = r[iComp] ? String(r[iComp]).trim() : null;
    const operario  = r[iOp]   ? String(r[iOp]).trim()   : null;
    const iniRaw    = r[iInicio];
    const finRaw    = r[iFin];
    const facturado = Number(r[iFacturado]) || 0;
    const cajas     = Number(r[iCajas])     || 0;

    if (!comp) continue;

    // Inicializar entrada del comprobante si no existe
    if (!compMap[comp]) {
      compMap[comp] = {
        fecha:    fechaStr,
        operario: null,
        iniStr:   null,
        finStr:   null,
        unidades: 0,
        cajas:    0,
      };
    }

    // Tomar OPERARIO, INICIO, FIN de la primera fila que los tenga
    if (!compMap[comp].operario && operario) {
      compMap[comp].operario = operario;
    }
    if (!compMap[comp].iniStr && iniRaw) {
      compMap[comp].iniStr = String(iniRaw).trim();
    }
    if (!compMap[comp].finStr && finRaw) {
      compMap[comp].finStr = String(finRaw).trim();
    }

    // Acumular unidades y cajas de TODAS las filas del pedido
    compMap[comp].unidades += facturado;
    compMap[comp].cajas    += cajas;
  }

  log(`📦 ${Object.keys(compMap).length} pedidos (Comprobantes) en ${_labelPeriodo(periodo)}`);

  // ── Paso 5: Validar y calcular duración por Comprobante ──
  // Luego agrupar: dayMap[fecha][operario] = { horas, unidades, cajas, pedidos }

  const dayMap = {};
  let pedidosValidos   = 0;
  let pedidosInvalidos = 0;

  for (const [comp, c] of Object.entries(compMap)) {
    const { fecha, operario, iniStr, finStr, unidades, cajas } = c;

    // Validar que tenga operario y tiempos
    if (!operario || !iniStr || !finStr) {
      pedidosInvalidos++;
      continue;
    }

    const hIni = _parseHora(iniStr);
    const hFin = _parseHora(finStr);

    if (hIni === null || hFin === null) {
      pedidosInvalidos++;
      continue;
    }

    // Duración del pedido
    let duracion = hFin - hIni;
    if (duracion < 0) duracion += 24;  // cruce de medianoche
    if (duracion <= 0 || duracion > 14) {
      pedidosInvalidos++;
      continue;
    }

    pedidosValidos++;

    if (!dayMap[fecha]) dayMap[fecha] = {};
    if (!dayMap[fecha][operario]) {
      dayMap[fecha][operario] = { horas: 0, unidades: 0, cajas: 0, pedidos: 0 };
    }
    dayMap[fecha][operario].horas    += duracion;
    dayMap[fecha][operario].unidades += unidades;
    dayMap[fecha][operario].cajas    += cajas;
    dayMap[fecha][operario].pedidos  += 1;
  }

  log(`📊 Pedidos válidos: ${pedidosValidos} | Descartados (sin operario/tiempo): ${pedidosInvalidos}`);

  if (pedidosValidos === 0) {
    throw new Error(
      `No se encontraron pedidos válidos para ${_labelPeriodo(periodo)}. ` +
      `Verifica que el archivo corresponda a ${_labelPeriodo(periodo)} y ` +
      `tenga OPERARIO, INICIO PICKING y FIN PICKING completos en al menos una fila por pedido.`
    );
  }

  // ── Paso 6: Construir registros diarios ──
  const diasOrdenados = Object.keys(dayMap).sort();
  const rowsDiario    = [];

  for (const fecha of diasOrdenados) {
    const operarios = dayMap[fecha];
    const nomOps    = Object.keys(operarios);

    let totalUnidades = 0, totalCajas = 0, totalHoras = 0, totalPedidos = 0;
    for (const op of nomOps) {
      totalUnidades += operarios[op].unidades;
      totalCajas    += operarios[op].cajas;
      totalHoras    += operarios[op].horas;
      totalPedidos  += operarios[op].pedidos;
    }

    const numOperarios = nomOps.length;
    const paUnd   = totalHoras > 0 ? Math.round((totalUnidades / totalHoras) * 100) / 100 : 0;
    const paCajas = totalHoras > 0 ? Math.round((totalCajas    / totalHoras) * 100) / 100 : 0;
    const semana  = _isoWeek(fecha);

    rowsDiario.push({
      periodo_id:      periodo,
      fecha,
      semana,
      num_pedidos:     totalPedidos,
      und_alistadas:   totalUnidades,
      cajas_alistadas: totalCajas,
      horas_efectivas: Math.round(totalHoras * 10000) / 10000,
      num_operarios:   numOperarios,
      pa_und:          paUnd,
      pa_cajas:        paCajas,
    });
  }

  log(`📅 ${rowsDiario.length} días a insertar en kpi_ali_diario`);

  // ── Paso 7: Construir resumen por semana y global ──
  const semMap = {};
  for (const d of rowsDiario) {
    const s = d.semana;
    if (!semMap[s]) semMap[s] = { und: 0, cajas: 0, horas: 0, ops_sum: 0, dias: 0, mejorPA: -Infinity, peorPA: Infinity };
    semMap[s].und      += d.und_alistadas;
    semMap[s].cajas    += d.cajas_alistadas;
    semMap[s].horas    += d.horas_efectivas;
    semMap[s].ops_sum  += d.num_operarios;
    semMap[s].dias     += 1;
    if (d.pa_und > semMap[s].mejorPA) semMap[s].mejorPA = d.pa_und;
    if (d.pa_und < semMap[s].peorPA)  semMap[s].peorPA  = d.pa_und;
  }

  const rowsResumen = [];

  for (const [semana, v] of Object.entries(semMap)) {
    const paUnd   = v.horas > 0 ? Math.round((v.und   / v.horas) * 100) / 100 : 0;
    const paCajas = v.horas > 0 ? Math.round((v.cajas / v.horas) * 100) / 100 : 0;
    const fechaInicio = rowsDiario.filter(d => d.semana === semana).map(d => d.fecha).sort()[0] || null;
    rowsResumen.push({
      periodo_id:         periodo, semana, fecha_inicio: fechaInicio,
      und_alistadas:      v.und,
      cajas_alistadas:    v.cajas,
      horas_efectivas:    Math.round(v.horas * 10000) / 10000,
      num_operarios_prom: v.dias > 0 ? Math.round((v.ops_sum / v.dias) * 100) / 100 : 0,
      pa_und:             paUnd,
      pa_cajas:           paCajas,
      mejor_dia_pa:       Math.round(v.mejorPA * 100) / 100,
      peor_dia_pa:        Math.round(v.peorPA  * 100) / 100,
    });
  }

  // Fila global (semana = null)
  const totUnd   = rowsDiario.reduce((s, d) => s + d.und_alistadas,   0);
  const totCajas = rowsDiario.reduce((s, d) => s + d.cajas_alistadas, 0);
  const totHoras = rowsDiario.reduce((s, d) => s + d.horas_efectivas, 0);
  const totOps   = rowsDiario.reduce((s, d) => s + d.num_operarios,   0);
  const paGlobal      = totHoras > 0 ? Math.round((totUnd   / totHoras) * 100) / 100 : 0;
  const paCajasGlobal = totHoras > 0 ? Math.round((totCajas / totHoras) * 100) / 100 : 0;
  const mejorDia = Math.max(...rowsDiario.map(d => d.pa_und));
  const peorDia  = Math.min(...rowsDiario.map(d => d.pa_und));

  rowsResumen.unshift({
    periodo_id:         periodo,
    semana:             null,
    fecha_inicio:       diasOrdenados[0] || null,
    und_alistadas:      totUnd,
    cajas_alistadas:    totCajas,
    horas_efectivas:    Math.round(totHoras * 10000) / 10000,
    num_operarios_prom: rowsDiario.length > 0 ? Math.round((totOps / rowsDiario.length) * 100) / 100 : 0,
    pa_und:             paGlobal,
    pa_cajas:           paCajasGlobal,
    mejor_dia_pa:       Math.round(mejorDia * 100) / 100,
    peor_dia_pa:        Math.round(peorDia  * 100) / 100,
  });

  log(`📊 Resumen: 1 global + ${rowsResumen.length - 1} semanas`);

  // ── Paso 8: Limpieza silenciosa ──
  log(`🧹 Borrando datos previos de ${_labelPeriodo(periodo)}…`);
  try {
    await sb.rest('DELETE', `kpi_ali_diario?periodo_id=eq.${periodo}`,  null, { 'Prefer': 'return=minimal' });
    await sb.rest('DELETE', `kpi_ali_resumen?periodo_id=eq.${periodo}`, null, { 'Prefer': 'return=minimal' });
  } catch (e) {
    throw new Error(
      `Error al limpiar datos anteriores de ${_labelPeriodo(periodo)}. ` +
      `Vuelve a cargar el archivo de ${_labelPeriodo(periodo)}.`
    );
  }

  // ── Paso 9: Upsert kpi_ali_diario ──
  log(`⬆️ Subiendo ${rowsDiario.length} días…`);
  const LOTE = 100;
  for (let i = 0; i < rowsDiario.length; i += LOTE) {
    try {
      await sb.rest('POST', 'kpi_ali_diario', rowsDiario.slice(i, i + LOTE), {
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      });
    } catch (e) {
      throw new Error(
        `Error guardando datos diarios de ${_labelPeriodo(periodo)} (lote ${Math.floor(i / LOTE) + 1}). ` +
        `Vuelve a cargar el archivo de ${_labelPeriodo(periodo)}.`
      );
    }
    log(`  ✓ Días ${i + 1}–${Math.min(i + LOTE, rowsDiario.length)} guardados`);
  }

  // ── Paso 10: Upsert kpi_ali_resumen ──
  log(`⬆️ Subiendo ${rowsResumen.length} registros de resumen…`);
  try {
    await sb.rest('POST', 'kpi_ali_resumen', rowsResumen, {
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    });
  } catch (e) {
    throw new Error(
      `Error guardando el resumen de ${_labelPeriodo(periodo)}. ` +
      `Vuelve a cargar el archivo de ${_labelPeriodo(periodo)}.`
    );
  }

  log(`✅ ${_labelPeriodo(periodo)} cargado: PA ${paGlobal} u/p/h · ${totUnd.toLocaleString('es-CO')} und · ${totCajas.toLocaleString('es-CO')} cajas · ${rowsDiario.length} días`);

  return {
    periodoId:      periodo,
    label:          _labelPeriodo(periodo),
    dias:           rowsDiario.length,
    undAlistadas:   totUnd,
    cajasAlistadas: totCajas,
    horasEfectivas: Math.round(totHoras * 100) / 100,
    paUnd:          paGlobal,
    paCajas:        paCajasGlobal,
    mejorDia:       Math.round(mejorDia * 100) / 100,
    peorDia:        Math.round(peorDia  * 100) / 100,
    pedidosValidos,
    pedidosInvalidos,
  };
}

window.procesarAlistamiento = procesarAlistamiento;
