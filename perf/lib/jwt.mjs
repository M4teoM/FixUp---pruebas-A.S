// Emisor de tokens de prueba para las pruebas de desempeño.
//
// El backend valida tokens RS256 contra un JWKS y exige iss, aud, sub y exp (JwtValidation).
// Pedirle miles de tokens a Auth0 no es viable —tiene límites de tasa y cuesta cuota del tenant—,
// así que las pruebas levantan un emisor propio: una llave RSA generada en cada corrida, publicada
// como JWKS en un contenedor, y tokens firmados con ella. El backend no se modifica: solo se le
// cambia AUTH0_ISSUER_URI para que busque las llaves aquí. La validación criptográfica que se mide
// es la real.
//
// Uso:
//   node perf/lib/jwt.mjs init <dir>            genera la llave y escribe <dir>/jwks.json
//   node perf/lib/jwt.mjs sign <dir> <subject>  imprime un token firmado para ese subject
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ISSUER = process.env.PERF_ISSUER ?? 'http://jwks:8081/';
export const AUDIENCE = process.env.PERF_AUDIENCE ?? 'https://api.fixup.perf';
const KID = 'fixup-perf-key';

const b64url = (input) => Buffer.from(input).toString('base64url');

export function initKeys(dir) {
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const jwk = publicKey.export({ format: 'jwk' });
  const jwks = { keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] };
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify(jwks, null, 2));
  return jwks;
}

export function loadPrivateKey(dir) {
  return createPrivateKey(readFileSync(join(dir, 'private.pem')));
}

/** Firma un token como lo haría Auth0: RS256, kid en el encabezado, iss/aud/sub/exp en el cuerpo. */
export function signToken(privateKey, subject, { ttlSeconds = 4 * 3600, extra = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    iss: ISSUER,
    aud: [AUDIENCE],
    sub: subject,
    iat: now,
    nbf: now - 5,
    exp: now + ttlSeconds,
    jti: randomUUID(),
    email: `${subject.replace(/[^a-z0-9-]/gi, '-')}@perf.fixup.test`,
    name: `Perf ${subject}`,
    ...extra
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Un token con la firma alterada: sirve para medir cuánto cuesta rechazar tokens falsos. */
export function tamper(token) {
  const [h, p, s] = token.split('.');
  const flipped = s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');
  return `${h}.${p}.${flipped}`;
}

// En Windows process.argv[1] es C:\...\jwt.mjs y import.meta.url es file:///C:/.../jwt.mjs,
// así que compararlos a mano nunca coincide y el bloque no se ejecutaba: node salía con
// código 0 sin escribir la llave. pathToFileURL hace la conversión bien en los tres sistemas.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, dir, subject] = process.argv;
  if (command === 'init' && dir) {
    initKeys(dir);
    console.log(`llave y JWKS escritos en ${dir}`);
  } else if (command === 'sign' && dir && subject) {
    console.log(signToken(loadPrivateKey(dir), subject));
  } else {
    console.error('uso: jwt.mjs init <dir> | jwt.mjs sign <dir> <subject>');
    process.exit(2);
  }
}
