// RNF-01 — siembra del catálogo para medir la búsqueda por geolocalización y filtros.
//
// La métrica del requisito dice "p95 ≤ 3 s con un catálogo de hasta 5.000 inmuebles". Los 5.000
// no son decoración: el índice parcial sobre (latitude, longitude) se comporta distinto con 50
// filas que con 5.000, y medir con pocas no prueba el requisito.
//
//   node perf/rnf01/seed-catalogo.mjs [carpeta-de-trabajo]
//
// Usa la carga masiva del propio sistema (POST /properties/bulk/import), no SQL directo, para que
// las filas sembradas sean exactamente las que la aplicación sabe producir. Va en lotes de 500
// porque es el tamaño que el importador procesa por bloque y mantiene cada archivo muy por debajo
// del límite de subida.
//
// Deja en la carpeta de trabajo:
//   catalogo.json    los identificadores y los tokens sembrados
//   busquedas.csv    combinaciones de latitud, longitud y radio para la búsqueda geográfica
//   filtros.csv      combinaciones de filtros para el catálogo

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { signToken, loadPrivateKey } from '../lib/jwt.mjs';

const WORK = process.argv[2] || 'perf/.work';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const TOTAL = Number(process.env.CATALOG_SIZE || 5000);
const CHUNK = 500;

mkdirSync(WORK, { recursive: true });
// La llave la crea `node perf/lib/jwt.mjs init <carpeta>`, igual que en el arnés de k6.
const key = loadPrivateKey(WORK);

async function api(method, path, token, body, expected = [200, 201]) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!expected.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function user(subject, role) {
  const token = signToken(key, subject);
  const me = await api('POST', '/auth/bootstrap', token, undefined, [200, 201]);
  await api('POST', '/auth/select-role', token, { role }, [200]);
  return { sub: subject, token, id: me.id, role };
}

// Ciudades reales con su centro aproximado. La mayor parte del catálogo se concentra en Bogotá
// a propósito: una nube densa es el caso que de verdad estresa la búsqueda por radio, porque un
// radio grande ahí dentro devuelve miles de filas y obliga a calcular la distancia de todas.
const CIUDADES = [
  { nombre: 'Bogotá', lat: 4.7110, lon: -74.0721, extension: 0.18, peso: 70 },
  { nombre: 'Medellín', lat: 6.2442, lon: -75.5812, extension: 0.10, peso: 10 },
  { nombre: 'Cali', lat: 3.4516, lon: -76.5320, extension: 0.09, peso: 8 },
  { nombre: 'Barranquilla', lat: 10.9685, lon: -74.7813, extension: 0.07, peso: 7 },
  { nombre: 'Cartagena', lat: 10.3910, lon: -75.4794, extension: 0.07, peso: 5 },
];

const TIPOS = ['APARTMENT', 'HOUSE', 'STUDIO', 'OFFICE', 'COMMERCIAL', 'COUNTRY_HOUSE'];
const OFERTAS = ['RENT', 'SALE'];

// Generador con semilla fija: la siembra tiene que ser reproducible, porque si cada corrida
// siembra un catálogo distinto los números de dos corridas no se pueden comparar.
let semilla = 20260101;
const aleatorio = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};

const elegirCiudad = () => {
  const total = CIUDADES.reduce((a, c) => a + c.peso, 0);
  let r = aleatorio() * total;
  for (const c of CIUDADES) {
    r -= c.peso;
    if (r <= 0) return c;
  }
  return CIUDADES[0];
};

function fila(i) {
  const ciudad = elegirCiudad();
  const lat = ciudad.lat + (aleatorio() - 0.5) * 2 * ciudad.extension;
  const lon = ciudad.lon + (aleatorio() - 0.5) * 2 * ciudad.extension;
  const oferta = OFERTAS[Math.floor(aleatorio() * OFERTAS.length)];
  const tipo = TIPOS[Math.floor(aleatorio() * TIPOS.length)];
  // Precios en pesos: arriendo mensual contra precio de venta, que son órdenes distintos.
  const precio = oferta === 'RENT'
    ? 800_000 + Math.floor(aleatorio() * 7_000_000)
    : 150_000_000 + Math.floor(aleatorio() * 900_000_000);
  return {
    name: `Inmueble de carga ${String(i).padStart(5, '0')}`,
    address: `Calle ${10 + (i % 180)} # ${1 + (i % 90)}-${10 + (i % 80)}`,
    city: ciudad.nombre,
    areaM2: String(35 + Math.floor(aleatorio() * 240)),
    latitude: lat.toFixed(6),
    longitude: lon.toFixed(6),
    listingType: oferta,
    propertyType: tipo,
    price: String(precio),
    adminFee: oferta === 'RENT' ? String(100_000 + Math.floor(aleatorio() * 600_000)) : '',
    bedrooms: String(1 + Math.floor(aleatorio() * 5)),
    bathrooms: String(1 + Math.floor(aleatorio() * 4)),
    parkingSpots: String(Math.floor(aleatorio() * 3)),
    stratum: String(1 + Math.floor(aleatorio() * 6)),
    neighborhood: `Barrio ${1 + (i % 40)}`,
    description: `Inmueble sintético para pruebas de desempeño. Registro ${i}.`,
  };
}

const COLUMNAS = ['name', 'address', 'city', 'areaM2', 'latitude', 'longitude', 'listingType',
  'propertyType', 'price', 'adminFee', 'bedrooms', 'bathrooms', 'parkingSpots', 'stratum',
  'neighborhood', 'description'];

const csvValor = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csvDe = (filas) =>
  [COLUMNAS.join(','), ...filas.map((f) => COLUMNAS.map((c) => csvValor(f[c] ?? '')).join(','))].join('\n') + '\n';

// ---------- siembra ----------

console.log(`Sembrando ${TOTAL} inmuebles contra ${BASE_URL}`);
const owner = await user('perf|rnf01-owner', 'OWNER');
const tenant = await user('perf|rnf01-tenant', 'TENANT');

let importados = 0;
let rechazados = 0;
const inicio = Date.now();

for (let desde = 0; desde < TOTAL; desde += CHUNK) {
  const hasta = Math.min(desde + CHUNK, TOTAL);
  const filas = [];
  for (let i = desde; i < hasta; i++) filas.push(fila(i));

  const form = new FormData();
  form.append('file', new Blob([csvDe(filas)], { type: 'text/csv' }), `lote-${desde}.csv`);

  const res = await fetch(`${BASE_URL}/properties/bulk/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner.token}` },
    body: form,
  });
  if (res.status !== 201) {
    throw new Error(`carga masiva ${desde}-${hasta} -> ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const r = await res.json();
  importados += r.importedCount ?? r.imported ?? 0;
  rechazados += r.rejectedCount ?? r.rejected ?? 0;
  process.stdout.write(`  ${hasta}/${TOTAL}\r`);
}

const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
console.log(`\nImportados: ${importados}  rechazados: ${rechazados}  en ${segundos}s`);
if (rechazados > 0) {
  console.warn('AVISO: hubo filas rechazadas. Revisa el informe de errores antes de medir.');
}

// ---------- combinaciones de búsqueda ----------

// Radios a propósito distintos. El de 50 km sobre Bogotá barre casi todo el catálogo y es el
// caso que de verdad pone a prueba el requisito; los pequeños representan el uso normal. Si solo
// se midieran radios pequeños, el p95 saldría bonito y no diría nada.
const RADIOS = [1, 3, 5, 10, 25, 50];
const busquedas = [];
for (let i = 0; i < 300; i++) {
  const ciudad = elegirCiudad();
  busquedas.push([
    (ciudad.lat + (aleatorio() - 0.5) * 2 * ciudad.extension).toFixed(6),
    (ciudad.lon + (aleatorio() - 0.5) * 2 * ciudad.extension).toFixed(6),
    RADIOS[i % RADIOS.length],
  ]);
}
writeFileSync(join(WORK, 'busquedas.csv'),
  ['latitude,longitude,radiusKm', ...busquedas.map((b) => b.join(','))].join('\n') + '\n');

const filtros = [];
for (let i = 0; i < 200; i++) {
  const ciudad = CIUDADES[i % CIUDADES.length];
  const oferta = OFERTAS[i % OFERTAS.length];
  filtros.push([
    ciudad.nombre,
    oferta,
    TIPOS[i % TIPOS.length],
    oferta === 'RENT' ? 800000 : 150000000,
    oferta === 'RENT' ? 8000000 : 1100000000,
    1 + (i % 4),
    1 + (i % 6),
  ]);
}
writeFileSync(join(WORK, 'filtros.csv'),
  ['city,listingType,propertyType,minPrice,maxPrice,minBedrooms,stratum',
    ...filtros.map((f) => f.join(','))].join('\n') + '\n');

// El mismo contenido en JSON, que es lo que lee k6; los CSV de arriba son para JMeter.
writeFileSync(join(WORK, 'catalogo.json'), JSON.stringify({
  baseUrl: BASE_URL,
  total: importados,
  owner: { token: owner.token, id: owner.id },
  tenant: { token: tenant.token, id: tenant.id },
  radios: RADIOS,
  busquedas: busquedas.map(([latitude, longitude, radiusKm]) => ({ latitude, longitude, radiusKm })),
  filtros: filtros.map(([city, listingType, propertyType, minPrice, maxPrice, minBedrooms, stratum]) =>
    ({ city, listingType, propertyType, minPrice, maxPrice, minBedrooms, stratum })),
}, null, 2) + '\n');

// Un token por línea, para que JMeter rote entre propietario e inquilino: los dos pueden buscar
// y conviene que la medición no dependa de un solo rol.
writeFileSync(join(WORK, 'buscadores.csv'), `token\n${owner.token}\n${tenant.token}\n`);

console.log(`Listo. ${busquedas.length} búsquedas y ${filtros.length} filtros en ${WORK}`);
