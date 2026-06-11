/**
 * etl_ali004.js — NexusKPI · KPI-ALI-004 Productividad de Alistamiento
 * Firma: procesarAlistamiento(file, periodoId, onProgress)
 *
 * FUENTE CORRECTA: Hoja ALISTAMIENTO (NO PICKING WMS)
 * Homologación:
 *   fecha      → DIA
 *   operario   → OPERARIO
 *   unidades   → Facturado (suma)
 *   cajas      → Cantidad cajas (suma)
 *   h_inicio   → INICIO PICKING (HH:MM:SS)
 *   h_fin      → FIN PICKING (HH:MM:SS)
 *   proceso    → todos incluidos (B2B, B2C, CLICK, RETAIL, MARKETPLACE, TRASLADO)
 *
 * CÁLCULO DE HORAS (método corregido):
 *   horas_op        = MAX(FIN PICKING) - MIN(INICIO PICKING)  por operario+día
 *   horas_totales   = Σ horas_op  ← suma individual, NO ventana global del turno
 *   PA              = und_totales_día / horas_totales
 *
 * CUARENTENA: operarios con horas < 0.1 o sin INICIO/FIN válido → excluidos del PA
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function _parseFechaAli(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth()+1).padStart(2,'0');
    const d = String(val.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  const p = s.split('/');
  if (p.length === 3 && p[2].length >= 4)
    return `${p[2].slice(0,4)}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return null;
}

function _parseHoraAli(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    const h = val * 24; // SheetJS puede dar fracción de día
    if (h >= 0 && h <= 24) return h;
    return null;
  }
  if (val instanceof Date) {
    return val.getHours() + val.getMinutes()/60 + val.getSeconds()/3600;
  }
  const s = String(val).trim();
  const p = s.split(':').map(Number);
  if (p.length < 2 || p.some(isNaN)) return null;
  const h=p[0], m=p[1]||0, sec=p[2]||0;
  if (h<0||h>23||m<0||m>59||sec<0||sec>59) return null;
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
      try {
        res(XLSX.read(e.target.result, {
          type: 'array',
          cellDates: true,
          dateNF: 'yyyy-mm-dd'
        }));
      } catch(err) { rej(new Error('Error leyendo el Excel: ' + err.message)); }
    };
    reader.onerror = () => rej(new Error('Error al leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });

  // ── FUENTE: hoja ALISTAMIENTO ─────────────────────────────────────────
  if (!wb.Sheets['ALISTAMIENTO']) {
    throw new Error(
      'El archivo no tiene hoja "ALISTAMIENTO". ' +
      'Verifica que sea SEGUIMIENTO_CLICK_MES.xlsx. ' +
      '(Nota: la fuente correcta es ALISTAMIENTO, no PICKING WMS.)'
    );
  }

  const ws   = wb.Sheets['ALISTAMIENTO'];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, cellDates: true
  });

  if (rows.length < 2) {
    throw new Error('La hoja ALISTAMIENTO está vacía o solo tiene encabezados.');
  }

  // ── Mapear columnas ───────────────────────────────────────────────────
  const headers = rows[0].map(h => h == null ? '' : String(h).trim());
  const col     = name => headers.indexOf(name);

  const iDia      = col('DIA');
  const iOperario = col('OPERARIO');
  const iFactura  = col('Facturado');
  const iCajas    = col('Cantidad cajas');
  const iInicio   = col('INICIO PICKING');
  const iFin      = col('FIN PICKING');

  if (iDia < 0 || iOperario < 0 || iFactura < 0 || iCajas < 0) {
    throw new Error(
      'Columnas críticas no encontradas en ALISTAMIENTO: ' +
      'se requieren DIA, OPERARIO, Facturado, Cantidad cajas.'
    );
  }
  if (iInicio < 0 || iFin < 0) {
    throw new Error(
      'Columnas de tiempo no encontradas en ALISTAMIENTO: ' +
      'se requieren "INICIO PICKING" y "FIN PICKING".'
    );
  }

  log(`✅ Columnas mapeadas · ${rows.length - 1} filas en ALISTAMIENTO`);

  // ── Verificar periodo ─────────────────────────────────────────────────
  const conteoMes = {};
  for (let i = 1; i < rows.length; i++) {
    const f = _parseFechaAli(rows[i][iDia]);
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
      `Meses encontrados: ${disponibles}.`
    );
  }

  if (mesDominante !== periodoId) {
    log(`⚠️ El archivo tiene más filas de ${_labelPeriodo(mesDominante)}. ` +
        `Procesando ${_labelPeriodo(periodoId)} (${filasDelPeriodo} filas).`);
  }

  log(`📅 Procesando: ${_labelPeriodo(periodoId)} · ${filasDelPeriodo} filas`);
  const periodo = periodoId;

  // ── Paso 1: Agrupar por (fecha, operario) ────────────────────────────
  // Incluye TODOS los procesos — no filtrar por PROCESO
  // turnMap[fecha][operario] = { unidades, cajas, inicios[], fines[] }

  const turnMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const fecha = _parseFechaAli(r[iDia]);
    if (!fecha || !fecha.startsWith(periodo)) continue;

    const operario = r[iOperario] ? String(r[iOperario]).trim() : null;
    if (!operario) continue;

    const unidades = Number(r[iFactura]) || 0;
    const cajas    = Number(r[iCajas])   || 0;
    const inicio   = _parseHoraAli(r[iInicio]);
    const fin      = _parseHoraAli(r[iFin]);

    if (!turnMap[fecha])           turnMap[fecha]           = {};
    if (!turnMap[fecha][operario]) turnMap[fecha][operario] = {
      unidades: 0, cajas: 0, inicios: [], fines: []
    };

    turnMap[fecha][operario].unidades += unidades;
    turnMap[fecha][operario].cajas    += cajas;
    if (inicio !== null) turnMap[fecha][operario].inicios.push(inicio);
    if (fin    !== null) turnMap[fecha][operario].fines.push(fin);
  }

  // ── Paso 2: Horas efectivas por operario+día ─────────────────────────
  // horas_op = MAX(fines) - MIN(inicios)   ← rango del operario ese día
  // SUMA de horas por operario (no ventana global del día)

  const diasOrdenados = Object.keys(turnMap).sort();
  const rowsDiario    = [];
  let totalCuarentena = 0;

  for (const fecha of diasOrdenados) {
    const empleados = turnMap[fecha];
    let totalUnidades = 0, totalCajas = 0, totalHoras = 0;
    let numOperarios  = 0, numCuarentena = 0;

    for (const [op, t] of Object.entries(empleados)) {
      let horasOp      = 0;
      let enCuarentena = false;

      if (t.inicios.length === 0 || t.fines.length === 0) {
        enCuarentena = true;
      } else {
        horasOp = Math.max(...t.fines) - Math.min(...t.inicios);
        if (horasOp < 0.1 || horasOp > 14) {
          enCuarentena = true;
        }
      }

      if (!enCuarentena) {
        totalUnidades += t.unidades;
        totalCajas    += t.cajas;
        totalHoras    += horasOp;  // ← SUMA individual, no ventana global
        numOperarios  += 1;
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
      num_pedidos:     0,
      und_alistadas:   totalUnidades,
      cajas_alistadas: totalCajas,
      horas_efectivas: Math.round(totalHoras * 10000) / 10000,
      num_operarios:   numOperarios,
      pa_und:          paUnd,
      pa_cajas:        paCajas,
    });
  }

  log(`📅 ${rowsDiario.length} días procesados · ${totalCuarentena} operarios en cuarentena`);

  if (rowsDiario.length === 0) {
    throw new Error(
      `No se encontraron registros válidos para ${_labelPeriodo(periodo)}.`
    );
  }

  // ── Paso 3: Resumen semanal y global ─────────────────────────────────
  const semMap = {};
  for (const d of rowsDiario) {
    const s = d.semana;
    if (!semMap[s]) semMap[s] = {
      und:0, cajas:0, horas:0, ops:0, dias:0,
      mejorPA:-Infinity, peorPA:Infinity
    };
    semMap[s].und   += d.und_alistadas;
    semMap[s].cajas += d.cajas_alistadas;
    semMap[s].horas += d.horas_efectivas;
    semMap[s].ops   += d.num_operarios;
    semMap[s].dias  += 1;
    if (d.pa_und > semMap[s].mejorPA) semMap[s].mejorPA = d.pa_und;
    if (d.pa_und < semMap[s].peorPA)  semMap[s].peorPA  = d.pa_und;
  }

  const rowsResumen = [];
  for (const [semana, v] of Object.entries(semMap)) {
    const paUnd   = v.horas > 0 ? Math.round((v.und  /v.horas)*100)/100 : 0;
    const paCajas = v.horas > 0 ? Math.round((v.cajas/v.horas)*100)/100 : 0;
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
  const paG      = totHoras>0 ? Math.round((totUnd  /totHoras)*100)/100 : 0;
  const paCjG    = totHoras>0 ? Math.round((totCajas/totHoras)*100)/100 : 0;
  const mejorDia = Math.max(...rowsDiario.map(d=>d.pa_und));
  const peorDia  = Math.min(...rowsDiario.map(d=>d.pa_und));
  const mejorDiaFecha = rowsDiario.find(d=>d.pa_und===mejorDia)?.fecha || null;

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

  // ── Paso 4: Limpieza ─────────────────────────────────────────────────
  log(`🧹 Borrando datos previos de ${_labelPeriodo(periodo)}…`);
  try {
    await sb.rest('DELETE',`kpi_ali_diario?periodo_id=eq.${periodo}`,  null,{'Prefer':'return=minimal'});
    await sb.rest('DELETE',`kpi_ali_resumen?periodo_id=eq.${periodo}`, null,{'Prefer':'return=minimal'});
  } catch(e) {
    throw new Error(`Error al limpiar datos anteriores de ${_labelPeriodo(periodo)}.`);
  }

  // ── Paso 5: Upsert diario ────────────────────────────────────────────
  log(`⬆️ Subiendo ${rowsDiario.length} días…`);
  const LOTE = 100;
  for (let i = 0; i < rowsDiario.length; i += LOTE) {
    try {
      await sb.rest('POST','kpi_ali_diario', rowsDiario.slice(i,i+LOTE),
        {'Prefer':'resolution=merge-duplicates,return=minimal'});
    } catch(e) {
      throw new Error(`Error guardando datos diarios (lote ${Math.floor(i/LOTE)+1}).`);
    }
    log(`  ✓ Días ${i+1}–${Math.min(i+LOTE,rowsDiario.length)} guardados`);
  }

  // ── Paso 6: Upsert resumen ───────────────────────────────────────────
  log(`⬆️ Subiendo ${rowsResumen.length} registros de resumen…`);
  try {
    await sb.rest('POST','kpi_ali_resumen', rowsResumen,
      {'Prefer':'resolution=merge-duplicates,return=minimal'});
  } catch(e) {
    throw new Error(`Error guardando el resumen de ${_labelPeriodo(periodo)}.`);
  }

  log(`✅ ${_labelPeriodo(periodo)}: PA ${paG} u/p/h · ${totUnd.toLocaleString('es-CO')} und · ${totCajas.toLocaleString('es-CO')} cajas · ${rowsDiario.length} días`);

  return {
    periodoId:      periodo,
    label:          _labelPeriodo(periodo),
    dias:           rowsDiario.length,
    undAlistadas:   totUnd,
    cajasAlistadas: totCajas,
    horasEfectivas: Math.round(totHoras*100)/100,
    paUnd:          paG,
    paCajas:        paCjG,
    mejorDia:       Math.round(mejorDia*100)/100,
    mejorDiaFecha,
    peorDia:        Math.round(peorDia*100)/100,
    totalCuarentena,
  };
}

window.procesarAlistamiento = procesarAlistamiento;
