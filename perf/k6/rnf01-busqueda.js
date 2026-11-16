// RNF-01 — "La búsqueda de inmuebles por geolocalización y filtros debe mostrar resultados en
// menos de 3 segundos". Métrica declarada: p95 ≤ 3 s con un catálogo de hasta 5.000 inmuebles.
//
// El umbral va declarado aquí abajo, así que la corrida reprueba sola si el p95 se pasa. Ese es
// el motivo de medir esto con k6 además de JMeter: JMeter da el informe, k6 da el veredicto.
//
// Alcance de lo que se mide: el tiempo de la API, no el pintado en pantalla. La métrica habla de
// "mostrar resultados en la interfaz", así que al reportar hay que decir que estos 3 s son el
// presupuesto del backend y que el render se mide aparte, o el número se lee como algo que no es.
import exec from 'k6/execution';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { TREND_STATS, get, summaryWriter } from './common.js';

const catalogo = JSON.parse(open(`${__ENV.PERF_WORK || '../.work'}/catalogo.json`));

// Cuántas filas devuelve cada búsqueda. No es una métrica de desempeño: es la prueba de que se
// midió contra un catálogo poblado. Un p95 excelente sobre cero resultados no vale nada, y este
// número lo delata en el informe.
const resultados = new Trend('resultados_devueltos');
const busquedasVacias = new Counter('busquedas_sin_resultados');

const P95 = Number(__ENV.RNF01_P95_MS || 3000);
const P99 = Number(__ENV.RNF01_P99_MS || 5000);
const TASA = Number(__ENV.RNF01_RATE || 30);
const DURACION = __ENV.RNF01_DURATION || '60s';

export const options = {
  summaryTrendStats: TREND_STATS,
  thresholds: {
    // El requisito, tal cual, por operación.
    'http_req_duration{name:property_search}': [`p(95)<${P95}`, `p(99)<${P99}`],
    'http_req_duration{name:property_catalog}': [`p(95)<${P95}`, `p(99)<${P99}`],
    'http_req_failed{name:property_search}': ['rate<0.01'],
    'http_req_failed{name:property_catalog}': ['rate<0.01'],
    // Si la mediana de resultados es cero, el catálogo no está sembrado y la corrida no prueba
    // el requisito aunque los tiempos salgan perfectos.
    resultados_devueltos: ['med>0'],
  },
  scenarios: {
    busqueda_geografica: {
      executor: 'constant-arrival-rate', exec: 'busquedaGeografica',
      rate: TASA, timeUnit: '1s', duration: DURACION, preAllocatedVUs: 20, maxVUs: 200,
    },
    catalogo_con_filtros: {
      executor: 'constant-arrival-rate', exec: 'catalogoConFiltros',
      rate: TASA, timeUnit: '1s', duration: DURACION, preAllocatedVUs: 20, maxVUs: 200,
    },
    // El peor caso del requisito: radio grande sobre la nube densa de Bogotá, que obliga a
    // calcular la distancia de casi todo el catálogo. Arranca después para no mezclarse con la
    // medición nominal.
    radio_amplio: {
      executor: 'constant-arrival-rate', exec: 'radioAmplio', startTime: DURACION,
      rate: 5, timeUnit: '1s', duration: '30s', preAllocatedVUs: 10, maxVUs: 100,
    },
  },
};

const buscadores = [catalogo.owner.token, catalogo.tenant.token];
const tokenDe = (i) => buscadores[i % buscadores.length];

function medirResultados(res) {
  if (res.status !== 200) return;
  try {
    const cuerpo = res.json();
    const n = Array.isArray(cuerpo) ? cuerpo.length
      : Array.isArray(cuerpo.items) ? cuerpo.items.length
        : Number(cuerpo.totalElements ?? 0);
    resultados.add(n);
    if (n === 0) busquedasVacias.add(1);
  } catch (_) {
    // Un cuerpo que no se puede leer ya lo marca http_req_failed; aquí no se suma nada.
  }
}

export function busquedaGeografica() {
  const i = exec.scenario.iterationInTest;
  const b = catalogo.busquedas[i % catalogo.busquedas.length];
  const res = get(
    `/properties/search?latitude=${b.latitude}&longitude=${b.longitude}&radiusKm=${b.radiusKm}&ownershipScope=ALL`,
    tokenDe(i), 'property_search');
  check(res, { 'búsqueda 200': (r) => r.status === 200 });
  medirResultados(res);
}

export function catalogoConFiltros() {
  const i = exec.scenario.iterationInTest;
  const f = catalogo.filtros[i % catalogo.filtros.length];
  const q = `city=${encodeURIComponent(f.city)}&listingType=${f.listingType}&propertyType=${f.propertyType}`
    + `&minPrice=${f.minPrice}&maxPrice=${f.maxPrice}&minBedrooms=${f.minBedrooms}&stratum=${f.stratum}`
    + `&page=0&size=12`;
  const res = get(`/properties/catalog?${q}`, tokenDe(i), 'property_catalog');
  check(res, { 'catálogo 200': (r) => r.status === 200 });
  medirResultados(res);
}

export function radioAmplio() {
  const i = exec.scenario.iterationInTest;
  // Centro de Bogotá, 50 km: barre prácticamente todo lo sembrado en esa ciudad.
  const res = get('/properties/search?latitude=4.7110&longitude=-74.0721&radiusKm=50&ownershipScope=ALL',
    tokenDe(i), 'property_search');
  check(res, { 'radio amplio 200': (r) => r.status === 200 });
  medirResultados(res);
}

export const handleSummary = summaryWriter('rnf01');
