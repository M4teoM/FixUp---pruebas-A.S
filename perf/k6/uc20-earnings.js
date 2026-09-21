// FR-UC-20 — monitoreo de ingresos del técnico.
//
// El panel (saldo, trabajos, transferencias) bajo lectura sostenida con historial real, el cierre
// de trabajos que libera el dinero retenido, y al final el ASR del caso: varias solicitudes de
// transferencia simultáneas del mismo técnico. Solo una puede llevarse el saldo; las demás deben
// recibir 409, y el dinero transferido debe ser exactamente el que estaba disponible — ni un peso
// dos veces.
import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import {
  BASE_URL, TREND_STATS, auth, fixtures, get, integrityViolations, pick, post, rate,
  summaryWriter, thresholdsFor
} from './common.js';

const heldJobs = fixtures.fixers.flatMap((f, fi) => f.heldJobIds.map((jobId) => ({ fi, jobId })));
const COMPLETE_RATE = rate(5);
const completeSeconds = Math.max(5, Math.ceil(heldJobs.length / COMPLETE_RATE) + 2);
const raceFixers = fixtures.fixers.slice(0, Math.min(20, fixtures.fixers.length));
const RACE_PARALLEL = 5;

export const ENDPOINTS = {
  earnings_summary: { p95: 300, p99: 800 },
  jobs_mine: { p95: 300, p99: 800 },
  payouts_mine: { p95: 300, p99: 800 },
  job_complete: { p95: 800, p99: 1500 },
  payout_race: { p95: 1000, p99: 2000 }
};

export const options = {
  summaryTrendStats: TREND_STATS,
  thresholds: thresholdsFor(ENDPOINTS),
  scenarios: {
    panel_reads: {
      executor: 'constant-arrival-rate', exec: 'panelReads',
      rate: rate(30), timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 150
    },
    complete_jobs: {
      executor: 'constant-arrival-rate', exec: 'completeJob',
      rate: COMPLETE_RATE, timeUnit: '1s', duration: `${completeSeconds}s`, preAllocatedVUs: 5, maxVUs: 40
    },
    payout_race: {
      executor: 'per-vu-iterations', exec: 'payoutRace', startTime: `${Math.max(65, completeSeconds + 5)}s`,
      vus: raceFixers.length, iterations: 1, maxDuration: '60s'
    }
  }
};

export function panelReads() {
  const i = exec.scenario.iterationInTest;
  const fixer = pick(fixtures.fixers, i);
  if (i % 3 === 0) {
    check(get('/payments/me/earnings', fixer.token, 'earnings_summary'), { 'saldo 200': (r) => r.status === 200 });
  } else if (i % 3 === 1) {
    check(get('/jobs/me', fixer.token, 'jobs_mine'), { 'trabajos 200': (r) => r.status === 200 });
  } else {
    check(get('/payments/me/payouts', fixer.token, 'payouts_mine'), { 'transferencias 200': (r) => r.status === 200 });
  }
}

export function completeJob() {
  const i = exec.scenario.iterationInTest;
  if (i >= heldJobs.length) return;
  const { fi, jobId } = heldJobs[i];
  const res = post(`/jobs/${jobId}/complete`, fixtures.fixers[fi].token, 'job_complete', undefined, [200]);
  check(res, { 'trabajo cerrado 200': (r) => r.status === 200 });
}

export function payoutRace() {
  const fixer = raceFixers[exec.scenario.iterationInTest];
  const before = get('/payments/me/earnings', fixer.token, 'earnings_summary').json();

  const responses = http.batch(Array.from({ length: RACE_PARALLEL }, () => ({
    method: 'POST',
    url: `${BASE_URL}/payments/me/payouts`,
    params: {
      headers: auth(fixer.token),
      tags: { name: 'payout_race' },
      responseCallback: http.expectedStatuses(201, 409)
    }
  })));
  const created = responses.filter((r) => r.status === 201);
  const conflicts = responses.filter((r) => r.status === 409).length;
  const paid = created.length === 1 ? created[0].json().amount : -1;

  const after = get('/payments/me/earnings', fixer.token, 'earnings_summary').json();
  const payouts = get('/payments/me/payouts', fixer.token, 'payouts_mine').json();

  const ok = check(null, {
    'exactamente una transferencia registrada': () => created.length === 1 && payouts.length === 1,
    'las demás reciben 409': () => conflicts === RACE_PARALLEL - 1,
    'se transfirió exactamente el saldo disponible': () => paid === before.availableBalance,
    'el saldo disponible quedó en cero': () => after.availableBalance === 0,
    'lo solicitado cuadra con la transferencia': () => after.paidOutTotal === paid
  });
  if (!ok) integrityViolations.add(1);
}

export const handleSummary = summaryWriter('uc20');
