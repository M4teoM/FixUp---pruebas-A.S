# Pruebas de carga con JMeter — FR-UC-18, FR-UC-20 y FR-UC-21

Este plan mide lo mismo que el arnés de k6 y contra los mismos datos sembrados, a propósito:
así los dos resultados se pueden poner lado a lado y la comparación significa algo.

## Por qué hay dos herramientas

El protocolo de la primera entrega eligió k6 y descartó JMeter, con una razón escrita: el plan
de JMeter es un XML que se edita con interfaz gráfica y revisarlo en un pull request es
impracticable. Esa razón sigue siendo cierta — por eso este `.jmx` se genera desde un script y
no se edita a mano.

Lo que cambió es que ahora el plan tiene que incluir JMeter. La forma honesta de resolverlo en
la documentación no es borrar aquella decisión, sino decir que se corren las dos y para qué
sirve cada una:

| | k6 | JMeter |
| --- | --- | --- |
| Umbrales que reprueban la corrida | Sí, declarados en el script por operación | No de forma nativa sobre percentiles |
| Verificación de integridad tras una carrera | Sí, consulta el estado y lo compara | Limitada; haría falta Groovy |
| Informe visual para sustentar | Texto y JSON | Panel HTML con percentiles por operación |
| Revisable en un pull request | Sí, es JavaScript | Solo si se genera, no si se edita a mano |

La conclusión práctica: **JMeter da el informe que se muestra, k6 da el veredicto que falla la
corrida.** No se reemplazan.

## Qué contiene el plan

Seis grupos de hilos, espejando los escenarios de k6:

| Grupo | Qué hace | Tasa por omisión |
| --- | --- | --- |
| FR-UC-21 · `/auth/me` nominal | Token válido, lectura sostenida | 50 por segundo |
| FR-UC-21 · tokens con firma falsa | Espera 401; mide si rechazar es barato | 20 por segundo |
| FR-UC-18 · lecturas del técnico | Bandeja y sus cotizaciones | 30 por segundo |
| FR-UC-18 · lecturas del propietario | Sus solicitudes y las ofertas recibidas | 20 por segundo |
| FR-UC-20 · panel de ingresos | Saldo, trabajos y transferencias | 30 por segundo |
| FR-UC-18 · carrera de aceptación | Cuatro aceptaciones a la vez sobre la misma solicitud | — |

Cada petición lleva dos comprobaciones: el código de respuesta que corresponde, y una
aserción de duración contra la meta del protocolo.

**Ojo con la aserción de duración.** No es un p95. JMeter la aplica petición por petición, así
que una sola lenta la marca como fallida, mientras que el p95 del protocolo admite que cinco de
cada cien se pasen. Sirve como alarma gruesa; el número que vale para el informe es el p95 que
sale en el panel HTML. Está dicho aquí porque confundir las dos cosas es el error fácil.

## Qué hay que instalar

Cuatro cosas, en este orden. Las tres primeras ya hacen falta para el arnés de k6, así que no
son trabajo perdido.

1. **Subsistema de Linux de Windows.** En PowerShell como administrador: `wsl --install`. Pide
   reiniciar el computador.
2. **Docker Desktop.** Sin él no arrancan PostgreSQL ni el backend en contenedor, que es contra
   lo que se mide. Docker necesita lo del punto 1; por eso va después.
3. **Java 21.** Ya está instalado si el backend compila.
4. **JMeter.** Se descarga de `jmeter.apache.org`, se descomprime en una carpeta y se agrega su
   subcarpeta `bin` al PATH. No tiene instalador: es una carpeta con scripts.

Para comprobar que quedó: `jmeter --version` debe responder, y `docker ps` debe devolver una
tabla aunque esté vacía.

## Cómo se corre

Hace falta el stack arriba y la siembra hecha, igual que para k6:

```bash
PERF_SCALE=small perf/run.sh      # o los pasos de siembra por separado
perf/jmeter/run.sh
```

El informe queda en `perf/.work/jmeter/informe/index.html`.

Para un ensayo corto, bajando las tasas y la duración:

```bash
DURATION=20 perf/jmeter/run.sh -JrpmAuth=600 -JrpmTecnico=360 -JrpmPropietario=240 -JrpmIngresos=360
```

Las tasas van **por minuto**, que es la unidad del temporizador de JMeter: 3000 por minuto son
50 por segundo.

Parámetros disponibles: `protocol`, `host`, `port`, `csvDir`, `duration`, `p95Lectura`,
`p95Carrera`, `rpmAuth`, `rpmFalsos`, `rpmTecnico`, `rpmPropietario`, `rpmIngresos`,
`raceRounds`.

## Mostrar la corrida de forma visual

Hay dos maneras y conviene usar las dos, porque muestran cosas distintas.

**En vivo, con la interfaz de JMeter.** Es lo que se ve "corriendo": las peticiones entrando una
por una, la gráfica moviéndose. El plan ya trae cuatro visualizadores puestos pero **apagados**:
*Ver árbol de resultados*, *Informe resumen*, *Informe agregado* y *Gráfica de resultados*. Para
la demostración:

1. `jmeter` sin argumentos, y abre `perf/jmeter/fixup.jmx`.
2. En el árbol de la izquierda, clic derecho sobre cada visualizador → *Enable*. Se ven en gris
   cuando están apagados.
3. Baja las tasas para que la demostración se vea y no sature: *Parámetros* → cambia `rpmAuth` a
   600 y los demás parecido, o pásalos al arrancar.
4. Botón verde de arrancar.

Van apagados a propósito: encendidos guardan cada respuesta en memoria, frenan la corrida y
falsean los tiempos. Para la demostración eso no importa; para el número que se reporta, sí.

**El informe HTML, para los números.** Lo genera la corrida sin interfaz y queda en
`perf/.work/jmeter/informe/index.html`. Trae percentiles por operación, tiempo de respuesta en
el tiempo, peticiones por segundo y distribución de códigos. Es lo que se muestra cuando
preguntan "¿y cuánto dio?".

La forma honesta de presentarlo: se corre en vivo con tasas bajas para que se vea el mecanismo,
y se muestra el informe de la corrida de verdad para los resultados. Si se presenta el número
de una corrida con la interfaz encendida como si fuera la medición oficial, el número está
inflado y alguien lo puede notar.

## Los tokens

JMeter no firma nada. `fixtures-a-csv.mjs` toma el `fixtures.json` que deja la siembra de k6 y
escribe cuatro CSV con los tokens ya firmados:

| Archivo | Columnas | Para |
| --- | --- | --- |
| `usuarios.csv` | `token` | FR-UC-21 |
| `tecnicos.csv` | `token` | Lecturas del técnico y panel de ingresos |
| `propietarios.csv` | `token,requestId` | Lecturas del propietario |
| `carrera.csv` | `ownerToken,quotationId` | Carrera de aceptación |

Esto evita meter criptografía RSA dentro del plan con samplers en Groovy, y de paso garantiza
que las dos herramientas midan sobre exactamente los mismos datos.

## La carrera, y el detalle que la puede romper

El grupo de la carrera corre con **4 hilos** y un temporizador de sincronía con
**groupSize 4**. Los dos números tienen que ser iguales al número de ofertas que la siembra
crea por cada solicitud de carrera, porque `carrera.csv` las escribe consecutivas y los hilos
leen el archivo en orden: cada bloque de 4 filas es una misma solicitud.

Si cambias `raceQuotes` en la siembra, hay que cambiar los dos valores en el plan. El script de
conversión te lo recuerda: imprime el `groupSize` que debería tener.

Si no coinciden, el temporizador espera un bloque que nunca se completa, agota su tiempo y las
peticiones salen desincronizadas. La prueba no falla con un error claro — simplemente deja de
probar lo que dice probar, que es peor.

## Editar el plan

El `.jmx` se genera. Si hay que cambiarlo, se cambia el generador y se vuelve a generar, no se
edita el XML a mano ni se guarda encima desde la interfaz de JMeter. Abrirlo en la interfaz para
mirarlo está bien; guardarlo desde ahí reordena medio archivo y el siguiente diff es ilegible.
