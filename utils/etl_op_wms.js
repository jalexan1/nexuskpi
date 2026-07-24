/**
 * etl_op_wms.js — NexusKPI · Fase 2 · Operatividad
 * ETL del archivo "WMS_BASE_CLICK COSMETICS MES AÑO.xlsx"
 * (hojas InventarioxUbicacion, DensidadxUbicacion, ProductividadxPk, RecogidasPkxRango).
 * Auto-contenido: no depende de etl.js ni de etl_op_seguimiento.js.
 */

// ── Utilidades de fecha/hora (auto-contenidas) ──────────────────────────────
function opwParseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'number' && val > 1) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d) ? null : d; }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  return null;
}
function opwToISODate(val) {
  const d = opwParseExcelDate(val);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function opwToISODateTime(val) {
  const d = opwParseExcelDate(val);
  return d ? d.toISOString() : null;
}
function opwParseHoraSimple(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return { h: val.getHours(), m: val.getMinutes() };
  if (typeof val === 'number' && val > 0 && val < 1) {
    const mins = Math.round(val * 1440);
    return { h: Math.floor(mins / 60) % 24, m: mins % 60 };
  }
  if (typeof val === 'string') {
    const p = val.trim().split(':');
    if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) return { h: parseInt(p[0]), m: parseInt(p[1]) };
  }
  return null;
}
function opwFmtHora(t) { return t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}:00` : null; }

function opwSimilitud(a, b) {
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const bigrams = s => { const arr = []; const t = norm(s); for (let i = 0; i < t.length - 1; i++) arr.push(t.substr(i, 2)); return arr; };
  const ba = bigrams(a), bb = bigrams(b);
  if (!ba.length || !bb.length) return 0;
  const mapB = {}; bb.forEach(g => mapB[g] = (mapB[g] || 0) + 1);
  let inter = 0;
  ba.forEach(g => { if (mapB[g] > 0) { inter++; mapB[g]--; } });
  return (2 * inter) / (ba.length + bb.length);
}
function opwValidarNombreArchivo(nombreArchivo, fraseEsperada, umbralMin = 0.6) {
  const sinExt = String(nombreArchivo || '').replace(/\.(xlsx|xls)$/i, '');
  const score = opwSimilitud(sinExt, fraseEsperada);
  return { ok: score >= umbralMin, score: Math.round(score * 100) };
}

/**
 * opwLeerHoja(wb, matchersNombreHoja, columnasClave)
 * A diferencia de SEGUIMIENTO CLICK, en WMS_BASE los encabezados reales NO están
 * en la fila 1: las primeras filas traen títulos/metadatos. Esta función busca,
 * dentro de las primeras 10 filas, la fila cuyo contenido coincide mejor con las
 * columnas esperadas (columnasClave) y la usa como encabezado.
 */
function opwLeerHoja(wb, matchersNombreHoja, columnasClave) {
  const sn = wb.SheetNames.find(n => matchersNombreHoja.some(m => n.toUpperCase().includes(m)));
  if (!sn) return null;
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true, cellDates: true });
  if (!raw.length) return null;

  let mejorFila = -1, mejorScore = -1;
  const tope = Math.min(10, raw.length);
  for (let i = 0; i < tope; i++) {
    const fila = (raw[i] || []).map(c => String(c || '').trim().toUpperCase());
    let score = 0;
    columnasClave.forEach(clave => { if (fila.some(c => c === clave.toUpperCase() || c.includes(clave.toUpperCase()))) score++; });
    if (score > mejorScore) { mejorScore = score; mejorFila = i; }
  }
  if (mejorFila < 0 || mejorScore < 2) return null; // no se encontró una fila de encabezados razonable

  const headers = raw[mejorFila].map(h => String(h || '').trim().toUpperCase());
  const idx = nombres => {
    for (const n of nombres) { const i = headers.findIndex(h => h === n.toUpperCase()); if (i >= 0) return i; }
    for (const n of nombres) { const i = headers.findIndex(h => h.includes(n.toUpperCase())); if (i >= 0) return i; }
    return -1;
  };
  return { sheetName: sn, headerRow: mejorFila, headers, rows: raw.slice(mejorFila + 1), idx };
}

function opwDetectarMesPredominante(fechasISO) {
  const conteo = {};
  fechasISO.forEach(f => { if (!f) return; const mes = f.slice(0, 7); conteo[mes] = (conteo[mes] || 0) + 1; });
  if (!Object.keys(conteo).length) return null;
  return Object.entries(conteo).sort((a, b) => b[1] - a[1])[0][0];
}

// ── InventarioxUbicacion → op_inventario_ubicacion ──────────────────────────
function opwProcesarInventarioUbicacion(wb, periodoId) {
  const hoja = opwLeerHoja(wb, ['INVENTARIOXUBICACION', 'INVENTARIO'], ['EAN', 'UBICACION', 'QTYSALDO', 'ZONA', 'ITEM']);
  if (!hoja) throw new Error('No se encontró la hoja InventarioxUbicacion en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    ean: idx(['EAN']), item: idx(['ITEM']), descripcion: idx(['DESCRIPCION']),
    ubicacion: idx(['UBICACION']), zona: idx(['ZONA']), mueble: idx(['MUEBLE']),
    altura: idx(['ALTURA']), posicion: idx(['POSICION']), caja: idx(['CAJA']),
    qtySaldo: idx(['QTYSALDO']), qtySaldoCajas: idx(['QTYSALDO CAJAS']),
    documento: idx(['DOCUMENTO']), proveedor: idx(['PROVEEDOR']), estado: idx(['ESTADO']),
    fechaCreacionCaja: idx(['FECHACREACIONCAJA']), fechaVence: idx(['FECHAVENCE']),
    bloqueada: idx(['BLOQUEADA']),
  };
  const records = [], inconsistencias = [], fechasISO = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    const ean = r[C.ean] ? String(r[C.ean]).trim() : null;
    const ubicacion = r[C.ubicacion] ? String(r[C.ubicacion]).trim() : null;
    const qtySaldo = Number(r[C.qtySaldo]) || 0;
    const fechaCC = opwToISODateTime(r[C.fechaCreacionCaja]);
    if (fechaCC) fechasISO.push(fechaCC.slice(0, 10));

    let esInc = false, causal = null;
    if (!ubicacion) { esInc = true; causal = 'Ubicación vacía'; }
    else if (!ean) { esInc = true; causal = 'EAN vacío'; }
    else if (qtySaldo < 0) { esInc = true; causal = 'QtySaldo negativo'; }

    records.push({
      ean, item: r[C.item] ? String(r[C.item]).trim() : null,
      descripcion: r[C.descripcion] ?? null, ubicacion,
      zona: r[C.zona] ?? null, mueble: r[C.mueble] ?? null, altura: r[C.altura] ?? null,
      posicion: r[C.posicion] ?? null, caja: r[C.caja] !== undefined && r[C.caja] !== null ? String(r[C.caja]) : null,
      qty_saldo: qtySaldo, qty_saldo_cajas: Number(r[C.qtySaldoCajas]) || 0,
      documento: r[C.documento] ?? null, proveedor: r[C.proveedor] ?? null, estado: r[C.estado] ?? null,
      fecha_creacion_caja: fechaCC, fecha_vence: opwToISODate(r[C.fechaVence]),
      bloqueada: !!Number(r[C.bloqueada]) || r[C.bloqueada] === true,
      periodo_id: periodoId, is_inconsistente: esInc, causal_inconsistencia: causal,
    });
    if (esInc) inconsistencias.push(records[records.length - 1]);
  }
  return { records, inconsistencias, fechasISO };
}

// ── DensidadxUbicacion → op_densidad_ubicacion (foto de estado, sin fecha) ──
function opwProcesarDensidadUbicacion(wb, periodoId) {
  const hoja = opwLeerHoja(wb, ['DENSIDADXUBICACION', 'DENSIDAD'], ['UBICACIÓN', 'UBICACION', 'ZONA', 'OCUPACION', 'MUEBLE']);
  if (!hoja) throw new Error('No se encontró la hoja DensidadxUbicacion en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    ubicacion: idx(['UBICACIÓN', 'UBICACION']), zona: idx(['ZONA']),
    prioridad: idx(['PRIORIDADROTACION']), mueble: idx(['MUEBLE']), altura: idx(['ALTURA']),
    capcubica: idx(['CAPCUBICA']), cappeso: idx(['CAPPESO']), ocupacion: idx(['OCUPACION']),
    area: idx(['AREA']),
  };
  const records = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    if (!r[C.ubicacion]) continue; // fila sin ubicación no aporta al mapa de densidad
    records.push({
      ubicacion: String(r[C.ubicacion]).trim(), zona: r[C.zona] ?? null,
      prioridad_rotacion: r[C.prioridad] !== undefined && r[C.prioridad] !== null ? String(r[C.prioridad]) : null,
      mueble: r[C.mueble] ?? null, altura: r[C.altura] ?? null,
      capcubica: Number(r[C.capcubica]) || 0, cappeso: Number(r[C.cappeso]) || 0,
      ocupacion: Number(r[C.ocupacion]) || 0, area: r[C.area] ?? null,
      periodo_id: periodoId,
    });
  }
  return { records, inconsistencias: [], fechasISO: [] };
}

// ── ProductividadxPk → op_productividad_pk ──────────────────────────────────
function opwProcesarProductividadPk(wb, periodoId) {
  const hoja = opwLeerHoja(wb, ['PRODUCTIVIDADXPK'], ['PEDIDOWMS', 'EMPLEADO', 'REFERENCIA', 'FECHAREGISTRO']);
  if (!hoja) throw new Error('No se encontró la hoja ProductividadxPk en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    pedidoWms: idx(['PEDIDOWMS']), tipo: idx(['TIPO']), picking: idx(['PICKING']),
    referencia: idx(['REFERENCIA']), productoEan: idx(['PRODUCTOEAN']), descripcion: idx(['DESCRIPCION']),
    cantidad: idx(['CANTIDAD']), lineaPicking: idx(['LINEADEPICKING']), idCaja: idx(['IDCAJA']),
    fechaRegistro: idx(['FECHAREGISTRO']), empleado: idx(['EMPLEADO']),
  };
  const records = [], inconsistencias = [], fechasISO = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    const pedidoWms = r[C.pedidoWms] ? String(r[C.pedidoWms]).trim() : null;
    const referencia = r[C.referencia] ? String(r[C.referencia]).trim() : null;
    const empleado = r[C.empleado] ? String(r[C.empleado]).trim() : null;
    const fechaISO = opwToISODateTime(r[C.fechaRegistro]);
    if (fechaISO) fechasISO.push(fechaISO.slice(0, 10));

    let esInc = false, causal = null;
    if (!pedidoWms) { esInc = true; causal = 'PedidoWMS vacío'; }
    else if (!referencia) { esInc = true; causal = 'Referencia vacía'; }
    else if (!empleado) { esInc = true; causal = 'EMPLEADO vacío'; }

    records.push({
      pedido_wms: pedidoWms, tipo: r[C.tipo] ?? null, picking: r[C.picking] !== undefined && r[C.picking] !== null ? String(r[C.picking]) : null,
      referencia, producto_ean: r[C.productoEan] ? String(r[C.productoEan]).trim() : null,
      descripcion: r[C.descripcion] ?? null, cantidad: Number(r[C.cantidad]) || 0,
      linea_de_picking: r[C.lineaPicking] !== undefined && r[C.lineaPicking] !== null ? String(r[C.lineaPicking]) : null,
      id_caja: r[C.idCaja] !== undefined && r[C.idCaja] !== null ? String(r[C.idCaja]) : null,
      fecha_registro: fechaISO, empleado, periodo_id: periodoId,
      is_inconsistente: esInc, causal_inconsistencia: causal,
    });
    if (esInc) inconsistencias.push(records[records.length - 1]);
  }
  return { records, inconsistencias, fechasISO };
}

// ── RecogidasPkxRango → op_recogidas_pk_rango (sin cuarentena, tabla informativa) ──
function opwProcesarRecogidasPkRango(wb, periodoId) {
  const hoja = opwLeerHoja(wb, ['RECOGIDASPKXRANGO'], ['PEDIDOWMS', 'EMPLEADO', 'FECHAREGISTRO', 'HORAREGISTRO']);
  if (!hoja) throw new Error('No se encontró la hoja RecogidasPkxRango en el archivo.');
  const { rows, idx } = hoja;
  const C = {
    pedidoWms: idx(['PEDIDOWMS']), tipo: idx(['TIPO']), picking: idx(['PICKING']),
    referencia: idx(['REFERENCIA']), productoEan: idx(['PRODUCTOEAN']),
    cantidad: idx(['CANTIDAD']), lineaPicking: idx(['LINEADEPICKING']),
    fechaRegistro: idx(['FECHAREGISTRO']), horaRegistro: idx(['HORAREGISTRO']),
    empleado: idx(['EMPLEADO']), nombreCliente: idx(['NOMBRECLIENTE']),
  };
  const records = [], fechasISO = [];
  for (const r of rows) {
    if (!r || r.every(v => v === null)) continue;
    const fecha = opwToISODate(r[C.fechaRegistro]);
    if (fecha) fechasISO.push(fecha);
    // Fila del área auxiliar / totales: sin PedidoWMS ni Empleado, se omite (no es una recogida real)
    if (!r[C.pedidoWms] && !r[C.empleado]) continue;
    records.push({
      pedido_wms: r[C.pedidoWms] ? String(r[C.pedidoWms]).trim() : null,
      tipo: r[C.tipo] ?? null, picking: r[C.picking] !== undefined && r[C.picking] !== null ? String(r[C.picking]) : null,
      referencia: r[C.referencia] ? String(r[C.referencia]).trim() : null,
      producto_ean: r[C.productoEan] ? String(r[C.productoEan]).trim() : null,
      cantidad: Number(r[C.cantidad]) || 0,
      linea_de_picking: r[C.lineaPicking] !== undefined && r[C.lineaPicking] !== null ? String(r[C.lineaPicking]) : null,
      fecha_registro: fecha, hora_registro: opwFmtHora(opwParseHoraSimple(r[C.horaRegistro])),
      empleado: r[C.empleado] ? String(r[C.empleado]).trim() : null,
      nombre_cliente: r[C.nombreCliente] ?? null, periodo_id: periodoId,
    });
  }
  return { records, inconsistencias: [], fechasISO };
}

/**
 * procesarWmsBase(file, periodoId, onProgress)
 * Orquesta la lectura de las 4 hojas de WMS_BASE_CLICK COSMETICS MES AÑO.xlsx.
 */
async function procesarWmsBase(file, periodoId, onProgress) {
  if (onProgress) onProgress(5, 'Leyendo archivo…');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

  if (onProgress) onProgress(20, 'Procesando InventarioxUbicacion…');
  const inventario = opwProcesarInventarioUbicacion(wb, periodoId);

  if (onProgress) onProgress(40, 'Procesando DensidadxUbicacion…');
  const densidad = opwProcesarDensidadUbicacion(wb, periodoId);

  if (onProgress) onProgress(60, 'Procesando ProductividadxPk…');
  const productividadPk = opwProcesarProductividadPk(wb, periodoId);

  if (onProgress) onProgress(80, 'Procesando RecogidasPkxRango…');
  const recogidas = opwProcesarRecogidasPkRango(wb, periodoId);

  // Mes predominante: prioriza InventarioxUbicacion (FechaCreacionCaja), luego ProductividadxPk
  const fechasBase = inventario.fechasISO.length ? inventario.fechasISO : productividadPk.fechasISO;
  const mesPredominante = opwDetectarMesPredominante(fechasBase);
  const mesConflicto = !!(mesPredominante && mesPredominante !== periodoId);

  const stats = {
    inventario: { total: inventario.records.length, cuarentena: inventario.inconsistencias.length },
    densidad: { total: densidad.records.length, cuarentena: 0 },
    productividadPk: { total: productividadPk.records.length, cuarentena: productividadPk.inconsistencias.length },
    recogidas: { total: recogidas.records.length, cuarentena: 0 },
  };

  if (onProgress) onProgress(100, 'Completado');
  return { inventario, densidad, productividadPk, recogidas, mesPredominante, mesConflicto, stats };
}

if (typeof window !== 'undefined') {
  window.procesarWmsBase = procesarWmsBase;
  window.opwValidarNombreArchivo = opwValidarNombreArchivo;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { procesarWmsBase, opwValidarNombreArchivo, opwSimilitud, opwLeerHoja };
}
