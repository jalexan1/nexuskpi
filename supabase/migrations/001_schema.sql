-- ============================================================
-- 001_schema.sql — NexusKPI Platform · Supabase PostgreSQL
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── KPI-REC-001: Recepciones ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_recibo_recepciones (
  id                      BIGSERIAL PRIMARY KEY,
  mes_id                  TEXT NOT NULL,
  documento               TEXT NOT NULL,
  oc                      TEXT,
  fecha                   DATE,
  semana                  TEXT,
  proveedor               TEXT,
  familia                 TEXT,
  tipo                    TEXT CHECK (tipo IN ('PT','MP')),
  skus                    INTEGER DEFAULT 0,
  unidades                INTEGER DEFAULT 0,
  hora_cita               TEXT,
  hora_inicio             TEXT,
  hora_tt                 TEXT,
  tiempo_h                NUMERIC(6,2),
  sla_ok_12               BOOLEAN,
  is_cert                 BOOLEAN DEFAULT FALSE,
  is_inconsistente        BOOLEAN DEFAULT FALSE,
  causal_inconsistencia   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_mes_documento UNIQUE (mes_id, documento)
);

CREATE INDEX IF NOT EXISTS idx_rec_mes      ON kpi_recibo_recepciones (mes_id);
CREATE INDEX IF NOT EXISTS idx_rec_prov     ON kpi_recibo_recepciones (proveedor);
CREATE INDEX IF NOT EXISTS idx_rec_fecha    ON kpi_recibo_recepciones (fecha);
CREATE INDEX IF NOT EXISTS idx_rec_tipo     ON kpi_recibo_recepciones (tipo);
CREATE INDEX IF NOT EXISTS idx_rec_inc      ON kpi_recibo_recepciones (is_inconsistente);

-- ── Histórico (auditoría automática) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_recibo_historico (
  id                  BIGSERIAL PRIMARY KEY,
  recepcion_id        BIGINT REFERENCES kpi_recibo_recepciones(id),
  mes_id              TEXT NOT NULL,
  documento           TEXT NOT NULL,
  accion              TEXT CHECK (accion IN ('INSERT','UPDATE','DELETE')),
  datos_antes         JSONB,
  datos_despues       JSONB,
  campos_modificados  TEXT[],
  etl_run_id          TEXT,
  changed_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_doc   ON kpi_recibo_historico (documento);
CREATE INDEX IF NOT EXISTS idx_hist_mes   ON kpi_recibo_historico (mes_id);
CREATE INDEX IF NOT EXISTS idx_hist_fecha ON kpi_recibo_historico (changed_at);

-- ── Trigger de auditoría ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_audit_recibo()
RETURNS TRIGGER AS $$
DECLARE
  v_campos TEXT[] := '{}';
  v_key    TEXT;
  v_run_id TEXT;
BEGIN
  BEGIN v_run_id := current_setting('app.etl_run_id', true);
  EXCEPTION WHEN OTHERS THEN v_run_id := 'manual'; END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO kpi_recibo_historico(recepcion_id,mes_id,documento,accion,datos_antes,datos_despues,etl_run_id)
    VALUES(NEW.id,NEW.mes_id,NEW.documento,'INSERT',NULL,row_to_json(NEW)::jsonb,v_run_id);

  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_key IN
      SELECT key FROM jsonb_each(row_to_json(NEW)::jsonb) n
      WHERE n.value IS DISTINCT FROM (row_to_json(OLD)::jsonb)->key
        AND key NOT IN ('updated_at','created_at')
    LOOP v_campos := array_append(v_campos,v_key); END LOOP;
    IF array_length(v_campos,1) > 0 THEN
      INSERT INTO kpi_recibo_historico(recepcion_id,mes_id,documento,accion,datos_antes,datos_despues,campos_modificados,etl_run_id)
      VALUES(NEW.id,NEW.mes_id,NEW.documento,'UPDATE',row_to_json(OLD)::jsonb,row_to_json(NEW)::jsonb,v_campos,v_run_id);
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO kpi_recibo_historico(recepcion_id,mes_id,documento,accion,datos_antes,datos_despues,etl_run_id)
    VALUES(OLD.id,OLD.mes_id,OLD.documento,'DELETE',row_to_json(OLD)::jsonb,NULL,v_run_id);
  END IF;

  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_recibo ON kpi_recibo_recepciones;
CREATE TRIGGER trg_audit_recibo
  AFTER INSERT OR UPDATE OR DELETE ON kpi_recibo_recepciones
  FOR EACH ROW EXECUTE FUNCTION fn_audit_recibo();

-- ── Resumen mensual ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_recibo_resumen (
  id           BIGSERIAL PRIMARY KEY,
  mes_id       TEXT NOT NULL UNIQUE,
  label        TEXT,
  total_oc     INTEGER DEFAULT 0,
  ok_12h       INTEGER DEFAULT 0,
  late_12h     INTEGER DEFAULT 0,
  trt_12h      NUMERIC(5,1),
  avg_h        NUMERIC(6,2),
  max_h        NUMERIC(6,2),
  cert_count   INTEGER DEFAULT 0,
  pt_total     INTEGER DEFAULT 0,
  mp_total     INTEGER DEFAULT 0,
  pt_ok_12h    INTEGER DEFAULT 0,
  mp_ok_12h    INTEGER DEFAULT 0,
  last_etl_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── ETL Log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS etl_log (
  id                  BIGSERIAL PRIMARY KEY,
  run_id              TEXT NOT NULL UNIQUE,
  mes_id              TEXT,
  archivo             TEXT,
  estado              TEXT CHECK (estado IN ('iniciado','completado','error')),
  docs_procesados     INTEGER DEFAULT 0,
  docs_insertados     INTEGER DEFAULT 0,
  docs_actualizados   INTEGER DEFAULT 0,
  docs_excluidos      INTEGER DEFAULT 0,
  error_msg           TEXT,
  iniciado_at         TIMESTAMPTZ DEFAULT NOW(),
  completado_at       TIMESTAMPTZ
);

-- ── Tabla de usuarios de la plataforma ───────────────────────────────────
-- Complementa Supabase Auth. Guarda metadatos de perfil.
CREATE TABLE IF NOT EXISTS kpi_usuarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  nombre      TEXT,
  rol         TEXT NOT NULL DEFAULT 'viewer' CHECK (rol IN ('admin','viewer')),
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── WMS Base (futuro KPI-INV-002) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wms_base (
  id                  BIGSERIAL PRIMARY KEY,
  corte_fecha         DATE NOT NULL,
  codigo              TEXT,
  descripcion         TEXT,
  ubicacion           TEXT,
  cantidad_sistema    INTEGER DEFAULT 0,
  cantidad_fisica     INTEGER DEFAULT 0,
  diferencia          INTEGER GENERATED ALWAYS AS (cantidad_fisica - cantidad_sistema) STORED,
  lote                TEXT,
  fecha_vencimiento   DATE,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_wms_corte_codigo UNIQUE (corte_fecha, codigo)
);

-- ── RLS (Row Level Security) ──────────────────────────────────────────────
ALTER TABLE kpi_recibo_recepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_recibo_resumen     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_recibo_historico   ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_base               ENABLE ROW LEVEL SECURITY;

-- Lectura pública: recepciones y resumen (dashboard)
DROP POLICY IF EXISTS "pub_read_recepciones" ON kpi_recibo_recepciones;
CREATE POLICY "pub_read_recepciones" ON kpi_recibo_recepciones FOR SELECT USING (true);

DROP POLICY IF EXISTS "pub_read_resumen" ON kpi_recibo_resumen;
CREATE POLICY "pub_read_resumen" ON kpi_recibo_resumen FOR SELECT USING (true);

-- Escritura: solo usuarios autenticados
DROP POLICY IF EXISTS "auth_write_recepciones" ON kpi_recibo_recepciones;
CREATE POLICY "auth_write_recepciones" ON kpi_recibo_recepciones
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_update_recepciones" ON kpi_recibo_recepciones;
CREATE POLICY "auth_update_recepciones" ON kpi_recibo_recepciones
  FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));

DROP POLICY IF EXISTS "auth_write_resumen" ON kpi_recibo_resumen;
CREATE POLICY "auth_write_resumen" ON kpi_recibo_resumen
  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

-- Historico y log: solo service_role
DROP POLICY IF EXISTS "srv_historico" ON kpi_recibo_historico;
CREATE POLICY "srv_historico" ON kpi_recibo_historico
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "srv_log" ON etl_log;
CREATE POLICY "srv_log" ON etl_log
  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

-- Usuarios: autenticados pueden leer y escribir
DROP POLICY IF EXISTS "auth_usuarios" ON kpi_usuarios;
CREATE POLICY "auth_usuarios" ON kpi_usuarios
  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

-- WMS: autenticados
DROP POLICY IF EXISTS "auth_wms" ON wms_base;
CREATE POLICY "auth_wms" ON wms_base
  FOR ALL USING (auth.role() IN ('authenticated','service_role'));

-- ── Verificación ──────────────────────────────────────────────────────────
SELECT 'kpi_recibo_recepciones' AS tabla, COUNT(*) FROM kpi_recibo_recepciones
UNION ALL SELECT 'kpi_recibo_historico',  COUNT(*) FROM kpi_recibo_historico
UNION ALL SELECT 'kpi_recibo_resumen',    COUNT(*) FROM kpi_recibo_resumen
UNION ALL SELECT 'etl_log',               COUNT(*) FROM etl_log
UNION ALL SELECT 'kpi_usuarios',          COUNT(*) FROM kpi_usuarios
UNION ALL SELECT 'wms_base',              COUNT(*) FROM wms_base;
