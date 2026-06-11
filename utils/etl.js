function tiempoEfectivoHoras(dtIni,dtFin){
  const {inicioH,finH,festivos}=CONFIG.jornada;
  let minutos=0,actual=new Date(dtIni.getTime());
  while(actual<=dtFin){
    const y=actual.getFullYear(),mo=actual.getMonth(),d=actual.getDate();
    const fs=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(actual.getDay()===0||festivos.has(fs)){actual=new Date(y,mo,d+1,inicioH,0,0);continue;}
    const dIni=new Date(Math.max(actual.getTime(),new Date(y,mo,d,inicioH,0,0).getTime()));
    const esUlt=actual.toDateString()===dtFin.toDateString();
    const dFin=esUlt?new Date(Math.min(dtFin.getTime(),new Date(y,mo,d,finH,0,0).getTime())):new Date(y,mo,d,finH,0,0);
    if(dIni<dFin) minutos+=(dFin-dIni)/60000;
    actual=new Date(y,mo,d+1,inicioH,0,0);
  }
  const h=Math.round((minutos/60)*100)/100;
  return h>0?h:null;
}
function parseHoraTT(val,mesId){
  // Detectar formato string DD-MM-AA-HH-MM sin importar el mes
  // Abril 2026 también usa este formato en HORA TT RECIBO
  if(typeof val==='string'&&/^\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(String(val).trim())){
    const p=String(val).trim().split('-');
    if(p.length===5) return {fecha:new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0])),h:parseInt(p[3]),m:parseInt(p[4])};
  }
  const t=parseHoraSimple(val); return t?{fecha:null,...t}:null;
}
function parseHoraSimple(val){
  if(!val&&val!==0) return null;
  // Date object (SheetJS con cellDates:true)
  if(val instanceof Date) return {h:val.getHours(),m:val.getMinutes()};
  // Número decimal Excel (fracción del día) — 0.6458 = 15:30
  if(typeof val==='number'&&val>0&&val<1){
    const mins=Math.round(val*1440);
    return {h:Math.floor(mins/60)%24, m:mins%60};
  }
  // String HH:MM (hora militar directa)
  if(typeof val==='string'){
    const s=val.trim();
    // Formato HH:MM o H:MM
    const p=s.split(':');
    if(p.length>=2&&!isNaN(p[0])&&!isNaN(p[1])){
      let h=parseInt(p[0]), m=parseInt(p[1]);
      // Detectar AM/PM si viene en el string (ej: "3:30 PM", "3:30:00 PM")
      const upper=s.toUpperCase();
      if(upper.includes('PM')&&h<12) h+=12;
      if(upper.includes('AM')&&h===12) h=0;
      return {h,m};
    }
  }
  return null;
}
function fmtHora(val){const t=parseHoraSimple(val);return t?`${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`:null;}
function parseExcelDate(val){
  if(!val) return null;
  if(val instanceof Date&&!isNaN(val)) return val;
  // Número serial Excel (raw:true) — días desde 1900-01-01
  if(typeof val==='number'&&val>1){
    const d=new Date(Math.round((val-25569)*86400*1000));
    return isNaN(d)?null:d;
  }
  if(typeof val==='string'){const d=new Date(val);return isNaN(d)?null:d;}
  return null;
}
function toISODate(val){
  const d=parseExcelDate(val);
  if(!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function semanaISO(fs){
  try{
    const d=new Date(fs+'T12:00:00'),thu=new Date(d);
    thu.setDate(d.getDate()+(4-(d.getDay()||7)));
    const j1=new Date(thu.getFullYear(),0,1);
    return `Sem ${Math.ceil(((thu-j1)/86400000+1)/7)}`;
  }catch{return null;}
}

/**
 * detectarMesPredominante(rows, C)
 * Lee todas las filas y cuenta la frecuencia de cada mes en Fecha Ingresa / Fecha Recibo.
 * Retorna el mes predominante en formato 'YYYY-MM'.
 * Fallback: Fecha Ingresa si Fecha Recibo viene vacía.
 */
function detectarMesPredominante(rows, C) {
  const conteo = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(v => v === null)) continue;
    // Tomar Fecha Recibo primero, fallback Fecha Ingresa
    const rawFecha = r[C.fechaRecibo] || r[C.fechaIngresa];
    const fecha    = toISODate(parseExcelDate(rawFecha));
    if (!fecha) continue;
    const mesAnio  = fecha.slice(0, 7); // 'YYYY-MM'
    conteo[mesAnio] = (conteo[mesAnio] || 0) + 1;
  }
  if (!Object.keys(conteo).length) return null;
  return Object.entries(conteo).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * procesarExcel(arrayBuffer, mesIdSeleccionado)
 * Retorna: { records, inconsistencias, stats, mesPredominante, mesConflicto }
 * - mesPredominante: mes detectado en el archivo (ej: '2026-04')
 * - mesConflicto: true si el mes seleccionado difiere del predominante
 */
function procesarExcel(arrayBuffer, mesIdSeleccionado) {
  const wb  = XLSX.read(new Uint8Array(arrayBuffer), {type:'array', cellDates:true});
  const sn  = wb.SheetNames.find(n => n.toUpperCase().includes('RECIB')) || wb.SheetNames[0];
  if (!sn) throw new Error('No se encontró la hoja RECIBOS en el archivo.');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, defval:null, raw:true, cellDates:true});
  if (rows.length < 2) throw new Error('La hoja RECIBOS está vacía.');

  const headers = rows[0].map(h => String(h||'').trim().toUpperCase());
  const idx = nombres => {
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
    fechaRecibo: idx(['FECHA RECIBO','FECHA_RECIBO']),
    cantUds:     idx(['CANTIDAD RECIBO UNIDADES','CANT RECIBO']),
    oc:          idx(['O.C','OC']),
    horaCita:    idx(['HORA CITA']),
    horaInicio:  idx(['HORA INICIO DESCARGUE','HORA INICIO']),
    horaFinal:   idx(['HORA FINAL DESCARGUE2','HORA FINAL DESCARGUE','HORA FINAL']),
    horaTT:      mesIdSeleccionado==='2026-03' ? idx(['HORA TT RECIBO2']) : idx(['HORA TT RECIBO']),
    cert:        idx(['CERTIFICACION']),
    familia:     idx(['FAMILIA']),
  };

  // ── Detectar mes predominante en el archivo ────────────────────────────
  const mesPredominante = detectarMesPredominante(rows, C);
  const mesConflicto    = mesPredominante && mesPredominante !== mesIdSeleccionado;
  // El mes que se grabará es siempre el predominante del archivo
  const mesId = mesPredominante || mesIdSeleccionado;

  const excluir = CONFIG.kpiRec001.excluirProveedores;
  const docMap  = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(v => v === null)) continue;
    const prov = String(r[C.prov]||'').trim();
    const doc  = String(r[C.doc] ||'').trim();
    if (!doc || !prov) continue;
    if (excluir.some(e => prov.toLowerCase().includes(e))) continue;
    if (!docMap.has(doc)) docMap.set(doc, []);
    docMap.get(doc).push(r);
  }

  const records = [], inconsistencias = [];

  for (const [doc, filas] of docMap) {
    const f0 = filas[0];
    const proveedor = String(f0[C.prov]||'').trim();

    // ── Fecha: Recibo → fallback Ingresa → cuarentena si ambas vacías ──
    const rawRecibo  = f0[C.fechaRecibo];
    const rawIngresa = f0[C.fechaIngresa];
    const fechaStr   = toISODate(parseExcelDate(rawRecibo)) || toISODate(parseExcelDate(rawIngresa));

    const oc           = String(f0[C.oc]||'').trim() || null;
    const horaCitaRaw  = f0[C.horaCita];
    const horaCita     = parseHoraSimple(horaCitaRaw);

    let horaIni = null;
    for (const f of filas) {
      const t = parseHoraSimple(f[C.horaInicio]);
      if (!t) continue;
      if (!horaIni || (t.h*60+t.m) < (horaIni.h*60+horaIni.m)) horaIni = t;
    }

    let horaTT = null;
    const ttRaw = f0[C.horaTT];
    if (ttRaw) { const p = parseHoraTT(ttRaw, mesId); if (p) horaTT = p; }
    if (!horaTT) {
      let mx = null;
      for (const f of filas) {
        const t = parseHoraSimple(f[C.horaFinal]);
        if (!t) continue;
        if (!mx || (t.h*60+t.m) > (mx.h*60+mx.m)) mx = t;
      }
      horaTT = mx ? {...mx, fecha:null} : null;
    }

    let tiempoH = null, slaOk = null, causal = null, esInc = false;
    // Ancla: HORA CITA. Fallback: HORA INICIO solo si no existe HORA CITA.
    // Cuarentena solo si no hay ninguna de las dos.
    const horaRef = horaCita || horaIni;

    if (!fechaStr) {
      causal = 'Fecha vacía en Fecha Recibo y Fecha Ingresa'; esInc = true;
    } else if (!horaRef) {
      causal = 'HORA CITA y HORA INICIO vacías'; esInc = true;
    } else if (!horaTT) {
      causal = 'HORA TT RECIBO vacía'; esInc = true;
    } else {
      try {
        const [y,mo,d] = fechaStr.split('-').map(Number);
        // Ancla siempre desde HORA CITA. Si no existe, HORA INICIO DESCARGUE.
        const dtIni = new Date(y, mo-1, d, horaRef.h, horaRef.m, 0);
        let   dtFin = new Date(y, mo-1, d, horaTT.h,  horaTT.m,  0);
        if (dtFin < dtIni) dtFin.setDate(dtFin.getDate() + 1);

        tiempoH = tiempoEfectivoHoras(dtIni, dtFin);
        if (tiempoH === null && dtFin > dtIni) {
          const fin17 = new Date(y, mo-1, d, 17, 0, 0);
          if (dtIni < fin17) tiempoH = Math.round((fin17-dtIni)/36000)/100;
        }
        if (tiempoH === null || tiempoH <= 0) {
          causal = 'Tiempo calculado = 0'; esInc = true;
        } else {
          slaOk = tiempoH <= CONFIG.kpiRec001.slaHoras;
        }
      } catch(e) { causal = `Error: ${e.message}`; esInc = true; }
    }

    const familiaRaw = String(f0[C.familia]||'').trim().toUpperCase();
    const tipo       = (familiaRaw.includes('RAW')||familiaRaw.includes('MATERIAL')) ? 'MP' : 'PT';
    const familia    = familiaRaw ? familiaRaw.charAt(0)+familiaRaw.slice(1).toLowerCase() : null;
    const skus       = new Set(filas.map(f=>String(f[C.ref]||'')).filter(Boolean)).size;
    const unidades   = filas.reduce((s,f) => s+(parseInt(f[C.cantUds])||0), 0);
    const isCert     = filas.some(f => f[C.cert]!==null && f[C.cert]!==undefined && f[C.cert]!=='');

    const record = {
      mes_id: mesId, documento:doc, oc,
      fecha:fechaStr, semana:semanaISO(fechaStr),
      proveedor, familia, tipo, skus, unidades,
      hora_cita:   fmtHora(horaCitaRaw),
      hora_inicio: horaIni ? `${String(horaIni.h).padStart(2,'0')}:${String(horaIni.m).padStart(2,'0')}` : null,
      hora_tt:     horaTT  ? `${String(horaTT.h).padStart(2,'0')}:${String(horaTT.m).padStart(2,'0')}`  : null,
      tiempo_h: tiempoH, sla_ok_12: slaOk, is_cert: isCert,
      is_inconsistente: esInc, causal_inconsistencia: causal,
    };
    records.push(record);
    if (esInc) inconsistencias.push(record);
  }

  const medidos = records.filter(r => r.sla_ok_12 !== null);
  const ok      = medidos.filter(r =>  r.sla_ok_12).length;
  const late    = medidos.filter(r => !r.sla_ok_12).length;
  const times   = records.filter(r => r.tiempo_h).map(r => r.tiempo_h);

  return {
    records, inconsistencias, mesPredominante, mesConflicto,
    stats: {
      total:   records.length,
      medidos: medidos.length,
      ok, late,
      sinDato: records.length - medidos.length,
      trt:     medidos.length>0 ? Math.round(ok/medidos.length*1000)/10 : null,
      avgH:    times.length ? Math.round(times.reduce((a,b)=>a+b,0)/times.length*100)/100 : null,
      maxH:    times.length ? Math.max(...times) : null,
      cert:    records.filter(r => r.is_cert).length,
      pt:      records.filter(r => r.tipo==='PT').length,
      mp:      records.filter(r => r.tipo==='MP').length,
    },
  };
}
