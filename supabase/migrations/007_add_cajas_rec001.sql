-- ── Migración 007 — KPI-REC-001: agregar columna cajas ───────────────────
-- Fuente: Columna "Cantidad Recibo Cajas" de la hoja RECIBOS
-- Aplica: ALTER TABLE kpi_recibo_recepciones
-- Fecha: Jun-2026
-- Nota: Después de aplicar, recargar los 3 meses (Mar/Abr/May)
--       desde cargue_rec001.html para que el ETL llene el campo.

ALTER TABLE kpi_recibo_recepciones
  ADD COLUMN IF NOT EXISTS cajas INTEGER DEFAULT 0;

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
