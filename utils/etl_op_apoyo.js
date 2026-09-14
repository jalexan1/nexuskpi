/**
 * etl_op_apoyo.js — NexusKPI · Fase 2 · Operatividad
 * ETL del archivo "Registro_TM_DD_mes_al_DD_mes_AAAA.xlsx"
 * (registro de Tiempo de apoyo Operativo — uso del tiempo libre del rol fijo
 * de cada colaborador para apoyar otras actividades del CEDI).
 * Auto-contenido: no depende de etl.js ni de los demás etl_op_*.js.
 *
 * REGLA DE NEGOCIO (validada contra el reporte de referencia
 * "Reporte_Control_Tiempos_Operativos.pptx" — cifra por cifra):
 *   - Se EXCLUYEN del cálculo los registros con Novedad = "Borrado".
 *   - Se SÍ incluyen los registros con Novedad = "Modificado" (son
 *     correcciones válidas de hora, no errores).
 *   - La duración se toma tal cual la columna "Duración (min)" del Excel
 *     — no se recalcula desde Inicio/Fin (los valores coinciden exacto).
 *
 * DIFERENCIA CLAVE frente a los demás ETL de la app: este archivo puede
 * traer fechas de MÁS DE UN MES CALENDARIO en una sola exportación (ej.
 * 22 julio → 26 agosto). Por eso NO se recibe un periodoId único por
 * archivo: el período de cada fila se calcula individualmente a partir
 * de su propia fecha "Inicio", y el resultado viene agrupado por
 * periodo_id para que el cargue pueda registrar cada mes por separado.
 */

// ── Utilidades de fecha (auto-contenidas) ───────────────────────────────
function opaParseFecha(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const ms = Math.round((val - 25569) * 86400000); // serial Excel → epoch ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
function opaPeriodoDeFecha(d) {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function opaFechaISO(d) {
  if (!d) return null;
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Validación de nombre de archivo (mismo patrón que los demás cargues) ──
// Estándar acordado: Registro_TM_DD_mes_al_DD_mes_AAAA.xlsx
function opaSimilitud(a, b) {
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const bigrams = s => { const arr = []; const t = norm(s); for (let i = 0; i < t.length - 1; i++) arr.push(t.substr(i, 2)); return arr; };
  const ba = bigrams(a), bb = bigrams(b);
  if (!ba.length || !bb.length) return 0;
  const mapB = {}; bb.forEach(g => mapB[g] = (mapB[g] || 0) + 1);
  let inter = 0;
  ba.forEach(g => { if (mapB[g] > 0) { inter++; mapB[g]--; } });
  return (2 * inter) / (ba.length + bb.length);
}
function opaValidarNombreArchivo(nombreArchivo, fraseEsperada = 'REGISTRO TM', umbralMin = 0.5) {
  const sinExt = String(nombreArchivo || '').replace(/\.(xlsx|xls)$/i, '');
  const score = opaSimilitud(sinExt, fraseEsperada);
  return { ok: score >= umbralMin, score: Math.round(score * 100) };
}

/**
 * procesarApoyoOperativo(file, onProgress)
 * Retorna { records, excluidos, porPeriodo }
 *   records   → filas válidas, listas para upsert en op_apoyo_detalle (on_conflict=codigo)
 *   excluidos → [{codigo, motivo}] filas descartadas (Borrado, o datos incompletos)
 *   porPeriodo → { 'YYYY-MM': cantidadDeFilas, ... } — para registrar op_periodos_cargue
 *                una vez por cada mes detectado en el archivo
 */
async function procesarApoyoOperativo(file, onProgress) {
  if (onProgress) onProgress(5, 'Leyendo archivo…');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('El archivo no tiene hojas.');
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, cellDates: true });

  if (onProgress) onProgress(30, 'Procesando registros…');

  const records = [], excluidos = [];
  for (const r of rows) {
    const codigo = r['Código'] !== null && r['Código'] !== undefined ? String(r['Código']).trim() : null;
    const novedad = (r['Novedad'] || 'Ninguna').toString().trim() || 'Ninguna';
    const inicio = opaParseFecha(r['Inicio']);

    if (novedad === 'Borrado') { excluidos.push({ codigo, motivo: 'Registro marcado como Borrado' }); continue; }
    if (!codigo) { excluidos.push({ codigo: '(sin código)', motivo: 'Código vacío' }); continue; }
    if (!inicio) { excluidos.push({ codigo, motivo: 'Fecha de Inicio vacía o inválida' }); continue; }

    const fin = opaParseFecha(r['Fin']);
    const fechaCreacion = opaParseFecha(r['Fecha de creación']);

    records.push({
      codigo,
      colaborador: r['Usuario'] ? String(r['Usuario']).trim() : null,
      correo: r['Correo'] ? String(r['Correo']).trim() : null,
      actividad: r['Actividad'] ? String(r['Actividad']).trim().toUpperCase() : null,
      inicio: inicio.toISOString(),
      fin: fin ? fin.toISOString() : null,
      duracion_min: Number(r['Duración (min)']) || 0,
      observaciones: r['Observaciones'] ? String(r['Observaciones']).trim() : null,
      novedad,
      motivo_novedad: r['Motivo de la novedad'] ? String(r['Motivo de la novedad']).trim() : null,
      creado_por: r['Creado por'] ? String(r['Creado por']).trim() : null,
      fecha_creacion: fechaCreacion ? fechaCreacion.toISOString() : null,
      periodo_id: opaPeriodoDeFecha(inicio),
    });
  }

  const porPeriodo = {};
  records.forEach(r => { porPeriodo[r.periodo_id] = (porPeriodo[r.periodo_id] || 0) + 1; });

  if (onProgress) onProgress(100, 'Completado');
  return { records, excluidos, porPeriodo };
}

if (typeof window !== 'undefined') {
  window.procesarApoyoOperativo = procesarApoyoOperativo;
  window.opaValidarNombreArchivo = opaValidarNombreArchivo;
  window.opaPeriodoDeFecha = opaPeriodoDeFecha;
  window.opaFechaISO = opaFechaISO;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { procesarApoyoOperativo, opaValidarNombreArchivo, opaSimilitud, opaParseFecha, opaPeriodoDeFecha, opaFechaISO };
}
