# Pruebas de desempeño — FR-UC-18, FR-UC-20 y FR-UC-21

Carga, concurrencia y disponibilidad sobre el stack real de `compose.local.yml`: PostgreSQL 17 con
las políticas RLS activas, el backend en contenedor y tokens RS256 que el backend valida de verdad.

## Qué se mide

| Caso | Escenarios |
| --- | --- |
| FR-UC-21 | `/auth/me` nominal (50 req/s) y en rampa hasta 300 req/s; `/auth/bootstrap` de sesiones existentes; rechazo de tokens con firma falsa |
| FR-UC-18 | Lecturas del técnico y del propietario (50 req/s en total); cotizaciones nuevas (10 req/s); aceptaciones simultáneas sobre la misma solicitud |
| FR-UC-20 | Panel de ingresos (30 req/s); cierre de trabajos (5 req/s); solicitudes de transferencia simultáneas del mismo técnico |
| Disponibilidad | Sondeo cada 100 ms mientras se provoca: caída abrupta del backend, reinicio planificado y reinicio de PostgreSQL |

Las carreras verifican integridad, no solo latencia: exactamente una aceptación gana y exactamente
una transferencia se lleva el saldo; cualquier desvío suma a `integrity_violations`, cuya meta es 0.

## Por qué un emisor de tokens propio

Pedirle miles de tokens a Auth0 no es viable. `perf/lib/jwt.mjs` genera una llave RSA por corrida,
`perf/jwks-server.mjs` la publica, y el backend la usa porque `AUTH0_ISSUER_URI` apunta a ese
contenedor. El código del backend no cambia y la validación criptográfica medida es la real.

## Cómo correrlo

En GitHub Actions: pestaña *Actions* → *Performance* → *Run workflow*. El resumen del job muestra el
informe completo y el artefacto `performance-results` guarda los JSON de k6.

En un equipo con Docker, Node 22, Java 21 y k6, con `fixup-backend` compilado y su `.jar` copiado en
`perf/backend/app.jar`:

```bash
PERF_SCALE=full RATE_FACTOR=1 perf/run.sh
```

`PERF_SCALE=small` y `RATE_FACTOR=0.2` sirven para un ensayo rápido.
