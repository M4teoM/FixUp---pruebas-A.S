# Despliegue distribuido en dos computadores

La primera entrega exige, textualmente, que **el sistema completo este distribuido en dos o mas
computadores** y que **pueda iniciarse con un unico script desde uno de ellos**. El despliegue que
teniamos (`compose.local.yml`) no cumplia ninguna de las dos cosas: levantaba los tres contenedores
en una sola maquina y publicaba los puertos solo en `127.0.0.1`, asi que nada era alcanzable desde
la red.

## Reparto

| Maquina | Rol | Contenedores | Archivo |
|---|---|---|---|
| **A** | Nodo de datos | PostgreSQL 17 | `compose.data.yml` |
| **B** | Nodo de aplicacion | API Spring Boot + PWA nginx | `compose.app.yml` |

La maquina B es la unica que se toca. Controla el Docker de la maquina A con un **contexto remoto
sobre SSH**, que es la forma estandar de operar un demonio ajeno sin instalar nada adicional.

```
   Maquina B (portatil que sustenta)          Maquina A (segundo portatil)
   ┌──────────────────────────────┐  ssh://   ┌───────────────────────────┐
   │ start-distributed.sh         │──────────▶│ dockerd                   │
   │  ├─ contexto fixup-data      │           │  └─ postgres:17  :5432    │
   │  ├─ backend  :8080 ──────────┼──jdbc────▶│     (0.0.0.0, no loopback)│
   │  └─ frontend :4200           │           └───────────────────────────┘
   └──────────────────────────────┘
```

## Preparacion, una sola vez

**En la maquina A:** Docker corriendo y acceso SSH con llave desde B.

```bash
# desde la maquina B
ssh-copy-id estudiante@192.168.1.10
ssh estudiante@192.168.1.10 docker info     # debe responder sin pedir contrasena
```

**En la maquina B:**

```bash
cp config/distributed.env.example .env.distributed
# editar DATA_HOST, DATA_SSH y APP_HOST con las IP reales de la red donde se sustenta
```

Las IP se toman de la red real del salon. `ipconfig getifaddr en0` en macOS, `hostname -I` en Linux,
`ipconfig` en Windows. Si la red del salon aisla a los clientes entre si, se levanta un punto de
acceso propio desde un telefono y se conectan los dos portatiles ahi.

## Inicio

```bash
./scripts/start-distributed.sh
```

El script hace seis cosas y deja evidencia escrita de cada una en `evidencia/despliegue-<fecha>/`:

1. crea o actualiza el contexto `fixup-data` y comprueba que la maquina A responde;
2. levanta PostgreSQL alla y espera a `pg_isready`;
3. inyecta `http://APP_HOST:8080` como origen del API en el bundle de Angular — `environment.ts`
   se resuelve al compilar, asi que hay que hacerlo antes de construir la imagen; el archivo se
   restaura solo al terminar;
4. construye y levanta API y PWA en la maquina B;
5. **prueba que el trafico cruza la red**: abre el socket TCP contra la maquina A desde dentro del
   contenedor del backend y lee `flyway_schema_history` ejecutando `psql` en la maquina A;
6. consulta la salud de los dos extremos publicados.

Para apagar: `./scripts/stop-distributed.sh` (con `--purge` borra tambien el volumen de datos).

## Que mostrar en la sustentacion

Son unos tres minutos y conviene ensayarlos con las dos maquinas en la mesa.

1. **Que son dos maquinas de verdad.** `docker ps` en B muestra `backend` y `frontend`;
   `docker --context fixup-data ps` muestra `database` y el `hostname` de la otra maquina. Mejor
   aun: girar el segundo portatil hacia el profesor con su `docker ps` en pantalla.
2. **Que se inicia con un solo comando.** Apagar todo con `stop-distributed.sh` y volver a correr
   `start-distributed.sh` sin tocar la maquina A. Cronometrarlo: el tiempo de arranque es la
   medida cuantitativa del atributo, junto con el numero de pasos manuales, que es cero.
3. **Que el dato vive en la otra maquina.** Crear algo desde la PWA (una solicitud de reparacion) y
   leerlo con `psql` en la maquina A. Es la prueba de que no hay una base escondida en B.
4. **Que se cae si se apaga A.** Detener la base en la maquina A y mostrar que `/actuator/health`
   del backend pasa a `DOWN`; volver a levantarla y mostrar la recuperacion. Eso conecta
   desplegabilidad con disponibilidad y se responde solo la pregunta de "y como sabe que de verdad
   depende de la otra maquina".

## Lo que este montaje no pretende ser

Es un despliegue de demostracion, no produccion: la base publica el puerto en la red local sin TLS
y las credenciales viven en `.env.distributed`. Para produccion estan los manifiestos de Kubernetes
y el `cd.yml` del repositorio del backend, que despliegan contra un cluster con secretos
gestionados. Vale la pena decirlo en voz alta antes de que lo pregunten.
