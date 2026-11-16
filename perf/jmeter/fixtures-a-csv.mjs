// Convierte el fixtures.json que deja la siembra de k6 (perf/seed.mjs) en los CSV que lee JMeter.
//
// JMeter no firma los tokens: los lee ya firmados de estos archivos. Así se evita meter
// criptografía RSA dentro del plan con samplers en Groovy, y además las dos herramientas
// miden exactamente sobre los mismos datos sembrados, que es lo que hace comparables
// los resultados.
//
//   node perf/jmeter/fixtures-a-csv.mjs [carpeta-de-trabajo]
//
// Por defecto lee perf/.work/fixtures.json y escribe en perf/.work/jmeter/.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const work = process.argv[2] || 'perf/.work';
const out = join(work, 'jmeter');
mkdirSync(out, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(work, 'fixtures.json'), 'utf8'));

const escape = (value) => {
  const text = String(value ?? '');
  // Un token JWT no lleva comas ni comillas, pero no cuesta nada no confiar en eso.
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function write(name, header, rows) {
  const body = [header, ...rows.map((r) => r.map(escape).join(','))].join('\n');
  writeFileSync(join(out, name), body + '\n', 'utf8');
  console.log(`${name}: ${rows.length} filas`);
}

// Técnicos: una fila por técnico. Sirve para las lecturas del caso 18 y el panel del caso 20.
write('tecnicos.csv', 'token', fixtures.fixers.map((f) => [f.token]));

// Propietarios: una fila por cada solicitud abierta, para que cada hilo lea una distinta
// y no se midan siempre las mismas filas calientes de la base.
const propietarios = fixtures.owners.flatMap((o) =>
  (o.openRequests || []).map((requestId) => [o.token, requestId]));
write('propietarios.csv', 'token,requestId', propietarios);

// Todos los usuarios juntos, para el caso 21.
write('usuarios.csv', 'token',
  [...fixtures.owners, ...fixtures.fixers].map((u) => [u.token]));

// Carrera de aceptación. El orden importa: las ofertas de una misma solicitud van
// consecutivas, porque los hilos leen el CSV en orden y el temporizador de sincronía
// los suelta en bloques del mismo tamaño. Si cambias cuántas ofertas tiene cada
// solicitud, hay que cambiar también el groupSize del temporizador y el número de
// hilos de ese grupo en el plan.
const carrera = [];
for (const race of fixtures.raceRequests || []) {
  const owner = fixtures.owners[race.owner];
  for (const quotationId of race.quotationIds) {
    carrera.push([owner.token, quotationId]);
  }
}
write('carrera.csv', 'ownerToken,quotationId', carrera);

const porSolicitud = (fixtures.raceRequests || []).map((r) => r.quotationIds.length);
const tamanos = [...new Set(porSolicitud)];
if (tamanos.length > 1) {
  console.warn(`AVISO: las solicitudes de carrera no tienen todas el mismo número de ofertas (${tamanos.join(', ')}). ` +
    'El temporizador de sincronía necesita bloques iguales; revisa la siembra.');
} else if (tamanos.length === 1) {
  console.log(`groupSize que debe tener el temporizador de sincronía: ${tamanos[0]}`);
}
