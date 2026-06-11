/**
 * etl_inv002.js — Motor ETL KPI-INV-002 · Exactitud de Inventario
 * NexusKPI · Logistics & Service × Click Cosmetics
 * Version: 1.1 · Junio 2026
 *
 * USA sb.rest() del proyecto (definido en auth.js) — sin credenciales externas.
 * CORRE 100% en el browser. Sin dependencias de servidor.
 * Lee la hoja ConteoInvxID del WMS_BASE_CLICK_COSMETICS_MES.xlsx con SheetJS.
 * Filtra bodega = "021". Agrupa por Referencia + Ubicacion (una fila = una ubicacion). Calcula EI%.
 * Autodetecta el periodo dominante desde la columna Fecha del Excel.
 *
 * USO DESDE admin.html:
 *   const resultado = await procesarInventario(file, periodoId, onProgress);
 *   const resultado = await reprocesarInventario(periodoId, onProgress);
 *
 * TABLAS SUPABASE REQUERIDAS:
 *   kpi_inventario_conteos
 *   kpi_inventario_detalle
 */

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const BODEGA_CLICK  = '021';
const META_EI_PCT   = 99;
const HOJA_CONTEO   = 'ConteoInvxID';

function semaforoInv(pct) {
  if (pct >= META_EI_PCT) return { estado: 'BIEN',    emoji: '🟢', color: 'green'  };
  if (pct >= 97)          return { estado: 'ALERTA',  emoji: '🟡', color: 'amber'  };
  return                         { estado: 'CRITICO', emoji: '🔴', color: 'red'    };
}

// ─────────────────────────────────────────────
// FAMILIA / TIPO desde Referencia
// ─────────────────────────────────────────────
function derivarFamilia(ref) {
  const r = String(ref || '').trim().toUpperCase();
  if (r.startsWith('MP'))  return { tipo: 'MP', familia: 'MATERIA_PRIMA' };
  if (r.startsWith('PTC')) return { tipo: 'PT', familia: 'CAPILAR'       };
  if (r.startsWith('PTB')) return { tipo: 'PT', familia: 'BODY'          };
  if (r.startsWith('PTK')) return { tipo: 'PT', familia: 'KIT'           };
  return                          { tipo: 'PT', familia: 'OTRO'          };
}

// ─────────────────────────────────────────────
// LEER HOJA — busca encabezados dinamicamente
// ─────────────────────────────────────────────
function leerHojaInv(workbook, nombreHoja) {
  if (!workbook.Sheets[nombreHoja]) {
    throw new Error(`Hoja "${nombreHoja}" no encontrada. Hojas disponibles: ${workbook.SheetNames.join(', ')}`);
  }
  const ws  = workbook.Sheets[nombreHoja];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  let headerIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const fila = raw[i];
    if (fila && fila.some(c => c !== null && String(c).trim() === 'idConteo')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(`No se encontro la fila de encabezados en "${nombreHoja}". Se espera columna "idConteo".`);
  }

  const headers = raw[headerIdx].map(h => (h !== null ? String(h).trim() : null));
  const datos   = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const fila = raw[i];
    if (!fila || fila.every(v => v === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = fila[idx]; });
    datos.push(obj);
  }
  return datos;
}

// ─────────────────────────────────────────────
// PARSEAR FECHA
// ─────────────────────────────────────────────
function parsearFechaInv(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().split('T')[0];
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(valor).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

// ─────────────────────────────────────────────
// ISO WEEK NUMBER
// ─────────────────────────────────────────────
function getISOWeekInv(date) {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y1  = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y1) / 86400000) + 1) / 7);
}

// ─────────────────────────────────────────────
// PROCESAR ConteoInvxID
// ─────────────────────────────────────────────
function autoDetectarPeriodoInv(datos) {
  const conteoMes = {};
  datos.forEach(r => {
    const fecha = parsearFechaInv(r.Fecha);
    if (fecha) {
      const mes = fecha.slice(0, 7); // YYYY-MM
      conteoMes[mes] = (conteoMes[mes] || 0) + 1;
    }
  });
  const entries = Object.entries(conteoMes).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries[0][0] : null;
}

function procesarConteoInvxIDLocal(datos, periodoId) {
  // Autodetectar el periodo predominante desde las fechas reales del archivo
  const periodoDetectado = autoDetectarPeriodoInv(datos);
  if (periodoDetectado && periodoDetectado !== periodoId) {
    periodoId = periodoDetectado; // usar siempre la fecha predominante
  }

  const filtrados = datos.filter(r => String(r.bodega || '').trim() === BODEGA_CLICK);

  if (filtrados.length === 0) {
    throw new Error(`No se encontraron registros con bodega "${BODEGA_CLICK}". Verifica el archivo WMS.`);
  }

  const mapConteos     = {};
  const inconsistentes = [];

  filtrados.forEach(r => {
    const idConteo = r.idConteo;
    const fecha    = parsearFechaInv(r.Fecha);
    const ref      = String(r.Referencia || '').trim();
    const ean      = String(r.EAN || '').trim();
    const desc     = String(r.Descripcion || '').trim();
    const ubic     = String(r.Ubicacion || '').trim();
    const operario = String(r.PersonaPrograma || '').trim();

    // ── Lógica de conteo: preferir Conteo 2 si existe con datos válidos ──────
    // Conteo 2 es la corrección del Conteo 1 cuando hubo diferencia
    // Columnas Conteo 2: fin_qtyTeorico_Conteo2 (WMS) y fin_qtyContabilizado_Conteo2 (físico)
    const wms2    = parseFloat(r['fin_qtyTeorico_Conteo2']);
    const fisica2 = parseFloat(r['fin_qtyContabilizado_Conteo2']);
    const tieneConteo2 = !isNaN(wms2) && !isNaN(fisica2) && (wms2 > 0 || fisica2 > 0);

    const wms    = tieneConteo2 ? wms2    : parseFloat(r.kantidadTeo_conteo1);
    const fisica = tieneConteo2 ? fisica2 : parseFloat(r.CantidadContab_Conteo1);

    const causales = [];
    if (!ref)          causales.push('Referencia vacia');
    if (!fecha)        causales.push('Fecha vacia');
    if (isNaN(wms))    causales.push('Cantidad WMS invalida');
    if (isNaN(fisica)) causales.push('Cantidad fisica invalida');
    if (!idConteo)     causales.push('idConteo vacio');

    if (causales.length > 0) {
      inconsistentes.push({ periodo_id: periodoId, id_conteo: idConteo || 0, ean, referencia: ref,
        descripcion: desc, is_inconsistente: true, causal: causales.join(', ') });
      return;
    }

    if (!mapConteos[idConteo]) {
      mapConteos[idConteo] = { fecha, operario, skus: new Map() };
    } else {
      if (fecha < mapConteos[idConteo].fecha) mapConteos[idConteo].fecha = fecha;
    }

    // Clave: ref + ubicacion (cada fila del Excel = una referencia en una ubicación)
    const clave = ref + '|' + ubic;
    if (!mapConteos[idConteo].skus.has(clave)) {
      mapConteos[idConteo].skus.set(clave, { ean, ref, desc, ubicacion: ubic, wms: 0, fisica: 0 });
    }
    const entry = mapConteos[idConteo].skus.get(clave);
    entry.wms    += isNaN(wms)   ? 0 : wms;
    entry.fisica += isNaN(fisica) ? 0 : fisica;
  });

  const conteosMeta = [];
  const detalles    = [];

  Object.entries(mapConteos).forEach(([idConteoStr, conteoData]) => {
    const idConteo   = parseInt(idConteoStr, 10);
    const { fecha, operario, skus } = conteoData;
    const fecha_date = new Date(fecha + 'T00:00:00');
    const semana     = `Sem ${getISOWeekInv(fecha_date)}-${fecha_date.getFullYear()}`;
    let total_skus = 0, skus_exactos = 0, skus_diferencia = 0;

    skus.forEach((sku, clave) => {
      const { tipo, familia } = derivarFamilia(sku.ref);
      const es_exacto = sku.wms === sku.fisica;
      total_skus++;
      if (es_exacto) skus_exactos++;
      else           skus_diferencia++;
      detalles.push({ periodo_id: periodoId, id_conteo: idConteo, ean: sku.ean,
        referencia: sku.ref, descripcion: sku.desc, ubicacion: sku.ubicacion,
        familia, tipo, qty_wms: sku.wms, qty_fisica: sku.fisica, es_exacto });
    });

    const ei_pct = total_skus > 0
      ? parseFloat(((skus_exactos / total_skus) * 100).toFixed(2)) : 0;

    conteosMeta.push({ periodo_id: periodoId, id_conteo: idConteo, fecha_conteo: fecha,
      semana, bodega: BODEGA_CLICK, total_skus, skus_exactos, skus_diferencia, ei_pct, operario });
  });

  const totalSKUs    = detalles.length;
  const totalExactos = detalles.filter(d => d.es_exacto).length;
  const totalDifs    = totalSKUs - totalExactos;
  const eiPctGlobal  = totalSKUs > 0
    ? parseFloat(((totalExactos / totalSKUs) * 100).toFixed(2)) : 0;

  return { conteosMeta, detalles, inconsistentes,
    stats: { periodoId, periodoDetectado, totalSKUs, totalExactos, totalDifs, eiPctGlobal,
             semaforo: semaforoInv(eiPctGlobal), totalInconsistentes: inconsistentes.length } };
}

// ─────────────────────────────────────────────
// UPSERT RESUMEN — GET + PATCH/POST (evita 409)
// USA sb.rest() del proyecto
// ─────────────────────────────────────────────
async function upsertResumenInv(conteosMeta) {
  for (const rec of conteosMeta) {
    const existe = await sb.rest('GET',
      `kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(rec.periodo_id)}&id_conteo=eq.${rec.id_conteo}&select=id`);
    if (existe && existe.length > 0) {
      await sb.rest('PATCH',
        `kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(rec.periodo_id)}&id_conteo=eq.${rec.id_conteo}`,
        rec, { 'Prefer': 'return=minimal' });
    } else {
      await sb.rest('POST', 'kpi_inventario_conteos', [rec], { 'Prefer': 'return=minimal' });
    }
  }
}

// ─────────────────────────────────────────────
// LIMPIAR DETALLES PREVIOS DEL PERIODO
// ─────────────────────────────────────────────
async function limpiarDetallesInv(periodoId) {
  await sb.rest('DELETE',
    `kpi_inventario_detalle?periodo_id=eq.${encodeURIComponent(periodoId)}`,
    null, { 'Prefer': 'return=minimal' });
}

// ─────────────────────────────────────────────
// UPSERT DETALLES EN LOTES
// ─────────────────────────────────────────────
async function upsertDetallesInv(detalles, onProgress) {
  const LOTE = 100;
  for (let i = 0; i < detalles.length; i += LOTE) {
    const lote = detalles.slice(i, i + LOTE);
    await sb.rest('POST', 'kpi_inventario_detalle', lote, { 'Prefer': 'return=minimal' });
    if (onProgress) onProgress(`Detalles: ${Math.min(i + LOTE, detalles.length)}/${detalles.length}`);
  }
}

// ─────────────────────────────────────────────
// FUNCION PRINCIPAL
// Uso: await procesarInventario(file, periodoId, onProgress)
// ─────────────────────────────────────────────
async function procesarInventario(file, periodoId, onProgress) {
  if (typeof onProgress !== 'function') onProgress = () => {};

  onProgress('Leyendo archivo Excel…');
  const buffer   = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  onProgress(`Archivo leido: ${workbook.SheetNames.join(', ')}`);

  onProgress(`Procesando hoja "${HOJA_CONTEO}"…`);
  const datosConteo = leerHojaInv(workbook, HOJA_CONTEO);
  const { conteosMeta, detalles, inconsistentes, stats } = procesarConteoInvxIDLocal(datosConteo, periodoId);
  // Usar el periodo autodetectado (fecha dominante del archivo)
  periodoId = stats.periodoId;

  onProgress(`ETL: ${stats.totalSKUs} SKUs · ${stats.totalExactos} exactos · EI = ${stats.eiPctGlobal}%`);

  onProgress('Guardando resumen en Supabase…');
  await upsertResumenInv(conteosMeta);

  onProgress('Limpiando detalles previos…');
  await limpiarDetallesInv(periodoId);

  onProgress('Guardando detalles de SKUs…');
  await upsertDetallesInv(detalles, onProgress);

  onProgress('Carga completada.');

  return {
    eiPctGlobal:        stats.eiPctGlobal,
    totalSKUs:          stats.totalSKUs,
    totalExactos:       stats.totalExactos,
    totalDifs:          stats.totalDifs,
    semaforo:           stats.semaforo,
    periodoId:          stats.periodoId,
    periodoDetectado:   stats.periodoDetectado,
    inconsistentesCount: inconsistentes.length,
    inconsistentes,
    conteosMeta,
    detalleCount: detalles.length,
  };
}

// ─────────────────────────────────────────────
// REPROCESAR (sin subir archivo)
// Uso: await reprocesarInventario(periodoId, onProgress)
// ─────────────────────────────────────────────
async function reprocesarInventario(periodoId, onProgress) {
  if (typeof onProgress !== 'function') onProgress = () => {};

  onProgress('Obteniendo detalles de Supabase…');
  const detalles = await sb.rest('GET',
    `kpi_inventario_detalle?periodo_id=eq.${encodeURIComponent(periodoId)}&select=*`);

  if (!detalles || !detalles.length) {
    throw new Error('No hay registros de detalle para este periodo en Supabase.');
  }

  onProgress(`Recalculando ${detalles.length} registros…`);
  const LOTE = 100;
  for (let i = 0; i < detalles.length; i += LOTE) {
    const lote = detalles.slice(i, i + LOTE);
    for (const d of lote) {
      const es_exacto = parseFloat(d.qty_fisica) === parseFloat(d.qty_wms);
      await sb.rest('PATCH', `kpi_inventario_detalle?id=eq.${d.id}`,
        { es_exacto }, { 'Prefer': 'return=minimal' });
    }
    onProgress(`Actualizando: ${Math.min(i + LOTE, detalles.length)}/${detalles.length}`);
  }

  // Recalcular resumen por conteo
  const conteos = await sb.rest('GET',
    `kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(periodoId)}&select=*`);

  for (const conteo of (conteos || [])) {
    const dets    = detalles.filter(d => d.id_conteo === conteo.id_conteo);
    const total   = dets.length;
    const exactos = dets.filter(d => parseFloat(d.qty_fisica) === parseFloat(d.qty_wms)).length;
    const ei_pct  = total > 0 ? parseFloat(((exactos / total) * 100).toFixed(2)) : 0;
    await sb.rest('PATCH',
      `kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(periodoId)}&id_conteo=eq.${conteo.id_conteo}`,
      { total_skus: total, skus_exactos: exactos, skus_diferencia: total - exactos, ei_pct },
      { 'Prefer': 'return=minimal' });
  }

  onProgress('Reprocesamiento completado.');
  return { periodoId, detalleCount: detalles.length };
}
