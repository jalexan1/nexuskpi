-- ============================================================
-- 005_schema_des005.sql — NexusKPI · KPI-DES-005 · OTD %
-- VERSIÓN 2 — reemplaza 004_schema_des005.sql
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- ── DROP tablas anteriores si existen (versión anterior incompleta) ──────
DROP TABLE IF EXISTS kpi_otd_diario  CASCADE;
DROP TABLE IF EXISTS kpi_otd_resumen CASCADE;
DROP TABLE IF EXISTS kpi_otd_proceso CASCADE;
DROP TABLE IF EXISTS kpi_otd_trans   CASCADE;
DROP TABLE IF EXISTS kpi_otd_detalle CASCADE;

-- ── Tabla 1: kpi_otd_proceso ─────────────────────────────────────────────
-- Una fila por (periodo_id, proceso). proceso=NULL → global del período.
-- Indicador principal con semáforo: B2B+B2C  (proceso = 'B2B+B2C')
-- Otros procesos (TRASLADO, RETAIL, CLICK, MARKETPLACE): informativos.
CREATE TABLE kpi_otd_proceso (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  proceso        TEXT,                      -- NULL=global · 'B2B+B2C' · 'B2B' · 'B2C' · etc.
  total_pedidos  INTEGER     DEFAULT 0,
  pedidos_atime  INTEGER     DEFAULT 0,
  pedidos_tarde  INTEGER     DEFAULT 0,
  otd_pct        NUMERIC(6,2),
  CONSTRAINT uq_otd_proceso UNIQUE (periodo_id, proceso)
);

-- ── Tabla 2: kpi_otd_trans ───────────────────────────────────────────────
-- OTD por transportador por período.
CREATE TABLE kpi_otd_trans (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  transportador  TEXT        NOT NULL,
  total_pedidos  INTEGER     DEFAULT 0,
  pedidos_atime  INTEGER     DEFAULT 0,
  pedidos_tarde  INTEGER     DEFAULT 0,
  otd_pct        NUMERIC(6,2),
  CONSTRAINT uq_otd_trans UNIQUE (periodo_id, transportador)
);

-- ── Tabla 3: kpi_otd_diario ──────────────────────────────────────────────
-- OTD B2B+B2C por día (para gráfico de evolución diaria).
CREATE TABLE kpi_otd_diario (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  fecha          DATE        NOT NULL,
  semana         TEXT,
  total_pedidos  INTEGER     DEFAULT 0,
  pedidos_atime  INTEGER     DEFAULT 0,
  pedidos_tarde  INTEGER     DEFAULT 0,
  otd_pct        NUMERIC(6,2),
  CONSTRAINT uq_otd_diario UNIQUE (periodo_id, fecha)
);

-- ── Tabla 4: kpi_otd_detalle ─────────────────────────────────────────────
-- Pedido a pedido — para tabla detallada y exportación.
CREATE TABLE kpi_otd_detalle (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  fecha          DATE,
  comprobante    TEXT,
  proceso        TEXT,
  transportador  TEXT,
  ciudad         TEXT,
  ontime         BOOLEAN,
  ontime_dias    INTEGER,                   -- valor raw de ON-TIME L&S
  novedad        TEXT
);

CREATE INDEX IF NOT EXISTS idx_otd_detalle_periodo  ON kpi_otd_detalle (periodo_id);
CREATE INDEX IF NOT EXISTS idx_otd_detalle_proceso  ON kpi_otd_detalle (proceso);
CREATE INDEX IF NOT EXISTS idx_otd_detalle_ontime   ON kpi_otd_detalle (ontime);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE kpi_otd_proceso  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_otd_trans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_otd_diario   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_otd_detalle  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pub_read_otd_proceso"  ON kpi_otd_proceso  FOR SELECT USING (true);
CREATE POLICY "pub_read_otd_trans"    ON kpi_otd_trans    FOR SELECT USING (true);
CREATE POLICY "pub_read_otd_diario"   ON kpi_otd_diario   FOR SELECT USING (true);
CREATE POLICY "pub_read_otd_detalle"  ON kpi_otd_detalle  FOR SELECT USING (true);

CREATE POLICY "auth_write_otd_proceso"  ON kpi_otd_proceso  FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_otd_trans"    ON kpi_otd_trans    FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_otd_diario"   ON kpi_otd_diario   FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_otd_detalle"  ON kpi_otd_detalle  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

NOTIFY pgrst, 'reload schema';
