-- ============================================================
-- 004_schema_des005.sql — NexusKPI · KPI-DES-005 · OTD %
-- Ejecutar en Supabase → SQL Editor.
-- NO modificar schemas anteriores.
-- ============================================================

-- Tabla 1: kpi_otd_diario
-- Una fila por día por periodo.
CREATE TABLE IF NOT EXISTS kpi_otd_diario (
  id               BIGSERIAL    PRIMARY KEY,
  periodo_id       TEXT         NOT NULL,           -- 'YYYY-MM'
  fecha            DATE         NOT NULL,
  semana           TEXT,                            -- 'YYYY-Wnn' ISO
  total_pedidos    INTEGER      DEFAULT 0,          -- pedidos únicos despachados
  pedidos_atime    INTEGER      DEFAULT 0,          -- ON-TIME L&S >= 0
  pedidos_tarde    INTEGER      DEFAULT 0,          -- ON-TIME L&S < 0
  otd_pct          NUMERIC(6,2),                   -- pedidos_atime / total * 100
  lead_time_prom   NUMERIC(6,2),                   -- días prom SOLICITUD→FECHA DESPACHO
  CONSTRAINT uq_otd_fecha UNIQUE (periodo_id, fecha)
);

-- Índices para performance en consultas de dashboard
CREATE INDEX IF NOT EXISTS idx_otd_diario_periodo
  ON kpi_otd_diario (periodo_id);
CREATE INDEX IF NOT EXISTS idx_otd_diario_fecha
  ON kpi_otd_diario (fecha);
CREATE INDEX IF NOT EXISTS idx_otd_diario_semana
  ON kpi_otd_diario (semana);

-- Tabla 2: kpi_otd_resumen
-- Una fila semana=NULL (global del periodo) + una fila por semana ISO.
CREATE TABLE IF NOT EXISTS kpi_otd_resumen (
  id               BIGSERIAL    PRIMARY KEY,
  periodo_id       TEXT         NOT NULL,           -- 'YYYY-MM'
  semana           TEXT,                            -- NULL = global; 'YYYY-Wnn' = semanal
  fecha_inicio     DATE,                            -- primera fecha del rango
  total_pedidos    INTEGER      DEFAULT 0,
  pedidos_atime    INTEGER      DEFAULT 0,
  pedidos_tarde    INTEGER      DEFAULT 0,
  otd_pct          NUMERIC(6,2),
  lead_time_prom   NUMERIC(6,2),
  mejor_dia_otd    NUMERIC(6,2),                   -- max(otd_pct) de los días del rango
  peor_dia_otd     NUMERIC(6,2),                   -- min(otd_pct) de los días del rango
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT uq_otd_periodo_semana UNIQUE (periodo_id, semana)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_otd_resumen_periodo
  ON kpi_otd_resumen (periodo_id);
CREATE INDEX IF NOT EXISTS idx_otd_resumen_semana
  ON kpi_otd_resumen (semana);

-- ── RLS (Row Level Security) ──────────────────────────────────────────────

ALTER TABLE kpi_otd_diario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_otd_resumen ENABLE ROW LEVEL SECURITY;

-- Lectura pública (viewers sin login pueden ver el dashboard)
CREATE POLICY "pub_read_otd_diario"
  ON kpi_otd_diario FOR SELECT USING (true);

CREATE POLICY "pub_read_otd_resumen"
  ON kpi_otd_resumen FOR SELECT USING (true);

-- Escritura solo para usuarios autenticados (admin ETL)
CREATE POLICY "auth_write_otd_diario"
  ON kpi_otd_diario FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "auth_write_otd_resumen"
  ON kpi_otd_resumen FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'));

-- ── Recargar schema cache (SIEMPRE al final) ─────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Verificación post-ejecución ──────────────────────────────────────────
-- Ejecutar después para confirmar que las tablas quedaron bien:
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name IN ('kpi_otd_diario', 'kpi_otd_resumen')
-- ORDER BY table_name, ordinal_position;
