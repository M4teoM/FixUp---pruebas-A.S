// Servidor mínimo que publica el JWKS de las pruebas en /.well-known/jwks.json.
// Sin dependencias: corre con la imagen oficial de Node. Cuenta las descargas de llaves para que el
// informe pueda decir cuántas veces el backend fue a buscarlas (debería ser una, luego las cachea).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8081);
const jwksPath = process.env.JWKS_PATH ?? '/work/jwks.json';
const body = readFileSync(jwksPath, 'utf8');
let fetches = 0;

createServer((req, res) => {
  if (req.url === '/.well-known/jwks.json') {
    fetches += 1;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=300' });
    res.end(body);
  } else if (req.url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jwksFetches: fetches }));
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(port, () => console.log(`jwks en :${port}`));
