-- ============================================================
-- 016_recuperar_kpi_inventario.sql — NexusKPI · KPI-INV-002
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- Las tablas kpi_inventario_conteos y kpi_inventario_detalle las usan
-- kpi002.html, cargue_inv002.html, etl_inv002.js y el Consolidado
-- Gerencial desde hace meses, pero NINGUNA migración versionada en este
-- proyecto las crea — no están en 001_schema.sql ni en ninguna de las
-- 002-015. Solo aparecen nombradas en extraer_estructura_bd.sql, que es
-- un script de SOLO LECTURA para diagnóstico, no de creación.
-- Eso significa que en algún momento se crearon a mano directo en el
-- SQL Editor de Supabase, sin quedar registradas en el repo. Mientras la
-- tabla siga existiendo tal cual se creó, todo sigue andando — pero es
-- un punto ciego: si le faltó una política RLS, si nunca se le activó
-- RLS, o si algún día se recrea la base de datos desde las migraciones
-- versionadas, KPI-INV-002 se queda huérfano silenciosamente.
--
-- QUÉ HACE ESTE SCRIPT
-- Usa CREATE TABLE IF NOT EXISTS: si las tablas YA existen con tus
-- datos, esta migración NO las toca ni borra nada — solo se asegura de
-- que existan las políticas RLS correctas (con DROP POLICY IF EXISTS +
-- CREATE POLICY, igual que en 001_schema.sql). Si por cualquier motivo
-- ya no existían, las vuelve a crear vacías con la estructura exacta
-- que ya usa el código (mismas columnas que etl_inv002.js escribe y
-- que kpi002.html / consolidado_gerencial.html leen).
-- ============================================================

-- ── KPI-INV-002: Conteos (resumen por conteo físico) ──────────────────────
CREATE TABLE IF NOT EXISTS kpi_inventario_conteos (
  id                BIGSERIAL PRIMARY KEY,
  periodo_id        TEXT NOT NULL,
  id_conteo         INTEGER NOT NULL,
  fecha_conteo      DATE,
  semana            TEXT,
  bodega            TEXT,
  total_skus        INTEGER DEFAULT 0,
  skus_exactos      INTEGER DEFAULT 0,
  skus_diferencia   INTEGER DEFAULT 0,
  ei_pct            NUMERIC(5,2),
  operario          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_inv_conteos_periodo_id UNIQUE (periodo_id, id_conteo)
);

CREATE INDEX IF NOT EXISTS idx_inv_conteos_periodo ON kpi_inventario_conteos (periodo_id);

-- ── KPI-INV-002: Detalle (una fila = referencia × ubicación) ──────────────
CREATE TABLE IF NOT EXISTS kpi_inventario_detalle (
  id             BIGSERIAL PRIMARY KEY,
  periodo_id     TEXT NOT NULL,
  id_conteo      INTEGER NOT NULL,
  ean            TEXT,
  referencia     TEXT,
  descripcion    TEXT,
  ubicacion      TEXT,
  familia        TEXT,
  tipo           TEXT CHECK (tipo IN ('PT','MP')),
  qty_wms        NUMERIC(12,2) DEFAULT 0,
  qty_fisica     NUMERIC(12,2) DEFAULT 0,
  es_exacto      BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_detalle_periodo    ON kpi_inventario_detalle (periodo_id);
CREATE INDEX IF NOT EXISTS idx_inv_detalle_id_conteo   ON kpi_inventario_detalle (id_conteo);
CREATE INDEX IF NOT EXISTS idx_inv_detalle_referencia  ON kpi_inventario_detalle (referencia);
CREATE INDEX IF NOT EXISTS idx_inv_detalle_es_exacto   ON kpi_inventario_detalle (es_exacto);

-- ── RLS — mismo patrón que el resto del proyecto (001_schema.sql) ─────────
ALTER TABLE kpi_inventario_conteos ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_inventario_detalle ENABLE ROW LEVEL SECURITY;

-- Lectura pública (dashboard, consolidado — usan la anon key sin sesión)
DROP POLICY IF EXISTS "pub_read_inv_conteos" ON kpi_inventario_conteos;
CREATE POLICY "pub_read_inv_conteos" ON kpi_inventario_conteos FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_inv_detalle" ON kpi_inventario_detalle;
CREATE POLICY "pub_read_inv_detalle" ON kpi_inventario_detalle FOR SELECT USING (true);

-- Escritura solo para usuarios autenticados (cargue_inv002.html exige rol admin)
DROP POLICY IF EXISTS "auth_write_inv_conteos" ON kpi_inventario_conteos;
CREATE POLICY "auth_write_inv_conteos" ON kpi_inventario_conteos
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_update_inv_conteos" ON kpi_inventario_conteos;
CREATE POLICY "auth_update_inv_conteos" ON kpi_inventario_conteos
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_delete_inv_conteos" ON kpi_inventario_conteos;
CREATE POLICY "auth_delete_inv_conteos" ON kpi_inventario_conteos
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_inv_detalle" ON kpi_inventario_detalle;
CREATE POLICY "auth_write_inv_detalle" ON kpi_inventario_detalle
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_update_inv_detalle" ON kpi_inventario_detalle;
CREATE POLICY "auth_update_inv_detalle" ON kpi_inventario_detalle
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_delete_inv_detalle" ON kpi_inventario_detalle;
CREATE POLICY "auth_delete_inv_detalle" ON kpi_inventario_detalle
  FOR DELETE USING (auth.role() IN ('authenticated','service_role'));

NOTIFY pgrst, 'reload schema';

-- ── Verificación ────────────────────────────────────────────────────────
-- Corre esto después y pégame el resultado si algo sigue sin cargar:
SELECT 'kpi_inventario_conteos' AS tabla, COUNT(*) AS filas FROM kpi_inventario_conteos
UNION ALL
SELECT 'kpi_inventario_detalle', COUNT(*) FROM kpi_inventario_detalle;
