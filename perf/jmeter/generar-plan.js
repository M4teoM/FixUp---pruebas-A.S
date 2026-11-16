// Genera perf/jmeter/fixup.jmx — plan de JMeter para FR-UC-18, FR-UC-20 y FR-UC-21.
// Los constructores del XML viven en lib-jmx.js; aquí solo está el contenido del plan.
const fs = require('fs');
const path = require('path');
const { crear } = require('./lib-jmx');

const p = crear();
const { esc, javaHash, w, raw, open, close, node, userVars, httpDefaults, csvDataSet, headerManager,
  threadGroup, httpGet, httpPost, responseCode, durationAssertion, listener, syncTimer,
  throughputTimer, BEARER } = p;

raw('<?xml version="1.0" encoding="UTF-8"?>');
open('<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">');
open('<hashTree>');

node([
  '<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="FIX&amp;RENT — FR-UC-18, FR-UC-20 y FR-UC-21" enabled="true">',
  '  <stringProp name="TestPlan.comments">Espeja los escenarios del arnes de k6 para que los dos resultados sean comparables. Los tokens se leen de CSV; no se firma criptografia dentro de JMeter.</stringProp>',
  '  <boolProp name="TestPlan.functional_mode">false</boolProp>',
  '  <boolProp name="TestPlan.tearDown_on_shutdown">true</boolProp>',
  '  <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>',
  '  <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="Variables del plan" enabled="true">',
  '    <collectionProp name="Arguments.arguments"/>',
  '  </elementProp>',
  '  <stringProp name="TestPlan.user_define_classpath"></stringProp>',
  '</TestPlan>',
], [
  userVars('Parámetros', {
    PROTOCOL: '${__P(protocol,http)}',
    HOST: '${__P(host,127.0.0.1)}',
    PORT: '${__P(port,8080)}',
    CSV_DIR: '${__P(csvDir,perf/.work/jmeter)}',
    DURATION: '${__P(duration,60)}',
    P95_LECTURA: '${__P(p95Lectura,300)}',
    P95_CARRERA: '${__P(p95Carrera,1000)}',
    // Peticiones por MINUTO, que es la unidad del temporizador. 3000/min = 50/s.
    RPM_AUTH: '${__P(rpmAuth,3000)}',
    RPM_FALSOS: '${__P(rpmFalsos,1200)}',
    RPM_TECNICO: '${__P(rpmTecnico,1800)}',
    RPM_PROPIETARIO: '${__P(rpmPropietario,1200)}',
    RPM_INGRESOS: '${__P(rpmIngresos,1800)}',
  }),
  httpDefaults(),

  // ---- FR-UC-21 ----
  threadGroup('FR-UC-21 · /auth/me nominal', { threads: 20, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    csvDataSet('Usuarios (propietarios y técnicos)', 'usuarios.csv', 'token'),
    headerManager('Token válido', BEARER),
    throughputTimer('50 por segundo', '${RPM_AUTH}'),
    httpGet('GET /auth/me', '/auth/me', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('No más lento que la meta de lectura', '${P95_LECTURA}'),
    ]),
  ]),

  threadGroup('FR-UC-21 · tokens con firma falsa', { threads: 10, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    csvDataSet('Usuarios', 'usuarios.csv', 'token'),
    headerManager('Token manipulado', { Authorization: 'Bearer ${token}XXXX', Accept: 'application/json' }),
    throughputTimer('20 por segundo', '${RPM_FALSOS}'),
    httpGet('GET /auth/me con firma rota', '/auth/me', [
      responseCode('Debe rechazar con 401', '401'),
      durationAssertion('Rechazar no puede costar más que atender', '${P95_LECTURA}'),
    ]),
  ]),

  // ---- FR-UC-18 ----
  threadGroup('FR-UC-18 · lecturas del técnico', { threads: 15, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    csvDataSet('Técnicos', 'tecnicos.csv', 'token'),
    headerManager('Token del técnico', BEARER),
    throughputTimer('30 por segundo', '${RPM_TECNICO}'),
    httpGet('GET /requests/open', '/requests/open', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
    httpGet('GET /quotations/me', '/quotations/me', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
  ]),

  threadGroup('FR-UC-18 · lecturas del propietario', { threads: 10, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    csvDataSet('Propietarios con una solicitud suya', 'propietarios.csv', 'token,requestId'),
    headerManager('Token del propietario', BEARER),
    throughputTimer('20 por segundo', '${RPM_PROPIETARIO}'),
    httpGet('GET /requests/me', '/requests/me', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
    httpGet('GET /quotations/for-request/{id}', '/quotations/for-request/${requestId}', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
  ]),

  // ---- FR-UC-20 ----
  threadGroup('FR-UC-20 · panel de ingresos del técnico', { threads: 15, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    csvDataSet('Técnicos', 'tecnicos.csv', 'token'),
    headerManager('Token del técnico', BEARER),
    throughputTimer('30 por segundo', '${RPM_INGRESOS}'),
    httpGet('GET /payments/me/earnings', '/payments/me/earnings', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
    httpGet('GET /jobs/me', '/jobs/me', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
    httpGet('GET /payments/me/payouts', '/payments/me/payouts', [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Meta de lectura', '${P95_LECTURA}'),
    ]),
  ]),

  // ---- carrera ----
  threadGroup('FR-UC-18 · carrera de aceptación', { threads: 4, rampSeconds: 0, durationSeconds: 0, delaySeconds: 0, loops: '${__P(raceRounds,3)}' }, [
    csvDataSet('Ofertas de la misma solicitud, en bloques', 'carrera.csv', 'ownerToken,quotationId',
      { recycle: false, shareMode: 'shareMode.all' }),
    headerManager('Token del propietario', { Authorization: 'Bearer ${ownerToken}', Accept: 'application/json' }),
    syncTimer('Soltar las peticiones a la vez', 4),
    httpPost('POST /quotations/{id}/accept', '/quotations/${quotationId}/accept', [
      responseCode('Gana una (200) y las demás chocan (409)', '^(200|409)$', 2),
      durationAssertion('Meta bajo carrera', '${P95_CARRERA}'),
    ]),
  ]),

  // ---- visualizadores para mostrar la corrida en vivo (apagados por omisión) ----
  listener('ViewResultsFullVisualizer', 'Ver árbol de resultados — apagado, enciéndelo para la demostración'),
  listener('SummaryReport', 'Informe resumen — apagado, enciéndelo para la demostración'),
  listener('StatVisualizer', 'Informe agregado — apagado, enciéndelo para la demostración'),
  listener('GraphVisualizer', 'Gráfica de resultados — apagado, enciéndelo para la demostración'),
]);

close('</hashTree>');
close('</jmeterTestPlan>');

const target = process.argv[2] || path.join(__dirname, 'fixup.jmx');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, p.terminar(), 'utf8');
console.log('escrito', target, p.terminar().split('\n').length, 'lineas');
