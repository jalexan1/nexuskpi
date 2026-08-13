-- ============================================================
-- 012_kpi_ns_cuarentena.sql — NexusKPI Platform · Supabase PostgreSQL
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- Contexto: incidencia detectada en KPI-DES-003 (Nivel de Servicio CEDI)
-- el 26-27/06/2026 — el mismo Comprobante aparecía en ALISTAMIENTO con
-- dos fechas DIA distintas (pedido re-cargado en el archivo fuente),
-- lo que duplicaba las "unidades pedidas" y hundía artificialmente el
-- NS% del día. etl_des003.js v1.6 ya NO fusiona estos casos: los excluye
-- del cálculo y los registra aquí para revisión manual del analista.
-- ============================================================

CREATE TABLE IF NOT EXISTS kpi_ns_cuarentena (
  id            BIGSERIAL PRIMARY KEY,
  periodo_id    TEXT NOT NULL,
  comprobante   TEXT NOT NULL,
  fechas        TEXT,              -- fechas DIA en conflicto, separadas por coma
  pedidas       NUMERIC,
  motivo        TEXT,
  revisado      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ns_cuarentena_periodo_comp UNIQUE (periodo_id, comprobante)
);

CREATE INDEX IF NOT EXISTS idx_ns_cuarentena_periodo   ON kpi_ns_cuarentena (periodo_id);
CREATE INDEX IF NOT EXISTS idx_ns_cuarentena_revisado  ON kpi_ns_cuarentena (revisado);

-- Nota: si por algún motivo el POST a esta tabla falla (p. ej. choque de
-- clave primaria uq_ns_cuarentena_periodo_comp por una recarga del mismo
-- período), etl_des003.js NO detiene el cálculo del KPI: el comprobante
-- ya quedó excluido en memoria antes del insert, y el error simplemente
-- se reporta por log para que el analista lo revise manualmente.
