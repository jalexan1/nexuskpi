/**
 * etl_ali004.js — NexusKPI · KPI-ALI-004 Productividad de Alistamiento
 * Firma: procesarAlistamiento(file, periodoId, onProgress)
 * Sin export · Sin credenciales · Usa sb.rest()
 *
 * FUENTE: Hoja PICKING WMS (no ALISTAMIENTO)
 * - fecha     → FechaRegistro  (string "dd/mm/yyyy")
 * - operario  → EMPLEADO
 * - unidades  → Σ(cantidad) por pedido+empleado+día
 * - cajas     → COUNT DISTINCT(idCaja) donde idCaja != -1
 * - horas     → max(HoraRegistro) - min(HoraRegistro) por empleado+día
 *
 * CUARENTENA: operarios con duración = 0 (1 solo registro en el día)
 * se incluyen con sus unidades pero con horas = null y flag en_cuarentena=true.
 * El PA solo se calcula sobre operarios con horas > 0.
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function _parseFechaWMS(val) {
  // "dd/mm/yyyy" → "yyyy-mm-dd"
  if (!val) return null;
  const s = String(val).trim();
  const p = s.split('/');
  if (p.length === 3) return `${p[2].slice(0,4)}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  // Si SheetJS devuelve un Date
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth()+1).padStart(2,'0');
    const d = String(val.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function _parseHoraWMS(val) {
  // "HH:MM:SS" → horas decimales
  if (!val) return null;
  const s = String(val).trim();
  const p = s.split(':').map(Number);
  if (p.length < 2 || p.some(isNaN)) return null;
  const h = p[0], m = p[1]||0, sec = p[2]||0;
  if (h < 0||h > 23||m < 0||m > 59||sec < 0||sec > 59) return null;
  return h + m/60 + sec/3600;
}

function _isoWeek(dateStr) {
  const d    = new Date(dateStr + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const doy  = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const wn   = Math.ceil((doy + jan4.getDay()) / 7);
  return `Sem ${String(wn).padStart(2,'0')}-${d.getFullYear()}`;
}

function _labelPeriodo(id) {
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

// ── Función principal ─────────────────────────────────────────────────────

async function procesarAlistamiento(file, periodoId, onProgress) {
  const log = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  log('📂 Leyendo archivo Excel…');

  const wb = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { res(XLSX.read(e.target.result, { type:'array', cellDates:true, dateNF:'yyyy-mm-dd' })); }
      catch(err) { rej(new Error('Error leyendo el Excel: ' + err.message)); }
    };
    reader.onerror = () => rej(new Error('Error al leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });

  if (!wb.Sheets['PICKING WMS']) {
    throw new Error('El archivo no tiene hoja "PICKING WMS". Verifica que sea SEGUIMIENTO_CLICK_MES.xlsx.');
  }

  const ws   = wb.Sheets['PICKING WMS'];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, cellDates:true });

  if (rows.length < 2) {
    throw new Error('La hoja PICKING WMS está vacía o solo tiene encabezados.');
  }

  // ── Mapear columnas por nombre ──────────────────────────────────────────
  const headers = rows[0].map(h => h == null ? '' : String(h).trim());
  const col     = name => headers.indexOf(name);

  const iPicking   = col('PICKING');
  const iCantidad  = col('cantidad');
  const iFechaReg  = col('FechaRegistro');
  const iHoraReg   = col('HoraRegistro');
  const iEmpleado  = col('EMPLEADO');
  const iIdCaja    = col('idCaja');

  if (iFechaReg < 0 || iHoraReg < 0 || iEmpleado < 0 || iCantidad < 0) {
    throw new Error(
      'No se encontraron columnas críticas en PICKING WMS ' +
      '(FechaRegistro, HoraRegistro, EMPLEADO, cantidad). ' +
      'Verifica que sea el archivo correcto.'
    );
  }

  log(`✅ Columnas mapeadas · ${rows.length - 1} filas en PICKING WMS`);

  // ── Verificar que el periodo solicitado existe en el archivo ────────────
  const conteoMes = {};
  for (let i = 1; i < rows.length; i++) {
    const f = _parseFechaWMS(rows[i][iFechaReg]);
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
      .map(([mes,cnt]) => `${_labelPeriodo(mes)} (${cnt} filas)`)
      .join(', ');
    throw new Error(
      `El archivo no contiene datos de ${_labelPeriodo(periodoId)}. ` +
      `Meses encontrados: ${disponibles}. ` +
      `Selecciona el mes correcto o sube el archivo de ${_labelPeriodo(periodoId)}.`
    );
  }

  if (mesDominante !== periodoId) {
    log(`⚠️ El archivo tiene más filas de ${_labelPeriodo(mesDominante)}. ` +
        `Procesando ${_labelPeriodo(periodoId)} (${filasDelPeriodo} filas) según el selector.`);
  }

  log(`📅 Procesando: ${_labelPeriodo(periodoId)} · ${filasDelPeriodo} filas`);
  const periodo = periodoId;

  // ── Paso 1: Agrupar por (fecha, empleado) ─────────────────────────────
  // turnMap[fecha][empleado] = { horas:[], unidades:0, cajas: Set(idCaja) }

  const turnMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const fecha = _parseFechaWMS(r[iFechaReg]);
    if (!fecha || !fecha.startsWith(periodo)) continue;

    const hora    = _parseHoraWMS(r[iHoraReg]);
    const empleado= r[iEmpleado] ? String(r[iEmpleado]).trim() : null;
    const cantidad= Number(r[iCantidad]) || 0;
    const idCaja  = r[iIdCaja];

    if (!empleado) continue;

    if (!turnMap[fecha])            turnMap[fecha]            = {};
    if (!turnMap[fecha][empleado])  turnMap[fecha][empleado]  = {
      horas: [], unidades: 0, cajas: new Set(), cuarentena: false
    };

    if (hora !== null) turnMap[fecha][empleado].horas.push(hora);
    turnMap[fecha][empleado].unidades += cantidad;
    // Cajas: contar idCaja únicos y válidos (distinto de -1 y no nulo)
    if (idCaja !== null && idCaja !== undefined && idCaja !== -1) {
      turnMap[fecha][empleado].cajas.add(idCaja);
    }
  }

  // ── Paso 2: Calcular horas efectivas por turno ────────────────────────
  // horas = max(HoraRegistro) - min(HoraRegistro) por empleado+día
  // Cuarentena si solo 1 registro (duración = 0) o duración absurda > 14h

  const diasOrdenados = Object.keys(turnMap).sort();
  const rowsDiario    = [];
  let totalCuarentena = 0;

  for (const fecha of diasOrdenados) {
    const empleados = turnMap[fecha];
    let totalUnidades = 0, totalCajas = 0, totalHoras = 0;
    let numOperarios  = 0, numCuarentena = 0;

    for (const [emp, t] of Object.entries(empleados)) {
      const unidades = t.unidades;
      const cajas    = t.cajas.size;

      // Calcular duración del turno
      let duracion = 0;
      let enCuarentena = false;

      if (t.horas.length === 0) {
        enCuarentena = true;  // sin registros de hora
      } else if (t.horas.length === 1) {
        enCuarentena = true;  // un solo scan → no se puede calcular duración
      } else {
        duracion = Math.max(...t.horas) - Math.min(...t.horas);
        if (duracion <= 0 || duracion > 14) {
          enCuarentena = true;  // duración absurda
        }
      }

      totalUnidades += unidades;
      totalCajas    += cajas;

      if (!enCuarentena) {
        totalHoras   += duracion;
        numOperarios += 1;
      } else {
        numCuarentena++;
        totalCuarentena++;
      }
    }

    const paUnd   = totalHoras > 0 ? Math.round((totalUnidades / totalHoras) * 100) / 100 : 0;
    const paCajas = totalHoras > 0 ? Math.round((totalCajas    / totalHoras) * 100) / 100 : 0;
    const semana  = _isoWeek(fecha);

    rowsDiario.push({
      periodo_id:      periodo,
      fecha,
      semana,
      num_pedidos:     0,            // PICKING WMS no tiene pedidos directos
      und_alistadas:   totalUnidades,
      cajas_alistadas: totalCajas,
      horas_efectivas: Math.round(totalHoras * 10000) / 10000,
      num_operarios:   numOperarios,

      pa_und:          paUnd,
      pa_cajas:        paCajas,
    });
  }

  log(`📅 ${rowsDiario.length} días procesados · ${totalCuarentena} operarios en cuarentena (1 registro/duración 0)`);

  if (rowsDiario.length === 0) {
    throw new Error(
      `No se encontraron registros válidos para ${_labelPeriodo(periodo)}. ` +
      `Verifica que el archivo corresponda a ${_labelPeriodo(periodo)}.`
    );
  }

  // ── Paso 3: Resumen semanal y global ──────────────────────────────────
  const semMap = {};
  for (const d of rowsDiario) {
    const s = d.semana;
    if (!semMap[s]) semMap[s] = { und:0, cajas:0, horas:0, ops:0, dias:0, mejorPA:-Infinity, peorPA:Infinity };
    semMap[s].und     += d.und_alistadas;
    semMap[s].cajas   += d.cajas_alistadas;
    semMap[s].horas   += d.horas_efectivas;
    semMap[s].ops     += d.num_operarios;
    semMap[s].dias    += 1;
    if (d.pa_und > semMap[s].mejorPA) semMap[s].mejorPA = d.pa_und;
    if (d.pa_und < semMap[s].peorPA)  semMap[s].peorPA  = d.pa_und;
  }

  const rowsResumen = [];
  for (const [semana, v] of Object.entries(semMap)) {
    const paUnd   = v.horas > 0 ? Math.round((v.und   / v.horas)*100)/100 : 0;
    const paCajas = v.horas > 0 ? Math.round((v.cajas / v.horas)*100)/100 : 0;
    const fi = rowsDiario.filter(d=>d.semana===semana).map(d=>d.fecha).sort()[0]||null;
    rowsResumen.push({
      periodo_id: periodo, semana, fecha_inicio: fi,
      und_alistadas: v.und, cajas_alistadas: v.cajas,
      horas_efectivas: Math.round(v.horas*10000)/10000,
      num_operarios_prom: v.dias>0 ? Math.round((v.ops/v.dias)*100)/100 : 0,
      pa_und: paUnd, pa_cajas: paCajas,
      mejor_dia_pa: Math.round(v.mejorPA*100)/100,
      peor_dia_pa:  Math.round(v.peorPA *100)/100,
    });
  }

  const totUnd   = rowsDiario.reduce((s,d)=>s+d.und_alistadas,   0);
  const totCajas = rowsDiario.reduce((s,d)=>s+d.cajas_alistadas, 0);
  const totHoras = rowsDiario.reduce((s,d)=>s+d.horas_efectivas, 0);
  const totOps   = rowsDiario.reduce((s,d)=>s+d.num_operarios,   0);
  const paG   = totHoras>0 ? Math.round((totUnd  /totHoras)*100)/100 : 0;
  const paCjG = totHoras>0 ? Math.round((totCajas/totHoras)*100)/100 : 0;
  const mejorDia = Math.max(...rowsDiario.map(d=>d.pa_und));
  const peorDia  = Math.min(...rowsDiario.map(d=>d.pa_und));

  rowsResumen.unshift({
    periodo_id: periodo, semana: null, fecha_inicio: diasOrdenados[0]||null,
    und_alistadas: totUnd, cajas_alistadas: totCajas,
    horas_efectivas: Math.round(totHoras*10000)/10000,
    num_operarios_prom: rowsDiario.length>0 ? Math.round((totOps/rowsDiario.length)*100)/100 : 0,
    pa_und: paG, pa_cajas: paCjG,
    mejor_dia_pa: Math.round(mejorDia*100)/100,
    peor_dia_pa:  Math.round(peorDia *100)/100,
  });

  log(`📊 Resumen: 1 global + ${rowsResumen.length-1} semanas`);

  // ── Paso 4: Limpieza silenciosa ────────────────────────────────────────
  log(`🧹 Borrando datos previos de ${_labelPeriodo(periodo)}…`);
  try {
    await sb.rest('DELETE',`kpi_ali_diario?periodo_id=eq.${periodo}`,  null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_ali_resumen?periodo_id=eq.${periodo}`, null,{'Prefer':'return=minimal'});
  } catch(e) {
    throw new Error(
      `Error al limpiar datos anteriores de ${_labelPeriodo(periodo)}. ` +
      `Vuelve a cargar el archivo de ${_labelPeriodo(periodo)}.`
    );
  }

  // ── Paso 5: Upsert kpi_ali_diario ─────────────────────────────────────
  log(`⬆️ Subiendo ${rowsDiario.length} días…`);
  const LOTE = 100;
  for (let i = 0; i < rowsDiario.length; i += LOTE) {
    try {
      await sb.rest('POST','kpi_ali_diario', rowsDiario.slice(i,i+LOTE),
        {'Prefer':'resolution=merge-duplicates,return=minimal'});
    } catch(e) {
      throw new Error(
        `Error guardando datos diarios de ${_labelPeriodo(periodo)} (lote ${Math.floor(i/LOTE)+1}). ` +
        `Vuelve a cargar el archivo de ${_labelPeriodo(periodo)}.`
      );
    }
    log(`  ✓ Días ${i+1}–${Math.min(i+LOTE,rowsDiario.length)} guardados`);
  }

  // ── Paso 6: Upsert kpi_ali_resumen ────────────────────────────────────
  log(`⬆️ Subiendo ${rowsResumen.length} registros de resumen…`);
  try {
    await sb.rest('POST','kpi_ali_resumen', rowsResumen,
      {'Prefer':'resolution=merge-duplicates,return=minimal'});
  } catch(e) {
    throw new Error(
      `Error guardando el resumen de ${_labelPeriodo(periodo)}. ` +
      `Vuelve a cargar el archivo de ${_labelPeriodo(periodo)}.`
    );
  }

  log(`✅ ${_labelPeriodo(periodo)}: PA ${paG} u/p/h · ${totUnd.toLocaleString('es-CO')} und · ${totCajas.toLocaleString('es-CO')} cajas · ${rowsDiario.length} días · ${totalCuarentena} ops en cuarentena`);

  return {
    periodoId: periodo, label: _labelPeriodo(periodo),
    dias: rowsDiario.length, undAlistadas: totUnd, cajasAlistadas: totCajas,
    horasEfectivas: Math.round(totHoras*100)/100,
    paUnd: paG, paCajas: paCjG,
    mejorDia: Math.round(mejorDia*100)/100,
    peorDia:  Math.round(peorDia *100)/100,
    totalCuarentena,
  };
}

window.procesarAlistamiento = procesarAlistamiento;
