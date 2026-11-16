# RNF-01 — Búsqueda por geolocalización y filtros

> **Requisito.** La búsqueda de inmuebles por geolocalización y filtros debe mostrar resultados en
> la interfaz en menos de 3 segundos.
>
> **Métrica declarada.** Tiempo de respuesta p95 ≤ 3 s con un catálogo de hasta 5.000 inmuebles,
> medido con pruebas de carga.
>
> Atributo: rendimiento. Prioridad alta. Caso de uso UC-05. Corresponde al ASR-05, cuyas tácticas
> son índice espacial, paginación y caché de consultas.

## Qué se mide y qué no

Se mide el tiempo de la API: `GET /properties/search` y `GET /properties/catalog`. **No** se mide
el pintado en pantalla.

Eso importa al reportar. La métrica dice "mostrar resultados en la interfaz", así que los 3 s del
requisito incluyen el render. Hay dos salidas honestas: presentar estos números como el
presupuesto del backend y decir que el render se mide aparte, o medir el recorrido completo con
Playwright y presentar ese. Lo que no se vale es enseñar el p95 de la API diciendo que es el del
requisito.

## Por qué 5.000 inmuebles no son opcionales

La búsqueda filtra primero por un rectángulo de coordenadas usando el índice parcial
`idx_properties_published_geolocation`, y después calcula la distancia real de los candidatos. Con
50 inmuebles sembrados el índice es irrelevante y todo sale instantáneo; con 5.000 empieza a
notarse cuántas filas sobreviven al rectángulo. Medir con pocos datos no prueba el requisito, da
un número bonito que no significa nada.

El sembrador reparte el catálogo así: 70% en Bogotá y el resto entre Medellín, Cali, Barranquilla
y Cartagena. La concentración es a propósito — una nube densa es el caso que de verdad estresa la
búsqueda por radio.

## Las tres cosas que pueden arruinar la medición

**Pedir siempre lo mismo.** Si todas las peticiones usan las mismas coordenadas, a partir de la
segunda se mide la caché. Por eso el sembrador deja 300 combinaciones de latitud, longitud y radio,
y 200 de filtros, y cada petición toma una distinta.

**Medir solo radios pequeños.** Un radio de 1 km devuelve un puñado de filas y siempre pasa. El
requisito tiene que cumplirse también cuando alguien busca en 50 km. Por eso hay un grupo aparte
que hace exactamente eso sobre el centro de Bogotá, que es el peor caso real.

**Medir contra un catálogo vacío.** Es el error más silencioso: si la siembra falló, las búsquedas
responden 200 con una lista vacía en dos milisegundos y el informe sale espectacular. El guion de
k6 lleva una métrica, `resultados_devueltos`, cuyo umbral exige mediana mayor que cero. Si el
catálogo no está, la corrida reprueba en vez de mentir.

## Cómo se corre

Con el stack arriba y la llave de firma creada, igual que el resto del arnés:

```bash
node perf/lib/jwt.mjs init perf/.work        # si no se ha hecho en esta corrida
node perf/rnf01/seed-catalogo.mjs perf/.work
```

La siembra usa la carga masiva del propio sistema (`POST /properties/bulk/import`) en lotes de
500, no SQL directo, para que las filas sean exactamente las que la aplicación sabe producir.
Tarda unos minutos.

Después, el veredicto con k6:

```bash
k6 run perf/k6/rnf01-busqueda.js
```

Y el informe con JMeter:

```bash
jmeter -n -t perf/jmeter/rnf01.jmx -l perf/.work/rnf01.jtl -e -o perf/.work/informe-rnf01 \
  -JcsvDir="$PWD/perf/.work"
```

## Qué sale de cada herramienta

k6 trae el umbral declarado: si el p95 pasa de 3.000 ms, la corrida termina en rojo y no hay que
interpretar nada. JMeter trae el panel HTML con los percentiles por operación, que es lo que se
muestra en una sustentación.

Son el mismo escenario sobre los mismos datos a propósito. Si los dos dan números muy distintos,
eso ya es un hallazgo: normalmente significa que uno de los dos no está variando los parámetros y
está midiendo la caché.

Parámetros de k6: `RNF01_P95_MS` (3000), `RNF01_P99_MS` (5000), `RNF01_RATE` (30),
`RNF01_DURATION` (60s), `CATALOG_SIZE` en la siembra (5000).

## Archivos

| Archivo | Qué es |
| --- | --- |
| `perf/rnf01/seed-catalogo.mjs` | Siembra los 5.000 inmuebles y genera las combinaciones de búsqueda |
| `perf/k6/rnf01-busqueda.js` | El escenario con el umbral que reprueba la corrida |
| `perf/jmeter/rnf01.jmx` | El mismo escenario para el informe visual |
| `perf/jmeter/generar-rnf01.js` | Genera ese `.jmx`; el XML no se edita a mano |
| `perf/.work/busquedas.csv` | 300 combinaciones de latitud, longitud y radio |
| `perf/.work/filtros.csv` | 200 combinaciones de filtros del catálogo |
| `perf/.work/buscadores.csv` | Los tokens del propietario y del inquilino |
