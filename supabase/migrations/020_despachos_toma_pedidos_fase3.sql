-- =============================================================================
-- 020_despachos_toma_pedidos_fase3.sql
-- Plataforma L&S · Portal de Despachos · Toma de pedidos fase 3 (19-oct-2026)
--
-- QUÉ HACE
--  1. Maestro de destinatarios: agrega DIRECCIÓN, DEPARTAMENTO y TELÉFONO
--     (quedan vacíos hasta que se carguen; el portal los usa si existen).
--  2. Crea el maestro core.item_ean (Item / EAN / Descripción) y lo carga con
--     la hoja "MAESTRO ACTUAL" de DESPACHOS.xlsx (257 ítems).
--  3. Líneas de solicitud: guardan EAN, dirección, departamento y teléfono
--     del destinatario (foto del dato al radicar, igual que NIT y nombre).
--  4. fn_crear_solicitud: recibe esos campos y, si llegan vacíos, los
--     completa con los maestros (EAN por SKU; dirección/depto/teléfono por NIT).
--  5. Vista despachos.vw_solicitud_lineas: una fila por línea con todos los
--     campos de la plantilla (tabla "Solicitudes de hoy" y descargas).
--
-- CÓMO EJECUTAR
--  Supabase → proyecto kpi-logistics → SQL Editor → pegar TODO → Run.
--  Es idempotente (se puede ejecutar más de una vez).
--  EJECUTAR ANTES de publicar la nueva versión del portal.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Maestro de destinatarios: campos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS direccion    text;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS departamento text;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS telefono     text;
COMMENT ON COLUMN core.destinatarios.direccion    IS 'Dirección de entrega del destinatario (pendiente de cargar)';
COMMENT ON COLUMN core.destinatarios.departamento IS 'Departamento del destinatario (pendiente de cargar)';
COMMENT ON COLUMN core.destinatarios.telefono     IS 'Teléfono de contacto del destinatario';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Maestro Item / EAN
-- ─────────────────────────────────────────────────────────────────────────────
-- SKU base: quita espacios y el sufijo de año que traen los PDF de Click
--   'PTC7300-2025' → 'PTC7300' · 'PTC8200 - 2026' → 'PTC8200' · 'MP0205-1' → 'MP0205-1'
CREATE OR REPLACE FUNCTION core.fn_sku_base(p_sku text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(regexp_replace(upper(regexp_replace(COALESCE(p_sku, ''), '\s+', '', 'g')), '-(19|20)[0-9]{2}$', ''), '')
$$;
COMMENT ON FUNCTION core.fn_sku_base(text) IS 'Normaliza el SKU del PDF al código del maestro Item/EAN (sin espacios ni sufijo -AAAA)';

CREATE TABLE IF NOT EXISTS core.item_ean (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  cuenta_id    bigint,
  item         text        NOT NULL,
  ean          text        NOT NULL,
  descripcion  text,
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid                 DEFAULT auth.uid(),
  updated_at   timestamptz,
  updated_by   uuid,
  version      integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_item_ean PRIMARY KEY (id),
  CONSTRAINT fk_item_ean_cuentas FOREIGN KEY (cuenta_id) REFERENCES core.cuentas (id),
  CONSTRAINT uq_item_ean_cuenta_item UNIQUE NULLS NOT DISTINCT (cuenta_id, item),
  CONSTRAINT ck_item_ean_item_mayus CHECK (item = upper(trim(item)) AND item <> ''),
  CONSTRAINT ck_item_ean_ean CHECK (trim(ean) <> '')
);
CREATE INDEX IF NOT EXISTS ix_item_ean_ean         ON core.item_ean (ean);
CREATE INDEX IF NOT EXISTS ix_item_ean_descripcion ON core.item_ean (lower(descripcion));
COMMENT ON TABLE  core.item_ean             IS 'Maestro Item / EAN: código de barras de cada SKU (fuente: hoja MAESTRO ACTUAL de DESPACHOS.xlsx)';
COMMENT ON COLUMN core.item_ean.item        IS 'Código del ítem / SKU base (ej. PTC7300). El PDF puede traerlo con sufijo de año (PTC7300-2025)';
COMMENT ON COLUMN core.item_ean.ean         IS 'Código EAN (código de barras) que se envía al WMS';
COMMENT ON COLUMN core.item_ean.descripcion IS 'Descripción del producto';

DROP TRIGGER IF EXISTS trg_item_ean_actualizacion ON core.item_ean;
CREATE TRIGGER trg_item_ean_actualizacion BEFORE UPDATE ON core.item_ean
  FOR EACH ROW EXECUTE FUNCTION core.fn_marcar_actualizacion();
DROP TRIGGER IF EXISTS trg_item_ean_auditoria ON core.item_ean;
CREATE TRIGGER trg_item_ean_auditoria AFTER INSERT OR UPDATE OR DELETE ON core.item_ean
  FOR EACH ROW EXECUTE FUNCTION core.fn_auditar();

-- Carga inicial (MAESTRO ACTUAL). Si el ítem ya existe, actualiza EAN y descripción.
INSERT INTO core.item_ean (item, ean, descripcion) VALUES
  ('11000101', '77011000101', 'COUNTER MUEBLE STAND'),
  ('1111000111', '7701111000111', 'EXHIBIDOR TORRE'),
  ('1313000113', '7701313000113', 'DUMMIE PERFUME'),
  ('1414000114', '7701414000114', 'DUMMIE MIEL'),
  ('1515000115', '7701515000115', 'CAJONERA CON 2 ALAS'),
  ('1616000116', '7701616000116', '1 PISO CAUCHO'),
  ('1717000117', '7701717000117', 'HABLADOR EN METAL'),
  ('1818000118', '7701818000118', 'AVISO LUMINOSO'),
  ('1919000119', '7701919000119', 'NEVERA'),
  ('2020000120', '7702020000120', 'ESTANTERIA ALTA'),
  ('2121000121', '7702121000121', 'RULETA BRANDEADA'),
  ('2222000122', '7702222000122', 'ESPEJO TOCADOR'),
  ('2323000123', '7702323000123', 'LAMPARA ESCRITORIO'),
  ('2424000124', '7702424000124', 'CILINDORS METAL EXHIBIDORES GRANDE'),
  ('2525000125', '7702525000125', 'CILINDORS METAL EXHIBIDORES MEDIANO'),
  ('2626000126', '7702626000126', 'CILINDORS METAL EXHIBIDORES PEQUEÑO'),
  ('2828000128', '7702828000128', 'STAND EVA'),
  ('2929000129', '7702929000129', 'POP BLACKDAYS'),
  ('3030000130', '7703030000130', 'POLI SOMBRA'),
  ('33000103', '77033000103', 'ESTRUCTURA PISO SILLA ACOLCHADA'),
  ('3434000134', '7703434000134', 'MUEBLE REDONDO CON CAJONERA'),
  ('3434000135', '7703434000135', 'DUMMI PERFUME DE MIEL (2 PIEZAS)'),
  ('3434000136', '7703434000136', 'ESTRUCTURA SUPERIOR MAQUINA VENDIG INSSA'),
  ('3434000137', '7703434000137', 'STAN SPO BELLEZA'),
  ('3434000138', '3434000138', 'BOLSA ROSADA GRANDE MARKETING'),
  ('3434000139', '3434000139', 'CONCHA CLICK'),
  ('3434000140', '3434000140', 'MUEBLE VENTAS'),
  ('3434000141', '7703434000141', 'GLORIFICADOR PIEZA 1'),
  ('3434000142', '7703434000142', 'GLORIFICADOR PIEZA 2'),
  ('3434000143', '7703434000143', 'VITRINA NEVERA'),
  ('3434000144', '7703434000144', 'BODEGA GLORIFICADOR'),
  ('3434000145', '7703434000145', 'COUNTER CIRCULAR'),
  ('3434000146', '7703434000146', 'DUMMY VASO CON BASE'),
  ('3434000148', '7703434000148', 'BASE PARA AVISOS'),
  ('3434000149', '7703434000149', 'DINTELES CHORRIADOS'),
  ('3434000150', '7703434000150', 'CABEZOTES PARA VITRINAS'),
  ('3434000151', '7703434000151', 'AVISOS GRANDES'),
  ('3434000152', '7703434000152', 'REFUERZO TUBO 2" REDONDO'),
  ('44000104', '77044000104', 'VITRINA/BODEGA HAIR STAND'),
  ('66000106', '77066000106', 'VITRINA/BODEGA BODY STAND'),
  ('77000107', '77077000107', 'EXIBIDOR BLANCO'),
  ('88000108', '77088000108', 'RULETA STAND'),
  ('99000109', '77099000109', 'PUFF STAND'),
  ('MK9311', '770MK9311', 'CAMISETAS FERIA MARKETING'),
  ('MKT05', '770MKT05', 'UNIFORMES LECHERO MUJER'),
  ('MKT058', '770MKT058', 'UNIFORMES LECHERO'),
  ('MKT059', '770MKT059', 'UNIFORMES APIARIO'),
  ('MKT060', '770MKT060', 'GORRAS LECHERO 1'),
  ('MKT061', '770MKT061', 'GORRAS LECHERO 2'),
  ('MP0100', '770MP0100', 'FOIL AUTOADHESIVO (SH + ENERG + ACOND)'),
  ('MP0203', '770MP0203', 'ENVASE CILINDRICO 20ML DE 5.3 GR'),
  ('MP0204', '770MP0204', 'ENVASE PERFUME CAPILAR 120 ML'),
  ('MP0205', '770MP0205', 'ENVASE CILINDRICO Y TAPA 250 ML (SH + ENERG)'),
  ('MP0205-0', '770MP0205-0', 'ENVASE CILINDRICO 250 ML (SH + ENERG)'),
  ('MP0205-1', '770MP0205-1', 'TAPA ENVASE CILINDRICO Y TAPA 250 ML (SH + ENERG)'),
  ('MP0301', '770MP0301', 'VALVULA 18/415 NATURAL LISA'),
  ('MP0302', '770MP0302', 'MINI GATILLO PERFUME CAPILAR'),
  ('MP0400', '770MP0400', 'ETQ PERFUME PARA EL CABELLO MINI 20ML'),
  ('MP0401', '770MP0401', 'ETIQUETA SELLO AGITE ANTES DE USAR'),
  ('MP0403', '770MP0403', 'ETQ PERFUEM PARA EL CABELLO 120 ML'),
  ('MP0501', '770MP0501', 'BANDA PVC35 MIC TRNASP ABIERTA GRAFILADA 165MM X90 MM MANTEQUILLA CORPOPRAL'),
  ('MP0602', '770MP0602', 'CAJA EMBALAJE MINI'),
  ('MP0603', '770MP0603', 'CAJA EMBALAJE PEQUEÑA'),
  ('MP0604', '770MP0604', 'CAJA EMBALAJE MEDIANA'),
  ('MP0605', '770MP0605', 'CAJA EMBALAJE GRANDE'),
  ('MP0608', '770MP0608', 'CAJA KIT PERFUME X3 MIX'),
  ('MP0610', '770MP0610', 'CINTA PARA EMBALAJE'),
  ('MP1101', '770MP1101', 'ETQ ACONDICIONADOR 4EN 1-ET14641V00'),
  ('MP1103', '770MP1103', 'ENVASE ACONDICIONADOR 300 ML CON TAPA FLIP TOP'),
  ('MP1105', '770MP1105-1', 'TERMOENCOGIBLE ACONDICIONADOR 300ML'),
  ('MP1702', '770MP1702', 'ETQ ENERGIZANTE 300ML'),
  ('MP2103', '770MP2103', 'ENVASE EXFOLIANTE SIN ETIQUETA'),
  ('MP2104', '770MP2104', 'ENVASE EXFOLIANTE CON ETIQUETA'),
  ('MP2402', '770MP2402', 'CAJA CLICK GUM 240 MG'),
  ('MP2403', '770MP2403', 'ETIQUETA ENVASE GUMMIES CABELLO'),
  ('MP2601', '770MP2601', 'CREMERA -GATILLO JABON CREMOSO'),
  ('MP2701', '770MP2701', 'ENVASE MANTEQUILLA CORPORAL 250G'),
  ('MP2702', '770MP2702', 'ETIQUETA RESPALDO MANTEQUILLA CORPORL 250ML ET-14853V00'),
  ('MP2703', '770MP2703', 'ETIQUETA FRENTE MANTEQUILLA CORPORL 250ML ET-14852 V00'),
  ('MP2802', '770MP2802', 'TAPA MIEL CAPILAR 50 ML'),
  ('MP2803', '770MP2803', 'ETIQUETA MIEL PARA EL CABELLO 50 ML RESPALDO'),
  ('MP2804', '770MP2804', 'ETIQUETA MIEL PARA EL CABELLO 50 ML FRENTE'),
  ('MP2807', '770MP2807', 'TERMOENCOGIBLE MIEL CAPILAR 50ML'),
  ('MP4002', '770MP4002', 'CONTRA ETQ PERFUME PARA EL CABELLO AMARILLO'),
  ('MP4102', '770MP4102', 'ETQ DORSO PERFUME AZUL 120ML'),
  ('MP4202', '770MP4202', 'ETQ DORSO PERFUME MORADO 120ML'),
  ('MP4803', '770MP4803', 'ETIQUETA SHAMPOO DE AJI 300 ML'),
  ('MP4806', '770MP4806', 'ETIQUETA SHAMPOO MIEL X 300ML (ENVOLVENTE)'),
  ('MP4808', '770MP4808', 'ENVASE SHAMPOO MIEL X 300ML'),
  ('MP4809', '770MP4809', 'TAPA SHAMPOO MIEL'),
  ('MP5401', '770MP5401', 'ENVASE JABON CREMOSO 250 ML'),
  ('MP5403', '770MP5403', 'ETIQUETA SPRAY DE ONDAS'),
  ('MP5601', '770MP5601', 'ENVASE SUERO RECONSTRUCTOR CON TAPA FLIP TOP 120 ML (SIN IMPRESIÓN)'),
  ('MP5602', '770MP5602', 'ETIQUETA SUERO RECONSTRUCTOR 120 ML'),
  ('MP5702', '770MP5702', 'TERMOENCOGIBLE SUERO RECONSTRUCTOR 120ML'),
  ('MP5801', '770MP5801', 'ENVASE PET BALA TONICO 120ML'),
  ('MP5802', '770MP5802', 'ETIQUETA TONICO CAPILAR 120ML ET14759V00'),
  ('MP5902', '770MP5902', 'ETIQUETA TONICO 60 ML'),
  ('MP5905', '770MP5905', 'BANDA PVC 35MIC TRANSP SELLO CURVO CONICO B TONICO CAPILAR 120ML 75MM X170 MM'),
  ('MP5906', '770MP5906', 'ENVASE BALA ROSADO 60ML'),
  ('MP5907', '770MP5907', 'SPRAY ROSA TONICO'),
  ('MP5908', '770MP5908', 'ANILLO PERFUME CAPILAR DE MIEL 100 ML (NACIONAL)'),
  ('MP5909', '770MP5909', 'SPRAY PERFUME MIEL CAPILAR 100 ML (NACIONAL)'),
  ('MP5911', '770MP5911', 'ETIQUETA TÓNICO DE AJI 60 ML'),
  ('MP7403', '770MP7403', 'ETIQUETA MASCARILLA MIEL X300ML'),
  ('MP7404', '770MP7404', 'CAJA MASCARILLA MIEL X 300ML'),
  ('MP7406', '770MP7406', 'ESPATULA ROSADA MASCARILLA'),
  ('MP7407', '770MP7407', 'LINER MASCARILLA DE MIEL X 300 ML'),
  ('MP7409', '770MP7409', 'TAPA MASCARILLA MIEL X300ML'),
  ('MP8101', '770MP8101', 'TERMOENCOGIBLE PERFUME MINI 40 ML'),
  ('MP8204', '770MP8204', 'CAJA PERFUME MIEL 100 ML'),
  ('MP8208', '770MP8208', 'ANILLO PERFUME CAPILAR DE MIEL BRILLO INTENSO 100ML'),
  ('MP8210', '770MP8210', 'TAPA PERFUME MIEL 100ML'),
  ('MP8302', '770MP8302', 'ENVASE DE MIEL CAPILAR 15ML'),
  ('MP8304', '770MP8304', 'ETIQUETA MIEL CAPILAR 15 ML'),
  ('MP8306', '770MP8306', 'TERMOENCOGIBLE MIEL CAPILAR 15 ML'),
  ('MP8802', '770MP8802', 'ENVASE ACONDICIONADOR MIEL 300ML'),
  ('MP8802-1', '770MP8802-1', 'TAPA ENVASE ACONDICIONADOR MIEL 300ML'),
  ('MP9002', '770MP9002', 'ENVASE PERFUME PRINCESA ROSADO 100 ML'),
  ('MP9006', '770MP9006', 'TAPA PERFUME PRINCESA ROSADO 100ML'),
  ('MP9007', '770MP9007', 'VALVULA PERFUME PRINCESA ROSADO 100ML'),
  ('MP9105', '770MP9105', 'TERMOENCOGIBLE PERFUME PRINCESA 100ML'),
  ('MP9107', '770MP9107', 'ENVASE PERFUME CORPORAL Y CAPILAR 100 ML'),
  ('MP9110', '770MP9110', 'TAPA PERFUME PLACE GARDEN( ROSA) 100ML'),
  ('MP9112', '770MP9112', 'SPRAY NEGRO PERFUME CORPORAL Y CAPILAR PALACE GARDEN 100 ML'),
  ('MP9113', '770MP9113', 'ENVASE PERFUME CORPORAL Y CAPILAR PALACE GARDEN 100 ML'),
  ('MP9115', '770MP9115', 'TAPA PERFUME MERMAID KISS (VERDE) 100ML'),
  ('MP9117', '770MP9117', 'ANILLO NEGRO PERFUME CORPORAL Y CAPILAR MERMAID KISS 100 ML'),
  ('MP9118', '770MP9118', 'SPRAY NEGRO PERFUME CORPORAL Y CAPILAR MERMAID KISS 100 ML'),
  ('MP9119', '770MP9119', 'CAJA PERFUME CAPILAR MASMELO 100ML'),
  ('MP9120', '770MP9120', 'TAPA PERFUME CAPILAR DE MASMELO 100ML'),
  ('MP9121', '770MP9121', 'ENVASE IMPRESO PERFUME CAPILAR DE MASMELO 100ML'),
  ('MP9122', '770MP9122', 'ENVASE PERFUME CORPORAL Y CAPILAR MERMAID KISS 100ML'),
  ('MP9124', '770MP9124', 'CAJA PERFUME CAPILAR PISTACHO 100ML'),
  ('MP9125', '770MP9125', 'TAPA PERFUME CAPILAR DE PISTACHO 100ML'),
  ('MP9126', '770MP9126', 'ENVASE IMPRESO PERFUME CAPILAR DE PISTACHO 100ML'),
  ('MP9133', '770MP9133', 'TAPA PERFUME CAPILAR SEDUCTION FLOWER 100 ML'),
  ('MP9134', '770MP9134', 'SPRAY PERFUME CAPILAR CANDY TOY 100ML'),
  ('MP9135', '770MP9135', 'TAPA PERFUME CAPILAR CANDY TOY 100 ML'),
  ('MP9137', '770MP9137', 'TAPA PERFUME CAPILAR TROPICAL CRUSH 100 ML'),
  ('MP9138', '770MP9138', 'SPRAY PERFUME CAPILAR MOCCA 100 ML'),
  ('MP9139', '770MP9139', 'TAPA PERFUME CAPILAR MOCCA 100 ML'),
  ('MP9140', '770MP9140', 'SPRAY PERFUME CAPILAR VAINILLA GLASEADA 100 ML'),
  ('MP9141', '770MP9141', 'TAPA PERFUME CAPILAR VAINILLA GLASEADA 100 ML'),
  ('MP9143', '770MP9143', 'TAPA PERFUME CAPILAR GOLDEN TOFFE 100 ML'),
  ('MP9144', '770MP9144', 'SPRAY PERFUME CAPILAR SEDUCTION FLOWER 32 ML'),
  ('MP9145', '770MP9145', 'TAPA PERFUME CAPILAR SEDUCTION FLOWER 32 ML'),
  ('MP9146', '770MP9146', 'SPRAY PERFUME CAPILAR CANDY TOY 32 ML'),
  ('MP9147', '770MP9147', 'TAPA PERFUME CAPILAR CANDY TOY 32 ML'),
  ('MP9148', '770MP9148', 'SPRAY PERFUME CAPILAR TROPICAL CRUSHY 32 ML'),
  ('MP9149', '770MP9149', 'TAPA PERFUME CAPILAR TROPICAL CRUSHY 32 ML'),
  ('MP9158', '770MP9158', 'ENVASE IMPRESO PERFUME CAPILAR CANDY TOY 100 ML'),
  ('MP9159', '770MP9159', 'ENVASE IMPRESO PERFUME CAPILAR TROPICAL CRUSH 100 ML'),
  ('MP9160', '770MP9160', 'ENVASE PERFUME CAPILAR MOCCA 100ML'),
  ('MP9162', '770MP9162', 'PERFUME CAPILAR GOLDEN TOFFEE 100ML'),
  ('MP9163', '770MP9163', 'ENVASE PERFUME CAPILAR SEDUCTION FLOWER 32ML'),
  ('MP9164', '770MP9164', 'ENVASE PERFUME CAPILAR CANDY TOY 32ML'),
  ('MP9165', '770MP9165', 'ENVASE PERFUME CAPILAR TROPICAL CRUSH 32ML'),
  ('MP9166', '770MP9166', 'ENVASE PERFUME CAPILAR MOCCA 32ML'),
  ('MP9167', '770MP9167', 'PERFUME CAPILAR VAINILLA GLASEADA 32ML'),
  ('MP9168', '770MP9168', 'ENVASE PERFUME CAPILAR GOLDEN TOFFEE 32ML'),
  ('MP9169', '770MP9169', 'CAJA MASTER MINI PERFUME PARA EL CABELLO 32 ML'),
  ('MP9171', '770MP9171', 'CAJA MASTER ACONDICIONADOR 300 ML'),
  ('MP9172', '770MP9172', 'CAJA MASTER TONICO CAPILAR AJI 60 ML'),
  ('MP9173', '770MP9173', 'TERMOENCOGIBLE DEL TERMO PROTECTOR BIFASICO LECHE Y MIEL 150 ML'),
  ('MP9200', '770MP9200', 'CAJA EMBALAJE PERFUME PARA EL CABELLO 120 ML'),
  ('MP9201', '770MP9201', 'CAJA MASTER MIEL CAPILAR 15 ML'),
  ('MP9202', '770MP9202', 'CAJA EMBALAJE ENERGIZANTE'),
  ('MP9203', '7700MP9203', 'CAJA CORRUMED DE MASCARILLA - MANTEQUILLA'),
  ('MP9204', '770MP9204', 'CAJA DE EMBALAJE ACONDICIONADOR DE MIEL 300 ML'),
  ('MP9206', '770MP9206', 'TERMO ENCOGIBLE TONICO CAPILAR 60 ML'),
  ('MP9207', '770MP9207', 'CAJA CORRUGADO MIEL 50ML'),
  ('MP9208', '770MP9208', 'CAJA EMBALAJE PERFUME MIEL 100ML'),
  ('MP9210', '770MP9210', 'FOIL N28 AUTOADHESIVO ENVASE SHAMPOO MIEL 300 ML'),
  ('MP9235', '770MP9235', 'ENVASE PERFUME CAPILAR MOCCA 100 ML'),
  ('MP9240', '770MP9240', 'ENVASE PERFUME CAPILAR VAINILLA GLASEADA 100 ML'),
  ('MP9242', '770MP9242', 'CAJA DE LUJO 26,6X13X8 CM'),
  ('MP9278', '770MP9278', 'SPRAY Y TAPA TERMO PROTECTOR BIFASICO LECHE Y MIEL 150 ML'),
  ('MP9281', '770MP9281', 'CAJA MASTER TERMOPROTECTOR BIFASICO LECHE Y MIEL X12 UNDS'),
  ('MP9284', '770MP9284', 'ETIQUETA MIEL CAPILAR 50 ML (ENVOLVENTE)'),
  ('MP9298', '770MP9298', 'CAJA PERFUMES SUGAR FLOWER 32 ML X 3 UND'),
  ('MP9299', '770MP9299', 'CAJA PERFUMES VANILLA CANDY 32 ML X 3 UND'),
  ('MP9300', '770MP9300', 'CAJA PERFUMES CREAMY CAKE 32 ML X 3 UND'),
  ('MP9312', '770MP9312', 'ENVASE IMPRESO MIEL CAPILAR 50 ML'),
  ('MP9325', '770MP9325', 'ENVASE IMPRESO PERFUME CAPILAR DE MIEL BRILLO INTENSO 100ML (NACIONAL)'),
  ('MP9672', '770MP9672', 'CAJA PLEGADIZA MASCARILLA DE PROTEINA 300ML'),
  ('MP9672-1', '770MP9672-1', 'PARRILLA PLEGADIZA MASCARILLA DE PROTEINA 300ML'),
  ('MP9678', '770MP9678', 'CAJA MASTER SHAMPOO PROTEINA'),
  ('MP9679', '770MP9679', 'CAJA MASTER MASCARILLA 300ML'),
  ('PT0003', '770PT0003', 'BOLSA X 10 UNIDADES'),
  ('PT0005', '770PT0005', 'CAJA ROSA MEDIANA'),
  ('PT0006', '770PT0006', 'CAJA ROSA PEQUEÑA'),
  ('PT0007', '659525889708', 'BOLSA MINI X 10'),
  ('PT008', '770PT008', 'BOLSA BIODEGRADABLE E-COMERCE'),
  ('PT009', '770PT009', 'BOLSA BIODEGRADABLE E-COMERCE PEQUEÑA'),
  ('PTB2100', '658325658415', 'EXFOLIANTE CORPORAL'),
  ('PTB2600', '658325658408', 'JABON CREMOSO'),
  ('PTB2700', '658325658392', 'MANTEQUILLA CORPORAL'),
  ('PTC1100', '781718679381', 'ACONDICIONADOR 4 EN 1 300ML'),
  ('PTC2800', '781718679428', 'MIEL PARA EL CABELLO 50ML'),
  ('PTC3100', '770PTC3100', 'PERFUME PARA EL CABELLO AMARILLO CONT 20 ML'),
  ('PTC3200', '770PTC3200', 'PERFUME PARA EL CABELLO AZUL CONT 20 ML'),
  ('PTC3300', '770PTC3300', 'PERFUME PARA EL CABELLO MORADO CONT 20 ML'),
  ('PTC3500', '770PTC3500', 'PERFUME PARA EL CABELLO VERDE CONT 20 ML'),
  ('PTC4000', '6595258896610', 'PERFUME PARA EL CABELLO AMARILLO 120ML'),
  ('PTC4100', '770PTC4100', 'PERFUME PARA EL CABELLO AZUL 120ML'),
  ('PTC4200', '781718679350', 'PERFUME PARA EL CABELLO MORADO 120ML'),
  ('PTC4300', '659525889630', 'PERFUME ROSADO 120ML'),
  ('PTC4400', '659525889647', 'PERFUME PARA EL CABELLO VERDE 120ML'),
  ('PTC4805', '677144930236', 'SHAMPOO DE AJI 300 ML'),
  ('PTC5400', '770PTC5400', 'SPRAY MOLDEADOR DE ONDAS'),
  ('PTC5600', '781718679367', 'SUERO RECONSTRUCTOR 120ML'),
  ('PTC5900', '659525889678', 'TONICO CAPILAR 60ML'),
  ('PTC6100', '781718679398', 'ENERGIZANTE CAPILAR 300ML'),
  ('PTC6600', '799192109102', 'PERFUME PARA EL CABELLO TRANSPARENTE 120ML'),
  ('PTC6700', '799192109119', 'PERFUME PARA EL CABELLO NARANJADO 120ML'),
  ('PTC7100', '770PTC7100', 'PERFUME PARA EL CABELLO TRASPARENTE CONT 20 ML'),
  ('PTC7200', '770PTC7200', 'PERFUME PARA EL CABELLO NARANJADO CONT 20 ML'),
  ('PTC7300', '799192109157', 'SHAMPOO MIEL X 300ML'),
  ('PTC7400', '799192109164', 'MASCARILLA DE MIEL BRILLO INTENSO 300ML'),
  ('PTC7500', '793969805471', 'PERFUME MORADO 40 ML (TROPICAL CRUSH)'),
  ('PTC7600', '793969805464', 'PERFUME ROSADO 40 ML (SEDUCTION FLOWER)'),
  ('PTC7700', '793969805440', 'PERFUME AZUL 40 ML (CANDY TOY)'),
  ('PTC7900', '793969805488', 'PERFUME VERDE 40 ML (FRESH AMBER)'),
  ('PTC8100', '793969805457', 'PERFUME TRANSPARENTE 40 ML (VAINILLA GLOW)'),
  ('PTC8200', '793969805563', 'PERFUME CAPILAR DE MIEL BRILLO INTENSO 100ML'),
  ('PTC8301', '793969805600', 'MIEL PARA EL CABELLO X 20 ML'),
  ('PTC8800', '793969805570', 'ACONDICIONADOR MIEL'),
  ('PTC8806', '793969805648', 'ACONDICIONADOR DE AJÍ 300 ML'),
  ('PTC8900', '793969805556', 'PERFUME DE PRINCESA - MAGIC STEP'),
  ('PTC9000', '770PTC9000', 'PERFUME DE PRINCESA - SLEEPING ROSE'),
  ('PTC9100', '7939698055320', 'PERFUME DE PRINCESA - PURPLE WAVES-1'),
  ('PTC9106', '770PTC9106', 'PERFUME CORPORAL Y CAPILAR PALACE GARDEN 110ML'),
  ('PTC9113', '770PTC9113', 'PERFUME CORPORAL Y CAPILAR MERMAID KISS 110ML'),
  ('PTC9119', '677144930205', 'PERFUME DE MIEL Y MASMELO'),
  ('PTC9121', '7709268279632', 'TERMOPROTECTOR BIFASICO LECHE Y MIEL 150 ML'),
  ('PTC9124', '677144930199', 'PERFUME DE MIEL Y PISTACHO'),
  ('PTC9130', '7709360339302', 'SHAMPOO DE PROTEINA 300 ML'),
  ('PTC9131', '7709360339395', 'ACONDICIONADOR DE PROTEINA 300 ML'),
  ('PTC9132', '7709360339319', 'MASCARILLA DE PROTEINA 300 ML'),
  ('PTC9133', '7709360339340', 'POLVO DE PROTEINA SACHET X 3GR'),
  ('PTC9215', '7709076081892', 'PERFUME CAPILAR SEDUCTION FLOWER 100ML (ROSADO)'),
  ('PTC9219', '7709268279670', 'PERFUME CAPILAR CANDY TOY 100 ML (AZUL)'),
  ('PTC9224', '7709268279601', 'PERFUME CAPILAR TROPICAL CRUSH 100 ML (MORADO)'),
  ('PTC9233', '7709268279656', 'PERFUME CAPILAR MOCCA 100 ML'),
  ('PTC9238', '7709268279625', 'PERFUME CAPILAR VAINILLA GLASEADA 100 M'),
  ('PTC9239', '7709268279694', 'PERFUME CAPILAR GOLDEN TOFFEE 100M'),
  ('PTC9270', '770PTC9270', 'TONICO CAPILAR DE AJI 60 ML'),
  ('PTK8023', '770PTK8023', 'KIT ONDAS SALUDABLES'),
  ('PTK9057', '793969805495', 'KIT MINI PERFUMES DULCES 40 ML X 3 UNIDADES'),
  ('PTK9058', '793969805518', 'KIT MINI PERFUMES CÍTRICOS 40 ML X 3 UNIDADES'),
  ('PTK9059', '793969805525', 'KIT MINI PERFUMES MIX 40 ML X 3 UNIDADES'),
  ('PTK9063', '7709360339371', 'KIT PERFUMES CANDY CRUSH (CANDY TOY, VANILLA GLAZE, GOLDEN TOFFEE) 32ML'),
  ('PTK9068', '7709360339388', 'KIT PERFUMES CREAMY CAKE (MOCCA SHAKE, VANILLA GLAZE, GOLDEN TOFFEE)32ML'),
  ('PTK9070', '677144930182', 'KIT GLOW UP 2 PERFUME MIEL Y MIEL'),
  ('PTK9291', '7709949388202', 'MASCARILLA DE PROTEINA 300 ML CON SACHET 3 G'),
  ('UNI006', '770UNI006', 'CAMISETAS VACA')
ON CONFLICT ON CONSTRAINT uq_item_ean_cuenta_item
DO UPDATE SET ean = EXCLUDED.ean, descripcion = EXCLUDED.descripcion
WHERE core.item_ean.ean IS DISTINCT FROM EXCLUDED.ean OR core.item_ean.descripcion IS DISTINCT FROM EXCLUDED.descripcion;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Líneas de solicitud: campos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS ean                       text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS destinatario_direccion    text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS destinatario_departamento text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS destinatario_telefono     text;
COMMENT ON COLUMN despachos.solicitud_lineas.ean IS 'EAN del SKU al radicar (digitado o tomado de core.item_ean)';

-- Solicitudes ya radicadas: completar EAN desde el maestro (las líneas no tienen trigger de actualización)
UPDATE despachos.solicitud_lineas l
   SET ean = (SELECT ie.ean FROM core.item_ean ie
               WHERE ie.activo AND ie.item IN (l.material, core.fn_sku_base(l.material))
               ORDER BY (ie.item = l.material) DESC, ie.id LIMIT 1)
 WHERE l.ean IS NULL
   AND EXISTS (SELECT 1 FROM core.item_ean ie
                WHERE ie.activo AND ie.item IN (l.material, core.fn_sku_base(l.material)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. fn_crear_solicitud (misma firma: el portal anterior sigue funcionando)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_crear_solicitud(
  p_idempotency_key    uuid,
  p_area_solicitante   text,
  p_solicitante_nombre text,
  p_solicitante_correo text,
  p_origen             text,
  p_lineas             jsonb,
  p_numero_pedido_origen text  DEFAULT NULL,
  p_archivo_origen     text  DEFAULT NULL,
  p_datos_origen       jsonb DEFAULT NULL,
  p_observaciones      text  DEFAULT NULL
)
RETURNS TABLE (solicitud_id bigint, numero text, radicada_at timestamptz,
               total_lineas integer, total_unidades numeric, es_reintento boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid   := auth.uid();
  v_cuenta   bigint := core.fn_mi_cuenta();
  v_id       bigint;
  v_numero   text;
  v_lineas   integer;
  v_unidades numeric;
  v_dup      text;
BEGIN
  -- 1) Autorización
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'DSP001: sesión no válida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['solicitante','operador','admin']) THEN
    RAISE EXCEPTION 'DSP002: el usuario no tiene permiso para radicar solicitudes' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2) Idempotencia: si este envío ya se procesó, devolver el mismo resultado
  RETURN QUERY
    SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, true
    FROM despachos.solicitudes s
    WHERE s.idempotency_key = p_idempotency_key AND s.solicitante_id = v_uid;
  IF FOUND THEN RETURN; END IF;

  -- 3) Validación del encabezado
  IF COALESCE(trim(p_area_solicitante),'') = '' OR COALESCE(trim(p_solicitante_nombre),'') = '' THEN
    RAISE EXCEPTION 'DSP003: área solicitante y solicitante son obligatorios' USING ERRCODE = 'check_violation';
  END IF;
  IF p_origen NOT IN ('MANUAL','PDF') THEN
    RAISE EXCEPTION 'DSP004: origen inválido (%)', p_origen USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'DSP005: la solicitud no tiene líneas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lineas) > 5000 THEN
    RAISE EXCEPTION 'DSP006: máximo 5000 líneas por solicitud' USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Validación de líneas (en tabla temporal de la transacción)
  CREATE TEMP TABLE IF NOT EXISTS tmp_lineas_v2 (
    linea_nro integer, entrega text, destinatario_nit text, destinatario_nombre text,
    destinatario_ciudad text, material text, producto_descripcion text, cantidad numeric,
    um text, item integer, bodega text, precio_unitario numeric, descuento_pct numeric,
    subtotal numeric, total numeric,
    ean text, direccion text, departamento text, telefono text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_lineas_v2;

  INSERT INTO pg_temp.tmp_lineas_v2
  SELECT o.ord::integer,
         upper(trim(l.entrega)), trim(l.destinatario), upper(trim(l.nombre)),
         upper(trim(l.lugar)),   upper(trim(l.material)), l.producto,
         l.cantidad, COALESCE(NULLIF(upper(trim(l.um)),''),'BUL'),
         l.item, NULLIF(trim(l.bodega),''),
         l.precio, l.descuento_pct, l.subtotal, l.total,
         NULLIF(trim(l.ean),''), NULLIF(upper(trim(l.direccion)),''),
         NULLIF(upper(trim(l.departamento)),''), NULLIF(trim(l.telefono),'')
  FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS l(entrega text, destinatario text, nombre text, lugar text,
                                    material text, producto text, cantidad numeric, um text,
                                    item integer, bodega text, precio numeric,
                                    descuento_pct numeric, subtotal numeric, total numeric,
                                    ean text, direccion text, departamento text, telefono text);

  SELECT string_agg(format('fila %s', t.linea_nro), ', ' ORDER BY t.linea_nro) INTO v_dup
  FROM pg_temp.tmp_lineas_v2 t
  WHERE COALESCE(t.entrega,'') = '' OR COALESCE(t.destinatario_nit,'') = ''
     OR COALESCE(t.destinatario_nombre,'') = '' OR COALESCE(t.destinatario_ciudad,'') = ''
     OR COALESCE(t.material,'') = '' OR t.cantidad IS NULL OR t.cantidad <= 0;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP007: campos obligatorios vacíos o cantidad <= 0 en %', v_dup USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('Entrega %s + Material %s', d.entrega, d.material), '; ') INTO v_dup
  FROM (SELECT t.entrega, t.material FROM pg_temp.tmp_lineas_v2 t
        GROUP BY t.entrega, t.material HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP008: líneas duplicadas: %', v_dup USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*), sum(t.cantidad) INTO v_lineas, v_unidades FROM pg_temp.tmp_lineas_v2 t;

  -- 5) Encabezado con consecutivo de la secuencia (único aunque radiquen 100 a la vez)
  v_numero := 'DSP-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
              || lpad(nextval('despachos.seq_solicitud_numero')::text, 6, '0');

  INSERT INTO despachos.solicitudes AS s (
    numero, idempotency_key, cuenta_id, origen, area_solicitante,
    solicitante_id, solicitante_nombre, solicitante_correo,
    numero_pedido_origen, archivo_origen, datos_origen,
    total_lineas, total_unidades, observaciones, created_by)
  VALUES (
    v_numero, p_idempotency_key, v_cuenta, p_origen, upper(trim(p_area_solicitante)),
    v_uid, upper(trim(p_solicitante_nombre)), lower(trim(p_solicitante_correo)),
    NULLIF(trim(p_numero_pedido_origen),''), p_archivo_origen, p_datos_origen,
    v_lineas, v_unidades, p_observaciones, v_uid)
  ON CONFLICT ON CONSTRAINT uq_solicitudes_idempotency_key DO NOTHING
  RETURNING s.id INTO v_id;

  IF v_id IS NULL THEN
    -- Carrera: otro request con la misma llave ganó la inserción → devolver ese
    RETURN QUERY
      SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, true
      FROM despachos.solicitudes s
      WHERE s.idempotency_key = p_idempotency_key AND s.solicitante_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DSP009: llave de idempotencia ya usada por otro usuario' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN;
  END IF;

  -- 6) Líneas + enlace al maestro de destinatarios y al maestro Item/EAN.
  --    Lo que viene digitado manda; si viene vacío se completa con el maestro.
  INSERT INTO despachos.solicitud_lineas (
    solicitud_id, linea_nro, entrega, destinatario_id, destinatario_nit,
    destinatario_nombre, destinatario_ciudad, material, producto_descripcion,
    cantidad, um, item, bodega, precio_unitario, descuento_pct, subtotal, total, created_by,
    ean, destinatario_direccion, destinatario_departamento, destinatario_telefono)
  SELECT v_id, t.linea_nro, t.entrega, d.id, t.destinatario_nit,
         t.destinatario_nombre, t.destinatario_ciudad, t.material, t.producto_descripcion,
         t.cantidad, t.um, t.item, t.bodega, t.precio_unitario, t.descuento_pct,
         t.subtotal, t.total, v_uid,
         COALESCE(t.ean, ie.ean), COALESCE(t.direccion, d.direccion),
         COALESCE(t.departamento, d.departamento), COALESCE(t.telefono, d.telefono)
  FROM pg_temp.tmp_lineas_v2 t
  LEFT JOIN core.destinatarios d
         ON d.nit = t.destinatario_nit AND d.activo
        AND d.cuenta_id IS NOT DISTINCT FROM v_cuenta
  LEFT JOIN LATERAL (
         SELECT x.ean FROM core.item_ean x
          WHERE x.activo AND (x.cuenta_id IS NULL OR x.cuenta_id = v_cuenta)
            AND x.item IN (t.material, core.fn_sku_base(t.material))
          ORDER BY (x.item = t.material) DESC, x.id
          LIMIT 1) ie ON true
  ORDER BY t.linea_nro;

  -- 7) Primer evento de la línea de tiempo
  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  VALUES (v_id, NULL, 'RADICADA', 'Radicada desde el portal (' || p_origen || ')', v_uid);

  RETURN QUERY
    SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, false
    FROM despachos.solicitudes s WHERE s.id = v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Vistas
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por línea con TODOS los campos de la plantilla de despacho
CREATE OR REPLACE VIEW despachos.vw_solicitud_lineas
WITH (security_invoker = true) AS
SELECT s.id AS solicitud_id, s.numero, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo, s.numero_pedido_origen,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.lote_id, lt.numero AS lote_numero,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_direccion, li.destinatario_ciudad, li.destinatario_departamento,
       li.destinatario_telefono, li.material, li.ean, li.producto_descripcion,
       li.cantidad, li.um, li.item, li.bodega, s.cuenta_id
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
JOIN despachos.estados e     ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes lt ON lt.id = s.lote_id;

-- Líneas de un bloque: se agregan al final los campos nuevos
CREATE OR REPLACE VIEW despachos.vw_lote_lineas
WITH (security_invoker = true) AS
SELECT s.lote_id, s.id AS solicitud_id, s.numero AS solicitud_numero, s.area_solicitante,
       s.solicitante_nombre, s.origen, s.numero_pedido_origen, s.radicada_at,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_ciudad, li.material, li.producto_descripcion, li.cantidad, li.um, li.item, li.bodega,
       s.solicitante_correo, li.ean, li.destinatario_direccion, li.destinatario_departamento,
       li.destinatario_telefono
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
WHERE s.lote_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permisos y RLS
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON core.item_ean FROM anon, authenticated;
GRANT SELECT ON core.item_ean TO authenticated;
GRANT INSERT (item, ean, descripcion, activo, cuenta_id), UPDATE (ean, descripcion, activo) ON core.item_ean TO authenticated;
GRANT ALL ON core.item_ean TO service_role;
GRANT SELECT ON despachos.vw_solicitud_lineas, despachos.vw_lote_lineas TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.fn_sku_base(text) TO authenticated, service_role;

ALTER TABLE core.item_ean ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_item_ean_leer ON core.item_ean;
CREATE POLICY pol_item_ean_leer ON core.item_ean FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_item_ean_escribir ON core.item_ean;
CREATE POLICY pol_item_ean_escribir ON core.item_ean FOR INSERT TO authenticated
  WITH CHECK ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));
DROP POLICY IF EXISTS pol_item_ean_actualizar ON core.item_ean;
CREATE POLICY pol_item_ean_actualizar ON core.item_ean FOR UPDATE TO authenticated
  USING ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACIÓN (ejecutar aparte)
--   SELECT count(*) FROM core.item_ean;                        → 257
--   SELECT core.fn_sku_base('PTC7300-2025'), core.fn_sku_base('PTC8200 - 2026');  → PTC7300 | PTC8200
--   SELECT numero, material, ean FROM despachos.vw_solicitud_lineas ORDER BY linea_id DESC LIMIT 20;
--
-- NOTA: en MAESTRO ACTUAL el ítem PTK9070 viene dos veces (EAN 677144930182 y 770PTK9070).
--       Se cargó el primero. Corrija en core.item_ean si el correcto es el otro.
-- =============================================================================
