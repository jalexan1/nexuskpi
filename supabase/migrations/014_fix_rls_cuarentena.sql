-- ============================================================
-- 014_fix_rls_cuarentena.sql — NexusKPI · KPI-DES-003
-- Corrige el error 403 (PGRST 42501 "row-level security policy")
-- al insertar en kpi_ns_cuarentena.
--
-- Causa raíz: la migración 012 creó la tabla pero NUNCA definió
-- políticas RLS. En algún momento se activó RLS sobre la tabla
-- (manualmente desde el dashboard de Supabase o por configuración
-- del proyecto) sin agregar ninguna política — con RLS activo y
-- cero políticas, Postgres deniega TODO por defecto, incluyendo
-- los inserts del propio ETL. Por eso la cuarentena nunca se guardó
-- en Supabase (solo aparecía en el log de esa sesión).
--
-- Ejecutar en Supabase → SQL Editor.
-- ============================================================

ALTER TABLE kpi_ns_cuarentena ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pub_read_ns_cuarentena"   ON kpi_ns_cuarentena;
DROP POLICY IF EXISTS "auth_write_ns_cuarentena" ON kpi_ns_cuarentena;

CREATE POLICY "pub_read_ns_cuarentena"  ON kpi_ns_cuarentena FOR SELECT USING (true);
CREATE POLICY "auth_write_ns_cuarentena" ON kpi_ns_cuarentena FOR ALL
  USING (auth.role() IN ('authenticated','service_role'));

NOTIFY pgrst, 'reload schema';
