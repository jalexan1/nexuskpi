/**
 * etl_op_seguimiento.js — NexusKPI · Fase 2 · Operatividad
 * ETL del archivo "SEGUIMIENTO CLICK MES AÑO.xlsx" (hojas RECIBOS, ALISTAMIENTO, PICKING WMS).
 * Auto-contenido: no depende de utils/etl.js (que es específico de KPI-REC-001, Fase 1).
 * No modifica ni importa nada de Fase 1.
 */

// ── Utilidades de fecha/hora (duplicadas y auto-contenidas a propósito) ────
function opParseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'number' && val > 1) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    // dd/mm/yyyy
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d) ? null : d; }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  return null;
}
function opToISODate(val) {
  const d = opParseExcelDate(val);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function opParseHoraSimple(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return { h: val.getHours(), m: val.getMinutes() };
  if (typeof val === 'number' && val > 0 && val < 1) {
    const mins = Math.round(val * 1440);
    return { h: Math.floor(mins / 60) % 24, m: mins % 60 };
  }
  if (typeof val === 'string') {
    const s = val.trim();
    const p = s.split(':');
    if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) {
      let h = parseInt(p[0]), m = parseInt(p[1]);
      const upper = s.toUpperCase();
      if (upper.includes('PM') && h < 12) h += 12;
      if (upper.includes('AM') && h === 12) h = 0;
      return { h, m };
    }
  }
  return null;
}
function opFmtHora(t) { return t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}:00` : null; }

/**
 * Parsea "HORA TT RECIBO" en formato texto día-mes-año-hora-minuto (ej. '02-05-26-12-33').
 * Retorna un timestamp ISO completo o null si el campo está vacío / no se puede interpretar.
 */
function opParseHoraTTRecibo(val) {
  if (val === null || val === undefined || val === '') return { txt: val ?? null, ts: null, ok: true }; // vacío = sin cita, no es error
  if (typeof val === 'string') {
    const s = val.trim();
    const m = s.match(/^(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
    if (m) {
      const [, dd, mo, aa, hh, mi] = m;
      const y = 2000 + parseInt(aa, 10);
      const d = new Date(y, parseInt(mo, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mi, 10), 0);
      if (!isNaN(d)) return { txt: s, ts: d.toISOString(), ok: true };
    }
  }
  // Formatos alternos: objeto Date directo (si Excel ya lo trae como fecha)
  const d2 = opParseExcelDate(val);
  if (d2) return { txt: String(val), ts: d2.toISOString(), ok: true };
  return { txt: String(val), ts: null, ok: false }; // vino diligenciado pero no se pudo interpretar → error de parseo
}

/**
 * Similitud de cadenas (coeficiente de Dice sobre bigramas), 0..1.
 * Se usa para la validación de nombre de archivo (mínimo 60% de similitud).
 */
function opSimilitud(a, b) {
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const bigrams = s => { const arr = []; const t = norm(s); for (let i = 0; i < t.length - 1; i++) arr.push(t.substr(i, 2)); return arr; };
  const ba = bigrams(a), bb = bigrams(b);
  if (!ba.length || !bb.length) return 0;
  const mapB = {}; bb.forEach(g => mapB[g] = (mapB[g] || 0) + 1);
  let inter = 0;
  ba.forEach(g => { if (mapB[g] > 0) { inter++; mapB[g]--; } });
  return (2 * inter) / (ba.length + bb.length);
}

/**
 * Valida que el nombre de archivo corresponda (>=60% de similitud) a la frase esperada.
 * No se aplica tope superior: una coincidencia exacta (100%) también es válida.
 */
function opValidarNombreArchivo(nombreArchivo, fraseEsperada, umbralMin = 0.6) {
  const sinExt = String(nombreArchivo || '').replace(/\.(xlsx|xls)$/i, '');
  const score = opSimilitud(sinExt, fraseEsperada);
  return { ok: score >= umbralMin, score: Math.round(score * 100) };
}

// ── Lectura de hoja con encabezados en la fila 1 ────────────────────────────
function opLeerHoja(wb, matchers) {
  const sn = wb.SheetNames.find(n => matchers.some(m => n.toUpperCase().includes(m)));
  if (!sn) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true, cellDates: true });
  if (rows.length < 2) return null;
  const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
  // Coincidencia por nombre de columna: primero exacta, luego por substring (fallback).
  // La coincidencia exacta evita falsos positivos como 'UM' encontrado dentro de 'DOCUMENTO'
  // o 'RECIBO' encontrado dentro de 'FECHA RECIBO'.
  const idx = nombres => {
    for (const n of nombres) {
      const i = headers.findIndex(h => h === n.toUpperCase());
      if (i >= 0) return i;
    }
    for (const n of nombres) {
      const i = headers.findIndex(h => h.includes(n.toUpperCase()));
      if (i >= 0) return i;
    }
    return -1;
  };
  return { sheetName: sn, headers, rows: rows.slice(1), idx };
}

/**
 * detectarMesPredominante(fechasISO[])
 * Retorna el mes 'YYYY-MM' más frecuente entre las fechas dadas.
 */
function opDetectarMesPredominante(fechasISO) {
  const conteo = {};
  fechasISO.forEach(f => { if (!f) return; const mes = f.slice(0, 7); conteo[mes] = (conteo[mes] || 0) + 1; });
  if (!Object.keys(conteo).length) return null;
  return Object.entries(conteo).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * opDistribucionMeses(fechasISO[], top=3)
 * Retorna los N meses 'YYYY-MM' con más fechas (con su conteo), de mayor a menor.
 * Se usa para mostrarle al usuario el desglose completo (no solo el mes ganador)
 * cuando el mes seleccionado en el cargue no coincide con el mes de las fechas.
 */
function opDistribucionMeses(fechasISO, top = 3) {
  const conteo = {};
  fechasISO.forEach(f => { if (!f) return; const mes = f.slice(0, 7); conteo[mes] = (conteo[mes] || 0) + 1; });
  return Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, top).map(([mes, count]) => ({ mes, count }));
}

/**
 * opAsignarSecuencia(records, keyFn)
 * La llave natural (periodo_id + columnas de negocio) puede repetirse dentro
 * del mismo archivo Excel (ej. la misma referencia recibida dos veces el mismo
 * día en el mismo documento, por líneas/lotes distintos). Se asigna un número
 * de secuencia (1,2,3…) por cada repetición de la llave, en el orden en que
 * aparecen las filas en el Excel, para que la llave + secuencia sí sea única
 * y el upsert (on_conflict) funcione sin error 23505.
 */
function opAsignarSecuencia(records, keyFn) {
  const contador = {};
  records.forEach(r => {
    const k = keyFn(r);
    contador[k] = (contador[k] || 0) + 1;
    r.secuencia = contador[k];
  });
  return records;
}

// ── Hoja RECIBOS → op_recibo ─────────────────────────────────────────────
function opProcesarRecibos(wb, periodoId) {
  const hoja = opLeerHoja(wb, ['RECIB']);
  if (!hoja) throw new Error('No se encontró la hoja RECIBOS en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    referencia: idx(['REFERENCIA']),
    sku: idx(['SKU']),
    proveedor: idx(['PROVEEDOR']),
    descripcion: idx(['DESCRIPCION']),
    documento: idx(['DOCUMENTO']),
    fechaIngresa: idx(['FECHA INGRESA']),
    fechaRecibo: idx(['FECHA RECIBO']),
    pedUds: idx(['CANTIDAD PEDIDO UNIDADES']),
    recUds: idx(['CANTIDAD RECIBO UNIDADES']),
    difUds: idx(['DIFERENCIA UNIDADES']),
    pedCaj: idx(['CANTIDAD PEDIDO CAJAS']),
    recCaj: idx(['CANTIDAD RECIBO CAJAS']),
    difCaj: idx(['DIFERENCIA CAJAS']),
    oc: idx(['O.C', 'OC']),
    um: idx(['UM']),
    horaCita: idx(['HORA CITA']),
    horaInicio: idx(['HORA INICIO DESCARGUE']),
    horaFinal: idx(['HORA FINAL DESCARGUE']),
    horaTT: idx(['HORA TT RECIBO']),
    cert: idx(['CERTIFICACION']),
    recibo: idx(['RECIBO']),
    prov2: idx(['PROVEEDOR2']),
    operario: idx(['OPERARIO']),
    familia: idx(['FAMILIA']),
    causal: idx(['CAUSAL']),
  };

  const records = [], inconsistencias = [], fechasISO = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    const documento = String(r[C.documento] || '').trim() || null;
    const referencia = String(r[C.referencia] || '').trim() || null;
    const fechaRecibo = opToISODate(r[C.fechaRecibo]);
    const fechaIngresa = opToISODate(r[C.fechaIngresa]);
    if (fechaRecibo) fechasISO.push(fechaRecibo);

    const recUds = Number(r[C.recUds]) || 0;
    const recCaj = Number(r[C.recCaj]) || 0;
    const tt = opParseHoraTTRecibo(r[C.horaTT]);

    let esInc = false, causal = null;
    if (!fechaRecibo) { esInc = true; causal = 'Fecha Recibo vacía'; }
    else if (!documento) { esInc = true; causal = 'Documento vacío'; }
    else if (recUds === 0 && recCaj === 0) { esInc = true; causal = 'Cantidad Recibo Unidades y Cajas en cero'; }
    else if (!tt.ok) { esInc = true; causal = 'Error de parseo de HORA TT RECIBO'; }

    const record = {
      referencia, sku: String(r[C.sku] || '').trim() || null,
      proveedor: String(r[C.proveedor] || '').trim() || null,
      descripcion: String(r[C.descripcion] || '').trim() || null,
      documento,
      fecha_ingresa: fechaIngresa, fecha_recibo: fechaRecibo,
      cantidad_pedido_unidades: Number(r[C.pedUds]) || 0,
      cantidad_recibo_unidades: recUds,
      diferencia_unidades: Number(r[C.difUds]) || 0,
      cantidad_pedido_cajas: Number(r[C.pedCaj]) || 0,
      cantidad_recibo_cajas: recCaj,
      diferencia_cajas: Number(r[C.difCaj]) || 0,
      oc: String(r[C.oc] || '').trim() || null,
      um: r[C.um] ?? null,
      hora_cita: opFmtHora(opParseHoraSimple(r[C.horaCita])),
      hora_inicio_descargue: opFmtHora(opParseHoraSimple(r[C.horaInicio])),
      hora_final_descargue: opFmtHora(opParseHoraSimple(r[C.horaFinal])),
      hora_tt_recibo_txt: tt.txt,
      hora_tt_recibo: tt.ts,
      tiene_cita: !!tt.ts,
      certificacion: r[C.cert] ?? null,
      recibo: Number(r[C.recibo]) || null,
      proveedor2: String(r[C.prov2] || '').trim() || null,
      operario: String(r[C.operario] || '').trim() || null, // Fase2: usar OPERARIO, NUNCA "Usuario"
      familia: String(r[C.familia] || '').trim() || null,
      causal: r[C.causal] ?? null,
      periodo_id: periodoId,
      is_inconsistente: esInc,
      causal_inconsistencia: causal,
    };
    records.push(record);
    if (esInc) inconsistencias.push(record);
  }
  opAsignarSecuencia(records, r => [r.periodo_id, r.documento, r.referencia, r.fecha_recibo].join('|'));
  return { records, inconsistencias, fechasISO };
}

// ── Hoja ALISTAMIENTO → op_alistamiento ─────────────────────────────────
function opProcesarAlistamiento(wb, periodoId) {
  const hoja = opLeerHoja(wb, ['ALISTAMIENTO']);
  if (!hoja) throw new Error('No se encontró la hoja ALISTAMIENTO en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    dia: idx(['DIA']),
    comprobante: idx(['COMPROBANTE']),
    estado: idx(['ESTADO']),
    documento: idx(['DOCUMENTO']),
    nombreTercero: idx(['NOMBRE TERCERO']),
    sku: idx(['SKU']),
    descripcion: idx(['DESCRIPCIÓN', 'DESCRIPCION']),
    facturado: idx(['FACTURADO']),
    alistado: idx(['ALISTADO']),
    cantCajas: idx(['CANTIDAD CAJAS']),
    operario: idx(['OPERARIO']),
    inicioPicking: idx(['INICIO PICKING']),
    finPicking: idx(['FIN PICKING']),
    tiempoReal: idx(['TIEMPO REAL']),
    certificador: idx(['CERTIFICADOR']),
    inicioAduana: idx(['INICIO ADUANA']),
    finAduana: idx(['FIN ADUANA']),
    // Nuevas columnas (aditivas) para el KPI "Nivel de Servicio" en Picking.
    // Nota: "ALISTADO", "PICK", "ALISTADO 2" y "CERTIFI" en archivos reales grandes
    // son columnas auxiliares de fórmulas del Excel origen (texto concatenado tipo
    // comprobante+sku), NO cantidades — por eso el nivel de servicio se calcula con
    // "PARCIAL ?" (OK/PARCIAL), que sí es un dato limpio.
    status: idx(['STATUS']),
    parcial: idx(['PARCIAL']),
  };

  const records = [], inconsistencias = [], fechasISO = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    const dia = opToISODate(r[C.dia]);
    const comprobante = (r[C.comprobante] !== null && r[C.comprobante] !== undefined) ? String(r[C.comprobante]).trim() : null;
    if (dia) fechasISO.push(dia);

    const ini = opParseHoraSimple(r[C.inicioPicking]);
    const fin = opParseHoraSimple(r[C.finPicking]);
    const finAntesDeInicio = ini && fin && (fin.h * 60 + fin.m) < (ini.h * 60 + ini.m);

    let esInc = false, causal = null;
    if (!dia) { esInc = true; causal = 'DIA vacío'; }
    else if (!comprobante) { esInc = true; causal = 'Comprobante vacío'; }
    else if (finAntesDeInicio) { esInc = true; causal = 'FIN PICKING anterior a INICIO PICKING'; }

    const record = {
      dia, comprobante,
      estado: r[C.estado] ?? null,
      documento: r[C.documento] ? String(r[C.documento]).trim() : null,
      nombre_tercero: r[C.nombreTercero] ?? null,
      sku: r[C.sku] ? String(r[C.sku]).trim() : null,
      descripcion: r[C.descripcion] ?? null,
      facturado: Number(r[C.facturado]) || 0,
      alistado: r[C.alistado] ?? null,
      cantidad_cajas: Number(r[C.cantCajas]) || 0,
      operario: String(r[C.operario] || '').trim() || null,
      inicio_picking: opFmtHora(ini),
      fin_picking: opFmtHora(fin),
      tiempo_real: r[C.tiempoReal] !== undefined && r[C.tiempoReal] !== null ? String(r[C.tiempoReal]) : null,
      certificador: r[C.certificador] ?? null,
      inicio_aduana: opFmtHora(opParseHoraSimple(r[C.inicioAduana])),
      fin_aduana: opFmtHora(opParseHoraSimple(r[C.finAduana])),
      status: r[C.status] ? String(r[C.status]).trim() : null,
      parcial: r[C.parcial] ? String(r[C.parcial]).trim() : null,
      ola_id: dia ? `${periodoId}-${dia}` : null,
      periodo_id: periodoId,
      is_inconsistente: esInc,
      causal_inconsistencia: causal,
    };
    records.push(record);
    if (esInc) inconsistencias.push(record);
  }
  opAsignarSecuencia(records, r => [r.periodo_id, r.comprobante, r.sku, r.dia].join('|'));
  return { records, inconsistencias, fechasISO };
}

// ── Hoja PICKING WMS → op_picking_wms ───────────────────────────────────
function opProcesarPickingWms(wb, periodoId) {
  const hoja = opLeerHoja(wb, ['PICKING WMS']);
  if (!hoja) throw new Error('No se encontró la hoja PICKING WMS en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    picking: idx(['PICKING']),
    pedidoWms: idx(['PEDIDOWMS']),
    tipo: idx(['TIPO']),
    referencia: idx(['REFERENCIA']),
    productoEan: idx(['PRODUCTOEAN']),
    descripcion: idx(['DESCRIPCION']),
    cantidad: idx(['CANTIDAD']),
    lineaPicking: idx(['LINEADEPICKING']),
    idCaja: idx(['IDCAJA']),
    fechaRegistro: idx(['FECHAREGISTRO']),
    horaRegistro: idx(['HORAREGISTRO']),
    empleado: idx(['EMPLEADO']),
    nombreCliente: idx(['NOMBRECLIENTE']),
  };

  // La hoja PICKING WMS trae, después de las filas de datos reales, un área auxiliar
  // de pivote/fórmulas (columnas "Columna1", "INICIO", "PEDIDO", "Suma de cantidad"…)
  // que reutiliza las mismas filas del Excel pero sin datos en las columnas principales.
  // Esas filas no son transacciones de picking: se descartan por completo (no se cargan
  // ni se envían a cuarentena) verificando que exista algo en las columnas principales.
  const colsPrincipales = [C.picking, C.pedidoWms, C.tipo, C.referencia, C.productoEan,
    C.descripcion, C.cantidad, C.lineaPicking, C.idCaja, C.fechaRegistro, C.horaRegistro,
    C.empleado, C.nombreCliente].filter(i => i >= 0);

  const records = [], inconsistencias = [], fechasISO = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    const tieneDatoPrincipal = colsPrincipales.some(i => r[i] !== null && r[i] !== undefined && String(r[i]).trim() !== '');
    if (!tieneDatoPrincipal) continue; // fila del área auxiliar de pivote, no es un registro de picking

    const pedidoWms = r[C.pedidoWms] ? String(r[C.pedidoWms]).trim() : null;
    const empleado = r[C.empleado] ? String(r[C.empleado]).trim() : null;
    const fecha = opToISODate(r[C.fechaRegistro]);
    if (fecha) fechasISO.push(fecha);

    let esInc = false, causal = null;
    if (!pedidoWms) { esInc = true; causal = 'PedidoWMS vacío'; }
    else if (!empleado) { esInc = true; causal = 'EMPLEADO vacío'; }

    const record = {
      picking: r[C.picking] ? String(r[C.picking]).trim() : null,
      pedido_wms: pedidoWms,
      tipo: r[C.tipo] ?? null,
      referencia: r[C.referencia] ? String(r[C.referencia]).trim() : null,
      producto_ean: r[C.productoEan] ? String(r[C.productoEan]).trim() : null,
      descripcion: r[C.descripcion] ?? null,
      cantidad: Number(r[C.cantidad]) || 0,
      linea_de_picking: r[C.lineaPicking] !== undefined && r[C.lineaPicking] !== null ? String(r[C.lineaPicking]) : null,
      id_caja: r[C.idCaja] !== undefined && r[C.idCaja] !== null ? String(r[C.idCaja]) : null,
      fecha_registro: fecha,
      hora_registro: opFmtHora(opParseHoraSimple(r[C.horaRegistro])),
      empleado,
      nombre_cliente: r[C.nombreCliente] ?? null,
      periodo_id: periodoId,
      is_inconsistente: esInc,
      causal_inconsistencia: causal,
    };
    records.push(record);
    if (esInc) inconsistencias.push(record);
  }
  opAsignarSecuencia(records, r => [r.periodo_id, r.pedido_wms, r.linea_de_picking, r.id_caja].join('|'));
  return { records, inconsistencias, fechasISO };
}

/**
 * procesarSeguimientoClick(file, periodoId, onProgress)
 * Orquesta la lectura de las 3 hojas del archivo SEGUIMIENTO CLICK MES AÑO.xlsx.
 * Retorna { recibo, alistamiento, pickingWms, mesPredominante, mesConflicto, stats }.
 */
async function procesarSeguimientoClick(file, periodoId, onProgress) {
  if (onProgress) onProgress(5, 'Leyendo archivo…');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

  if (onProgress) onProgress(20, 'Procesando hoja RECIBOS…');
  const recibo = opProcesarRecibos(wb, periodoId);

  if (onProgress) onProgress(45, 'Procesando hoja ALISTAMIENTO…');
  const alistamiento = opProcesarAlistamiento(wb, periodoId);

  if (onProgress) onProgress(70, 'Procesando hoja PICKING WMS…');
  const pickingWms = opProcesarPickingWms(wb, periodoId);

  // Mes predominante: se prioriza RECIBOS (Fecha Recibo), con fallback a ALISTAMIENTO (DIA)
  const todasFechas = recibo.fechasISO.length ? recibo.fechasISO : alistamiento.fechasISO;
  const mesPredominante = opDetectarMesPredominante(todasFechas);
  const mesConflicto = !!(mesPredominante && mesPredominante !== periodoId);
  const distribucionMeses = opDistribucionMeses(todasFechas, 3);

  if (onProgress) onProgress(90, 'Consolidando…');

  const stats = {
    recibo: { total: recibo.records.length, cuarentena: recibo.inconsistencias.length },
    alistamiento: { total: alistamiento.records.length, cuarentena: alistamiento.inconsistencias.length },
    pickingWms: { total: pickingWms.records.length, cuarentena: pickingWms.inconsistencias.length },
  };

  if (onProgress) onProgress(100, 'Completado');
  return { recibo, alistamiento, pickingWms, mesPredominante, mesConflicto, distribucionMeses, stats };
}

// Exponer en window para uso desde op_cargue_seguimiento.html
if (typeof window !== 'undefined') {
  window.procesarSeguimientoClick = procesarSeguimientoClick;
  window.opValidarNombreArchivo = opValidarNombreArchivo;
}
// Exponer en module.exports para pruebas con Node (no afecta el navegador)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    procesarSeguimientoClick, opValidarNombreArchivo, opSimilitud,
    opParseHoraTTRecibo, opToISODate, opParseHoraSimple, opDetectarMesPredominante,
  };
}
