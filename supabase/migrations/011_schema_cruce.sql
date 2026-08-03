-- ============================================================
-- 011_schema_cruce.sql — NexusKPI · Fase 2 · Operatividad
-- "Auditoría de Cargues" — cruce SEGUIMIENTO CLICK vs WMS BASE
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Prefijo op_ = Fase 2 / Operatividad. Aditivo: no modifica ninguna
-- tabla, policy ni parámetro existente de Fase 1 ni del resto de Fase 2.
-- ============================================================

-- ── 1) op_cruce_ejecuciones — cabecera de cada corrida del cruce ──────────
CREATE TABLE IF NOT EXISTS op_cruce_ejecuciones (
  id                          BIGSERIAL PRIMARY KEY,
  fecha_ejecucion             TIMESTAMPTZ DEFAULT NOW(),
  meses_analizados            TEXT,               -- 'YYYY-MM,YYYY-MM' (los meses realmente comparados)
  meses_comparar_parametro    INTEGER,            -- valor de op_parametros.meses_comparar usado en esta corrida
  incluye_mes_parcial         BOOLEAN DEFAULT FALSE,
  total_hallazgos             INTEGER DEFAULT 0,
  ejecutado_por               TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_cruce_ejec_fecha ON op_cruce_ejecuciones (fecha_ejecucion);

-- ── 2) op_cruce_hallazgos — resultado del comparativo (Tabla 1, solo lectura) ─
CREATE TABLE IF NOT EXISTS op_cruce_hallazgos (
  id              BIGSERIAL PRIMARY KEY,
  ejecucion_id    BIGINT NOT NULL REFERENCES op_cruce_ejecuciones(id) ON DELETE CASCADE,
  periodo_id      TEXT,                -- 'YYYY-MM' del hallazgo
  tipo            TEXT NOT NULL,       -- 'Cobertura de mes' | 'Identidad de operarios' | 'Solapamiento de fechas' | 'Volumen por operario'
  detalle         TEXT NOT NULL,
  severidad       TEXT NOT NULL DEFAULT 'Revisar' CHECK (severidad IN ('Informativo','Revisar')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_cruce_hall_ejecucion ON op_cruce_hallazgos (ejecucion_id);
CREATE INDEX IF NOT EXISTS idx_op_cruce_hall_periodo   ON op_cruce_hallazgos (periodo_id);
CREATE INDEX IF NOT EXISTS idx_op_cruce_hall_tipo       ON op_cruce_hallazgos (tipo);

-- ── 3) op_cruce_ajustes — CRUD de ajustes/compromisos (Tabla 2, editable) ──
-- Un ajuste por hallazgo. "estado" es un checklist: Bueno u Revisión. Si no es
-- "Bueno" la observación es obligatoria (se valida también en el frontend).
CREATE TABLE IF NOT EXISTS op_cruce_ajustes (
  id                BIGSERIAL PRIMARY KEY,
  hallazgo_id       BIGINT NOT NULL REFERENCES op_cruce_hallazgos(id) ON DELETE CASCADE,
  estado            TEXT NOT NULL DEFAULT 'Revisión' CHECK (estado IN ('Bueno','Revisión')),
  observacion       TEXT,
  responsable       TEXT,
  actualizado_por   TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_op_cruce_ajuste UNIQUE (hallazgo_id),
  CONSTRAINT ck_op_cruce_observacion_obligatoria CHECK (estado = 'Bueno' OR (observacion IS NOT NULL AND btrim(observacion) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_op_cruce_ajuste_hallazgo ON op_cruce_ajustes (hallazgo_id);
CREATE INDEX IF NOT EXISTS idx_op_cruce_ajuste_estado   ON op_cruce_ajustes (estado);

-- ── 4) Parámetro "meses_comparar" en la tabla genérica existente ──────────
-- Cantidad de meses CERRADOS que se comparan por defecto en Auditoría de Cargues.
-- Un mes se considera cerrado si es anterior al mes calendario actual (regla aprobada).
INSERT INTO op_parametros (clave, valor, descripcion)
VALUES ('meses_comparar', '2', 'Cantidad de meses cerrados a comparar en Auditoría de Cargues (el mes en curso solo se incluye si el líder de proceso lo confirma explícitamente)')
ON CONFLICT (clave) DO NOTHING;

-- ── RLS (Row Level Security) ──────────────────────────────────────────────
ALTER TABLE op_cruce_ejecuciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_cruce_hallazgos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_cruce_ajustes     ENABLE ROW LEVEL SECURITY;

-- Lectura pública (dashboard)
DROP POLICY IF EXISTS "pub_read_op_cruce_ejecuciones" ON op_cruce_ejecuciones;
CREATE POLICY "pub_read_op_cruce_ejecuciones" ON op_cruce_ejecuciones FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_cruce_hallazgos" ON op_cruce_hallazgos;
CREATE POLICY "pub_read_op_cruce_hallazgos" ON op_cruce_hallazgos FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_op_cruce_ajustes" ON op_cruce_ajustes;
CREATE POLICY "pub_read_op_cruce_ajustes" ON op_cruce_ajustes FOR SELECT USING (true);

-- Escritura (insert/update/delete): solo authenticated/service_role
DROP POLICY IF EXISTS "auth_write_op_cruce_ejecuciones" ON op_cruce_ejecuciones;
CREATE POLICY "auth_write_op_cruce_ejecuciones" ON op_cruce_ejecuciones
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_cruce_ejecuciones" ON op_cruce_ejecuciones;
CREATE POLICY "auth_delete_op_cruce_ejecuciones" ON op_cruce_ejecuciones
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_cruce_hallazgos" ON op_cruce_hallazgos;
CREATE POLICY "auth_write_op_cruce_hallazgos" ON op_cruce_hallazgos
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_cruce_hallazgos" ON op_cruce_hallazgos;
CREATE POLICY "auth_delete_op_cruce_hallazgos" ON op_cruce_hallazgos
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_op_cruce_ajustes" ON op_cruce_ajustes;
CREATE POLICY "auth_write_op_cruce_ajustes" ON op_cruce_ajustes
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_update_op_cruce_ajustes" ON op_cruce_ajustes;
CREATE POLICY "auth_update_op_cruce_ajustes" ON op_cruce_ajustes
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "auth_delete_op_cruce_ajustes" ON op_cruce_ajustes;
CREATE POLICY "auth_delete_op_cruce_ajustes" ON op_cruce_ajustes
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

-- ── Recarga de esquema PostgREST ───────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Verificación rápida ─────────────────────────────────────────────────
SELECT 'op_cruce_ejecuciones' AS tabla, COUNT(*) FROM op_cruce_ejecuciones
UNION ALL SELECT 'op_cruce_hallazgos', COUNT(*) FROM op_cruce_hallazgos
UNION ALL SELECT 'op_cruce_ajustes',   COUNT(*) FROM op_cruce_ajustes;
