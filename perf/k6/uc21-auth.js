// FR-UC-21 — autenticación segura y gestión de sesiones.
//
// Cada petición lleva un token RS256 que el backend valida de verdad (firma, iss, aud, sub, exp)
// y luego resuelve el actor contra PostgreSQL. Se mide:
//   - /auth/me en carga nominal y en rampa hasta encontrar el punto donde se degrada,
//   - /auth/bootstrap idempotente (el retorno de una sesión ya registrada),
//   - el rechazo de tokens con firma falsa: debe ser 401 y barato, porque es la puerta que un
//     atacante martillaría.
import exec from 'k6/execution';
import { check } from 'k6';
import { TREND_STATS, fixtures, get, pick, post, rate, summaryWriter, thresholdsFor } from './common.js';

const users = [...fixtures.owners, ...fixtures.fixers];

export const ENDPOINTS = {
  auth_me: { p95: 300, p99: 800 },
  auth_me_peak: { p95: 1000, p99: 2000 },
  auth_bootstrap: { p95: 500, p99: 1000 },
  forged_token: { p95: 300, p99: 800 }
};

export const options = {
  summaryTrendStats: TREND_STATS,
  thresholds: thresholdsFor(ENDPOINTS),
  scenarios: {
    auth_me_nominal: {
      executor: 'constant-arrival-rate', exec: 'authMe',
      rate: rate(50), timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 200
    },
    auth_me_peak: {
      executor: 'ramping-arrival-rate', exec: 'authMePeak', startTime: '65s',
      startRate: rate(50), timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 400,
      stages: [
        { target: rate(150), duration: '30s' },
        { target: rate(300), duration: '30s' },
        { target: rate(300), duration: '30s' }
      ]
    },
    bootstrap_existing: {
      executor: 'constant-arrival-rate', exec: 'bootstrap', startTime: '160s',
      rate: rate(20), timeUnit: '1s', duration: '30s', preAllocatedVUs: 10, maxVUs: 100
    },
    forged_tokens: {
      executor: 'constant-arrival-rate', exec: 'forged', startTime: '160s',
      rate: rate(20), timeUnit: '1s', duration: '30s', preAllocatedVUs: 10, maxVUs: 100
    }
  }
};

export function authMe() {
  const u = pick(users, exec.scenario.iterationInTest);
  const res = get('/auth/me', u.token, 'auth_me');
  check(res, { 'me 200': (r) => r.status === 200 });
}

export function authMePeak() {
  const u = pick(users, exec.scenario.iterationInTest);
  const res = get('/auth/me', u.token, 'auth_me_peak');
  check(res, { 'me pico 200': (r) => r.status === 200 });
}

export function bootstrap() {
  const u = pick(users, exec.scenario.iterationInTest);
  const res = post('/auth/bootstrap', u.token, 'auth_bootstrap', undefined, [200, 201]);
  check(res, { 'bootstrap idempotente': (r) => r.status === 200 || r.status === 201 });
}

export function forged() {
  const u = pick(users, exec.scenario.iterationInTest);
  const [h, p, s] = u.token.split('.');
  const bad = `${h}.${p}.${s.slice(0, -4)}${s.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
  const res = get('/auth/me', bad, 'forged_token', [401]);
  check(res, { 'firma falsa rechazada con 401': (r) => r.status === 401 });
}

export const handleSummary = summaryWriter('uc21');
