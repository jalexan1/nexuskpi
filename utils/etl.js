/**
 * etl.js — Motor ETL KPI-REC-001
 * Corre en el browser. Lee el Excel con SheetJS, aplica toda la lógica
 * de negocio de LogicaNegocio_KPI_ETL_v1.docx y retorna records para Supabase.
 * Dependencia: SheetJS (XLSX) cargado globalmente.
 */

// ── Tiempo efectivo con jornada laboral ────────────────────────────────────
function tiempoEfectivoHoras(dtIni, dtFin) {
  const { inicioH, finH, festivos } = CONFIG.jornada;
  let minutos = 0;
  let actual  = new Date(dtIni.getTime());

  while (actual <= dtFin) {
    const y = actual.getFullYear(), mo = actual.getMonth(), d = actual.getDate();
    const fechaStr = `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const esDomingo = actual.getDay() === 0;
    const esFestivo = festivos.has(fechaStr);

    if (esDomingo || esFestivo) {
      actual = new Date(y, mo, d + 1, inicioH, 0, 0);
      continue;
    }

    const diaIni = new Date(Math.max(actual.getTime(), new Date(y, mo, d, inicioH, 0, 0).getTime()));
    const esUltimo = actual.toDateString() === dtFin.toDateString();
    const diaFin  = esUltimo
      ? new Date(Math.min(dtFin.getTime(), new Date(y, mo, d, finH, 0, 0).getTime()))
      : new Date(y, mo, d, finH, 0, 0);

    if (diaIni < diaFin) minutos += (diaFin - diaIni) / 60000;

    actual = new Date(y, mo, d + 1, inicioH, 0, 0);
  }

  const h = Math.round((minutos / 60) * 100) / 100;
  return h > 0 ? h : null;
}

// ── Parsers ────────────────────────────────────────────────────────────────
function parseHoraTT(val, mesId) {
  // Marzo: string 'DD-MM-AA-HH-MM'
  if (mesId === '2026-03' || (typeof val === 'string' && /^\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(String(val).trim()))) {
    const p = String(val).trim().split('-');
    if (p.length === 5) {
      return {
        fecha: new Date(2000 + parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])),
        h: parseInt(p[3]), m: parseInt(p[4]),
      };
    }
  }
  const t = parseHoraSimple(val);
  return t ? { fecha: null, ...t } : null;
}

function parseHoraSimple(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return { h: val.getHours(), m: val.getMinutes() };
  if (typeof val === 'number' && val > 0 && val < 1) {
    const mins = Math.round(val * 1440);
    return { h: Math.floor(mins / 60) % 24, m: mins % 60 };
  }
  if (typeof val === 'string') {
    const p = val.trim().split(':');
    if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]))
      return { h: parseInt(p[0]), m: parseInt(p[1]) };
  }
  return null;
}

function fmtHora(val) {
  const t = parseHoraSimple(val);
  return t ? `${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}` : null;
}

function parseExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'string') { const d = new Date(val); return isNaN(d) ? null : d; }
  return null;
}

function toISODate(val) {
  const d = parseExcelDate(val);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function semanaISO(fechaStr) {
  try {
    const d   = new Date(fechaStr + 'T12:00:00');
    const thu = new Date(d); thu.setDate(d.getDate() + (4 - (d.getDay() || 7)));
    const jan1 = new Date(thu.getFullYear(), 0, 1);
    return `Sem ${Math.ceil(((thu - jan1) / 86400000 + 1) / 7)}`;
  } catch { return null; }
}

// ── ETL principal ──────────────────────────────────────────────────────────
/**
 * procesarExcel(arrayBuffer, mesId)
 * @returns {{ records, inconsistencias, stats }}
 */
function procesarExcel(arrayBuffer, mesId) {
  const wb   = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames.find(n => n.toUpperCase().includes('RECIB')) || wb.SheetNames[0];
  if (!sheetName) throw new Error('No se encontró la hoja RECIBOS.');

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, defval: null, raw: false, cellDates: true,
  });
  if (rows.length < 2) throw new Error('La hoja RECIBOS está vacía.');

  // Mapeo de columnas por nombre
  const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
  const idx = (nombres) => {
    for (const n of nombres) {
      const i = headers.findIndex(h => h.includes(n.toUpperCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  const C = {
    ref:         idx(['REFERENCIA']),
    prov:        idx(['PROVEEDOR']),
    doc:         idx(['DOCUMENTO']),
    fechaIngresa:idx(['FECHA INGRESA','FECHA_INGRESA']),
    cantUds:     idx(['CANTIDAD RECIBO UNIDADES','CANT RECIBO']),
    oc:          idx(['O.C','OC']),
    horaCita:    idx(['HORA CITA']),
    horaInicio:  idx(['HORA INICIO DESCARGUE','HORA INICIO']),
    horaFinal:   idx(['HORA FINAL DESCARGUE2','HORA FINAL DESCARGUE','HORA FINAL']),
    horaTT:      mesId === '2026-03' ? idx(['HORA TT RECIBO2']) : idx(['HORA TT RECIBO']),
    cert:        idx(['CERTIFICACION']),
    familia:     idx(['FAMILIA']),
  };

  const excluir = CONFIG.kpiRec001.excluirProveedores;

  // ── Paso 1: agrupar por Documento ──────────────────────────────────────
  const docMap = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(v => v === null)) continue;
    const prov = String(r[C.prov] || '').trim();
    const doc  = String(r[C.doc]  || '').trim();
    if (!doc || !prov) continue;
    if (excluir.some(e => prov.toLowerCase().includes(e))) continue;
    if (!docMap.has(doc)) docMap.set(doc, []);
    docMap.get(doc).push(r);
  }

  const records         = [];
  const inconsistencias = [];

  // ── Paso 2: consolidar un registro por Documento ───────────────────────
  for (const [doc, filas] of docMap) {
    const f0 = filas[0];
    const proveedor    = String(f0[C.prov] || '').trim();
    const fechaIngresa = parseExcelDate(f0[C.fechaIngresa]);
    const fechaStr     = toISODate(fechaIngresa);
    const oc           = String(f0[C.oc] || '').trim() || null;

    // hora_cita: primera fila
    const horaCitaRaw = f0[C.horaCita];
    const horaCita    = parseHoraSimple(horaCitaRaw);

    // hora_inicio: MIN entre todas las filas
    let horaIni = null;
    for (const f of filas) {
      const t = parseHoraSimple(f[C.horaInicio]);
      if (!t) continue;
      if (!horaIni || (t.h * 60 + t.m) < (horaIni.h * 60 + horaIni.m)) horaIni = t;
    }

    // hora_tt: HORA TT RECIBO si existe, si no MAX HORA FINAL DESCARGUE
    let horaTT = null; let fechaTT = null;
    const ttRaw = f0[C.horaTT];
    if (ttRaw) {
      const parsed = parseHoraTT(ttRaw, mesId);
      if (parsed) { horaTT = parsed; fechaTT = parsed.fecha || null; }
    }
    if (!horaTT) {
      let maxFinal = null;
      for (const f of filas) {
        const t = parseHoraSimple(f[C.horaFinal]);
        if (!t) continue;
        if (!maxFinal || (t.h * 60 + t.m) > (maxFinal.h * 60 + maxFinal.m)) maxFinal = t;
      }
      horaTT = maxFinal ? { ...maxFinal, fecha: null } : null;
    }

    // ── Paso 3: calcular tiempo efectivo ───────────────────────────────
    let tiempoH = null;
    let slaOk   = null;
    let causal  = null;
    let esInconsistente = false;

    const horaRef = horaCita || horaIni;

    if (!fechaStr)  { causal = 'Fecha Ingresa vacía'; esInconsistente = true; }
    else if (!horaRef) { causal = 'HORA CITA y HORA INICIO vacías'; esInconsistente = true; }
    else if (!horaTT)  { causal = 'HORA TT RECIBO vacía'; esInconsistente = true; }
    else {
      try {
        const [y, mo, d] = fechaStr.split('-').map(Number);
        const dtIni = new Date(y, mo - 1, d, horaRef.h, horaRef.m, 0);

        let dtFin;
        if (fechaTT) {
          dtFin = new Date(fechaTT.getFullYear(), fechaTT.getMonth(), fechaTT.getDate(), horaTT.h, horaTT.m, 0);
        } else {
          dtFin = new Date(y, mo - 1, d, horaTT.h, horaTT.m, 0);
          if (dtFin < dtIni) dtFin.setDate(dtFin.getDate() + 1);
        }

        if (dtFin < dtIni) {
          causal = `Hora TT (${horaTT.h}:${String(horaTT.m).padStart(2,'0')}) anterior a hora inicio — revisión requerida`;
          esInconsistente = true;
        } else {
          tiempoH = tiempoEfectivoHoras(dtIni, dtFin);
          if (tiempoH === null) {
            causal = 'Tiempo calculado = 0 (posible error de datos)';
            esInconsistente = true;
          } else {
            slaOk = tiempoH <= CONFIG.kpiRec001.slaHoras;
          }
        }
      } catch (e) {
        causal = `Error en cálculo: ${e.message}`;
        esInconsistente = true;
      }
    }

    // ── Paso 4: tipo PT / MP ───────────────────────────────────────────
    const familiaRaw = String(f0[C.familia] || '').trim().toUpperCase();
    const tipo       = (familiaRaw.includes('RAW') || familiaRaw.includes('MATERIAL')) ? 'MP' : 'PT';
    const familia    = familiaRaw ? familiaRaw.charAt(0) + familiaRaw.slice(1).toLowerCase() : null;

    const skus     = new Set(filas.map(f => String(f[C.ref] || '')).filter(Boolean)).size;
    const unidades = filas.reduce((s, f) => s + (parseInt(f[C.cantUds]) || 0), 0);
    const isCert   = filas.some(f => f[C.cert] !== null && f[C.cert] !== undefined && f[C.cert] !== '');

    const record = {
      mes_id:               mesId,
      documento:            doc,
      oc,
      fecha:                fechaStr,
      semana:               semanaISO(fechaStr),
      proveedor,
      familia,
      tipo,
      skus,
      unidades,
      hora_cita:            fmtHora(horaCitaRaw),
      hora_inicio:          horaIni ? `${String(horaIni.h).padStart(2,'0')}:${String(horaIni.m).padStart(2,'0')}` : null,
      hora_tt:              horaTT  ? `${String(horaTT.h).padStart(2,'0')}:${String(horaTT.m).padStart(2,'0')}` : null,
      tiempo_h:             tiempoH,
      sla_ok_12:            slaOk,
      is_cert:              isCert,
      is_inconsistente:     esInconsistente,
      causal_inconsistencia:causal,
    };

    records.push(record);
    if (esInconsistente) inconsistencias.push(record);
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  const medidos = records.filter(r => r.sla_ok_12 !== null);
  const ok      = medidos.filter(r => r.sla_ok_12 === true).length;
  const late    = medidos.filter(r => r.sla_ok_12 === false).length;
  const times   = records.filter(r => r.tiempo_h).map(r => r.tiempo_h);

  return {
    records,
    inconsistencias,
    stats: {
      total:    records.length,
      medidos:  medidos.length,
      ok, late,
      sinDato:  records.length - medidos.length,
      trt:      medidos.length > 0 ? Math.round((ok / medidos.length) * 1000) / 10 : null,
      avgH:     times.length ? Math.round(times.reduce((a,b)=>a+b,0)/times.length*100)/100 : null,
      maxH:     times.length ? Math.max(...times) : null,
      cert:     records.filter(r => r.is_cert).length,
      pt:       records.filter(r => r.tipo === 'PT').length,
      mp:       records.filter(r => r.tipo === 'MP').length,
    },
  };
}
