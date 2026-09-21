// Siembra de datos para las pruebas de desempeño de FR-UC-18, FR-UC-20 y FR-UC-21.
//
// Todo lo que el producto permite hacer por la API se hace por la API: registrar usuarios, elegir
// rol, crear propiedades y solicitudes, cotizar, aceptar y cerrar trabajos. Así los datos quedan
// con las mismas invariantes que en uso real, incluidas las políticas RLS de PostgreSQL. Lo único
// que va por SQL es aprobar la verificación del técnico y darle su especialidad, que en el
// producto requieren un administrador revisando documentos.
//
// Variables:
//   BASE_URL     http://127.0.0.1:8080
//   PERF_WORK    carpeta con la llave (jwt.mjs init) y donde se escribe fixtures.json
//   PERF_PSQL    comando que recibe SQL por stdin (psql contra la base del backend)
//   PERF_SCALE   small | full   (volumen de datos)
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrivateKey, signToken } from './lib/jwt.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const WORK = process.env.PERF_WORK ?? 'perf/.work';
const PSQL = process.env.PERF_PSQL;
const SCALE = process.env.PERF_SCALE ?? 'full';

const VOLUME = {
  small: { owners: 6, fixers: 6, openPerOwner: 4, raceRequests: 3, raceQuotes: 4, available: 2, held: 2 },
  full: { owners: 30, fixers: 30, openPerOwner: 10, raceRequests: 20, raceQuotes: 5, available: 10, held: 5 }
}[SCALE];
if (!VOLUME) throw new Error(`PERF_SCALE desconocido: ${SCALE}`);
if (!PSQL) throw new Error('PERF_PSQL es obligatorio: comando psql que recibe SQL por stdin');

const key = loadPrivateKey(WORK);
const runId = Date.now().toString(36);
const started = Date.now();
let calls = 0;

async function api(method, path, token, body, expected) {
  calls += 1;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!expected.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} (se esperaba ${expected}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Ejecuta tareas con concurrencia acotada: la siembra no debe ser ella misma una prueba de carga. */
async function pool(items, size, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

function sql(statement) {
  execSync(PSQL, { input: statement, stdio: ['pipe', 'inherit', 'inherit'] });
}

async function user(subject, role) {
  const token = signToken(key, subject);
  const me = await api('POST', '/auth/bootstrap', token, undefined, [200, 201]);
  await api('POST', '/auth/select-role', token, { role }, [200]);
  return { sub: subject, token, id: me.id };
}

const REQUEST = {
  title: 'Fuga de agua en el lavamanos',
  description: 'La tuberia del lavamanos gotea constantemente y el grifo no cierra bien.'
};

async function openRequest(owner) {
  const created = await api('POST', '/requests', owner.token,
    { propertyId: owner.propertyId, ...REQUEST, mediaIds: [] }, [201]);
  return created.requestId;
}

async function quote(fixer, requestId, amount) {
  const created = await api('POST', '/quotations', fixer.token,
    { requestId, amount, estimatedDays: 3, message: 'Cambio de tuberia y grifo' }, [201]);
  return created.id;
}

const amountFor = (i) => 150_000 + (i % 10) * 50_000;

// ---------- 1. Usuarios ----------
const owners = await pool([...Array(VOLUME.owners).keys()], 8,
  (i) => user(`perf|owner-${runId}-${i}`, 'OWNER'));
const fixers = await pool([...Array(VOLUME.fixers).keys()], 8,
  (i) => user(`perf|fixer-${runId}-${i}`, 'FIXER'));

// ---------- 2. Verificación y especialidad (lo único que va por SQL) ----------
const fixerIds = fixers.map((f) => `'${f.id}'`).join(',');
sql(`
UPDATE fixer_profiles SET verification_status = 'VERIFIED' WHERE user_id IN (${fixerIds});
INSERT INTO fixer_specialties (fixer_user_id, specialty)
  SELECT id, 'PLUMBING' FROM users WHERE id IN (${fixerIds})
  ON CONFLICT DO NOTHING;
`);

// ---------- 3. Una propiedad por propietario ----------
await pool(owners, 8, async (owner, i) => {
  const property = await api('POST', '/properties', owner.token,
    { name: `Apto perf ${i}`, address: `Calle ${i} # 1-23`, city: 'Bogota', areaM2: 60 }, [201]);
  owner.propertyId = property.id;
});

// ---------- 4. Solicitudes abiertas (bandeja del técnico y cotizaciones nuevas) ----------
for (const owner of owners) owner.openRequests = [];
await pool(owners.flatMap((o) => Array(VOLUME.openPerOwner).fill(o)), 8, async (owner) => {
  owner.openRequests.push(await openRequest(owner));
});

// Pares técnico–solicitud que nadie ha cotizado todavía: cada cotización de la prueba es nueva.
// Se acota: cada VU de k6 carga estos datos al iniciar, y la prueba usa unos cientos.
const quotePairs = [];
owners.forEach((owner, oi) => owner.openRequests.forEach((requestId, ri) => {
  fixers.forEach((_, fi) => quotePairs.push({ fixer: fi, owner: oi, requestId, order: ri }));
}));
quotePairs.length = Math.min(quotePairs.length, 1200);

// ---------- 5. Carrera de aceptación (FR-UC-18): varias ofertas por solicitud ----------
const raceRequests = await pool([...Array(VOLUME.raceRequests).keys()], 4, async (i) => {
  const oi = i % owners.length;
  const requestId = await openRequest(owners[oi]);
  const quotationIds = [];
  for (let q = 0; q < VOLUME.raceQuotes; q++) {
    quotationIds.push(await quote(fixers[(i + q) % fixers.length], requestId, amountFor(q)));
  }
  return { owner: oi, requestId, quotationIds };
});

// ---------- 6. Historial de ingresos (FR-UC-20): trabajos cerrados y retenidos por técnico ----------
async function assignedJob(fixer, fi, n) {
  const owner = owners[(fi + n) % owners.length];
  const requestId = await openRequest(owner);
  const quotationId = await quote(fixer, requestId, amountFor(n));
  await api('POST', `/quotations/${quotationId}/accept`, owner.token, undefined, [200]);
  return { requestId, quotationId, amount: amountFor(n) };
}

await pool(fixers, 6, async (fixer, fi) => {
  fixer.heldJobs = [];
  fixer.expectedAvailable = 0;
  for (let n = 0; n < VOLUME.available + VOLUME.held; n++) {
    fixer.heldJobs.push(await assignedJob(fixer, fi, n));
  }
  const jobs = await api('GET', '/jobs/me', fixer.token, undefined, [200]);
  const byQuotation = new Map(jobs.map((j) => [j.quotationId, j.id]));
  for (const job of fixer.heldJobs) job.jobId = byQuotation.get(job.quotationId);

  // Los primeros quedan cerrados (dinero disponible); el resto sigue retenido para la prueba.
  const toClose = fixer.heldJobs.splice(0, VOLUME.available);
  for (const job of toClose) {
    await api('POST', `/jobs/${job.jobId}/complete`, fixer.token, undefined, [200]);
    fixer.expectedAvailable += job.amount - Math.floor(job.amount * 1000 / 10000);
  }
});

const fixtures = {
  runId,
  scale: SCALE,
  baseUrl: BASE_URL,
  owners: owners.map((o) => ({ sub: o.sub, token: o.token, id: o.id, propertyId: o.propertyId,
    openRequests: o.openRequests })),
  fixers: fixers.map((f) => ({ sub: f.sub, token: f.token, id: f.id,
    heldJobIds: f.heldJobs.map((j) => j.jobId), expectedAvailable: f.expectedAvailable })),
  quotePairs,
  raceRequests,
  seed: { apiCalls: calls, seconds: Math.round((Date.now() - started) / 100) / 10, volume: VOLUME }
};
writeFileSync(join(WORK, 'fixtures.json'), JSON.stringify(fixtures));
console.log(`siembra lista: ${owners.length} propietarios, ${fixers.length} técnicos, ` +
  `${quotePairs.length} pares para cotizar, ${raceRequests.length} carreras, ` +
  `${calls} llamadas en ${fixtures.seed.seconds} s`);
