// Convierte los resúmenes de k6 y la prueba de disponibilidad en un informe Markdown (para el
// resumen del job en GitHub Actions) y en un results.json compacto con todas las cifras.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.OUT_DIR ?? 'perf/.work';
const RATE_FACTOR = Number(process.env.RATE_FACTOR ?? 1);
const read = (f) => (existsSync(join(OUT, f)) ? JSON.parse(readFileSync(join(OUT, f), 'utf8')) : null);

const CASES = [
  { id: 'uc21', title: 'FR-UC-21 — Autenticación y sesión', ops: {
    auth_me: ['GET /auth/me (nominal)', 300, 50],
    auth_me_peak: ['GET /auth/me (rampa 50→300/s)', 1000, null],
    auth_bootstrap: ['POST /auth/bootstrap (sesión existente)', 500, 20],
    forged_token: ['Token con firma falsa → 401', 300, 20] } },
  { id: 'uc18', title: 'FR-UC-18 — Responder solicitudes y cotizar', ops: {
    requests_open: ['GET /requests/open (bandeja)', 300, 10],
    request_detail: ['GET /requests/{id}', 300, 10],
    quotations_mine: ['GET /quotations/me', 300, 10],
    requests_mine: ['GET /requests/me', 300, 10],
    quotations_for_request: ['GET /quotations/for-request/{id}', 300, 10],
    quotation_submit: ['POST /quotations', 500, 10],
    quotation_accept_race: ['POST /quotations/{id}/accept (concurrente)', 1000, null] } },
  { id: 'uc20', title: 'FR-UC-20 — Ingresos del técnico', ops: {
    earnings_summary: ['GET /payments/me/earnings', 300, 10],
    jobs_mine: ['GET /jobs/me', 300, 10],
    payouts_mine: ['GET /payments/me/payouts', 300, 10],
    job_complete: ['POST /jobs/{id}/complete', 800, 5],
    payout_race: ['POST /payments/me/payouts (concurrente)', 1000, null] } }
];

const ms = (v) => (v === undefined || v === null ? '—' : `${v.toFixed(v < 10 ? 1 : 0)}`);
const results = { generatedAt: new Date().toISOString(), rateFactor: RATE_FACTOR, cases: {} };
const md = [];

const fixtures = read('fixtures.json');
md.push('# Pruebas de desempeño — FR-UC-18, 20 y 21', '');
md.push(`- Generado: ${results.generatedAt}`);
md.push(`- Backend: \`${process.env.BACKEND_REF ?? 'local'}\` @ \`${(process.env.BACKEND_SHA ?? '').slice(0, 7)}\``);
md.push(`- Máquina: ${process.env.RUNNER_INFO ?? 'local'}`);
md.push(`- Factor de tasa: ${RATE_FACTOR} · volumen: ${fixtures?.scale ?? '—'}`);
if (fixtures) {
  md.push(`- Siembra: ${fixtures.owners.length} propietarios, ${fixtures.fixers.length} técnicos, ` +
    `${fixtures.seed.apiCalls} llamadas en ${fixtures.seed.seconds} s`);
  results.seed = fixtures.seed;
}
md.push('');

for (const c of CASES) {
  const data = read(`summary-${c.id}.json`);
  md.push(`## ${c.title}`, '');
  if (!data) {
    md.push('_Sin resultados: el escenario no terminó._', '');
    continue;
  }
  md.push('| Operación | Peticiones | Tasa (req/s) | p50 ms | p95 ms | p99 ms | máx ms | Errores | Meta p95 | ¿Cumple? |');
  md.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |');
  const ops = {};
  for (const [name, [label, target, baseRate]] of Object.entries(c.ops)) {
    const d = data.metrics[`http_req_duration{name:${name}}`]?.values;
    const f = data.metrics[`http_req_failed{name:${name}}`]?.values;
    if (!d) continue;
    const errors = f ? f.rate : 0;
    const pass = d['p(95)'] < target && errors < 0.01;
    ops[name] = { label, count: d.count, med: d.med, p90: d['p(90)'], p95: d['p(95)'], p99: d['p(99)'],
      max: d.max, avg: d.avg, errorRate: errors, targetP95: target,
      rate: baseRate === null ? null : Math.max(1, Math.round(baseRate * RATE_FACTOR)), pass };
    md.push(`| ${label} | ${d.count} | ${ops[name].rate ?? '—'} | ${ms(d.med)} | ${ms(d['p(95)'])} | ` +
      `${ms(d['p(99)'])} | ${ms(d.max)} | ${(errors * 100).toFixed(2)} % | ${target} | ${pass ? 'sí' : 'NO'} |`);
  }
  const checks = Object.values(data.root_group.checks ?? {}).map((k) => ({ name: k.name, passes: k.passes, fails: k.fails }));
  const violations = data.metrics.integrity_violations?.values?.count ?? 0;
  const dropped = data.metrics.dropped_iterations?.values?.count ?? 0;
  const total = data.metrics.http_reqs?.values;
  md.push('');
  md.push(`Violaciones de integridad: **${violations}** · iteraciones descartadas por falta de capacidad: ${dropped} · ` +
    `total ${total?.count ?? 0} peticiones a ${total?.rate?.toFixed(1) ?? 0} req/s promedio.`);
  const failedChecks = checks.filter((k) => k.fails > 0);
  md.push(failedChecks.length === 0
    ? `Todas las verificaciones pasaron (${checks.length}).`
    : `Verificaciones con fallas: ${failedChecks.map((k) => `${k.name} (${k.fails}/${k.passes + k.fails})`).join('; ')}`);
  md.push('');
  results.cases[c.id] = { ops, checks, integrityViolations: violations, droppedIterations: dropped,
    totalRequests: total?.count ?? 0, avgRps: total?.rate ?? 0 };
}

const availability = read('availability.json');
md.push('## Disponibilidad bajo fallas', '');
if (availability) {
  md.push(`Sondeo cada ${availability.intervalMs} ms durante ${availability.durationSeconds} s ` +
    `(${availability.probes} sondeos). Disponibilidad total **${availability.availabilityPercent} %**; ` +
    `fuera de las ventanas de falla **${availability.steadyStateAvailabilityPercent} %**. ` +
    `Latencia de la sonda: p50 ${ms(availability.latencyMs.p50)} ms, p95 ${ms(availability.latencyMs.p95)} ms.`, '');
  md.push('| Falla provocada | Segundo | Detectada tras (s) | Tiempo caído (s) | Recuperado tras (s) | ¿Se recuperó solo? | Sondeos fallidos |');
  md.push('| --- | ---: | ---: | ---: | ---: | :---: | ---: |');
  for (const d of availability.disruptions) {
    md.push(`| ${d.label ?? d.name} | ${d.at} | ${d.detectedAfterSeconds ?? '—'} | ${d.downtimeSeconds ?? 'no volvió'} | ` +
      `${d.recoveredAfterSeconds ?? '—'} | ${d.recoveredWithoutIntervention ? 'sí' : 'NO'} | ${d.failedProbes} |`);
  }
  const { timeline, ...rest } = availability;
  results.availability = rest;
} else {
  md.push('_Sin resultados de disponibilidad._');
}
md.push('');

// Consumo de recursos durante la carga (muestreo de docker stats cada ~2 s).
const statsPath = join(OUT, 'docker-stats.jsonl');
if (existsSync(statsPath)) {
  const toMiB = (s) => {
    const m = /([\d.]+)\s*([KMG]i?B)/.exec(s ?? '');
    if (!m) return 0;
    const f = { KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[m[2]] ?? 1;
    return Number(m[1]) * f;
  };
  const byService = {};
  for (const line of readFileSync(statsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const name = row.s.Name ?? '';
    const service = ['backend', 'database', 'jwks'].find((s) => name.includes(s));
    if (!service) continue;
    (byService[service] ??= []).push({ cpu: parseFloat(row.s.CPUPerc), mem: toMiB(row.s.MemUsage.split('/')[0]) });
  }
  const services = Object.entries(byService);
  if (services.length > 0) {
    md.push('## Consumo de recursos durante la carga', '');
    md.push('| Servicio | Muestras | CPU promedio | CPU pico | Memoria promedio (MiB) | Memoria pico (MiB) |');
    md.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    results.resources = {};
    for (const [service, rows] of services) {
      const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
      const max = (k) => Math.max(...rows.map((r) => r[k]));
      results.resources[service] = { samples: rows.length, cpuAvg: avg('cpu'), cpuMax: max('cpu'),
        memAvgMiB: avg('mem'), memMaxMiB: max('mem') };
      md.push(`| ${service} | ${rows.length} | ${avg('cpu').toFixed(1)} % | ${max('cpu').toFixed(1)} % | ` +
        `${avg('mem').toFixed(0)} | ${max('mem').toFixed(0)} |`);
    }
    md.push('', 'El porcentaje de CPU es sobre un núcleo: 200 % equivale a dos núcleos completos.', '');
  }
}

const boot = read('boot.json');
if (boot) {
  md.push(`Arranque en frío del backend (contenedor iniciado → primera respuesta): ${boot.bootSeconds} s.`, '');
  results.bootSeconds = boot.bootSeconds;
}

const jwks = read('jwks-stats.json');
if (jwks) {
  md.push(`Descargas del JWKS durante toda la corrida: ${jwks.jwksFetches} (el backend cachea las llaves).`, '');
  results.jwksFetches = jwks.jwksFetches;
}

writeFileSync(join(OUT, 'report.md'), md.join('\n'));
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(md.join('\n'));
