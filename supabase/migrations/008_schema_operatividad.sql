-- ============================================================
-- 008_schema_operatividad.sql — NexusKPI · Fase 2 · Operatividad
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Prefijo op_ = Fase 2 / Operatividad. No modifica ninguna tabla
-- ni policy existente de Fase 1 (kpi_*, etl_log, kpi_usuarios, wms_base).
-- ============================================================

-- ── 1) Control de cargues por periodo/archivo ─────────────────────────────
CREATE TABLE IF NOT EXISTS op_periodos_cargue (
  id                  BIGSERIAL PRIMARY KEY,
  periodo_id          TEXT NOT NULL,                 -- 'YYYY-MM'
  archivo_origen      TEXT NOT NULL CHECK (archivo_origen IN ('SEGUIMIENTO_CLICK','WMS_BASE')),
  nombre_archivo      TEXT,
  fecha_carga         TIMESTAMPTZ DEFAULT NOW(),
  usuario_carga       TEXT,
  estado              TEXT,
  registros_ok        INTEGER DEFAULT 0,
  registros_cuarentena INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_periodo_archivo UNIQUE (periodo_id, archivo_origen)
);

CREATE INDEX IF NOT EXISTS idx_op_periodos_periodo  ON op_periodos_cargue (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_periodos_archivo  ON op_periodos_cargue (archivo_origen);

-- ── 2) op_recibo — hoja RECIBOS (SEGUIMIENTO CLICK) ───────────────────────
CREATE TABLE IF NOT EXISTS op_recibo (
  id                          BIGSERIAL PRIMARY KEY,
  referencia                  TEXT,
  sku                         TEXT,
  proveedor                   TEXT,
  descripcion                 TEXT,
  documento                   TEXT,
  fecha_ingresa                DATE,
  fecha_recibo                DATE,
  cantidad_pedido_unidades    NUMERIC,
  cantidad_recibo_unidades    NUMERIC,
  diferencia_unidades         NUMERIC,
  cantidad_pedido_cajas       NUMERIC,
  cantidad_recibo_cajas       NUMERIC,
  diferencia_cajas            NUMERIC,
  oc                          TEXT,
  um                          TEXT,
  hora_cita                   TIME,
  hora_inicio_descargue       TIME,
  hora_final_descargue        TIME,
  hora_tt_recibo_txt          TEXT,          -- valor original tal cual llega ("02-05-26-12-33")
  hora_tt_recibo              TIMESTAMPTZ,   -- valor parseado
  tiene_cita                  BOOLEAN DEFAULT FALSE,
  certificacion                TEXT,
  recibo                      NUMERIC,
  proveedor2                  TEXT,
  operario                    TEXT,
  familia                     TEXT,
  causal                      TEXT,
  periodo_id                  TEXT NOT NULL,
  is_inconsistente            BOOLEAN DEFAULT FALSE,
  causal_inconsistencia       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_recibo UNIQUE (periodo_id, documento, referencia, fecha_recibo)
);

CREATE INDEX IF NOT EXISTS idx_op_recibo_periodo    ON op_recibo (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_recibo_fecha      ON op_recibo (fecha_recibo);
CREATE INDEX IF NOT EXISTS idx_op_recibo_operario   ON op_recibo (operario);
CREATE INDEX IF NOT EXISTS idx_op_recibo_proveedor  ON op_recibo (proveedor);
CREATE INDEX IF NOT EXISTS idx_op_recibo_cita       ON op_recibo (tiene_cita);
CREATE INDEX IF NOT EXISTS idx_op_recibo_inc        ON op_recibo (is_inconsistente);

-- ── 3) op_alistamiento — hoja ALISTAMIENTO (SEGUIMIENTO CLICK) ────────────
CREATE TABLE IF NOT EXISTS op_alistamiento (
  id                     BIGSERIAL PRIMARY KEY,
  dia                    DATE,
  comprobante            TEXT,
  estado                 TEXT,
  documento              TEXT,
  nombre_tercero         TEXT,
  sku                    TEXT,
  descripcion            TEXT,
  facturado              NUMERIC,
  alistado               TEXT,
  cantidad_cajas         NUMERIC,
  operario               TEXT,
  inicio_picking         TIME,
  fin_picking            TIME,
  tiempo_real            TEXT,
  certificador           TEXT,
  inicio_aduana          TIME,
  fin_aduana             TIME,
  ola_id                 TEXT,        -- calculado: periodo_id || '-' || dia
  periodo_id             TEXT NOT NULL,
  is_inconsistente       BOOLEAN DEFAULT FALSE,
  causal_inconsistencia  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_alistamiento UNIQUE (periodo_id, comprobante, sku, dia)
);

CREATE INDEX IF NOT EXISTS idx_op_alist_periodo   ON op_alistamiento (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_alist_dia        ON op_alistamiento (dia);
CREATE INDEX IF NOT EXISTS idx_op_alist_operario   ON op_alistamiento (operario);
CREATE INDEX IF NOT EXISTS idx_op_alist_ola        ON op_alistamiento (ola_id);
CREATE INDEX IF NOT EXISTS idx_op_alist_inc        ON op_alistamiento (is_inconsistente);

-- ── 4) op_picking_wms — hoja PICKING WMS (SEGUIMIENTO CLICK) ──────────────
CREATE TABLE IF NOT EXISTS op_picking_wms (
  id                     BIGSERIAL PRIMARY KEY,
  picking                TEXT,
  pedido_wms             TEXT,
  tipo                   TEXT,
  referencia             TEXT,
  producto_ean           TEXT,
  descripcion            TEXT,
  cantidad               NUMERIC,
  linea_de_picking       TEXT,
  id_caja                TEXT,
  fecha_registro         DATE,
  hora_registro          TIME,
  empleado               TEXT,
  nombre_cliente         TEXT,
  periodo_id             TEXT NOT NULL,
  is_inconsistente       BOOLEAN DEFAULT FALSE,
  causal_inconsistencia  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_picking_wms UNIQUE (periodo_id, pedido_wms, linea_de_picking, id_caja)
);

CREATE INDEX IF NOT EXISTS idx_op_pkwms_periodo  ON op_picking_wms (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_pkwms_fecha    ON op_picking_wms (fecha_registro);
CREATE INDEX IF NOT EXISTS idx_op_pkwms_empleado ON op_picking_wms (empleado);
CREATE INDEX IF NOT EXISTS idx_op_pkwms_inc      ON op_picking_wms (is_inconsistente);

-- ── 5) op_inventario_ubicacion — hoja InventarioxUbicacion (WMS_BASE) ─────
CREATE TABLE IF NOT EXISTS op_inventario_ubicacion (
  id                    BIGSERIAL PRIMARY KEY,
  ean                   TEXT,
  item                  TEXT,
  descripcion           TEXT,
  ubicacion             TEXT,
  zona                  TEXT,
  mueble                TEXT,
  altura                TEXT,
  posicion              TEXT,
  caja                  TEXT,
  qty_saldo             NUMERIC,
  qty_saldo_cajas       NUMERIC,
  documento             TEXT,
  proveedor             TEXT,
  estado                TEXT,
  fecha_creacion_caja   TIMESTAMPTZ,
  fecha_vence           DATE,
  bloqueada             BOOLEAN DEFAULT FALSE,
  periodo_id            TEXT NOT NULL,
  is_inconsistente      BOOLEAN DEFAULT FALSE,
  causal_inconsistencia TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_inv_ubicacion UNIQUE (periodo_id, ean, ubicacion, caja)
);

CREATE INDEX IF NOT EXISTS idx_op_invub_periodo  ON op_inventario_ubicacion (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_invub_zona     ON op_inventario_ubicacion (zona);
CREATE INDEX IF NOT EXISTS idx_op_invub_ubic     ON op_inventario_ubicacion (ubicacion);

-- ── 6) op_densidad_ubicacion — hoja DensidadxUbicacion (WMS_BASE) ─────────
CREATE TABLE IF NOT EXISTS op_densidad_ubicacion (
  id                  BIGSERIAL PRIMARY KEY,
  ubicacion           TEXT,
  zona                TEXT,
  prioridad_rotacion  TEXT,
  mueble              TEXT,
  altura              TEXT,
  capcubica           NUMERIC,
  cappeso             NUMERIC,
  ocupacion           NUMERIC,
  area                TEXT,
  periodo_id          TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_densidad UNIQUE (periodo_id, ubicacion)
);

CREATE INDEX IF NOT EXISTS idx_op_densidad_periodo ON op_densidad_ubicacion (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_densidad_zona    ON op_densidad_ubicacion (zona);

-- ── 7) op_productividad_pk — hoja ProductividadxPk (WMS_BASE) ────────────
CREATE TABLE IF NOT EXISTS op_productividad_pk (
  id                     BIGSERIAL PRIMARY KEY,
  pedido_wms             TEXT,
  tipo                   TEXT,
  picking                TEXT,
  referencia             TEXT,
  producto_ean           TEXT,
  descripcion            TEXT,
  cantidad               NUMERIC,
  linea_de_picking       TEXT,
  id_caja                TEXT,
  fecha_registro         TIMESTAMPTZ,
  empleado               TEXT,
  periodo_id             TEXT NOT NULL,
  is_inconsistente       BOOLEAN DEFAULT FALSE,
  causal_inconsistencia  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_prod_pk UNIQUE (periodo_id, pedido_wms, linea_de_picking, id_caja)
);

CREATE INDEX IF NOT EXISTS idx_op_prodpk_periodo  ON op_productividad_pk (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_prodpk_empleado ON op_productividad_pk (empleado);
CREATE INDEX IF NOT EXISTS idx_op_prodpk_fecha    ON op_productividad_pk (fecha_registro);
CREATE INDEX IF NOT EXISTS idx_op_prodpk_inc      ON op_productividad_pk (is_inconsistente);

-- ── 8) op_recogidas_pk_rango — hoja RecogidasPkxRango (WMS_BASE) ─────────
CREATE TABLE IF NOT EXISTS op_recogidas_pk_rango (
  id                  BIGSERIAL PRIMARY KEY,
  pedido_wms          TEXT,
  tipo                TEXT,
  picking             TEXT,
  referencia          TEXT,
  producto_ean        TEXT,
  cantidad            NUMERIC,
  linea_de_picking    TEXT,
  fecha_registro      DATE,
  hora_registro       TIME,
  empleado            TEXT,
  nombre_cliente      TEXT,
  periodo_id          TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_recogidas UNIQUE (periodo_id, pedido_wms, linea_de_picking)
);

CREATE INDEX IF NOT EXISTS idx_op_recog_periodo  ON op_recogidas_pk_rango (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_recog_empleado ON op_recogidas_pk_rango (empleado);
CREATE INDEX IF NOT EXISTS idx_op_recog_fecha    ON op_recogidas_pk_rango (fecha_registro);

-- ── 9) op_parametros — parametrización genérica clave/valor ──────────────
CREATE TABLE IF NOT EXISTS op_parametros (
  id              BIGSERIAL PRIMARY KEY,
  clave           TEXT NOT NULL UNIQUE,
  valor           TEXT,
  descripcion     TEXT,
  actualizado_por TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO op_parametros (clave, valor, descripcion)
VALUES ('acordeon_intervalo_segundos', '300', 'Segundos entre tarjetas del Acordeón de Productividad en modo TV')
ON CONFLICT (clave) DO NOTHING;

-- ── RLS (Row Level Security) ──────────────────────────────────────────────
ALTER TABLE op_periodos_cargue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_recibo                ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_alistamiento          ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_picking_wms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_inventario_ubicacion  ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_densidad_ubicacion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_productividad_pk      ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_recogidas_pk_rango    ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_parametros            ENABLE ROW LEVEL SECURITY;

-- Lectura pública (dashboard) en todas las tablas op_
DROP POLICY IF EXISTS "pub_read_op_periodos_cargue"      ON op_periodos_cargue;
CREATE POLICY "pub_read_op_periodos_cargue"      ON op_periodos_cargue      FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_recibo"                ON op_recibo;
CREATE POLICY "pub_read_op_recibo"                ON op_recibo                FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_alistamiento"          ON op_alistamiento;
CREATE POLICY "pub_read_op_alistamiento"          ON op_alistamiento          FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_picking_wms"           ON op_picking_wms;
CREATE POLICY "pub_read_op_picking_wms"           ON op_picking_wms           FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_inventario_ubicacion"  ON op_inventario_ubicacion;
CREATE POLICY "pub_read_op_inventario_ubicacion"  ON op_inventario_ubicacion  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_densidad_ubicacion"    ON op_densidad_ubicacion;
CREATE POLICY "pub_read_op_densidad_ubicacion"    ON op_densidad_ubicacion    FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_productividad_pk"      ON op_productividad_pk;
CREATE POLICY "pub_read_op_productividad_pk"      ON op_productividad_pk      FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_recogidas_pk_rango"    ON op_recogidas_pk_rango;
CREATE POLICY "pub_read_op_recogidas_pk_rango"    ON op_recogidas_pk_rango    FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_parametros"            ON op_parametros;
CREATE POLICY "pub_read_op_parametros"            ON op_parametros            FOR SELECT USING (true);

-- Escritura (insert/update/delete): solo authenticated/service_role, en todas las tablas op_
DROP POLICY IF EXISTS "auth_write_op_periodos_cargue" ON op_periodos_cargue;
CREATE POLICY "auth_write_op_periodos_cargue" ON op_periodos_cargue
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_periodos_cargue" ON op_periodos_cargue;
CREATE POLICY "auth_update_op_periodos_cargue" ON op_periodos_cargue
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_periodos_cargue" ON op_periodos_cargue;
CREATE POLICY "auth_delete_op_periodos_cargue" ON op_periodos_cargue
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_recibo" ON op_recibo;
CREATE POLICY "auth_write_op_recibo" ON op_recibo
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_recibo" ON op_recibo;
CREATE POLICY "auth_update_op_recibo" ON op_recibo
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_recibo" ON op_recibo;
CREATE POLICY "auth_delete_op_recibo" ON op_recibo
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_alistamiento" ON op_alistamiento;
CREATE POLICY "auth_write_op_alistamiento" ON op_alistamiento
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_alistamiento" ON op_alistamiento;
CREATE POLICY "auth_update_op_alistamiento" ON op_alistamiento
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_alistamiento" ON op_alistamiento;
CREATE POLICY "auth_delete_op_alistamiento" ON op_alistamiento
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_picking_wms" ON op_picking_wms;
CREATE POLICY "auth_write_op_picking_wms" ON op_picking_wms
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_picking_wms" ON op_picking_wms;
CREATE POLICY "auth_update_op_picking_wms" ON op_picking_wms
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_picking_wms" ON op_picking_wms;
CREATE POLICY "auth_delete_op_picking_wms" ON op_picking_wms
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_inventario_ubicacion" ON op_inventario_ubicacion;
CREATE POLICY "auth_write_op_inventario_ubicacion" ON op_inventario_ubicacion
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_inventario_ubicacion" ON op_inventario_ubicacion;
CREATE POLICY "auth_update_op_inventario_ubicacion" ON op_inventario_ubicacion
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_inventario_ubicacion" ON op_inventario_ubicacion;
CREATE POLICY "auth_delete_op_inventario_ubicacion" ON op_inventario_ubicacion
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_densidad_ubicacion" ON op_densidad_ubicacion;
CREATE POLICY "auth_write_op_densidad_ubicacion" ON op_densidad_ubicacion
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_densidad_ubicacion" ON op_densidad_ubicacion;
CREATE POLICY "auth_update_op_densidad_ubicacion" ON op_densidad_ubicacion
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_densidad_ubicacion" ON op_densidad_ubicacion;
CREATE POLICY "auth_delete_op_densidad_ubicacion" ON op_densidad_ubicacion
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_productividad_pk" ON op_productividad_pk;
CREATE POLICY "auth_write_op_productividad_pk" ON op_productividad_pk
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_productividad_pk" ON op_productividad_pk;
CREATE POLICY "auth_update_op_productividad_pk" ON op_productividad_pk
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_productividad_pk" ON op_productividad_pk;
CREATE POLICY "auth_delete_op_productividad_pk" ON op_productividad_pk
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_recogidas_pk_rango" ON op_recogidas_pk_rango;
CREATE POLICY "auth_write_op_recogidas_pk_rango" ON op_recogidas_pk_rango
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_recogidas_pk_rango" ON op_recogidas_pk_rango;
CREATE POLICY "auth_update_op_recogidas_pk_rango" ON op_recogidas_pk_rango
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_recogidas_pk_rango" ON op_recogidas_pk_rango;
CREATE POLICY "auth_delete_op_recogidas_pk_rango" ON op_recogidas_pk_rango
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_parametros" ON op_parametros;
CREATE POLICY "auth_write_op_parametros" ON op_parametros
  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';

-- ── Verificación ──────────────────────────────────────────────────────────
SELECT 'op_periodos_cargue' AS tabla, COUNT(*) FROM op_periodos_cargue
UNION ALL SELECT 'op_recibo',               COUNT(*) FROM op_recibo
UNION ALL SELECT 'op_alistamiento',         COUNT(*) FROM op_alistamiento
UNION ALL SELECT 'op_picking_wms',          COUNT(*) FROM op_picking_wms
UNION ALL SELECT 'op_inventario_ubicacion', COUNT(*) FROM op_inventario_ubicacion
UNION ALL SELECT 'op_densidad_ubicacion',   COUNT(*) FROM op_densidad_ubicacion
UNION ALL SELECT 'op_productividad_pk',     COUNT(*) FROM op_productividad_pk
UNION ALL SELECT 'op_recogidas_pk_rango',   COUNT(*) FROM op_recogidas_pk_rango
UNION ALL SELECT 'op_parametros',           COUNT(*) FROM op_parametros;
