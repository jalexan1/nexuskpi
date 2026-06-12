-- ============================================================
-- 006_schema_des008.sql — NexusKPI · KPI-DES-008 · Ciclo de Pedido (Lead Time)
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- ── DROP tablas anteriores si existen (versión anterior incompleta) ──────
DROP TABLE IF EXISTS kpi_des008_pedidos  CASCADE;
DROP TABLE IF EXISTS kpi_des008_resumen  CASCADE;
DROP TABLE IF EXISTS kpi_des008_proceso  CASCADE;
DROP TABLE IF EXISTS kpi_des008_trans    CASCADE;
DROP TABLE IF EXISTS kpi_des008_diario   CASCADE;
DROP TABLE IF EXISTS kpi_des008_detalle  CASCADE;

-- ── Tabla 1: kpi_des008_proceso ──────────────────────────────────────────
-- Una fila por (periodo_id, proceso). proceso=NULL → global del período.
-- Indicador principal con semáforo: B2B+B2C (proceso = 'B2B+B2C')
-- Otros procesos (TRASLADO, RETAIL, CLICK, MARKETPLACE, MAQUINAS): informativos.
CREATE TABLE kpi_des008_proceso (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  proceso        TEXT,                      -- NULL=global · 'B2B+B2C' · 'B2B' · 'B2C' · etc.
  total_pedidos  INTEGER     DEFAULT 0,
  cp_prom        NUMERIC(7,2),              -- Lead Time promedio (h hábiles)
  cp_min         NUMERIC(7,2),
  cp_max         NUMERIC(7,2),
  cp_mediana     NUMERIC(7,2),
  ok_24h         INTEGER     DEFAULT 0,
  pct_24h        NUMERIC(6,2),              -- % pedidos < 24h (meta >= 95%)
  pct_8h         NUMERIC(6,2),              -- % pedidos < 8h
  estado         TEXT CHECK (estado IN ('BIEN','ALERTA','CRITICO')),
  CONSTRAINT uq_des008_proceso UNIQUE (periodo_id, proceso)
);

-- ── Tabla 2: kpi_des008_trans ────────────────────────────────────────────
-- Lead Time promedio por transportador por período (solo B2B+B2C).
CREATE TABLE kpi_des008_trans (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  transportador  TEXT        NOT NULL,
  total_pedidos  INTEGER     DEFAULT 0,
  cp_prom        NUMERIC(7,2),
  CONSTRAINT uq_des008_trans UNIQUE (periodo_id, transportador)
);

-- ── Tabla 3: kpi_des008_diario ───────────────────────────────────────────
-- Lead Time B2B+B2C por día (para gráfico de evolución diaria).
CREATE TABLE kpi_des008_diario (
  id             BIGSERIAL   PRIMARY KEY,
  periodo_id     TEXT        NOT NULL,
  fecha          DATE        NOT NULL,
  semana         TEXT,
  total_pedidos  INTEGER     DEFAULT 0,
  cp_prom        NUMERIC(7,2),
  cp_min         NUMERIC(7,2),
  cp_max         NUMERIC(7,2),
  pct_24h        NUMERIC(6,2),
  CONSTRAINT uq_des008_diario UNIQUE (periodo_id, fecha)
);

-- ── Tabla 4: kpi_des008_detalle ──────────────────────────────────────────
-- Pedido a pedido (picking único) — para tabla detallada, distribución y exportación.
CREATE TABLE kpi_des008_detalle (
  id               BIGSERIAL   PRIMARY KEY,
  periodo_id       TEXT        NOT NULL,
  fecha            DATE,
  semana           TEXT,
  picking_id       TEXT,
  proceso          TEXT,
  transportador    TEXT,
  cp_horas         NUMERIC(7,2),
  estado_semaforo  TEXT CHECK (estado_semaforo IN ('BIEN','ALERTA','CRITICO'))
);

CREATE INDEX IF NOT EXISTS idx_des008_detalle_periodo  ON kpi_des008_detalle (periodo_id);
CREATE INDEX IF NOT EXISTS idx_des008_detalle_proceso  ON kpi_des008_detalle (proceso);
CREATE INDEX IF NOT EXISTS idx_des008_detalle_estado   ON kpi_des008_detalle (estado_semaforo);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE kpi_des008_proceso  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_des008_trans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_des008_diario   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_des008_detalle  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pub_read_des008_proceso"  ON kpi_des008_proceso  FOR SELECT USING (true);
CREATE POLICY "pub_read_des008_trans"    ON kpi_des008_trans    FOR SELECT USING (true);
CREATE POLICY "pub_read_des008_diario"   ON kpi_des008_diario   FOR SELECT USING (true);
CREATE POLICY "pub_read_des008_detalle"  ON kpi_des008_detalle  FOR SELECT USING (true);

CREATE POLICY "auth_write_des008_proceso"  ON kpi_des008_proceso  FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_des008_trans"    ON kpi_des008_trans    FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_des008_diario"   ON kpi_des008_diario   FOR ALL USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_write_des008_detalle"  ON kpi_des008_detalle  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

NOTIFY pgrst, 'reload schema';
