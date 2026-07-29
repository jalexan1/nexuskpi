-- 010_add_status_parcial_alistamiento.sql
-- NexusKPI · Fase 2 · Operatividad
-- Agrega dos columnas aditivas a op_alistamiento para soportar el KPI "Nivel de Servicio"
-- en la pantalla Picking: STATUS (logístico: DESPACHADO/ENTREGADO/DEVOLUCION/EN REPARTO/
-- DEV TIEMPO) y PARCIAL ? (OK/PARCIAL, indicador confiable de cumplimiento de la línea).
-- No modifica ni elimina ninguna columna existente. No toca ninguna tabla de Fase 1.

ALTER TABLE op_alistamiento ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE op_alistamiento ADD COLUMN IF NOT EXISTS parcial TEXT;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'op_alistamiento' AND column_name IN ('status','parcial');
