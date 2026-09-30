-- ============================================================
-- extraer_estructura_bd.sql — NexusKPI · Extracción de estructura
-- Pégalo completo en Supabase → SQL Editor → Run.
-- Es de SOLO LECTURA (no modifica nada), solo consulta el catálogo
-- de PostgreSQL para listar tablas, columnas y tipos.
-- Copia el resultado (puedes exportarlo con el botón "Download CSV"
-- del editor, o simplemente copiar el texto) y pégamelo de vuelta.
-- ============================================================

select
  c.table_name,
  c.ordinal_position as pos,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    -- KPI-INV-002 · Exactitud de Inventario
    'kpi_inventario_conteos',
    'kpi_inventario_detalle',
    -- KPI-DES-003 · Nivel de Servicio CEDI
    'kpi_ns_resumen',
    'kpi_ns_diario',
    'kpi_ns_skus',
    'kpi_ns_diario_afectados',
    'kpi_ns_skus_afectados',
    'kpi_ns_pedidos_sku_detalle',
    'kpi_ns_cuarentena',
    -- KPI-ALI-004 · Productividad Alistamiento
    'kpi_ali_resumen',
    'kpi_ali_diario',
    -- KPI-REC-001 · Recepción a Tiempo (ya la tengo, se incluye para confirmar)
    'kpi_recibo_recepciones',
    'kpi_recibo_historico',
    'kpi_recibo_resumen',
    -- KPI-DES-005 · OTD (ya la tengo, se incluye para confirmar)
    'kpi_otd_proceso',
    'kpi_otd_trans',
    'kpi_otd_diario',
    'kpi_otd_detalle',
    -- KPI-DES-008 · Lead Time (ya la tengo, se incluye para confirmar)
    'kpi_des008_proceso',
    'kpi_des008_trans',
    'kpi_des008_diario',
    'kpi_des008_detalle',
    -- KPI-INV-007 · Utilización Capacidad CEDI (por si ya existe algo)
    'kpi_capacidad_resumen',
    'kpi_ocupacion_resumen'
  )
order by c.table_name, c.ordinal_position;

-- ============================================================
-- Opcional pero útil: si alguna de las tablas de arriba NO aparece
-- en el resultado, es porque no existe con ese nombre. Corre también
-- esta segunda consulta para ver TODAS las tablas que sí existen en
-- tu base (así detectamos nombres reales si difieren de los que
-- infiero del código):
-- ============================================================

select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
