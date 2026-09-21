// FR-UC-18 — responder solicitudes y cotizar.
//
// Lecturas del técnico (bandeja, detalle, sus cotizaciones) y del propietario (sus solicitudes,
// las ofertas recibidas) bajo carga sostenida, cotizaciones nuevas en paralelo, y al final la
// prueba que importa para el ASR: varias aceptaciones simultáneas sobre la misma solicitud. Solo
// una puede ganar; las demás deben recibir 409 y la solicitud debe quedar con una sola oferta
// aceptada. Todo corre sobre PostgreSQL con las políticas RLS activas.
import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import {
  BASE_URL, TREND_STATS, auth, fixtures, get, integrityViolations, pick, post, rate,
  summaryWriter, thresholdsFor
} from './common.js';

export const ENDPOINTS = {
  requests_open: { p95: 300, p99: 800 },
  request_detail: { p95: 300, p99: 800 },
  quotations_mine: { p95: 300, p99: 800 },
  requests_mine: { p95: 300, p99: 800 },
  quotations_for_request: { p95: 300, p99: 800 },
  quotation_submit: { p95: 500, p99: 1000 },
  // En la carrera se esperan 409: no cuentan como error, pero su latencia sí se juzga.
  quotation_accept_race: { p95: 1000, p99: 2000 }
};

export const options = {
  summaryTrendStats: TREND_STATS,
  thresholds: thresholdsFor(ENDPOINTS),
  scenarios: {
    fixer_reads: {
      executor: 'constant-arrival-rate', exec: 'fixerReads',
      rate: rate(30), timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 150
    },
    owner_reads: {
      executor: 'constant-arrival-rate', exec: 'ownerReads',
      rate: rate(20), timeUnit: '1s', duration: '60s', preAllocatedVUs: 15, maxVUs: 100
    },
    submit_quotations: {
      executor: 'constant-arrival-rate', exec: 'submitQuotation',
      rate: rate(10), timeUnit: '1s', duration: '30s', preAllocatedVUs: 10, maxVUs: 60
    },
    accept_race: {
      executor: 'per-vu-iterations', exec: 'acceptRace', startTime: '65s',
      vus: fixtures.raceRequests.length, iterations: 1, maxDuration: '60s'
    }
  }
};

export function fixerReads() {
  const i = exec.scenario.iterationInTest;
  const fixer = pick(fixtures.fixers, i);
  const owner = pick(fixtures.owners, i);
  switch (i % 3) {
    case 0:
      check(get('/requests/open', fixer.token, 'requests_open'), { 'bandeja 200': (r) => r.status === 200 });
      break;
    case 1:
      check(get(`/requests/${pick(owner.openRequests, i)}`, fixer.token, 'request_detail'),
        { 'detalle 200': (r) => r.status === 200 });
      break;
    default:
      check(get('/quotations/me', fixer.token, 'quotations_mine'), { 'mis cotizaciones 200': (r) => r.status === 200 });
  }
}

export function ownerReads() {
  const i = exec.scenario.iterationInTest;
  const owner = pick(fixtures.owners, i);
  if (i % 2 === 0) {
    check(get('/requests/me', owner.token, 'requests_mine'), { 'mis solicitudes 200': (r) => r.status === 200 });
  } else {
    const race = pick(fixtures.raceRequests, i);
    const raceOwner = fixtures.owners[race.owner];
    check(get(`/quotations/for-request/${race.requestId}`, raceOwner.token, 'quotations_for_request'),
      { 'ofertas recibidas 200': (r) => r.status === 200 });
  }
}

export function submitQuotation() {
  const i = exec.scenario.iterationInTest;
  if (i >= fixtures.quotePairs.length) return;
  // Recorre los pares en orden de solicitud para no cotizar dos veces lo mismo.
  const pair = fixtures.quotePairs[i];
  const fixer = fixtures.fixers[pair.fixer];
  const res = post('/quotations', fixer.token, 'quotation_submit',
    { requestId: pair.requestId, amount: 200000 + (i % 20) * 10000, estimatedDays: 2, message: 'Oferta de carga' },
    [201]);
  check(res, { 'cotización 201': (r) => r.status === 201 });
}

export function acceptRace() {
  const race = fixtures.raceRequests[exec.scenario.iterationInTest];
  const owner = fixtures.owners[race.owner];
  // Todas las aceptaciones salen a la vez sobre la misma solicitud.
  const responses = http.batch(race.quotationIds.map((id) => ({
    method: 'POST',
    url: `${BASE_URL}/quotations/${id}/accept`,
    params: {
      headers: auth(owner.token),
      tags: { name: 'quotation_accept_race' },
      responseCallback: http.expectedStatuses(200, 409)
    }
  })));
  const winners = responses.filter((r) => r.status === 200).length;
  const conflicts = responses.filter((r) => r.status === 409).length;
  const ok = check(null, {
    'exactamente una aceptación gana': () => winners === 1,
    'las demás reciben 409': () => conflicts === race.quotationIds.length - 1
  });

  // Y la base lo confirma: una sola oferta aceptada, las demás rechazadas.
  const after = get(`/quotations/for-request/${race.requestId}`, owner.token, 'quotations_for_request');
  const accepted = after.status === 200 ? after.json().filter((q) => q.status === 'ACCEPTED').length : -1;
  const persisted = check(after, { 'una sola oferta ACCEPTED persistida': () => accepted === 1 });
  if (!ok || !persisted) integrityViolations.add(1);
}

export const handleSummary = summaryWriter('uc18');
