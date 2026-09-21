// Prueba de disponibilidad: sondea el backend cada INTERVAL_MS y provoca fallas controladas.
//
// Cada falla del plan es un comando de shell que se lanza en su segundo. El sondeo nunca se detiene:
// así se ve cuándo el sistema deja de responder, cuánto tarda en volver y si vuelve solo. La sonda
// es GET /auth/me con un token válido, que exige lo mismo que cualquier petición real: servidor
// arriba, validación del token y una consulta a PostgreSQL.
//
// Variables:
//   BASE_URL, PERF_WORK (fixtures.json), DURATION (s), INTERVAL_MS, OUT_DIR
//   PLAN  JSON: [{"at": 20, "name": "backend_crash", "label": "...", "cmd": "..."}]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const WORK = process.env.PERF_WORK ?? 'perf/.work';
const OUT_DIR = process.env.OUT_DIR ?? WORK;
const DURATION = Number(process.env.DURATION ?? 200);
const INTERVAL = Number(process.env.INTERVAL_MS ?? 100);
const PLAN = JSON.parse(process.env.PLAN ?? '[]');

const token = JSON.parse(readFileSync(join(WORK, 'fixtures.json'), 'utf8')).owners[0].token;
const t0 = Date.now();
const seconds = () => (Date.now() - t0) / 1000;
const probes = [];
const events = [];

async function probe() {
  const started = seconds();
  const t = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000)
    });
    await res.arrayBuffer();
    probes.push({ t: started, ok: res.status === 200, status: res.status, ms: performance.now() - t });
  } catch (error) {
    probes.push({ t: started, ok: false, status: error.name === 'TimeoutError' ? 'timeout' : 'down',
      ms: performance.now() - t });
  }
}

for (const step of PLAN) {
  setTimeout(() => {
    events.push({ name: step.name, label: step.label, at: seconds(), phase: 'start' });
    const child = spawn(step.cmd, { shell: true, stdio: 'inherit' });
    child.on('exit', (code) => events.push({ name: step.name, at: seconds(), phase: 'end', code }));
  }, step.at * 1000);
}

// Sondeo a intervalo fijo, sin esperar a que termine el anterior: una petición colgada no debe
// esconder el tiempo que el servicio estuvo caído.
const inFlight = [];
while (seconds() < DURATION) {
  inFlight.push(probe());
  await new Promise((r) => setTimeout(r, INTERVAL));
}
await Promise.allSettled(inFlight);
probes.sort((a, b) => a.t - b.t);

const pct = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

// Por cada falla: ventana desde su segundo hasta la siguiente falla (o el final).
const disruptions = PLAN.map((step, i) => {
  const end = PLAN[i + 1]?.at ?? DURATION;
  const window = probes.filter((p) => p.t >= step.at && p.t < end);
  const firstFailure = window.find((p) => !p.ok);
  let recovery = null;
  if (firstFailure) {
    const lastFailure = [...window].reverse().find((p) => !p.ok);
    recovery = window.find((p) => p.ok && p.t > lastFailure.t) ?? null;
  }
  return {
    name: step.name,
    label: step.label,
    at: step.at,
    probes: window.length,
    failedProbes: window.filter((p) => !p.ok).length,
    detectedAfterSeconds: firstFailure ? +(firstFailure.t - step.at).toFixed(2) : null,
    downtimeSeconds: firstFailure && recovery ? +(recovery.t - firstFailure.t).toFixed(2) : firstFailure ? null : 0,
    recoveredAfterSeconds: recovery ? +(recovery.t - step.at).toFixed(2) : firstFailure ? null : 0,
    recoveredWithoutIntervention: firstFailure ? recovery !== null : true,
    failureKinds: [...new Set(window.filter((p) => !p.ok).map((p) => String(p.status)))]
  };
});

const disrupted = (p) => disruptions.some((d) => d.failedProbes > 0 && p.t >= d.at &&
  p.t < d.at + (d.recoveredAfterSeconds ?? DURATION));
const okLatencies = probes.filter((p) => p.ok).map((p) => p.ms);
const steady = probes.filter((p) => !disrupted(p));

const result = {
  durationSeconds: DURATION,
  intervalMs: INTERVAL,
  probes: probes.length,
  successes: probes.filter((p) => p.ok).length,
  availabilityPercent: +(100 * probes.filter((p) => p.ok).length / probes.length).toFixed(3),
  steadyStateAvailabilityPercent: +(100 * steady.filter((p) => p.ok).length / Math.max(1, steady.length)).toFixed(3),
  latencyMs: { p50: pct(okLatencies, 50), p95: pct(okLatencies, 95), p99: pct(okLatencies, 99) },
  disruptions,
  events,
  timeline: probes.map((p) => [+p.t.toFixed(2), p.ok ? 1 : 0, Math.round(p.ms)])
};
writeFileSync(join(OUT_DIR, 'availability.json'), JSON.stringify(result));
console.log(`disponibilidad total ${result.availabilityPercent}% sobre ${result.probes} sondeos`);
for (const d of disruptions) {
  console.log(`${d.name}: caída ${d.downtimeSeconds ?? 'sin recuperar'} s, ` +
    `recuperado ${d.recoveredWithoutIntervention ? 'solo' : 'NO'}, sondeos fallidos ${d.failedProbes}`);
}
