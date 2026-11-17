// Prueba de carga corta para mostrar en vivo, contra el ambiente de demostración.
//
//   k6 run perf/k6/en-vivo.js
//
// No reemplaza a las mediciones oficiales de RNF-01 (JMeter, 5.000 inmuebles) ni de RNF-20 (k6,
// 10.030 inmuebles): esas necesitan su propio ambiente con el catálogo grande sembrado, y tardan
// minutos en montarse. Esta corre contra el mismo backend que usan las pruebas de navegador, en
// treinta segundos, para que se vea la herramienta trabajando: muchas peticiones a la vez, cuánto
// tarda cada operación y cuántas fallan.
//
// Se autentica con /demo/token, así que solo funciona contra un backend con perfil demo.
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';

const API = __ENV.API || 'http://localhost:8080';
const RITMO = Number(__ENV.RITMO || 30);       // peticiones por segundo de cada escenario
const DURACION = __ENV.DURACION || '30s';

function escenario(funcion) {
  return {
    executor: 'constant-arrival-rate',
    exec: funcion,
    rate: RITMO,
    timeUnit: '1s',
    duration: DURACION,
    preAllocatedVUs: 20,
    maxVUs: 150,
  };
}

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    propietaria: escenario('propietaria'),
    tecnico: escenario('tecnico'),
  },
  thresholds: {
    // Lo que reprueba la corrida: errores.
    http_req_failed: ['rate<0.01'],
    // RNF-01 tiene umbral aprobado: 3 s para el 95 % de las búsquedas.
    'http_req_duration{op:busqueda}': ['p(95)<3000'],
    // Las demás se declaran solo para que k6 las muestre por separado al final.
    // 'max>=0' se cumple siempre: no juzga, solo hace visible la operación.
    'http_req_duration{op:catalogo}': ['max>=0'],
    'http_req_duration{op:mis_trabajos}': ['max>=0'],
    'http_req_duration{op:mis_cotizaciones}': ['max>=0'],
  },
};

export function setup() {
  const token = (rol) => {
    const r = http.get(`${API}/demo/token?role=${rol}`, { tags: { op: 'token' } });
    if (r.status !== 200) {
      throw new Error(`/demo/token?role=${rol} respondió ${r.status}. ¿El backend está arriba con perfil demo?`);
    }
    return r.json('accessToken');
  };
  return { propietaria: token('OWNER'), tecnico: token('FIXER') };
}

const conToken = (token, op) => ({ headers: { Authorization: `Bearer ${token}` }, tags: { op } });

export function propietaria(datos) {
  if (exec.scenario.iterationInTest % 2 === 0) {
    // El peor caso de RNF-01: radio de 50 km sobre el centro de Bogotá.
    const r = http.get(`${API}/properties/search?latitude=4.7110&longitude=-74.0721&radiusKm=50&ownershipScope=ALL`,
      conToken(datos.propietaria, 'busqueda'));
    check(r, { 'búsqueda responde 200': (x) => x.status === 200 });
  } else {
    const r = http.get(`${API}/properties/catalog?page=0&size=12`, conToken(datos.propietaria, 'catalogo'));
    check(r, { 'catálogo responde 200': (x) => x.status === 200 });
  }
}

export function tecnico(datos) {
  if (exec.scenario.iterationInTest % 2 === 0) {
    const r = http.get(`${API}/jobs/me`, conToken(datos.tecnico, 'mis_trabajos'));
    check(r, { 'trabajos responde 200': (x) => x.status === 200 });
  } else {
    const r = http.get(`${API}/quotations/me`, conToken(datos.tecnico, 'mis_cotizaciones'));
    check(r, { 'cotizaciones responde 200': (x) => x.status === 200 });
  }
}
