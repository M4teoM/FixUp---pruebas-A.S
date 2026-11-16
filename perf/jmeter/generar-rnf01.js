// Genera perf/jmeter/rnf01.jmx — plan de JMeter para RNF-01.
//
// RNF-01: "La búsqueda de inmuebles por geolocalización y filtros debe mostrar resultados en
// menos de 3 segundos". Métrica: p95 ≤ 3 s con un catálogo de hasta 5.000 inmuebles.
//
// Va en un plan aparte del de los casos de uso porque es otro requisito, con otra precondición
// (el catálogo sembrado) y otro responsable. Mezclarlos obligaría a sembrar las dos cosas para
// correr cualquiera de las dos.
const fs = require('fs');
const path = require('path');
const { crear } = require('./lib-jmx');

const p = crear();
const { raw, open, close, node, userVars, httpDefaults, csvDataSet, headerManager,
  threadGroup, httpGet, responseCode, durationAssertion, listener, throughputTimer, BEARER } = p;

raw('<?xml version="1.0" encoding="UTF-8"?>');
open('<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">');
open('<hashTree>');

const BUSQUEDA = '/properties/search?latitude=${latitude}&longitude=${longitude}'
  + '&radiusKm=${radiusKm}&ownershipScope=ALL';

const CATALOGO = '/properties/catalog?city=${city}&listingType=${listingType}'
  + '&propertyType=${propertyType}&minPrice=${minPrice}&maxPrice=${maxPrice}'
  + '&minBedrooms=${minBedrooms}&stratum=${stratum}&page=0&size=12';

node([
  '<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="RNF-01 — Búsqueda por geolocalización y filtros" enabled="true">',
  '  <stringProp name="TestPlan.comments">Requiere el catalogo sembrado con perf/rnf01/seed-catalogo.mjs. Los 5.000 inmuebles son parte de la metrica, no un detalle.</stringProp>',
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
    CSV_DIR: '${__P(csvDir,perf/.work)}',
    DURATION: '${__P(duration,60)}',
    // El umbral del requisito, en milisegundos.
    P95_RNF01: '${__P(p95Rnf01,3000)}',
    RPM_BUSQUEDA: '${__P(rpmBusqueda,1800)}',
    RPM_CATALOGO: '${__P(rpmCatalogo,1800)}',
    RPM_AMPLIO: '${__P(rpmAmplio,300)}',
  }),
  httpDefaults(),

  threadGroup('RNF-01 · búsqueda por radio', { threads: 20, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    // Dos orígenes de datos: las coordenadas y el token. Cada petición pide algo distinto; si
    // todos los hilos pidieran lo mismo se estaría midiendo la caché, no la búsqueda.
    csvDataSet('Coordenadas y radios', 'busquedas.csv', 'latitude,longitude,radiusKm'),
    csvDataSet('Quién busca (propietario e inquilino)', 'buscadores.csv', 'token'),
    headerManager('Token', BEARER),
    throughputTimer('30 por segundo', '${RPM_BUSQUEDA}'),
    httpGet('GET /properties/search', BUSQUEDA, [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Umbral de RNF-01', '${P95_RNF01}'),
    ]),
  ]),

  threadGroup('RNF-01 · catálogo con filtros', { threads: 20, rampSeconds: 5, durationSeconds: '${DURATION}' }, [
    csvDataSet('Combinaciones de filtros', 'filtros.csv',
      'city,listingType,propertyType,minPrice,maxPrice,minBedrooms,stratum'),
    csvDataSet('Quién busca', 'buscadores.csv', 'token'),
    headerManager('Token', BEARER),
    throughputTimer('30 por segundo', '${RPM_CATALOGO}'),
    httpGet('GET /properties/catalog', CATALOGO, [
      responseCode('Debe responder 200', '200'),
      durationAssertion('Umbral de RNF-01', '${P95_RNF01}'),
    ]),
  ]),

  // El peor caso del requisito: 50 km desde el centro de Bogotá, donde está el 70% del catálogo.
  // Obliga a calcular la distancia de casi todas las filas. Si RNF-01 se cumple aquí, se cumple.
  threadGroup('RNF-01 · peor caso, radio amplio sobre Bogotá',
    { threads: 5, rampSeconds: 2, durationSeconds: 30, delaySeconds: '${DURATION}' }, [
      csvDataSet('Quién busca', 'buscadores.csv', 'token'),
      headerManager('Token', BEARER),
      throughputTimer('5 por segundo', '${RPM_AMPLIO}'),
      httpGet('GET /properties/search (50 km)',
        '/properties/search?latitude=4.7110&longitude=-74.0721&radiusKm=50&ownershipScope=ALL', [
          responseCode('Debe responder 200', '200'),
          durationAssertion('Umbral de RNF-01', '${P95_RNF01}'),
        ]),
    ]),

  listener('ViewResultsFullVisualizer', 'Ver árbol de resultados — apagado, enciéndelo para la demostración'),
  listener('SummaryReport', 'Informe resumen — apagado, enciéndelo para la demostración'),
  listener('StatVisualizer', 'Informe agregado — apagado, enciéndelo para la demostración'),
  listener('GraphVisualizer', 'Gráfica de resultados — apagado, enciéndelo para la demostración'),
]);

close('</hashTree>');
close('</jmeterTestPlan>');

const target = process.argv[2] || path.join(__dirname, 'rnf01.jmx');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, p.terminar(), 'utf8');
console.log('escrito', target, p.terminar().split('\n').length, 'lineas');
