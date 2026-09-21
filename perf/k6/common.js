// Utilidades compartidas por los escenarios k6.
import http from 'k6/http';
import { Counter } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080';
export const OUT_DIR = __ENV.OUT_DIR || 'perf/.work';
export const RATE_FACTOR = Number(__ENV.RATE_FACTOR || 1);

// Los datos sembrados. open() solo funciona en el contexto de inicio de k6.
export const fixtures = JSON.parse(open(`${__ENV.PERF_WORK || '../.work'}/fixtures.json`));

// Violaciones de integridad: dinero cobrado dos veces, dos ofertas aceptadas para una solicitud.
// La meta es cero, sin tolerancia.
export const integrityViolations = new Counter('integrity_violations');

/** Tasa escalada: el ensayo local corre al 20 %, GitHub Actions al 100 %. */
export const rate = (perSecond) => Math.max(1, Math.round(perSecond * RATE_FACTOR));

export const pick = (list, i) => list[i % list.length];

export function auth(token) {
  return { authorization: `Bearer ${token}` };
}

export function get(path, token, name, expected = [200]) {
  return http.get(`${BASE_URL}${path}`, {
    headers: auth(token),
    tags: { name },
    responseCallback: http.expectedStatuses(...expected)
  });
}

export function post(path, token, name, body, expected = [200, 201]) {
  const headers = auth(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return http.post(`${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers,
    tags: { name },
    responseCallback: http.expectedStatuses(...expected)
  });
}

/**
 * Umbrales por operación. Además de juzgar, obligan a k6 a guardar en el resumen los percentiles,
 * el conteo y la tasa de errores de cada operación por separado.
 */
export function thresholdsFor(endpoints) {
  const t = { integrity_violations: ['count==0'] };
  for (const [name, target] of Object.entries(endpoints)) {
    t[`http_req_duration{name:${name}}`] = [`p(95)<${target.p95}`, `p(99)<${target.p99}`];
    t[`http_req_failed{name:${name}}`] = [`rate<${target.errors ?? 0.01}`];
    t[`http_reqs{name:${name}}`] = ['count>0'];
  }
  return t;
}

export const TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'];

/** Guarda el resumen completo en JSON para el informe y deja una línea legible en la consola. */
export function summaryWriter(label) {
  return (data) => {
    const lines = [`\n== ${label} ==`];
    for (const [key, metric] of Object.entries(data.metrics)) {
      if (!key.startsWith('http_req_duration{name:')) continue;
      const v = metric.values;
      const name = key.slice('http_req_duration{name:'.length, -1);
      lines.push(`${name.padEnd(28)} n=${String(v.count).padStart(6)}  p50=${v.med.toFixed(1)}ms  ` +
        `p95=${v['p(95)'].toFixed(1)}ms  p99=${v['p(99)'].toFixed(1)}ms  max=${v.max.toFixed(1)}ms`);
    }
    const violations = data.metrics.integrity_violations?.values?.count ?? 0;
    lines.push(`integrity_violations = ${violations}`);
    return {
      [`${OUT_DIR}/summary-${label}.json`]: JSON.stringify(data, null, 2),
      stdout: lines.join('\n') + '\n'
    };
  };
}
