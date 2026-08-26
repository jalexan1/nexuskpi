-- ============================================================
-- 013_kpi_ns_afectados_detalle.sql — NexusKPI · KPI-DES-003
-- Drill-down de "pedidos/órdenes afectados por corte"
-- Ejecutar en Supabase → SQL Editor
--
-- NO modifica kpi_ns_resumen / kpi_ns_diario / kpi_ns_skus.
-- Son 3 tablas nuevas e independientes:
--   1) kpi_ns_diario_afectados   — espejo liviano de kpi_ns_diario,
--                                  agrega cuántos pedidos del día tuvieron
--                                  al menos una unidad cortada.
--   2) kpi_ns_skus_afectados     — espejo liviano de kpi_ns_skus,
--                                  agrega cuántas órdenes de ese SKU
--                                  tuvieron corte.
--   3) kpi_ns_pedidos_sku_detalle — detalle granular pedido × SKU,
--                                  para el drill-down al hacer clic
--                                  (se consulta bajo demanda, NO se
--                                  carga completa al abrir la página).
-- ============================================================

DROP TABLE IF EXISTS kpi_ns_diario_afectados     CASCADE;
DROP TABLE IF EXISTS kpi_ns_skus_afectados       CASCADE;
DROP TABLE IF EXISTS kpi_ns_pedidos_sku_detalle  CASCADE;

-- ── Tabla 1: kpi_ns_diario_afectados ─────────────────────────────────────
CREATE TABLE kpi_ns_diario_afectados (
  id                 BIGSERIAL PRIMARY KEY,
  periodo_id         TEXT      NOT NULL,
  fecha              DATE      NOT NULL,
  pedidos_afectados  INTEGER   DEFAULT 0,   -- # comprobantes con cortadas > 0 ese día
  CONSTRAINT uq_ns_diario_afectados UNIQUE (periodo_id, fecha)
);

-- ── Tabla 2: kpi_ns_skus_afectados ───────────────────────────────────────
CREATE TABLE kpi_ns_skus_afectados (
  id                  BIGSERIAL PRIMARY KEY,
  periodo_id          TEXT      NOT NULL,
  referencia          TEXT      NOT NULL,
  ordenes_afectadas   INTEGER   DEFAULT 0,  -- # órdenes donde ese SKU tuvo corte
  CONSTRAINT uq_ns_skus_afectados UNIQUE (periodo_id, referencia)
);

-- ── Tabla 3: kpi_ns_pedidos_sku_detalle ──────────────────────────────────
-- Grano: un pedido (comprobante) puede tener varias filas, una por SKU.
-- No lleva UNIQUE (periodo_id,comprobante,sku): el ETL borra por
-- periodo_id y vuelve a insertar completo en cada cargue (igual patrón
-- que kpi_otd_detalle en KPI-DES-005) — no se necesita upsert por fila.
CREATE TABLE kpi_ns_pedidos_sku_detalle (
  id             BIGSERIAL PRIMARY KEY,
  periodo_id     TEXT      NOT NULL,
  fecha          DATE,
  comprobante    TEXT,
  sku            TEXT,
  descripcion    TEXT,
  pedidas        INTEGER   DEFAULT 0,
  despachadas    INTEGER   DEFAULT 0,
  cortadas       INTEGER   DEFAULT 0,
  estado         TEXT,               -- 'BIEN' · 'PARCIAL' · 'PENDIENTE'
  sin_match_wms  BOOLEAN   DEFAULT FALSE  -- true = el comprobante no tuvo NINGÚN
                                           -- registro en PICKING WMS (no solo este SKU)
);

CREATE INDEX IF NOT EXISTS idx_ns_detalle_periodo      ON kpi_ns_pedidos_sku_detalle (periodo_id);
CREATE INDEX IF NOT EXISTS idx_ns_detalle_fecha         ON kpi_ns_pedidos_sku_detalle (periodo_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ns_detalle_sku           ON kpi_ns_pedidos_sku_detalle (periodo_id, sku);
CREATE INDEX IF NOT EXISTS idx_ns_detalle_estado        ON kpi_ns_pedidos_sku_detalle (estado);

-- ── RLS (mismo patrón que el resto de tablas kpi_ns_*) ───────────────────
ALTER TABLE kpi_ns_diario_afectados     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_ns_skus_afectados       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_ns_pedidos_sku_detalle  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pub_read_ns_diario_afectados"  ON kpi_ns_diario_afectados     FOR SELECT USING (true);
CREATE POLICY "pub_read_ns_skus_afectados"    ON kpi_ns_skus_afectados       FOR SELECT USING (true);
CREATE POLICY "pub_read_ns_detalle"           ON kpi_ns_pedidos_sku_detalle  FOR SELECT USING (true);

CREATE POLICY "auth_write_ns_diario_afectados" ON kpi_ns_diario_afectados    FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_ns_skus_afectados"   ON kpi_ns_skus_afectados      FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_ns_detalle"          ON kpi_ns_pedidos_sku_detalle FOR ALL USING (auth.role() IN ('authenticated','service_role'));

NOTIFY pgrst, 'reload schema';
