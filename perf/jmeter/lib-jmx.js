// Constructores del XML de JMeter, compartidos por los generadores de planes.
// El XML de JMeter es repetitivo y un paréntesis mal puesto deja el plan sin abrir, así que
// ningún .jmx se escribe a mano: se genera desde aquí.
//
//   const { crear } = require('./lib-jmx');
//   const p = crear();   // p.node, p.threadGroup, p.httpGet, ... y p.terminar()

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// JMeter nombra cada stringProp de una colección con el hashCode Java del contenido.
function javaHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

function crear() {
let out = [];
let depth = 0;
const w = (line) => out.push('  '.repeat(depth) + line);
const open = (line) => { w(line); depth++; };
// Escribe una línea sin tocar la sangría ni la profundidad: para la declaración XML.
const raw = (line) => out.push(line);
const close = (line) => { depth--; w(line); };

// Un nodo de JMeter es el elemento seguido de su propio hashTree con los hijos.
function node(xmlLines, children) {
  xmlLines.forEach((l) => w(l));
  if (!children || children.length === 0) {
    w('<hashTree/>');
    return;
  }
  open('<hashTree>');
  children.forEach((c) => c());
  close('</hashTree>');
}

// ---------- elementos ----------

const userVars = (testname, vars) => () => node([
  `<Arguments guiclass="ArgumentsPanel" testclass="Arguments" testname="${esc(testname)}" enabled="true">`,
  '  <collectionProp name="Arguments.arguments">',
  ...Object.entries(vars).flatMap(([k, v]) => [
    `    <elementProp name="${esc(k)}" elementType="Argument">`,
    `      <stringProp name="Argument.name">${esc(k)}</stringProp>`,
    `      <stringProp name="Argument.value">${esc(v)}</stringProp>`,
    '      <stringProp name="Argument.metadata">=</stringProp>',
    '    </elementProp>',
  ]),
  '  </collectionProp>',
  '</Arguments>',
]);

const httpDefaults = () => () => node([
  '<ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="Valores por defecto HTTP" enabled="true">',
  '  <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">',
  '    <collectionProp name="Arguments.arguments"/>',
  '  </elementProp>',
  '  <stringProp name="HTTPSampler.domain">${HOST}</stringProp>',
  '  <stringProp name="HTTPSampler.port">${PORT}</stringProp>',
  '  <stringProp name="HTTPSampler.protocol">${PROTOCOL}</stringProp>',
  '  <stringProp name="HTTPSampler.contentEncoding">UTF-8</stringProp>',
  '  <stringProp name="HTTPSampler.path"></stringProp>',
  '  <stringProp name="HTTPSampler.concurrentPool">6</stringProp>',
  '  <stringProp name="HTTPSampler.connect_timeout">5000</stringProp>',
  '  <stringProp name="HTTPSampler.response_timeout">30000</stringProp>',
  '</ConfigTestElement>',
]);

const csvDataSet = (testname, file, variableNames, { recycle = true, shareMode = 'shareMode.all' } = {}) => () => node([
  `<CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="${esc(testname)}" enabled="true">`,
  `  <stringProp name="filename">\${CSV_DIR}/${esc(file)}</stringProp>`,
  '  <stringProp name="fileEncoding">UTF-8</stringProp>',
  `  <stringProp name="variableNames">${esc(variableNames)}</stringProp>`,
  '  <boolProp name="ignoreFirstLine">true</boolProp>',
  '  <stringProp name="delimiter">,</stringProp>',
  '  <boolProp name="quotedData">false</boolProp>',
  `  <boolProp name="recycle">${recycle}</boolProp>`,
  `  <boolProp name="stopThread">${!recycle}</boolProp>`,
  `  <stringProp name="shareMode">${esc(shareMode)}</stringProp>`,
  '</CSVDataSet>',
]);

const headerManager = (testname, headers) => () => node([
  `<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="${esc(testname)}" enabled="true">`,
  '  <collectionProp name="HeaderManager.headers">',
  ...Object.entries(headers).flatMap(([k, v]) => [
    '    <elementProp name="" elementType="Header">',
    `      <stringProp name="Header.name">${esc(k)}</stringProp>`,
    `      <stringProp name="Header.value">${esc(v)}</stringProp>`,
    '    </elementProp>',
  ]),
  '  </collectionProp>',
  '</HeaderManager>',
]);

const threadGroup = (testname, { threads, rampSeconds, durationSeconds, delaySeconds = 0, loops = -1 }, children) => () => node([
  `<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${esc(testname)}" enabled="true">`,
  '  <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>',
  '  <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">',
  '    <boolProp name="LoopController.continue_forever">false</boolProp>',
  `    <stringProp name="LoopController.loops">${esc(loops)}</stringProp>`,
  '  </elementProp>',
  `  <stringProp name="ThreadGroup.num_threads">${esc(threads)}</stringProp>`,
  `  <stringProp name="ThreadGroup.ramp_time">${esc(rampSeconds)}</stringProp>`,
  `  <boolProp name="ThreadGroup.scheduler">${durationSeconds ? 'true' : 'false'}</boolProp>`,
  `  <stringProp name="ThreadGroup.duration">${esc(durationSeconds || '')}</stringProp>`,
  `  <stringProp name="ThreadGroup.delay">${esc(delaySeconds || '')}</stringProp>`,
  '  <boolProp name="ThreadGroup.same_user_on_next_iteration">false</boolProp>',
  '</ThreadGroup>',
], children);

const httpGet = (testname, pathExpr, children) => () => node([
  `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(testname)}" enabled="true">`,
  '  <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">',
  '    <collectionProp name="Arguments.arguments"/>',
  '  </elementProp>',
  `  <stringProp name="HTTPSampler.path">${esc(pathExpr)}</stringProp>`,
  '  <stringProp name="HTTPSampler.method">GET</stringProp>',
  '  <boolProp name="HTTPSampler.follow_redirects">true</boolProp>',
  '  <boolProp name="HTTPSampler.auto_redirects">false</boolProp>',
  '  <boolProp name="HTTPSampler.use_keepalive">true</boolProp>',
  '  <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>',
  '</HTTPSamplerProxy>',
], children);

const httpPost = (testname, pathExpr, children) => () => node([
  `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(testname)}" enabled="true">`,
  '  <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">',
  '    <collectionProp name="Arguments.arguments"/>',
  '  </elementProp>',
  `  <stringProp name="HTTPSampler.path">${esc(pathExpr)}</stringProp>`,
  '  <stringProp name="HTTPSampler.method">POST</stringProp>',
  '  <boolProp name="HTTPSampler.follow_redirects">true</boolProp>',
  '  <boolProp name="HTTPSampler.auto_redirects">false</boolProp>',
  '  <boolProp name="HTTPSampler.use_keepalive">true</boolProp>',
  '  <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>',
  '</HTTPSamplerProxy>',
], children);

// testType 8 = igual, 2 = expresión regular
const responseCode = (testname, pattern, testType = 8) => () => node([
  `<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="${esc(testname)}" enabled="true">`,
  '  <collectionProp name="Asserion.test_strings">',
  `    <stringProp name="${javaHash(pattern)}">${esc(pattern)}</stringProp>`,
  '  </collectionProp>',
  '  <stringProp name="Assertion.custom_message"></stringProp>',
  '  <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>',
  '  <boolProp name="Assertion.assume_success">false</boolProp>',
  `  <intProp name="Assertion.test_type">${testType}</intProp>`,
  '</ResponseAssertion>',
]);

const durationAssertion = (testname, millisExpr) => () => node([
  `<DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion" testname="${esc(testname)}" enabled="true">`,
  `  <stringProp name="DurationAssertion.duration">${esc(millisExpr)}</stringProp>`,
  '</DurationAssertion>',
]);

// calcMode 2 = repartir el objetivo entre los hilos activos del grupo. El valor es POR MINUTO.
// Va como stringProp y no como doubleProp porque lleva una variable: JMeter guarda así las
// propiedades de TestBean que no son un literal.
const throughputTimer = (testname, perMinuteVar) => () => node([
  `<ConstantThroughputTimer guiclass="TestBeanGUI" testclass="ConstantThroughputTimer" testname="${esc(testname)}" enabled="true">`,
  '  <intProp name="calcMode">2</intProp>',
  `  <stringProp name="throughput">${esc(perMinuteVar)}</stringProp>`,
  '</ConstantThroughputTimer>',
]);

// Los visualizadores van APAGADOS: encendidos frenan una corrida sin interfaz y falsean la
// medición. Se encienden a mano en JMeter para mostrar la ejecución en vivo.
const listener = (guiclass, testname) => () => node([
  `<ResultCollector guiclass="${guiclass}" testclass="ResultCollector" testname="${esc(testname)}" enabled="false">`,
  '  <boolProp name="ResultCollector.error_logging">false</boolProp>',
  '  <objProp>',
  '    <name>saveConfig</name>',
  '    <value class="SampleSaveConfiguration">',
  '      <time>true</time>',
  '      <latency>true</latency>',
  '      <timestamp>true</timestamp>',
  '      <success>true</success>',
  '      <label>true</label>',
  '      <code>true</code>',
  '      <message>true</message>',
  '      <threadName>true</threadName>',
  '      <dataType>true</dataType>',
  '      <encoding>false</encoding>',
  '      <assertions>true</assertions>',
  '      <subresults>true</subresults>',
  '      <responseData>false</responseData>',
  '      <samplerData>false</samplerData>',
  '      <xml>false</xml>',
  '      <fieldNames>true</fieldNames>',
  '      <responseHeaders>false</responseHeaders>',
  '      <requestHeaders>false</requestHeaders>',
  '      <responseDataOnError>false</responseDataOnError>',
  '      <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>',
  '      <assertionsResultsToSave>0</assertionsResultsToSave>',
  '      <bytes>true</bytes>',
  '      <sentBytes>true</sentBytes>',
  '      <url>true</url>',
  '      <threadCounts>true</threadCounts>',
  '      <idleTime>true</idleTime>',
  '      <connectTime>true</connectTime>',
  '    </value>',
  '  </objProp>',
  '  <stringProp name="filename"></stringProp>',
  '</ResultCollector>',
]);

const syncTimer = (testname, groupSize, timeoutMs = 20000) => () => node([
  `<SyncTimer guiclass="TestBeanGUI" testclass="SyncTimer" testname="${esc(testname)}" enabled="true">`,
  `  <intProp name="groupSize">${groupSize}</intProp>`,
  `  <longProp name="timeoutInMs">${timeoutMs}</longProp>`,
  '</SyncTimer>',
]);

const BEARER = { Authorization: 'Bearer ${token}', Accept: 'application/json' };

// ---------- el plan ----------

return { esc, javaHash, w, raw, open, close, node, userVars, httpDefaults, csvDataSet,
  headerManager, threadGroup, httpGet, httpPost, responseCode, durationAssertion,
  listener, syncTimer, throughputTimer, BEARER,
  terminar: () => out.join('\n') + '\n' };
}

module.exports = { crear };
