/**
 * etl_op_cruce.js — NexusKPI · Fase 2 · Operatividad
 * "Auditoría de Cargues" — cruce de SEGUIMIENTO CLICK (op_alistamiento, op_picking_wms)
 * contra WMS BASE (op_recogidas_pk_rango), sobre los últimos N meses cerrados.
 *
 * Aditivo: no toca ninguna tabla, ETL ni página de Fase 1 ni de los demás módulos de
 * Fase 2. Este archivo se carga en op_auditoria_cargues.html.
 *
 * ── Regla de "mes cerrado" (aprobada) ───────────────────────────────────────
 * Un mes es "cerrado" si es estrictamente anterior al mes calendario actual, sin
 * importar el día del mes en curso. El mes en curso NUNCA se considera cerrado, aunque
 * ya tenga cargues (parciales) — solo se incluye en el cruce si el líder de proceso lo
 * confirma explícitamente (ver mostrarModalMesParcial en op_auditoria_cargues.html).
 */

// ── Utilidades de mes ────────────────────────────────────────────────────────
function ocMesActual(hoy = new Date()) {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}
function ocEsMesCerrado(mesId, hoy = new Date()) {
  return mesId < ocMesActual(hoy);
}

/**
 * ocMesesAComparar(periodosDisponibles, n, opciones)
 * periodosDisponibles: array de 'YYYY-MM' (de los datos realmente cargados).
 * Devuelve { meses: [...ultimos N meses cerrados con datos, desc...], mesActualIncluido: bool }
 */
function ocMesesAComparar(periodosDisponibles, n, { incluirMesActual = false, hoy = new Date() } = {}) {
  const unicos = [...new Set(periodosDisponibles)].sort().reverse(); // desc
  const cerrados = unicos.filter(m => ocEsMesCerrado(m, hoy));
  const actual = unicos.filter(m => m === ocMesActual(hoy));
  const meses = cerrados.slice(0, n);
  let mesActualIncluido = false;
  if (incluirMesActual && actual.length) { meses.unshift(actual[0]); mesActualIncluido = true; }
  return { meses, mesActualIncluido };
}

// ── Utilidad: mes real predominante de un array de fechas ISO 'YYYY-MM-DD' ─
function ocMesPredominante(fechasISO) {
  const conteo = {};
  fechasISO.forEach(f => { if (!f) return; const mes = String(f).slice(0, 7); conteo[mes] = (conteo[mes] || 0) + 1; });
  const entries = Object.entries(conteo).sort((a, b) => b[1] - a[1]);
  return entries.length ? { mes: entries[0][0], distribucion: entries.map(([mes, count]) => ({ mes, count })) } : null;
}

// ── Cruce 1: Cobertura de mes ────────────────────────────────────────────────
// Compara el periodo_id con el que quedó guardado cada registro contra el mes real
// predominante de sus propias fechas — detecta cargues registrados bajo el mes
// incorrecto.
function ocCompararCobertura(periodoId, registros, campoFecha, fuenteLabel) {
  const fechas = registros.filter(r => r.periodo_id === periodoId).map(r => r[campoFecha]);
  if (!fechas.length) return null;
  const pred = ocMesPredominante(fechas);
  if (!pred || pred.mes === periodoId) return null;
  return {
    tipo: 'Cobertura de mes',
    detalle: `${fuenteLabel}: el periodo se registró como ${periodoId}, pero el mes real predominante de sus fechas es ${pred.mes} (${pred.distribucion.map(d => `${d.mes}: ${d.count}`).join(', ')}).`,
    severidad: 'Revisar',
  };
}

// ── Cruce 2: Identidad de operarios/empleados ────────────────────────────────
// Nombres presentes en una fuente y ausentes en la otra, para el mismo mes.
function ocCompararIdentidad(periodoId, nombresA, nombresB, labelA, labelB) {
  const hallazgos = [];
  const soloEnA = [...nombresA].filter(n => !nombresB.has(n));
  const soloEnB = [...nombresB].filter(n => !nombresA.has(n));
  soloEnA.forEach(n => hallazgos.push({
    tipo: 'Identidad de operarios',
    detalle: `"${n}" aparece en ${labelA} (${periodoId}) pero no en ${labelB} del mismo mes.`,
    severidad: 'Revisar',
  }));
  soloEnB.forEach(n => hallazgos.push({
    tipo: 'Identidad de operarios',
    detalle: `"${n}" aparece en ${labelB} (${periodoId}) pero no en ${labelA} del mismo mes.`,
    severidad: 'Revisar',
  }));
  return hallazgos;
}

// ── Cruce 3: Solapamiento de fechas entre archivos ───────────────────────────
// Si el mes tiene datos de Seguimiento pero el WMS Base no trae ni una fila de ese
// mes en RecogidasPkxRango, se marca — no se puede validar productividad cruzada.
function ocCompararSolapamiento(periodoId, tieneSeguimiento, tieneRecogidas) {
  if (tieneSeguimiento && !tieneRecogidas) {
    return {
      tipo: 'Solapamiento de fechas',
      detalle: `${periodoId} tiene datos de SEGUIMIENTO CLICK pero RecogidasPkxRango (WMS BASE) no tiene ninguna fila de ese mes — no es posible cruzar productividad para este período.`,
      severidad: 'Informativo',
    };
  }
  return null;
}

// ── Cruce 4: Volumen por operario (cajas vs cantidad recogida) ──────────────
// No son la misma unidad de medida (cajas vs unidades), así que se compara la
// PROPORCIÓN cantidad/cajas de cada operario contra la mediana del grupo — un operario
// con una proporción muy alejada de la mediana es señal de posible mes mal cargado o
// datos incompletos de alguna de las dos fuentes, no un valor absoluto a exigir.
function ocCompararVolumen(periodoId, porOperarioCajas, porOperarioCantidad) {
  const comunes = Object.keys(porOperarioCajas).filter(op => porOperarioCantidad[op] > 0 && porOperarioCajas[op] > 0);
  if (comunes.length < 3) return []; // muestra insuficiente para comparar contra una mediana
  const ratios = comunes.map(op => porOperarioCantidad[op] / porOperarioCajas[op]).sort((a, b) => a - b);
  const mediana = ratios[Math.floor(ratios.length / 2)];
  const hallazgos = [];
  comunes.forEach(op => {
    const ratio = porOperarioCantidad[op] / porOperarioCajas[op];
    if (mediana > 0 && (ratio > mediana * 3 || ratio < mediana / 3)) {
      hallazgos.push({
        tipo: 'Volumen por operario',
        detalle: `${periodoId} — "${op}": proporción unidades/caja (${Math.round(ratio * 10) / 10}) muy alejada de la mediana del grupo (${Math.round(mediana * 10) / 10}). Cajas: ${porOperarioCajas[op]}, Unidades: ${porOperarioCantidad[op]}.`,
        severidad: 'Revisar',
      });
    }
  });
  return hallazgos;
}

/**
 * ocEjecutarCruce(datasets, opciones)
 * datasets: { alistamiento, pickingWms, recogidas, periodosCargue }
 * opciones: { mesesComparar (int), incluirMesActual (bool), hoy (Date, opcional) }
 * Devuelve { ejecucion: {...cabecera...}, hallazgos: [...] } listo para persistir en
 * op_cruce_ejecuciones / op_cruce_hallazgos.
 */
function ocEjecutarCruce(datasets, opciones = {}) {
  const { alistamiento = [], pickingWms = [], recogidas = [] } = datasets;
  const { mesesComparar = 2, incluirMesActual = false, hoy = new Date() } = opciones;

  const periodosDisponibles = [...new Set(alistamiento.map(r => r.periodo_id))];
  const { meses, mesActualIncluido } = ocMesesAComparar(periodosDisponibles, mesesComparar, { incluirMesActual, hoy });

  const hallazgos = [];
  meses.forEach(periodoId => {
    // Cruce 1: cobertura de mes (Seguimiento y WMS por separado)
    const h1a = ocCompararCobertura(periodoId, alistamiento, 'dia', 'ALISTAMIENTO (Seguimiento Click)');
    const h1b = ocCompararCobertura(periodoId, recogidas, 'fecha_registro', 'RecogidasPkxRango (WMS Base)');
    [h1a, h1b].forEach(h => { if (h) hallazgos.push({ ...h, periodo_id: periodoId }); });

    // Cruce 2: identidad de operarios
    const nombresAlistamiento = new Set(alistamiento.filter(r => r.periodo_id === periodoId && r.operario).map(r => r.operario.trim()));
    const nombresPicking = new Set(pickingWms.filter(r => r.periodo_id === periodoId && r.empleado).map(r => r.empleado.trim()));
    const nombresSeguimiento = new Set([...nombresAlistamiento, ...nombresPicking]);
    const nombresRecogidas = new Set(recogidas.filter(r => r.periodo_id === periodoId && r.empleado).map(r => r.empleado.trim()));
    if (nombresRecogidas.size) {
      ocCompararIdentidad(periodoId, nombresSeguimiento, nombresRecogidas, 'SEGUIMIENTO CLICK', 'WMS BASE (RecogidasPkxRango)')
        .forEach(h => hallazgos.push({ ...h, periodo_id: periodoId }));
    }

    // Cruce 3: solapamiento de fechas
    const tieneSeguimiento = alistamiento.some(r => r.periodo_id === periodoId);
    const tieneRecogidas = recogidas.some(r => r.periodo_id === periodoId);
    const h3 = ocCompararSolapamiento(periodoId, tieneSeguimiento, tieneRecogidas);
    if (h3) hallazgos.push({ ...h3, periodo_id: periodoId });

    // Cruce 4: volumen por operario (cajas vs cantidad recogida)
    const porOperarioCajas = {};
    alistamiento.filter(r => r.periodo_id === periodoId && r.operario).forEach(r => {
      const op = r.operario.trim();
      porOperarioCajas[op] = (porOperarioCajas[op] || 0) + (r.cantidad_cajas || 0);
    });
    const porOperarioCantidad = {};
    recogidas.filter(r => r.periodo_id === periodoId && r.empleado).forEach(r => {
      const op = r.empleado.trim();
      porOperarioCantidad[op] = (porOperarioCantidad[op] || 0) + (r.cantidad || 0);
    });
    ocCompararVolumen(periodoId, porOperarioCajas, porOperarioCantidad)
      .forEach(h => hallazgos.push({ ...h, periodo_id: periodoId }));
  });

  const ejecucion = {
    fecha_ejecucion: new Date().toISOString(),
    meses_analizados: meses.join(','),
    meses_comparar_parametro: mesesComparar,
    incluye_mes_parcial: mesActualIncluido,
    total_hallazgos: hallazgos.length,
  };

  return { ejecucion, hallazgos };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ocMesActual, ocEsMesCerrado, ocMesesAComparar, ocMesPredominante,
    ocCompararCobertura, ocCompararIdentidad, ocCompararSolapamiento, ocCompararVolumen,
    ocEjecutarCruce,
  };
}
