-- ============================================================
-- 021_schema_geh_reglamento.sql — NexusKPI Platform · Supabase PostgreSQL
-- Módulo: GEH — Gestión Humana · Constancias de Divulgación
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Esquema: geh (nuevo, aislado — no toca ninguna tabla existente)
-- Autor: Jhon Alexander Tuquerres Jiménez
-- Fecha: 2026-10-29
-- ============================================================

-- ── 0. Crear esquema geh ──────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS geh;
COMMENT ON SCHEMA geh IS 'Gestión Humana — documentos internos, reglamentos y constancias de divulgación';

-- Exponer el esquema al rol anon y authenticated de Supabase
GRANT USAGE ON SCHEMA geh TO anon, authenticated;

-- ── 1. Tabla maestra de documentos / reglamentos ─────────────────────────
CREATE TABLE IF NOT EXISTS geh.reglamentos (
  id               BIGSERIAL    PRIMARY KEY,
  codigo           TEXT         NOT NULL,
  nombre           TEXT         NOT NULL,
  version          TEXT         NOT NULL DEFAULT '1',
  fecha_emision    DATE,
  fecha_aprobacion DATE,
  proceso          TEXT,
  elaborado_por    TEXT,
  aprobado_por     TEXT,
  pdf_url          TEXT,
  pdf_path         TEXT,
  activo           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_geh_reglamentos_codigo_version UNIQUE (codigo, version)
);

CREATE INDEX IF NOT EXISTS ix_geh_reglamentos_activo ON geh.reglamentos (activo);
CREATE INDEX IF NOT EXISTS ix_geh_reglamentos_codigo ON geh.reglamentos (codigo);

COMMENT ON TABLE  geh.reglamentos           IS 'Catálogo de documentos internos con versiones y URL del PDF en Storage';
COMMENT ON COLUMN geh.reglamentos.codigo    IS 'Código del documento según el sistema documental (ej. PLA-PRD-001-O-010)';
COMMENT ON COLUMN geh.reglamentos.pdf_url   IS 'URL pública del PDF en Supabase Storage bucket geh-docs';
COMMENT ON COLUMN geh.reglamentos.pdf_path  IS 'Path interno del archivo dentro del bucket geh-docs';
COMMENT ON COLUMN geh.reglamentos.activo    IS 'Solo el registro activo = true se muestra en el portal';

-- ── 2. Tabla de centros de costos ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geh.centros_costo (
  id         BIGSERIAL   PRIMARY KEY,
  codigo     TEXT        NOT NULL UNIQUE,
  nombre     TEXT        NOT NULL,
  activo     BOOLEAN     NOT NULL DEFAULT TRUE,
  orden      SMALLINT    NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE geh.centros_costo IS 'Catálogo de centros de costos para el formulario de constancias';

-- ── 3. Tabla principal de constancias ────────────────────────────────────
CREATE TABLE IF NOT EXISTS geh.constancias_divulgacion (
  id                    BIGSERIAL   PRIMARY KEY,
  reglamento_id         BIGINT      NOT NULL REFERENCES geh.reglamentos(id) ON DELETE RESTRICT,
  nombre_completo       TEXT        NOT NULL,
  numero_identificacion TEXT        NOT NULL,
  cargo                 TEXT        NOT NULL,
  centro_costo_id       BIGINT      REFERENCES geh.centros_costo(id) ON DELETE SET NULL,
  centro_costo_texto    TEXT,
  firma_b64             TEXT        NOT NULL,
  firma_bytes           INTEGER     GENERATED ALWAYS AS (length(firma_b64)) STORED,
  ip_registro           TEXT,
  user_agent            TEXT,
  sesion_uid            UUID,
  email_sesion          TEXT,
  fecha_lectura_inicio  TIMESTAMPTZ,
  fecha_firma           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_geh_const_reglamento    ON geh.constancias_divulgacion (reglamento_id);
CREATE INDEX IF NOT EXISTS ix_geh_const_identificacion ON geh.constancias_divulgacion (numero_identificacion);
CREATE INDEX IF NOT EXISTS ix_geh_const_fecha         ON geh.constancias_divulgacion (fecha_firma);
CREATE INDEX IF NOT EXISTS ix_geh_const_sesion        ON geh.constancias_divulgacion (sesion_uid);
CREATE INDEX IF NOT EXISTS ix_geh_const_cc            ON geh.constancias_divulgacion (centro_costo_id);

COMMENT ON TABLE  geh.constancias_divulgacion                      IS 'Registro de constancias de lectura y divulgación del Reglamento Interno de Trabajo y otros documentos GEH';
COMMENT ON COLUMN geh.constancias_divulgacion.firma_b64            IS 'Firma digital capturada en canvas, formato data:image/png;base64';
COMMENT ON COLUMN geh.constancias_divulgacion.sesion_uid           IS 'UID de Supabase Auth si el colaborador estaba logueado (referencia informativa, no FK)';
COMMENT ON COLUMN geh.constancias_divulgacion.fecha_lectura_inicio IS 'Timestamp cuando el colaborador abrió el visor del PDF (trazabilidad de lectura)';
COMMENT ON COLUMN geh.constancias_divulgacion.ip_registro          IS 'IP del cliente al momento del registro (informativa, capturada desde cabeceras)';

-- ── 4. Triggers de updated_at ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION geh.fn_marcar_actualizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION geh.fn_marcar_actualizacion() IS 'Actualiza updated_at automáticamente en UPDATE — patrón estándar NexusKPI';

DROP TRIGGER IF EXISTS trg_geh_reglamentos_upd ON geh.reglamentos;
CREATE TRIGGER trg_geh_reglamentos_upd
  BEFORE UPDATE ON geh.reglamentos
  FOR EACH ROW EXECUTE FUNCTION geh.fn_marcar_actualizacion();

-- ── 5. RLS — Row Level Security ───────────────────────────────────────────
ALTER TABLE geh.reglamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY geh_reglamentos_lectura ON geh.reglamentos
  FOR SELECT TO anon, authenticated
  USING (activo = TRUE);

CREATE POLICY geh_reglamentos_admin ON geh.reglamentos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.accesos a
      WHERE a.perfil_id = (SELECT id FROM core.perfiles WHERE email = auth.email())
        AND a.aplicacion_codigo = 'GEH'
        AND a.rol = 'admin'
        AND a.activo = TRUE
    )
  );

ALTER TABLE geh.constancias_divulgacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY geh_const_insertar ON geh.constancias_divulgacion
  FOR INSERT TO anon, authenticated
  WITH CHECK (TRUE);

CREATE POLICY geh_const_leer ON geh.constancias_divulgacion
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.accesos a
      WHERE a.perfil_id = (SELECT id FROM core.perfiles WHERE email = auth.email())
        AND a.aplicacion_codigo = 'GEH'
        AND a.activo = TRUE
    )
  );

ALTER TABLE geh.centros_costo ENABLE ROW LEVEL SECURITY;

CREATE POLICY geh_cc_lectura ON geh.centros_costo
  FOR SELECT TO anon, authenticated
  USING (activo = TRUE);

-- ── 6. Grants de tablas ───────────────────────────────────────────────────
GRANT SELECT             ON geh.reglamentos             TO anon, authenticated;
GRANT SELECT             ON geh.centros_costo           TO anon, authenticated;
GRANT SELECT, INSERT     ON geh.constancias_divulgacion TO anon, authenticated;
GRANT USAGE, SELECT      ON ALL SEQUENCES IN SCHEMA geh TO anon, authenticated;

-- ── 7. Función RPC: fn_geh_resumen_constancias ────────────────────────────
CREATE OR REPLACE FUNCTION geh.fn_geh_resumen_constancias(p_reglamento_id BIGINT DEFAULT NULL)
RETURNS TABLE (
  reglamento_id     BIGINT,
  reglamento_nombre TEXT,
  total_constancias BIGINT,
  primera_firma     TIMESTAMPTZ,
  ultima_firma      TIMESTAMPTZ,
  centros           JSONB
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = geh, core, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.nombre,
    COUNT(c.id),
    MIN(c.fecha_firma),
    MAX(c.fecha_firma),
    jsonb_agg(DISTINCT jsonb_build_object(
      'centro', COALESCE(c.centro_costo_texto, '—'),
      'total', (
        SELECT COUNT(*) FROM geh.constancias_divulgacion c2
        WHERE c2.reglamento_id = r.id
          AND c2.centro_costo_texto = c.centro_costo_texto
      )
    ))
  FROM geh.reglamentos r
  LEFT JOIN geh.constancias_divulgacion c ON c.reglamento_id = r.id
  WHERE (p_reglamento_id IS NULL OR r.id = p_reglamento_id)
    AND r.activo = TRUE
  GROUP BY r.id, r.nombre;
END;
$$;

COMMENT ON FUNCTION geh.fn_geh_resumen_constancias IS 'Resumen de constancias por reglamento para panel RH — solo acceso GEH';

-- ── 8. Datos iniciales — Reglamento Interno de Trabajo ────────────────────
INSERT INTO geh.reglamentos (codigo, nombre, version, fecha_emision, fecha_aprobacion, proceso, elaborado_por, aprobado_por, activo)
VALUES (
  'PLA-PRD-001-O-010',
  'Reglamento Interno de Trabajo',
  '1',
  '2023-10-11',
  '2023-10-11',
  'Planeación',
  'Landia Yurley Mina Gómez',
  'Tulio Mario Castrillón',
  TRUE
)
ON CONFLICT (codigo, version) DO UPDATE
  SET nombre        = EXCLUDED.nombre,
      proceso       = EXCLUDED.proceso,
      elaborado_por = EXCLUDED.elaborado_por,
      aprobado_por  = EXCLUDED.aprobado_por,
      updated_at    = NOW();
-- ↑ updated_at OK aquí porque geh.reglamentos SÍ tiene esa columna

-- ── 9. Datos iniciales — Centros de costo ─────────────────────────────────
INSERT INTO geh.centros_costo (codigo, nombre, orden) VALUES
  ('CEDI',   'CEDI / Bodega',                    1),
  ('ADM',    'Administrativo',                   2),
  ('OPER',   'Operaciones',                      3),
  ('TRANS',  'Transporte',                       4),
  ('COMERC', 'Comercial',                        5),
  ('TI',     'Tecnología e Información',          6),
  ('GH',     'Gestión Humana',                   7),
  ('CONTAB', 'Contabilidad y Finanzas',           8),
  ('SST',    'Seguridad y Salud en el Trabajo',   9),
  ('OTRO',   'Otro',                             99)
ON CONFLICT (codigo) DO NOTHING;

-- ── 10. Registrar la aplicación GEH en core ───────────────────────────────
-- FIX #1: core.aplicaciones NO tiene columna updated_at → se elimina de UPDATE
-- FIX #2: core.aplicaciones tiene columna ruta NOT NULL → se agrega al INSERT

-- Desactivar tarjeta anterior (Inventario de Pasillos)
UPDATE core.aplicaciones
  SET activo = FALSE
  WHERE codigo IN ('INV_PASILLOS', 'PASILLOS', 'INV-PASILLOS')
    AND activo = TRUE;

-- Activar / insertar tarjeta Gestión Humana
INSERT INTO core.aplicaciones (codigo, nombre, descripcion, ruta, roles_validos, orden, activo)
VALUES (
  'GEH',
  'Gestión Humana',
  'Consulta reglamentos internos y registra constancias de divulgación',
  'geh.html',           -- ← ajusta si tu archivo tiene otra ruta (ej. 'geh/reglamento.html')
  ARRAY['viewer','admin'],
  6,
  TRUE
)
ON CONFLICT (codigo) DO UPDATE
  SET nombre        = EXCLUDED.nombre,
      descripcion   = EXCLUDED.descripcion,
      ruta          = EXCLUDED.ruta,
      roles_validos = EXCLUDED.roles_validos,
      activo        = TRUE;
-- ↑ updated_at eliminado: core.aplicaciones no tiene esa columna

-- ── FIN 021_schema_geh_reglamento.sql ─────────────────────────────────────
