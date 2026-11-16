// Arma la tabla de caracterización de RNF-20 cruzando dos fuentes que se miden por separado:
// el resumen de k6 (lo que vio el cliente) y las muestras de `docker stats` (lo que costó al
// servidor). La métrica del requisito pide las dos cosas en el mismo informe.
//
//   node perf/rnf20/caracterizacion.mjs <dirTrabajo> [inicioUnix] [finUnix]
//
// Lo llama perf/rnf20/medir.ps1, que es quien conoce la ventana de la corrida. Suelto también
// sirve: sin ventana, usa todas las muestras del archivo.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const work = process.argv[2] || 'perf/.work';
const desde = Number(process.argv[3] || 0);
const hasta = Number(process.argv[4] || Number.MAX_SAFE_INTEGER);

const rutaResumen = join(work, 'summary-rnf20.json');
const rutaRecursos = join(work, 'recursos-rnf20.jsonl');
const salida = join(work, 'caracterizacion-rnf20.md');

if (!existsSync(rutaResumen)) {
  console.error(`No encuentro ${rutaResumen}. ¿Corrió k6?`);
  process.exit(1);
}
const resumen = JSON.parse(readFileSync(rutaResumen, 'utf8'));

// ----------------------------------------------------------------- latencia por operación
const PREFIJO = 'http_req_duration{name:';
const operaciones = [];
for (const [clave, metrica] of Object.entries(resumen.metrics)) {
  if (!clave.startsWith(PREFIJO)) continue;
  const nombre = clave.slice(PREFIJO.length, -1);
  const v = metrica.values;
  const fallos = resumen.metrics[`http_req_failed{name:${nombre}}`]?.values?.rate;
  operaciones.push({
    nombre,
    n: v.count,
    p50: v.med,
    p95: v['p(95)'],
    p99: v['p(99)'],
    max: v.max,
    errores: fallos,
  });
}
operaciones.sort((a, b) => a.nombre.localeCompare(b.nombre));

const duracionS = (resumen.state?.testRunDurationMs ?? 0) / 1000;
const totalPeticiones = resumen.metrics.http_reqs?.values?.count ?? 0;
const tasaErrorGlobal = resumen.metrics.http_req_failed?.values?.rate ?? 0;
const filas = resumen.metrics.filas_devueltas?.values;

// ----------------------------------------------------------------- CPU y memoria
// `docker stats` entrega texto formateado, no números: "1.23%" y "512MiB / 7.6GiB". Hay que
// convertirlo antes de poder promediar.
const UNIDADES = { b: 1 / 1048576, kib: 1 / 1024, mib: 1, gib: 1024, kb: 1 / 1024, mb: 1, gb: 1024 };

function aMiB(texto) {
  const m = /^([\d.]+)\s*([a-zA-Z]+)$/.exec((texto || '').trim());
  if (!m) return null;
  const factor = UNIDADES[m[2].toLowerCase()];
  return factor === undefined ? null : Number(m[1]) * factor;
}
const aPorcentaje = (texto) => {
  const n = Number(String(texto || '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

const contenedores = new Map();
let muestrasLeidas = 0;
let muestrasEnVentana = 0;

if (existsSync(rutaRecursos)) {
  for (const cruda of readFileSync(rutaRecursos, 'utf8').split('\n')) {
    // Windows PowerShell 5.1 escribe una marca de orden de bytes al crear el archivo. Sin quitarla
    // la primera muestra no parsea, que es justo la del arranque de la corrida.
    const linea = cruda.replace(/^﻿/, '').trim();
    if (!linea) continue;
    muestrasLeidas++;
    let registro;
    try { registro = JSON.parse(linea); } catch { continue; }
    if (registro.t < desde || registro.t > hasta) continue;
    muestrasEnVentana++;

    const s = registro.s || {};
    const nombre = s.Name || s.Container || '(sin nombre)';
    const cpu = aPorcentaje(s.CPUPerc);
    const mem = aMiB(String(s.MemUsage || '').split('/')[0]);

    if (!contenedores.has(nombre)) contenedores.set(nombre, { cpu: [], mem: [] });
    const c = contenedores.get(nombre);
    if (cpu !== null) c.cpu.push(cpu);
    if (mem !== null) c.mem.push(mem);
  }
}

const promedio = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const maximo = (a) => (a.length ? Math.max(...a) : null);

// ----------------------------------------------------------------- procedencia de la corrida
// Un informe de caracterización sin la versión medida no es reproducible: es un número suelto.
function gitRev() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '(desconocido)';
  }
}
function escala(archivo, campo) {
  try {
    const d = JSON.parse(readFileSync(join(work, archivo), 'utf8'));
    return Array.isArray(d[campo]) ? d[campo].length : (d[campo] ?? '?');
  } catch {
    return '?';
  }
}

const n1 = (x) => (x === null || x === undefined ? '—' : x.toFixed(1));
const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(2)} %`);

// ----------------------------------------------------------------- el informe
const L = [];
L.push('# RNF-20 — Caracterización de desempeño bajo carga representativa', '');
L.push('> **Requisito.** La API deberá contar con una caracterización reproducible de desempeño');
L.push('> bajo carga representativa, con objetivos explícitos de latencia y errores.', '');
L.push('> **Métrica declarada.** Ejecutar k6 con carga y datos documentados y registrar RPS, p95,');
L.push('> p99, tasa de errores y CPU/memoria. **Umbrales por aprobar.**', '');
L.push('Este informe mide y reporta; no emite veredicto de latencia. Mientras los umbrales de');
L.push('RNF-20 no estén ratificados, presentar estos valores como "cumple" sería convertir una');
L.push('medición en un objetivo aprobado. Lo único que reprueba la corrida es la tasa de errores.', '');

L.push('## Condiciones de la corrida', '');
L.push('| Dato | Valor |');
L.push('| --- | --- |');
L.push(`| Fecha | ${new Date().toISOString()} |`);
L.push(`| Versión del arnés | \`${gitRev()}\` |`);
L.push(`| Guion | \`perf/k6/rnf20-caracterizacion.js\` |`);
L.push(`| Carga nominal | ${process.env.RNF20_RPS || 60} pet/s repartidos 50 % UC-05 / 30 % UC-12 / 20 % UC-13 |`);
L.push(`| Etapas | subida ${process.env.RNF20_RAMP_UP || '30s'}, meseta ${process.env.RNF20_PLATEAU || '120s'}, bajada ${process.env.RNF20_RAMP_DOWN || '15s'} |`);
L.push(`| Duración medida | ${duracionS.toFixed(1)} s |`);
// La cifra autorizada es la que se contó en la base al arrancar la corrida. catalogo.json solo dice
// cuántos sembró la última ejecución del sembrador, que no es lo mismo si la base venía con datos.
const enBase = process.env.RNF20_PROPIEDADES;
L.push(enBase
  ? `| Inmuebles en la base | ${enBase} (contados al arrancar; la última siembra aportó ${escala('catalogo.json', 'total')}) |`
  : `| Inmuebles en la base | sin contar — la cifra de la última siembra fue ${escala('catalogo.json', 'total')}, pero la base puede traer más |`);
L.push(`| Técnicos / propietarios | ${escala('fixtures.json', 'fixers')} / ${escala('fixtures.json', 'owners')} |`);
L.push(`| Muestras de recursos | ${muestrasEnVentana} en ventana (de ${muestrasLeidas} tomadas) |`);
L.push('');

L.push('## Latencia y errores por operación', '');
L.push('| Operación | Peticiones | pet/s medio | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) | Errores |');
L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const o of operaciones) {
  const rps = duracionS > 0 ? o.n / duracionS : null;
  L.push(`| \`${o.nombre}\` | ${o.n} | ${n1(rps)} | ${n1(o.p50)} | ${n1(o.p95)} | ${n1(o.p99)} | ${n1(o.max)} | ${pct(o.errores)} |`);
}
L.push('');
L.push(`**Total.** ${totalPeticiones} peticiones en ${duracionS.toFixed(1)} s `
  + `(${duracionS > 0 ? (totalPeticiones / duracionS).toFixed(1) : '—'} pet/s medio), `
  + `tasa de errores ${pct(tasaErrorGlobal)}.`, '');
L.push('El "pet/s medio" se calcula sobre la corrida completa, rampas incluidas, así que queda por');
L.push('debajo del ritmo de la meseta. Es a propósito: es el número que se puede verificar contra');
L.push('el resumen crudo sin recortar la serie a mano.', '');

if (filas) {
  L.push(`**Filas devueltas por lectura:** mediana ${n1(filas.med)}, p95 ${n1(filas['p(95)'])}, `
    + `máx ${n1(filas.max)}. Confirma que se midió contra datos y no contra tablas vacías, `
    + 'que es la forma más fácil de publicar un p95 excelente y falso.', '');
}

L.push('## CPU y memoria', '');
if (contenedores.size === 0) {
  L.push('No hay muestras de recursos en la ventana de la corrida. La mitad de la métrica queda sin');
  L.push('cubrir: hay que repetir la corrida con `perf/rnf20/medir.ps1`, que es quien levanta el');
  L.push('muestreo de `docker stats` en paralelo.', '');
} else {
  L.push('| Contenedor | CPU media | CPU máx | Memoria media | Memoria máx | Muestras |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const [nombre, c] of [...contenedores].sort()) {
    L.push(`| \`${nombre}\` | ${n1(promedio(c.cpu))} % | ${n1(maximo(c.cpu))} % | `
      + `${n1(promedio(c.mem))} MiB | ${n1(maximo(c.mem))} MiB | ${c.cpu.length} |`);
  }
  L.push('');
  L.push('Son los contenedores del entorno de medición en una máquina de escritorio, no un entorno');
  L.push('productivo. Sirven para comparar corridas entre sí y para ver cuál componente se satura');
  L.push('primero; no para dimensionar infraestructura. Eso corresponde a RNF-04.', '');
}

L.push('## Qué queda abierto', '');
L.push('1. Ratificar los umbrales de latencia de RNF-20. Hasta entonces el guion no los declara.');
L.push('2. La carga nominal (60 pet/s con ese reparto) es una propuesta basada en los casos de uso');
L.push('   que nombra el requisito, no un dato de operación. Conviene que quede aprobada junto con');
L.push('   los umbrales, porque un p95 sin su carga no significa nada.');
L.push('3. Los percentiles son del backend. El requisito habla de la API, así que aquí coinciden;');
L.push('   para lo que ve el usuario en pantalla, ver RNF-01.', '');

L.push('---', '');
L.push('Generado por `perf/rnf20/caracterizacion.mjs` a partir de `summary-rnf20.json` y');
L.push('`recursos-rnf20.jsonl`. No se edita a mano: se regenera.');

writeFileSync(salida, L.join('\n'), 'utf8');
console.log('escrito', salida);
console.log(`${operaciones.length} operaciones, ${contenedores.size} contenedores, ${muestrasEnVentana} muestras.`);
