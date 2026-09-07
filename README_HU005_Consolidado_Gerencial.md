# HU005 — Consolidado Gerencial x Mes

## Historial de esta HU

1ª entrega: pantalla base del Consolidado (tarjetas con número + semáforo + tabla + narrativa).
2ª entrega (este paquete): se agregó, dentro de cada una de las 6 tarjetas, un
**mini-gráfico de tendencia de los últimos 6 meses con banda de color de meta**
(verde/amarillo/rojo de fondo, estilo dashboard ejecutivo clásico) y un botón
**"⤢ Ampliar"** que reutiliza el mismo patrón de modal "Maximizar/Minimizar"
que ya existe en `kpi001.html`–`kpi008.html` — no se creó un componente nuevo,
se generalizó el que ya tenían.

Esto responde al análisis que nos compartiste (`2_Analisis_Operacion_Click_Cosmetics...docx`):
las tarjetas ya no son solo un número aislado — ahora muestran de un vistazo si
la tendencia va bien, mal, o hacia dónde se mueve, sin tener que hacer clic.

**Fuera de esta entrega** (según lo que definimos en el chat): costo por
unidad/pedido, separación B2B/B2C en todos los KPIs, y top-3 causas de
novedad. Esos requieren datos que hoy no existen en ninguna tabla de Supabase
(costo) o solo existen para 2 de los 6 KPIs (B2B/B2C en OTD y Lead Time) — se
dejaron pendientes hasta que definan de dónde sale esa información, tal como
acordamos.

## Qué cambió en este paquete (solo 1 archivo, `pages/consolidado_gerencial.html`)

- Se agregó Chart.js (misma versión 4.4.0 que ya usan kpi001–kpi008, mismo CDN).
- Cada tarjeta con datos ahora incluye:
  - Un mini-gráfico de línea (últimos 6 meses o los que haya disponibles si
    son menos) con una **banda de fondo verde/amarillo/rojo** calculada a
    partir de la meta y el semáforo de cada KPI (mismos umbrales de siempre,
    no se inventó ninguno nuevo).
  - Una línea punteada de "Meta" superpuesta.
  - Los puntos de la serie se pintan del color de su propio semáforo (verde/
    amarillo/rojo) mes a mes.
  - Botón **"⤢ Ampliar"** que abre esa misma serie en grande, en un modal
    (con ejes, leyenda y tooltip), igual en estilo al modal "Maximizar" que
    ya existía en las pantallas de detalle.
- Si un KPI tiene menos de 2 meses de historial, no se muestra el mini-gráfico
  (no hay tendencia que graficar con 1 solo punto) — la tarjeta se ve igual
  que antes, solo con el número y el semáforo.
- No se tocó la tabla consolidada ni la narrativa gerencial — siguen igual.
- No se tocó `config/config.js` ni `pages/menu.html` en este paquete (ya
  estaban aplicados de la entrega anterior).

## Deploy

Igual que la vez anterior — es el mismo archivo, solo actualizado:

```bash
git checkout master
git pull origin master

# reemplaza pages/consolidado_gerencial.html con el de este zip

git add pages/consolidado_gerencial.html
git commit -m "HU005: mini-gráficos de tendencia con banda de meta + botón Ampliar en Consolidado Gerencial"
git push origin master
```

Sigue sin haber nada de base de datos que desplegar — mismo dato, misma
fuente, solo cambió cómo se dibuja.

## Nota sobre el documento de análisis

El documento trae recomendaciones de mediano plazo (reagrupar por etapa del
proceso: Recibo/Almacén/Alistamiento/Despacho/Postventa) y de antes-de-B2C
(costo por unidad, separación B2B/B2C en todos los KPIs, top-3 causas de
novedad). Confirmamos en el chat dejar la estructura actual (por KPI
numerado) y enfocar esta entrega solo en la mejora visual con mini-gráficos.
El resto queda documentado aquí como pendiente para una HU futura, cuando
definan de dónde sale el dato de costo (hoy no existe en ningún Excel ni
tabla revisada).
