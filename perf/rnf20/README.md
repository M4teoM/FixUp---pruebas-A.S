# RNF-20 — Caracterización de desempeño bajo carga representativa

> **Requisito.** La API deberá contar con una caracterización reproducible de desempeño bajo carga
> representativa, con objetivos explícitos de latencia y errores.
>
> **Métrica declarada.** Ejecutar k6 con carga y datos documentados y registrar RPS, p95, p99, tasa
> de errores y CPU/memoria. **Umbrales por aprobar.**
>
> Atributo: desempeño. Casos de uso UC-05, UC-12 y UC-13.

## La decisión de diseño que hay que entender antes de leer los números

**Este guion no declara umbrales de latencia.** No es un olvido.

RNF-20 dice "umbrales por aprobar". Si yo pongo `p(95) < 500 ms` y la corrida sale verde, el informe
queda diciendo que el sistema cumple un objetivo que nadie aprobó — y ese número, una vez escrito en
un entregable, se vuelve el objetivo por inercia. Una caracterización mide y reporta; el veredicto
viene después, cuando el equipo ratifique los umbrales con estos datos a la vista.

Lo que sí reprueba la corrida son dos cosas:

| Umbral | Por qué sí |
| --- | --- |
| `http_req_failed: rate<0.01` | Un 5xx no es una medición lenta, es un defecto. No necesita umbral ratificado. |
| `filas_devueltas: med>0` | Si las lecturas vuelven vacías, no se caracterizó nada. |

Hay además un umbral por operación que **no juzga**: `http_req_duration{name:X}: max>=0`. Una
duración nunca es negativa, así que se cumple siempre. Está porque k6 solo guarda los percentiles de
una etiqueta en el resumen si esa etiqueta tiene un umbral declarado. Sin ese truco el resumen
traería un p95 global y nada más, que es justo lo que una caracterización no puede entregar. (Sobre
un trend k6 solo admite `avg`, `min`, `max`, `med` y `p(N)`.)

Para contraste: `perf/k6/rnf01-busqueda.js` **sí** declara umbral, porque RNF-01 tiene un objetivo
aprobado de 3 segundos. Son dos requisitos distintos y por eso los dos guiones se comportan distinto.

## Qué es "carga representativa" aquí

Los tres casos de uso que nombra el requisito, corriendo a la vez, con el reparto que imita el uso
esperado: se busca mucho más de lo que se cotiza o se gestiona.

| Escenario | Peso | Operaciones |
| --- | --- | --- |
| UC-05 · publicación y búsqueda | 50 % | `GET /properties/search`, `GET /properties/catalog` |
| UC-12 · responder y cotizar | 30 % | `GET /requests/open`, `GET /quotations/me`, `GET /quotations/for-request/{id}` |
| UC-13 · trabajos activos | 20 % | `GET /jobs/me`, `GET /payments/me/earnings` |

Son lecturas. Un escenario de escritura sostenida crecería la base durante la propia corrida y los
percentiles del final no serían comparables con los del principio; para medir hace falta que el
tamaño de los datos se quede quieto.

Los 60 pet/s y ese reparto son **una propuesta mía**, derivada de los casos de uso del requisito, no
un dato de operación. Conviene que queden aprobados junto con los umbrales: un p95 sin su carga no
significa nada. Se cambian sin tocar código con `-Rps`.

## Cómo se corre

Precondición: k6 instalado, el entorno arriba y las **dos** siembras hechas, porque la carga toca
los tres casos de uso y cada siembra prepara distintos.

```powershell
winget install --id GrafanaLabs.k6 -e     # una sola vez; después abre una ventana nueva
k6 version
```

```powershell
cd C:\Users\DELLPHOTO\Documents\GitHub\FixUp---pruebas-A.S

.\perf\rnf01\levantar.ps1                      # PostgreSQL + emisor de llaves + backend

# seed.mjs necesita un psql que reciba SQL por stdin: casi todo lo siembra por la API, pero
# aprobar la verificación del técnico y darle su especialidad requieren un administrador en el
# producto, así que esas dos filas van por SQL. En Linux lo exporta perf/run.sh; en Windows toca
# a mano. La forma con `docker compose exec` no depende del nombre del contenedor.
$env:PERF_PSQL = "docker compose --env-file .env -f compose.local.yml -f compose.perf.yml exec -T database psql -q -U fixup -d fixup -v ON_ERROR_STOP=1"

node perf\seed.mjs                             # fixtures.json  -> UC-12 y UC-13
node perf\rnf01\seed-catalogo.mjs perf\.work   # catalogo.json  -> UC-05

.\perf\rnf20\medir.ps1
```

`$env:PERF_PSQL` vive solo en esa ventana de PowerShell. Si abres otra, hay que volver a ponerla.

`medir.ps1` hace cuatro cosas en orden: comprueba que el entorno y los datos están, levanta el
muestreo de `docker stats` cada 2 s en un trabajo aparte, corre k6, y cruza las dos series en
`perf\.work\caracterizacion-rnf20.md`.

Parámetros: `.\perf\rnf20\medir.ps1 -Rps 100 -Plateau 300s`.

## Por qué el muestreo va por fuera de k6

k6 mide lo que ve el cliente: latencia y errores. No sabe nada del costo en el servidor, y la métrica
de RNF-20 pide CPU y memoria explícitamente. Por eso `medir.ps1` corre `docker stats` en paralelo y
guarda cada muestra con su marca de tiempo, y `caracterizacion.mjs` cruza las dos series por esa
marca. Sin eso, el entregable cubriría media métrica.

Las cifras de CPU y memoria son de contenedores en una máquina de escritorio. Sirven para comparar
corridas entre sí y para ver cuál componente se satura primero. **No** sirven para dimensionar
infraestructura: eso es RNF-04, que se mide sobre Kubernetes.

## Un cambio que hubo que hacer en el sembrador

`perf/seed.mjs` venía del flujo anterior, cuando aceptar una cotización abría el trabajo de una vez.
Desde FR-UC-22 eso ya no pasa: aceptar **inicia un pago**, y el trabajo nace — con su ingreso
retenido — cuando un intento por la pasarela simulada queda aprobado. Con el sembrador viejo,
`/jobs/me` y `/payments/me/earnings` respondían listas vacías y el 20 % de la carga de UC-13 medía
consultas sin filas.

`assignedJob()` ahora recorre el flujo real: acepta, lee el pago con `GET /payments/{id}` y manda el
intento a `POST /payments/{id}/attempts` con su `Idempotency-Key`. Es el mismo camino que hace un
propietario en la aplicación, así que las filas sembradas son exactamente las que el sistema sabe
producir.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `perf/k6/rnf20-caracterizacion.js` | El escenario mixto, sin umbrales de latencia |
| `perf/rnf20/medir.ps1` | Corrida completa: muestreo, k6 e informe |
| `perf/rnf20/caracterizacion.mjs` | Cruza el resumen de k6 con las muestras de recursos |
| `perf/.work/summary-rnf20.json` | Resumen crudo de k6 (lo que respalda la tabla) |
| `perf/.work/recursos-rnf20.jsonl` | Muestras de `docker stats`, una por línea con marca de tiempo |
| `perf/.work/caracterizacion-rnf20.md` | El entregable. Se regenera, no se edita |

## Lo que queda abierto

1. **Ratificar los umbrales de latencia.** Es la tarea que vuelve esto una prueba y no solo una
   medición. Mi recomendación: correr dos o tres veces, mirar el p95 por operación y poner el umbral
   con margen sobre el peor, no sobre la mediana.
2. **Aprobar la carga nominal**, por lo dicho arriba.
3. **Los percentiles son del backend.** Para RNF-20 eso es lo correcto, porque el requisito habla de
   la API. Para lo que ve el usuario en pantalla, ver la nota equivalente en `perf/rnf01/README.md`.
