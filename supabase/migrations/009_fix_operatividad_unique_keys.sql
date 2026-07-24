-- ============================================================
-- 009_fix_operatividad_unique_keys.sql — NexusKPI · Fase 2 · Operatividad
-- Corrige el error 409 (23505 duplicate key) reportado al cargar
-- SEGUIMIENTO CLICK MAR 2026.xlsx y WMS_BASE.
--
-- Causa raíz (2 problemas combinados):
-- 1) Las llaves naturales originales (periodo_id + columnas de negocio)
--    no son únicas dentro del propio archivo Excel: es normal que la
--    misma referencia/comprobante/ubicación aparezca varias veces el
--    mismo día (líneas de recibo parciales, varios lotes, varias cajas
--    en la misma ubicación, etc.). Se agrega una columna "secuencia"
--    (1,2,3...) calculada por el ETL para diferenciar esas filas.
-- 2) Las páginas de cargue llamaban a Supabase con
--    Prefer: resolution=merge-duplicates pero SIN el parámetro
--    ?on_conflict=..., por lo que PostgREST no sabía contra qué
--    columnas resolver el conflicto y terminaba lanzando el error de
--    duplicado plano en vez de actualizar (upsert). Ese fix va en las
--    páginas op_cargue_seguimiento.html / op_cargue_wms.html (no en SQL).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── op_recibo ──────────────────────────────────────────────────────────
ALTER TABLE op_recibo ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_recibo DROP CONSTRAINT IF EXISTS uq_op_recibo;
ALTER TABLE op_recibo ADD CONSTRAINT uq_op_recibo
  UNIQUE (periodo_id, documento, referencia, fecha_recibo, secuencia);

-- ── op_alistamiento ────────────────────────────────────────────────────
ALTER TABLE op_alistamiento ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_alistamiento DROP CONSTRAINT IF EXISTS uq_op_alistamiento;
ALTER TABLE op_alistamiento ADD CONSTRAINT uq_op_alistamiento
  UNIQUE (periodo_id, comprobante, sku, dia, secuencia);

-- ── op_picking_wms ─────────────────────────────────────────────────────
ALTER TABLE op_picking_wms ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_picking_wms DROP CONSTRAINT IF EXISTS uq_op_picking_wms;
ALTER TABLE op_picking_wms ADD CONSTRAINT uq_op_picking_wms
  UNIQUE (periodo_id, pedido_wms, linea_de_picking, id_caja, secuencia);

-- ── op_inventario_ubicacion ────────────────────────────────────────────
ALTER TABLE op_inventario_ubicacion ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_inventario_ubicacion DROP CONSTRAINT IF EXISTS uq_op_inv_ubicacion;
ALTER TABLE op_inventario_ubicacion ADD CONSTRAINT uq_op_inv_ubicacion
  UNIQUE (periodo_id, ean, ubicacion, caja, secuencia);

-- ── op_densidad_ubicacion ──────────────────────────────────────────────
ALTER TABLE op_densidad_ubicacion ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_densidad_ubicacion DROP CONSTRAINT IF EXISTS uq_op_densidad;
ALTER TABLE op_densidad_ubicacion ADD CONSTRAINT uq_op_densidad
  UNIQUE (periodo_id, ubicacion, secuencia);

-- ── op_productividad_pk ────────────────────────────────────────────────
ALTER TABLE op_productividad_pk ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_productividad_pk DROP CONSTRAINT IF EXISTS uq_op_prod_pk;
ALTER TABLE op_productividad_pk ADD CONSTRAINT uq_op_prod_pk
  UNIQUE (periodo_id, pedido_wms, linea_de_picking, id_caja, secuencia);

-- ── op_recogidas_pk_rango ──────────────────────────────────────────────
ALTER TABLE op_recogidas_pk_rango ADD COLUMN IF NOT EXISTS secuencia INTEGER NOT NULL DEFAULT 1;
ALTER TABLE op_recogidas_pk_rango DROP CONSTRAINT IF EXISTS uq_op_recogidas;
ALTER TABLE op_recogidas_pk_rango ADD CONSTRAINT uq_op_recogidas
  UNIQUE (periodo_id, pedido_wms, linea_de_picking, secuencia);

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';

-- ── Verificación ──────────────────────────────────────────────────────────
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'secuencia'
  AND table_name IN ('op_recibo','op_alistamiento','op_picking_wms',
                      'op_inventario_ubicacion','op_densidad_ubicacion',
                      'op_productividad_pk','op_recogidas_pk_rango')
ORDER BY table_name;
