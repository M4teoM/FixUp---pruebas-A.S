// RNF-20 — "La API deberá contar con una caracterización reproducible de desempeño bajo carga
// representativa, con objetivos explícitos de latencia y errores."
//
// Métrica declarada: ejecutar k6 con carga y datos documentados, y registrar RPS, p95, p99, tasa
// de errores y CPU/memoria. Los umbrales están "por aprobar".
//
// Eso último manda sobre el diseño de este guion y conviene entenderlo: **aquí no se declaran
// umbrales de latencia**. Una caracterización mide y reporta; no emite veredicto. Poner un p95
// máximo convertiría un valor de prueba en un objetivo aprobado, que es justo lo que la hoja de
// requisitos advierte que no se haga. Lo único que sí reprueba es la tasa de errores, porque un
// 5xx no es una medición: es un defecto, con o sin umbral ratificado.
//
// Para contraste: perf/k6/rnf01-busqueda.js sí declara umbral, porque RNF-01 tiene un objetivo
// aprobado de 3 s. Son dos requisitos distintos y por eso los dos guiones se comportan distinto.
//
// Carga representativa: los tres casos de uso que nombra el requisito, corriendo a la vez.
//   UC-05  publicación y búsqueda de inmuebles
//   UC-12  responder solicitudes y cotizar
//   UC-13  gestión de trabajos activos
//
// Requiere las dos siembras:
//   node perf/seed.mjs                       -> fixtures.json  (UC-12, UC-13)
//   node perf/rnf01/seed-catalogo.mjs        -> catalogo.json  (UC-05)
import exec from 'k6/execution';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { TREND_STATS, get, summaryWriter } from './common.js';

const WORK = __ENV.PERF_WORK || '../.work';
const fixtures = JSON.parse(open(`${WORK}/fixtures.json`));
const catalogo = JSON.parse(open(`${WORK}/catalogo.json`));

// Cuántas filas devuelve cada lectura. No es desempeño: es la prueba de que se midió contra datos
// y no contra tablas vacías, que es la forma más fácil de publicar un p95 excelente y falso.
const filasDevueltas = new Trend('filas_devueltas');

// La meseta y la rampa se parametrizan porque RNF-04 reutiliza este mismo guion para observar el
// escalado: allí la rampa es el estímulo, aquí es solo la entrada a la medición.
const RPS = Number(__ENV.RNF20_RPS || 60);
const SUBIDA = __ENV.RNF20_RAMP_UP || '30s';
const MESETA = __ENV.RNF20_PLATEAU || '120s';
const BAJADA = __ENV.RNF20_RAMP_DOWN || '15s';

const etapas = [
  { target: RPS, duration: SUBIDA },
  { target: RPS, duration: MESETA },
  { target: 0, duration: BAJADA },
];

function escenario(exec_, peso) {
  return {
    executor: 'ramping-arrival-rate',
    exec: exec_,
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 20,
    maxVUs: 400,
    stages: etapas.map((e) => ({ target: Math.max(1, Math.round(e.target * peso)), duration: e.duration })),
  };
}

// Las siete lecturas que componen la carga. La lista existe aparte porque hay que declararle a k6
// una submétrica por operación: k6 solo guarda los percentiles de una etiqueta en el resumen si
// esa etiqueta tiene un umbral declarado. Sin esto el resumen traería un p95 global y nada más,
// que es precisamente lo que una caracterización no puede entregar.
const OPERACIONES = [
  'uc05_search', 'uc05_catalog',
  'uc12_bandeja', 'uc12_mis_cotizaciones', 'uc12_ofertas_recibidas',
  'uc13_mis_trabajos', 'uc13_ingresos',
];

function umbrales() {
  const t = {
    // Los errores sí reprueban, con umbral ratificado o sin él: un 5xx no es una medición lenta,
    // es un defecto.
    http_req_failed: ['rate<0.01'],
    // Si las lecturas vuelven vacías, la corrida no caracteriza nada.
    filas_devueltas: ['med>0'],
  };
  for (const op of OPERACIONES) {
    // 'max>=0' no juzga nada: una duración nunca es negativa, así que se cumple siempre. Está para
    // que k6 materialice la submétrica y el resumen traiga p95, p99 y conteo de esta operación por
    // separado. Deliberadamente no hay un 'p(95)<algo': los umbrales de RNF-20 están por aprobar.
    // (Sobre un trend, k6 solo admite avg, min, max, med y p(N); 'count' no sirve aquí.)
    t[`http_req_duration{name:${op}}`] = ['max>=0'];
    t[`http_req_failed{name:${op}}`] = ['rate<0.01'];
  }
  return t;
}

export const options = {
  summaryTrendStats: TREND_STATS,
  thresholds: umbrales(),
  scenarios: {
    // El reparto imita el uso esperado: se busca mucho más de lo que se cotiza o se gestiona.
    uc05_busqueda: escenario('uc05Busqueda', 0.5),
    uc12_cotizaciones: escenario('uc12Cotizaciones', 0.3),
    uc13_trabajos: escenario('uc13Trabajos', 0.2),
  },
};

const buscadores = [catalogo.owner.token, catalogo.tenant.token];
const tokenBusqueda = (i) => buscadores[i % buscadores.length];
const tecnico = (i) => fixtures.fixers[i % fixtures.fixers.length];
const propietario = (i) => fixtures.owners[i % fixtures.owners.length];

function contar(res) {
  if (res.status !== 200) return;
  try {
    const cuerpo = res.json();
    filasDevueltas.add(Array.isArray(cuerpo) ? cuerpo.length
      : Array.isArray(cuerpo.items) ? cuerpo.items.length
        : Array.isArray(cuerpo.history) ? cuerpo.history.length : 1);
  } catch (_) {
    // Un cuerpo ilegible ya lo marca http_req_failed.
  }
}

export function uc05Busqueda() {
  const i = exec.scenario.iterationInTest;
  if (i % 2 === 0) {
    const b = catalogo.busquedas[i % catalogo.busquedas.length];
    const res = get(`/properties/search?latitude=${b.latitude}&longitude=${b.longitude}`
      + `&radiusKm=${b.radiusKm}&ownershipScope=ALL`, tokenBusqueda(i), 'uc05_search');
    check(res, { 'búsqueda 200': (r) => r.status === 200 });
    contar(res);
  } else {
    const f = catalogo.filtros[i % catalogo.filtros.length];
    const res = get(`/properties/catalog?city=${encodeURIComponent(f.city)}`
      + `&listingType=${f.listingType}&minPrice=${f.minPrice}&maxPrice=${f.maxPrice}`
      + `&page=0&size=12`, tokenBusqueda(i), 'uc05_catalog');
    check(res, { 'catálogo 200': (r) => r.status === 200 });
    contar(res);
  }
}

export function uc12Cotizaciones() {
  const i = exec.scenario.iterationInTest;
  switch (i % 3) {
    case 0: {
      const res = get('/requests/open', tecnico(i).token, 'uc12_bandeja');
      check(res, { 'bandeja 200': (r) => r.status === 200 });
      contar(res);
      break;
    }
    case 1: {
      const res = get('/quotations/me', tecnico(i).token, 'uc12_mis_cotizaciones');
      check(res, { 'mis cotizaciones 200': (r) => r.status === 200 });
      contar(res);
      break;
    }
    default: {
      const o = propietario(i);
      const requestId = o.openRequests[i % o.openRequests.length];
      const res = get(`/quotations/for-request/${requestId}`, o.token, 'uc12_ofertas_recibidas');
      check(res, { 'ofertas 200': (r) => r.status === 200 });
      contar(res);
    }
  }
}

export function uc13Trabajos() {
  const i = exec.scenario.iterationInTest;
  const f = tecnico(i);
  if (i % 2 === 0) {
    const res = get('/jobs/me', f.token, 'uc13_mis_trabajos');
    check(res, { 'trabajos 200': (r) => r.status === 200 });
    contar(res);
  } else {
    const res = get('/payments/me/earnings', f.token, 'uc13_ingresos');
    check(res, { 'ingresos 200': (r) => r.status === 200 });
    contar(res);
  }
}

export const handleSummary = summaryWriter('rnf20');
