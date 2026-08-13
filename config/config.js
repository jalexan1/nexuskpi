/**
 * config.js — NexusKPI · Fuente única de verdad
 * Solo este archivo se toca al agregar meses o cambiar parámetros operativos.
 */
const CONFIG = Object.freeze({

  supabase: Object.freeze({
    url:     'https://husmzwfaaaelqsytajxw.supabase.co',
    anonKey: 'sb_publishable_aBQJdx_ChbLDojt95lo36g_xrxOSoZB',
  }),

  jornada: Object.freeze({
    inicioH: 8,
    finH:    17,
    festivos: new Set([
      '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
      '2026-05-01','2026-05-18','2026-06-08','2026-06-29','2026-07-20',
      '2026-08-07','2026-08-17','2026-10-12','2026-11-02','2026-11-16',
      '2026-12-08','2026-12-25',
    ]),
  }),

  kpiRec001: Object.freeze({
    slaHoras: 12,
    metaPct:  95,
    semaforo: Object.freeze({ verde: 95, amarillo: 80 }),
    excluirProveedores: ['click cosmetics s.a.s'],
    campoHoraTT: Object.freeze({
      '2026-03': 'HORA TT RECIBO2',
      'default': 'HORA TT RECIBO',
    }),
  }),

  // Meses del año completo (con nombre) para que cualquier lookup de label
  // (CONFIG.meses.find) resuelva bien apenas empiecen a llegar datos de un
  // mes nuevo. Cuáles de estos se OFRECEN para cargue/selección se controla
  // aparte con mesesHastaHoy() (ver más abajo) — no editar esa lógica aquí.
  meses: [
    { id: '2026-03', label: 'Marzo 2026' },
    { id: '2026-04', label: 'Abril 2026' },
    { id: '2026-05', label: 'Mayo 2026'  },
    { id: '2026-06', label: 'Junio 2026' },
    { id: '2026-07', label: 'Julio 2026' },
    { id: '2026-08', label: 'Agosto 2026' },
    { id: '2026-09', label: 'Septiembre 2026' },
    { id: '2026-10', label: 'Octubre 2026' },
    { id: '2026-11', label: 'Noviembre 2026' },
    { id: '2026-12', label: 'Diciembre 2026' },
  ],

  kpis: [
    { code:'KPI-REC-001', name:'Tasa de Recepción a Tiempo',  icon:'📦', href:'kpi001.html', activo:true  },
    { code:'KPI-INV-002', name:'Exactitud de Inventario',     icon:'🗃️', href:'kpi002.html', activo:true  },
    { code:'KPI-DES-003', name:'Nivel de Servicio CEDI',      icon:'🏭', href:'kpi003.html', activo:true  },
    { code:'KPI-ALI-004', name:'Productividad Alistamiento',  icon:'🔧', href:'kpi004.html', activo:true  },
    { code:'KPI-DES-005', name:'On-Time Delivery (OTD)',      icon:'🚚', href:'kpi005.html', activo:true  },
    { code:'KPI-INV-007', name:'Utilización Capacidad CEDI',  icon:'📊', href:'kpi007.html', activo:true  },
    { code:'KPI-DES-008', name:'Ciclo de Pedido (Lead Time)', icon:'⏱️', href:'kpi008.html', activo:true  },
    { code:'KPI-DEV-006', name:'Tasa de Devoluciones',        icon:'↩️', href:null,           activo:false, hidden:true },
  ],

  // ── Fase 2 · Operatividad (prefijo op_ en BD, sufijo OP en páginas) ──────
  // No se toca ninguna clave anterior de este objeto.
  operatividad: Object.freeze({
    cargueHref:    'op_cargue_menu.html',
    dashboardHref: 'op_dashboard_menu.html',
    theme: 'op',
    dashboardKpis: [
      { code:'OP-RECIBO',      name:'Recibo',                     icon:'📥', href:'op_kpi_recibo.html' },
      { code:'OP-PROD-REC',    name:'Productividad Recibo',       icon:'👷', href:'op_kpi_prod_recibo.html' },
      { code:'OP-OCUPACION',   name:'Ocupación CEDI',              icon:'🏗️', href:'op_kpi_ocupacion.html' },
      { code:'OP-PICKING',     name:'Picking',                     icon:'🧰', href:'op_kpi_picking.html' },
      { code:'OP-PROD-PICK',   name:'Productividad Picking',       icon:'⚡', href:'op_kpi_prod_picking.html' },
      { code:'OP-OLAS',        name:'Olas',                        icon:'🌊', href:'op_kpi_olas.html' },
      { code:'OP-ACORDEON',    name:'Acordeón de Productividad',   icon:'📺', href:'op_acordeon.html' },
      { code:'OP-PARAMETROS',  name:'Parametrización',             icon:'⚙️', href:'op_parametros.html' },
    ],
  }),
});

/**
 * mesesHastaHoy() — meses de CONFIG.meses que ya "llegaron" (id <= mes actual
 * del calendario real, según la fecha del dispositivo). Úsala en cualquier
 * selector de cargue/tabs para NO ofrecer meses futuros (ej. si hoy estamos
 * en agosto-2026, no se muestran septiembre-diciembre todavía).
 * No requiere tocar este archivo cada mes: apenas el reloj cruce a
 * septiembre, ese mes aparece solo porque ya está en CONFIG.meses arriba.
 */
function mesesHastaHoy() {
  const hoy = new Date();
  const actual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  return CONFIG.meses.filter(m => m.id <= actual);
}
