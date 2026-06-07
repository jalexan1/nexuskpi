/**
 * etl_inv002.js — Motor ETL KPI-INV-002 · Exactitud de Inventario
 * NexusKPI · Logistics & Service × Click Cosmetics
 * Versión: 1.0 · Junio 2026
 *
 * PRINCIPIOS:
 *  - Completamente independiente de etl.js (KPI-REC-001). No modifica ningún archivo existente.
 *  - Corre 100% en el browser. Sin dependencias de servidor.
 *  - Lee la hoja ConteoInvxID del WMS_BASE_CLICK_COSMETICS_MES.xlsx con SheetJS.
 *  - Filtra bodega = "021" (Click Cosmetics).
 *  - Agrupa por Referencia (SKU único) para calcular exactitud.
 *  - Envía registros a Supabase vía REST API (upsert).
 *  - Registros con datos inválidos se marcan is_inconsistente = true y se excluyen del EI%.
 *
 * TABLAS SUPABASE REQUERIDAS:
 *  - kpi_inventario_conteos   (resumen por conteo)
 *  - kpi_inventario_detalle   (detalle por SKU)
 *  → SQL de creación en el Manual de Desarrollo sección 3.7
 *
 * USO DESDE admin.html:
 *   import { procesarInventario } from './etl_inv002.js';
 *   const resultado = await procesarInventario(file, periodoId, supabaseUrl, supabaseKey, onProgress);
 */

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const BODEGA_CLICK = '021';
const META_EI_PCT  = 99;          // meta ≥ 99 % (ajustado desde reglas KPI-INV-002)
const HOJA_CONTEO  = 'ConteoInvxID';
const HOJA_DIFS    = 'DiferenciasInventario';

// Semáforo
function semaforo(pct) {
  if (pct >= META_EI_PCT)        return { estado: 'BIEN',    emoji: '🟢', color: 'green'  };
  if (pct >= 97)                 return { estado: 'ALERTA',  emoji: '🟡', color: 'amber'  };
  return                                { estado: 'CRÍTICO', emoji: '🔴', color: 'red'    };
}

// ─────────────────────────────────────────────
// DERIVAR FAMILIA / TIPO desde código Referencia
//   PT = Producto Terminado
//     PTC = Capilar
//     PTB = Body
//     PTK = Kit
//   MP = Materia Prima (6 dígitos)
// ─────────────────────────────────────────────
function derivarFamilia(ref) {
  const r = String(ref || '').trim().toUpperCase();
  if (r.startsWith('MP'))  return { tipo: 'MP',  familia: 'MATERIA_PRIMA' };
  if (r.startsWith('PTC')) return { tipo: 'PT',  familia: 'CAPILAR'       };
  if (r.startsWith('PTB')) return { tipo: 'PT',  familia: 'BODY'          };
  if (r.startsWith('PTK')) return { tipo: 'PT',  familia: 'KIT'           };
  if (r.startsWith('PT'))  return { tipo: 'PT',  familia: 'OTRO'          };
  return                           { tipo: 'PT',  familia: 'OTRO'          };
}

// ─────────────────────────────────────────────
// LEER HOJA — devuelve array de objetos JSON
// Ignora las primeras filas de título hasta
// encontrar la fila de encabezados (busca 'idConteo')
// ─────────────────────────────────────────────
function leerHoja(workbook, nombreHoja) {
  if (!workbook.Sheets[nombreHoja]) {
    throw new Error(`Hoja "${nombreHoja}" no encontrada en el archivo. Verificar nombre exacto.`);
  }
  const ws  = workbook.Sheets[nombreHoja];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Buscar fila de encabezados
  let headerIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const fila = raw[i];
    if (fila && fila.some(c => c !== null && String(c).trim() === 'idConteo')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(`No se encontró la fila de encabezados en "${nombreHoja}". Se espera columna "idConteo".`);
  }

  const headers = raw[headerIdx].map(h => (h !== null ? String(h).trim() : null));
  const datos   = [];

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const fila = raw[i];
    if (!fila || fila.every(v => v === null)) continue;   // fila vacía
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = fila[idx];
    });
    datos.push(obj);
  }
  return datos;
}

// ─────────────────────────────────────────────
// PARSEAR FECHA — maneja datetime de Excel o string
// Retorna ISO string "YYYY-MM-DD" o null
// ─────────────────────────────────────────────
function parsearFecha(valor) {
  if (!valor) return null;

  // Date object (SheetJS con cellDates:true)
  if (valor instanceof Date) {
    return valor.toISOString().split('T')[0];
  }
  // Número Excel serial
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  // String — intentar parsear
  const s = String(valor).trim();
  // Formato "YYYY-MM-DD HH:MM:SS"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

// ─────────────────────────────────────────────
// PROCESAR HOJA ConteoInvxID
// Retorna { conteosMeta, detalles, inconsistentes, stats }
// ─────────────────────────────────────────────
function procesarConteoInvxID(datos, periodoId) {
  // Filtrar bodega 021
  const filtrados = datos.filter(r => {
    const bod = String(r.bodega || '').trim();
    return bod === BODEGA_CLICK;
  });

  if (filtrados.length === 0) {
    throw new Error(`No se encontraron registros con bodega "${BODEGA_CLICK}". Verificar el archivo WMS.`);
  }

  // Agrupar por idConteo → Referencia (SKU nivel)
  // Un SKU puede tener múltiples cajas/ubicaciones → sumar cantidades
  const mapConteos = {};   // idConteo → { fecha, operario, skus: Map<ref, {wms, fisica}> }

  const inconsistentes = [];

  filtrados.forEach(r => {
    const idConteo = r.idConteo;
    const fecha    = parsearFecha(r.Fecha);
    const ref      = String(r.Referencia || '').trim();
    const ean      = String(r.EAN || '').trim();
    const desc     = String(r.Descripcion || '').trim();
    const ubic     = String(r.Ubicacion || '').trim();
    const operario = String(r.PersonaPrograma || '').trim();
    const estado   = String(r.Estado || '').trim();

    const wms     = parseFloat(r.kantidadTeo_conteo1);
    const fisica  = parseFloat(r.CantidadContab_Conteo1);

    // Validaciones de inconsistencia
    const causales = [];
    if (!ref)              causales.push('Referencia vacía');
    if (!fecha)            causales.push('Fecha vacía');
    if (isNaN(wms))        causales.push('Cantidad WMS inválida');
    if (isNaN(fisica))     causales.push('Cantidad física inválida');
    if (!idConteo)         causales.push('idConteo vacío');

    if (causales.length > 0) {
      inconsistentes.push({
        periodo_id:       periodoId,
        id_conteo:        idConteo || 0,
        ean,
        referencia:       ref,
        descripcion:      desc,
        is_inconsistente: true,
        causal:           causales.join(', '),
      });
      return;
    }

    // Inicializar conteo
    if (!mapConteos[idConteo]) {
      mapConteos[idConteo] = {
        fecha,
        operario,
        skus: new Map(),   // ref → { ean, desc, wms, fisica, ubicacion }
      };
    } else {
      // Usar la fecha más temprana (primer registro)
      if (fecha < mapConteos[idConteo].fecha) mapConteos[idConteo].fecha = fecha;
    }

    // Acumular por SKU (varios cajas/ubicaciones)
    const clave = ref;
    if (!mapConteos[idConteo].skus.has(clave)) {
      mapConteos[idConteo].skus.set(clave, {
        ean, ref, desc, ubicacion: ubic,
        wms: 0, fisica: 0,
      });
    }
    const skuEntry = mapConteos[idConteo].skus.get(clave);
    skuEntry.wms   += isNaN(wms)   ? 0 : wms;
    skuEntry.fisica += isNaN(fisica) ? 0 : fisica;
  });

  // Construir registros para Supabase
  const conteosMeta = [];
  const detalles    = [];

  Object.entries(mapConteos).forEach(([idConteoStr, conteoData]) => {
    const idConteo    = parseInt(idConteoStr, 10);
    const { fecha, operario, skus } = conteoData;
    const fecha_date  = new Date(fecha + 'T00:00:00');
    const semana      = `Sem ${getISOWeek(fecha_date)}-${fecha_date.getFullYear()}`;

    let total_skus      = 0;
    let skus_exactos    = 0;
    let skus_diferencia = 0;

    skus.forEach((sku, ref) => {
      const { tipo, familia } = derivarFamilia(ref);
      const es_exacto = sku.wms === sku.fisica;
      const diferencia = sku.fisica - sku.wms;

      total_skus++;
      if (es_exacto) skus_exactos++;
      else           skus_diferencia++;

      detalles.push({
        periodo_id:  periodoId,
        id_conteo:   idConteo,
        ean:         sku.ean,
        referencia:  ref,
        descripcion: sku.desc,
        ubicacion:   sku.ubicacion,
        familia,
        tipo,
        qty_wms:     sku.wms,
        qty_fisica:  sku.fisica,
        es_exacto,
      });
    });

    const ei_pct = total_skus > 0
      ? parseFloat(((skus_exactos / total_skus) * 100).toFixed(2))
      : 0;

    conteosMeta.push({
      periodo_id:       periodoId,
      id_conteo:        idConteo,
      fecha_conteo:     fecha,
      semana,
      bodega:           BODEGA_CLICK,
      total_skus,
      skus_exactos,
      skus_diferencia,
      ei_pct,
      operario,
    });
  });

  // Stats globales del período
  const totalSKUs     = detalles.length;
  const totalExactos  = detalles.filter(d => d.es_exacto).length;
  const totalDifs     = totalSKUs - totalExactos;
  const eiPctGlobal   = totalSKUs > 0
    ? parseFloat(((totalExactos / totalSKUs) * 100).toFixed(2))
    : 0;

  return {
    conteosMeta,
    detalles,
    inconsistentes,
    stats: {
      periodoId,
      totalSKUs,
      totalExactos,
      totalDifs,
      eiPctGlobal,
      semaforo: semaforo(eiPctGlobal),
      totalInconsistentes: inconsistentes.length,
    },
  };
}

// ─────────────────────────────────────────────
// ISO WEEK NUMBER
// ─────────────────────────────────────────────
function getISOWeek(date) {
  const d    = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day  = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y1   = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y1) / 86400000) + 1) / 7);
}

// ─────────────────────────────────────────────
// UPSERT A SUPABASE — lotes de 100
// Solución al error 409: verificar + PATCH/POST
// ─────────────────────────────────────────────
async function upsertLotes(url, key, tabla, registros, onProgress, labelBase) {
  const LOTE = 100;
  let enviados = 0;

  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE);

    const res = await fetch(`${url}/rest/v1/${tabla}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(lote),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Error enviando a ${tabla}: ${res.status} — ${err}`);
    }

    enviados += lote.length;
    if (onProgress) onProgress(`${labelBase}: ${enviados}/${registros.length}`);
  }
}

// ─────────────────────────────────────────────
// UPSERT RESUMEN — evita 409 en UNIQUE(periodo_id, id_conteo)
// ─────────────────────────────────────────────
async function upsertResumen(url, key, conteosMeta) {
  for (const rec of conteosMeta) {
    // Verificar si existe
    const chk = await fetch(
      `${url}/rest/v1/kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(rec.periodo_id)}&id_conteo=eq.${rec.id_conteo}`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    const existe = await chk.json();

    const method = existe.length > 0 ? 'PATCH' : 'POST';
    const endpoint = existe.length > 0
      ? `${url}/rest/v1/kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(rec.periodo_id)}&id_conteo=eq.${rec.id_conteo}`
      : `${url}/rest/v1/kpi_inventario_conteos`;

    const res = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'apikey':         key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(method === 'POST' ? rec : { ...rec }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Error en resumen conteo ${rec.id_conteo}: ${res.status} — ${err}`);
    }
  }
}

// ─────────────────────────────────────────────
// ELIMINAR DETALLES PREVIOS DEL PERÍODO
// Permite recargar sin duplicados
// ─────────────────────────────────────────────
async function limpiarDetallesPrevios(url, key, periodoId) {
  const res = await fetch(
    `${url}/rest/v1/kpi_inventario_detalle?periodo_id=eq.${encodeURIComponent(periodoId)}`,
    {
      method:  'DELETE',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'return=minimal' },
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error limpiando detalles previos: ${res.status} — ${err}`);
  }
}

// ─────────────────────────────────────────────
// FUNCIÓN PRINCIPAL — exportada
// ─────────────────────────────────────────────
/**
 * procesarInventario
 * @param {File}     file        — archivo WMS_BASE_CLICK_COSMETICS_MES.xlsx
 * @param {string}   periodoId   — "2026-05", "2026-06", etc.
 * @param {string}   supabaseUrl — URL del proyecto Supabase
 * @param {string}   supabaseKey — anon key
 * @param {Function} onProgress  — callback(mensaje: string) para actualizar UI
 * @returns {Object} stats — resultado del procesamiento
 */
export async function procesarInventario(file, periodoId, supabaseUrl, supabaseKey, onProgress = () => {}) {
  onProgress('Leyendo archivo Excel…');

  // Leer archivo con SheetJS
  const buffer   = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  onProgress(`Archivo leído: ${workbook.SheetNames.join(', ')}`);

  // Extraer y procesar hoja ConteoInvxID
  onProgress(`Procesando hoja "${HOJA_CONTEO}"…`);
  const datosConteo = leerHoja(workbook, HOJA_CONTEO);
  const { conteosMeta, detalles, inconsistentes, stats } = procesarConteoInvxID(datosConteo, periodoId);

  onProgress(`ETL completado: ${stats.totalSKUs} SKUs · ${stats.totalExactos} exactos · EI = ${stats.eiPctGlobal}%`);

  // Guardar en Supabase
  onProgress('Enviando resumen de conteos a Supabase…');
  await upsertResumen(supabaseUrl, supabaseKey, conteosMeta);

  onProgress('Limpiando detalles previos del período…');
  await limpiarDetallesPrevios(supabaseUrl, supabaseKey, periodoId);

  onProgress('Enviando detalles de SKUs a Supabase…');
  await upsertLotes(supabaseUrl, supabaseKey, 'kpi_inventario_detalle', detalles, onProgress, 'Detalles');

  onProgress('✅ Carga completada correctamente.');

  return {
    ...stats,
    conteosMeta,
    detalleCount:       detalles.length,
    inconsistentesCount: inconsistentes.length,
    inconsistentes,
  };
}

// ─────────────────────────────────────────────
// FUNCIÓN DE REPROCESAMIENTO (sin re-subir archivo)
// Trae datos de Supabase y recalcula EI%
// ─────────────────────────────────────────────
/**
 * reprocesarInventario
 * @param {string} periodoId
 * @param {string} supabaseUrl
 * @param {string} supabaseKey
 * @param {Function} onProgress
 * @returns {Object} stats actualizados
 */
export async function reprocesarInventario(periodoId, supabaseUrl, supabaseKey, onProgress = () => {}) {
  onProgress('Obteniendo detalles de Supabase…');

  const res = await fetch(
    `${supabaseUrl}/rest/v1/kpi_inventario_detalle?periodo_id=eq.${encodeURIComponent(periodoId)}&select=*`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) throw new Error('Error al obtener detalles: ' + res.status);
  const detalles = await res.json();

  onProgress(`Recalculando para ${detalles.length} registros…`);

  // Recalcular exactitud por SKU (qty_fisica vs qty_wms)
  const actualizar = detalles.map(d => ({
    id:        d.id,
    es_exacto: parseFloat(d.qty_fisica) === parseFloat(d.qty_wms),
  }));

  // Actualizar en lotes
  for (let i = 0; i < actualizar.length; i += 100) {
    const lote = actualizar.slice(i, i + 100);
    for (const upd of lote) {
      await fetch(
        `${supabaseUrl}/rest/v1/kpi_inventario_detalle?id=eq.${upd.id}`,
        {
          method:  'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':         supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify({ es_exacto: upd.es_exacto }),
        }
      );
    }
    onProgress(`Actualizando: ${Math.min(i + 100, actualizar.length)}/${actualizar.length}`);
  }

  // Recalcular resumen por conteo
  const conteosRes = await fetch(
    `${supabaseUrl}/rest/v1/kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(periodoId)}&select=*`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const conteos = await conteosRes.json();

  for (const conteo of conteos) {
    const dets      = detalles.filter(d => d.id_conteo === conteo.id_conteo);
    const totalSkus = dets.length;
    const exactos   = actualizar.filter(u => {
      const d = detalles.find(x => x.id === u.id && x.id_conteo === conteo.id_conteo);
      return d && u.es_exacto;
    }).length;
    const eiPct = totalSkus > 0 ? parseFloat(((exactos / totalSkus) * 100).toFixed(2)) : 0;

    await fetch(
      `${supabaseUrl}/rest/v1/kpi_inventario_conteos?periodo_id=eq.${encodeURIComponent(periodoId)}&id_conteo=eq.${conteo.id_conteo}`,
      {
        method:  'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':         supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ total_skus: totalSkus, skus_exactos: exactos, skus_diferencia: totalSkus - exactos, ei_pct: eiPct }),
      }
    );
  }

  onProgress('✅ Reprocesamiento completado.');
  return { periodoId, detalleCount: detalles.length };
}
