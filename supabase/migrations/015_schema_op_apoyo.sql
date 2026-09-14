-- ============================================================
-- 015_schema_op_apoyo.sql — NexusKPI · Fase 2 · Operatividad
-- "Tiempo de apoyo Operativo" (OP-APOYO)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Prefijo op_ = Fase 2 / Operatividad. No modifica ninguna tabla
-- ni policy existente de Fase 1 (kpi_*) ni de las demás de Fase 2.
--
-- Fuente: Registro_TM_DD_mes_al_DD_mes_AAAA.xlsx — exportación de
-- registros de apoyo operativo (tiempo libre del rol fijo usado para
-- apoyar otras actividades del CEDI). Un archivo puede traer fechas
-- de más de un mes calendario (ver etl_op_apoyo.js) — por eso
-- periodo_id se calcula POR FILA a partir de la fecha de "Inicio",
-- no se elige una sola vez por archivo como en los demás cargues.
-- ============================================================

-- ── 1) op_apoyo_detalle — un registro = una fila del Excel ────────────────
CREATE TABLE IF NOT EXISTS op_apoyo_detalle (
  id                  BIGSERIAL PRIMARY KEY,
  codigo              TEXT NOT NULL,             -- "Código" del Excel: id único de fila (ej. 20260722134717)
  colaborador         TEXT,                       -- "Usuario"
  correo              TEXT,
  actividad           TEXT,                       -- RECIBO, ALMACENAMIENTO, ALISTAMIENTO, DESPACHO, RUTA, INVENTARIO, ASEO, DEVOLUCIONES, CERTIFICACIÓN, VALIDACIÓN PICKING, …
  inicio              TIMESTAMPTZ NOT NULL,
  fin                 TIMESTAMPTZ,
  duracion_min        NUMERIC,                    -- tal cual la columna "Duración (min)" del Excel — no se recalcula
  observaciones       TEXT,
  novedad             TEXT DEFAULT 'Ninguna',     -- 'Ninguna' | 'Modificado' | 'Borrado'
  motivo_novedad      TEXT,
  creado_por          TEXT,
  fecha_creacion      TIMESTAMPTZ,
  periodo_id          TEXT NOT NULL,              -- 'YYYY-MM', derivado de "Inicio" (no del archivo completo)
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_apoyo_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_op_apoyo_periodo      ON op_apoyo_detalle (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_apoyo_colaborador  ON op_apoyo_detalle (colaborador);
CREATE INDEX IF NOT EXISTS idx_op_apoyo_actividad    ON op_apoyo_detalle (actividad);
CREATE INDEX IF NOT EXISTS idx_op_apoyo_inicio       ON op_apoyo_detalle (inicio);

-- ── 2) Registrar 'APOYO_OPERATIVO' como archivo_origen válido ─────────────
-- op_periodos_cargue ya existe (008_schema_operatividad.sql) con un CHECK
-- que solo permitía 'SEGUIMIENTO_CLICK' y 'WMS_BASE'. Se amplía sin tocar
-- filas existentes. Un mismo cargue de OP-APOYO puede insertar/actualizar
-- MÁS DE UNA fila aquí (una por cada periodo_id detectado en el archivo),
-- a diferencia de los demás archivos_origen que son 1 fila por cargue.
ALTER TABLE op_periodos_cargue DROP CONSTRAINT IF EXISTS op_periodos_cargue_archivo_origen_check;
ALTER TABLE op_periodos_cargue ADD CONSTRAINT op_periodos_cargue_archivo_origen_check
  CHECK (archivo_origen IN ('SEGUIMIENTO_CLICK','WMS_BASE','APOYO_OPERATIVO'));

-- ── RLS (Row Level Security) — mismo patrón que las demás tablas op_ ──────
ALTER TABLE op_apoyo_detalle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pub_read_op_apoyo_detalle" ON op_apoyo_detalle;
CREATE POLICY "pub_read_op_apoyo_detalle" ON op_apoyo_detalle FOR SELECT USING (true);

DROP POLICY IF EXISTS "auth_write_op_apoyo_detalle" ON op_apoyo_detalle;
CREATE POLICY "auth_write_op_apoyo_detalle" ON op_apoyo_detalle
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_apoyo_detalle" ON op_apoyo_detalle;
CREATE POLICY "auth_update_op_apoyo_detalle" ON op_apoyo_detalle
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_apoyo_detalle" ON op_apoyo_detalle;
CREATE POLICY "auth_delete_op_apoyo_detalle" ON op_apoyo_detalle
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';

-- ── Verificación ──────────────────────────────────────────────────────────
SELECT 'op_apoyo_detalle' AS tabla, COUNT(*) FROM op_apoyo_detalle;
