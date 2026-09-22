# Bitácora arquitectónica individual — Mateo Madrigal Luz

Proyecto Fix&Rent (FixUp) · Grupo Fixapp · Arquitectura de Software

Cada entrada registra fecha y hora, personas involucradas, tipo de entrada y descripción. Cuando la
entrada corresponde a una decisión de diseño, incluye el proceso ADD: drivers, conceptos de diseño
analizados, diagramas preliminares, análisis preliminar de resultados y tareas asignadas.

---

## Entrada 1 — 20 de agosto de 2026

**Personas involucradas:** los cinco integrantes del equipo
**Tipo de entrada:** inicio de iteración y decisión de diseño (ADD)

**Descripción.** Nos organizamos para repartir los 17 casos de uso ASR únicos que filtramos del
Excel. Me quedé con el tercer bloque de responsabilidades: consultar indicadores del mercado
inmobiliario, registro y validación del Fixer, y crear el portafolio visual.

**Proceso ADD (mis ASR)**

- **Drivers.** Rendimiento: los indicadores deben cargar rápido sin trabar la interfaz. Seguridad:
  manejar bien los datos y documentos de los técnicos. Escalabilidad y disponibilidad: gestionar el
  peso de las fotos y videos del portafolio sin caerse.
- **Conceptos de diseño analizados.** PostgreSQL como base relacional, para aprovechar su velocidad
  en las consultas de indicadores. Para el portafolio, almacenamiento en la nube (bucket S3 o
  Supabase Storage) para no saturar el servidor propio con archivos pesados.
- **Diagramas preliminares.** Falta armar un diagrama de componentes práctico que muestre cómo se
  comunica el cliente con el backend, la base de datos y el servicio de almacenamiento externo.
- **Análisis preliminar de resultados.** Sacar las imágenes del servidor principal quita un problema
  grande de infraestructura. Para los indicadores, dejar que PostgreSQL haga el trabajo pesado con
  consultas optimizadas es más eficiente que procesar todo en el código.

---

## Entrada 2 — 25 de agosto de 2026

**Personas involucradas:** actividad de clase, equipo completo
**Tipo de entrada:** ejercicio de clase — tácticas y patrones de disponibilidad

**Descripción.** Ejercicio de la sesión de disponibilidad: identificar tácticas y patrones
relevantes para los escenarios de disponibilidad del proyecto. Revisando el Excel de casos de uso,
el escenario que más claramente aplica es FR-UC-08 (solicitud de reparaciones urgentes con SLA de
48 horas), porque es de prioridad crítica, tiene riesgo alto por los temporizadores, la asignación
automática y el escalamiento, y es el diferenciador de negocio de Fix&Rent. También incluimos
FR-UC-10 (notificaciones de estado), porque es el motor de eventos que sostiene ese SLA.

Como no tenemos infraestructura real —no vamos a montar redundancia con servidores hot, warm o cold
spare, ni TMR, eso es para producción de verdad— nos enfocamos en tácticas implementables a nivel de
código con nuestro stack:

- **Detección.** Monitoreo del backend y dependencias críticas; ping/echo o heartbeat para verificar
  que los servicios que soportan el SLA estén vivos; detección de excepciones en llamadas a
  servicios externos y a la base de datos; timeout para no dejar operaciones colgadas; sanity
  checking para validar que la respuesta no solo llegó, sino que es correcta.
- **Recuperación.** Retry para fallos transitorios, sobre todo en FR-UC-10 y FR-UC-18; graceful
  degradation para que el resto de la aplicación siga funcionando si un servicio externo se cae;
  reconfiguración para redirigir la ejecución si una instancia deja de responder; reinicio escalado,
  primero la unidad más pequeña; rollback para no dejar estados a medias en operaciones críticas
  (FR-UC-08, 14, 19, 22).
- **Prevención.** Transacciones para evitar estados parciales; prevención de excepciones validando
  antes de ejecutar; incrementar estados competentes diseñando explícitamente los flujos
  alternativos de error para FR-UC-08, 10, 18 y 21.

**Patrón elegido para el escenario principal.** Circuit Breaker (Resilience4j) sobre las llamadas al
servicio de notificaciones push: si las notificaciones empiezan a fallar, el circuit breaker corta
los reintentos indefinidos y dispara el escalamiento al administrador por otra vía, en vez de dejar
la solicitud urgente esperando sin control.

**Análisis preliminar de resultados.** La mayoría de estas tácticas se implementan directamente en
el código —try/catch, timeouts, retries— sin infraestructura extra, lo cual tiene mucho más sentido
para el alcance académico del proyecto. Timeout, retry y circuit breaker cubren bien el riesgo del
SLA sin inventar una arquitectura de redundancia que no vamos a poder sustentar.

---

## Entrada 3 — 1 de septiembre de 2026

**Personas involucradas:** yo
**Tipo de entrada:** trabajo técnico y mantenimiento del repositorio

**Descripción.** Arreglé y ajusté el repositorio del proyecto original. Aparte, creé un repositorio
para hacer pruebas sin arriesgar el principal: `FixUp---pruebas-A.S`, en mi cuenta personal, donde
vamos a probar con una API key nueva. También alimenté un NotebookLM del equipo con el contexto de
la aplicación, para resolver dudas de diseño más adelante.

**Desplegabilidad.** Todavía no decidimos nada; lo acordamos con el equipo cuando estemos todos. Hoy
faltaron algunos por temas de tesis, así que aprovecho el tiempo para indagar más al respecto.

---

## Entrada 4 — 7 de septiembre de 2026, 8:57 p.m. (reunión virtual)

**Personas involucradas:** Sebastián Méndez, Ismafrr y yo
**Tipo de entrada:** reunión de equipo — decisión de diseño

**Descripción.** Reunión virtual para cerrar la arquitectura del documento. Sebastián propuso una
arquitectura de tres capas —frontend independiente, backend como monolito modular y base de datos
PostgreSQL— y quedó acordada. Me toca ajustar la estructura de la aplicación para que cuadre con
esto; Sebastián se encarga de redactar la descripción de la arquitectura por capas en el documento.
También quedamos en preguntarle al profesor los requisitos exactos para la primera entrega antes de
meterle más horas al documento: nos preocupa el estado de los diagramas —hay que corregirlos, no se
ven bien— y no tenemos clara la fecha real de esa entrega (el resumen automático de la reunión dice
3 de agosto, pero eso ya pasó, así que hay que confirmarlo).

Sobre el parcial 2: cambió el formato sin aviso previo; ahora solo se permite una hoja de ayuda
tamaño carta escrita a mano.

**Análisis preliminar de resultados.** Con la arquitectura de capas acordada puedo empezar a mover
la aplicación hacia ese esquema sin esperar más. Lo urgente es aclarar qué tan avanzado tiene que
estar el documento para la primera entrega.

---

## Entrada 5 — 17 de septiembre de 2026

**Personas involucradas:** yo (registro individual). Se referencian la reunión de equipo del 15 de
septiembre y el trabajo de Sebastián Méndez sobre el entorno de despliegue.
**Tipo de entrada:** registro de avance — inicio de iteración de desarrollo

**Descripción.**

*Reunión del equipo (martes 15 de septiembre, 9:00 p.m.).* Pasamos formalmente a etapa de desarrollo
de los casos de uso asignados a cada quien y organizamos los repositorios del proyecto: frontend,
backend, pruebas y principal, este último con la aplicación móvil en Kotlin. También quedó repartido
el documento SAD; a mí me corresponden las secciones de Contexto, Contenedores y Componentes, que es
continuidad de los diagramas C4 que vengo trabajando desde agosto.

*Entorno de desarrollo compartido (miércoles 16 de septiembre).* Sebastián dejó versionado en
`FixUp---pruebas-A.S` un despliegue local con Docker, con instrucciones, para que todo el equipo
trabaje sobre el mismo ambiente y el comportamiento sea reproducible entre máquinas. El `.env`
incluido es de ejemplo. El contenedor está diseñado para probar la rama en la que cada quien esté
parado en el momento, así el front y el back estén en ramas distintas, y sin necesidad de hacer
push. Junto con eso quedó fijada la convención de ramas: no se trabaja directamente sobre `develop`,
sino sobre `feature/<nombre-de-la-funcionalidad>`, y `develop` ya tiene CI configurado.

Esta decisión de proceso vale registrarla como tal: el empaquetado en contenedores es la táctica de
desplegabilidad *Package Dependencies* que habíamos analizado en la sesión del 3 de septiembre
—repetibilidad entre desarrollo, pruebas y producción— y la CI sobre `develop` es el primer paso
concreto del nivel de automatización que definimos como métrica de ese atributo. Es decir, la
desplegabilidad dejó de estar solo en el papel.

*Arranque de pendientes (17 de septiembre).* Empiezo a ejecutar lo que me corresponde para la
primera entrega:

- Prototipo individual de FR-UC-15 (consultar indicadores del mercado inmobiliario), FR-UC-16
  (registro y validación del Fixer) y FR-UC-17 (crear el portafolio visual), end-to-end —interfaz,
  backend, base de datos y servicios de apoyo— con pruebas de integración sobre el backend.
- Mis secciones del documento SAD: diagramas de Contexto, Contenedores y Componentes, corrigiendo
  además el problema de calidad visual de los diagramas identificado el 7 de septiembre.

**Riesgos y puntos abiertos que registro hoy**

- Dependencia de FR-UC-21 (autenticación segura y gestión de sesiones, a cargo de Santiago). Mis
  tres casos requieren usuario autenticado, así que mi prototipo no queda demostrable end-to-end
  hasta que ese caso esté implementado. Es la dependencia más crítica de mi ruta.
- Inconsistencia arquitectónica sin resolver: la documentación del 20 de agosto y del 3 de
  septiembre describe una arquitectura de microservicios en la nube, mientras que el 7 de septiembre
  acordamos monolito modular de tres capas con PostgreSQL. Los diagramas de contenedores y
  componentes que me corresponden no se pueden dibujar de forma coherente hasta que esto quede
  zanjado, y en cualquier caso debe quedar como decisión explícita en el registro de decisiones
  arquitectónicas.
- Fecha de entrega: los entregables deben estar subidos a Brightspace antes de que inicie la clase
  del 22 de septiembre, aunque nuestra sustentación sea el 29; después de esa subida no se permiten
  modificaciones.

**Análisis preliminar de resultados.** Tener el ambiente en Docker quita la variabilidad entre
máquinas, que era el riesgo obvio con cinco personas desarrollando en paralelo y con el requisito de
despliegue distribuido en dos o más computadores. El cuello de botella real de mi parte no es el
código de mis tres casos de uso, sino las dos dependencias anteriores: la autenticación y la
definición firme del estilo arquitectónico. Por eso arranco por los diagramas de Contexto y
Contenedores, que son los que fuerzan a cerrar esa definición, y en paralelo monto lo que no depende
de la autenticación.

---

## Entrada 6 — 20 de septiembre de 2026 · Implementación end-to-end de FR-UC-15, FR-UC-16 y FR-UC-17

Cubre el trabajo realizado entre el 18 y el 20 de septiembre.

**Personas involucradas:** Mateo Madrigal Luz (autor del trabajo registrado). Se referencian las
revisiones posteriores de Sebastián Méndez y Sergio Parra sobre este mismo código.
**Tipo de entrada:** trabajo individual — implementación, pruebas y cierre de iteración de
desarrollo

**Descripción.** Cerré la implementación end-to-end de los tres casos de uso que me fueron asignados
el 20 de agosto. Cada uno quedó completo en las cuatro capas que exige la entrega —interfaz,
backend, base de datos y servicio de apoyo— y con pruebas de integración sobre el backend. El
trabajo se hizo en tres ramas `feature` separadas desde `develop`, siguiendo la convención acordada
el 15 de septiembre, y entró a `develop` por pull request revisado.

| Caso de uso | Qué quedó implementado | Evidencia en el repositorio |
|---|---|---|
| FR-UC-16 — Registro y validación del Fixer | Máquina de estados PENDING / VERIFIED / REJECTED, carga parcial de documentos con apertura automática de la revisión al completarse el conjunto obligatorio, y decisión administrativa con bloqueo pesimista de la fila. Seis rutas bajo `/fixers`. Pantallas de carga de documentos y de revisión del administrador. | Rama `feature/fixer-verification`. Commits f365551, 3e8c0e2, 0e10164, 0927fdb, 4d10b6b y ce6234b (18-sep, 00:48). Backend: PR #25, mergeado el 18-sep a las 09:22. |
| FR-UC-17 — Crear el portafolio visual | Ciclo de vida del medio, subida directa al almacenamiento con URL firmada, publicación del portafolio sujeta a la regla de tres fotografías visibles y borrado durable del objeto fuera de la transacción. Pantalla de portafolio con subida y curaduría. | Rama `feature/fixer-portfolio`. Commits 92c430f, 7e0eb35, 2f40f9c, bc21212, 5c63240 y 6fb0dc6 (18-sep, 00:54–00:56); endurecimiento de concurrencia en c0b2955 (18-sep, 15:10). Backend: PR #26, mergeado el 19-sep a las 10:21. |
| FR-UC-15 — Consultar indicadores del mercado | Adaptador REST con timeout y reintentos acotados, caché monotónica en PostgreSQL y degradación al último valor conocido cuando la fuente no responde. La respuesta distingue frescura de procedencia. Pantalla de consulta por zona. | Rama `feature/market-indicators`. Commits 443b457, 6cd13fe, 8b5c875, c62feca, df9e38c, 8299308 y 9defa0c (18-sep, 01:01–01:02); separación de procedencia y frescura en 9256df0 (18-sep, 15:18). Backend: PR #27, mergeado el 19-sep a las 11:25. |
| Frontend de los tres casos | Generación del cliente tipado desde el contrato OpenAPI del backend, interceptor que adjunta el Bearer solo a las rutas de la API, cuatro pantallas nuevas y registro de sus rutas privadas con guarda por rol. | Commits f8b92c6, fcdde25, a37b3b3, 6871dd2, 0c74a3e y 396e338 (18-sep, 01:15) y 1dd17b6 (18-sep, 08:30). Frontend: PR #24, mergeado el 19-sep a las 16:43. |

**Decisiones de diseño tomadas durante la implementación.** Tres decisiones se tomaron al escribir
el código, no antes, porque solo aparecieron al enfrentar el problema concreto. Las registro con su
alternativa descartada.

- *El backend no recibe archivos.* El cliente pide una URL firmada y sube el archivo directamente
  contra el bucket privado; el cuerpo que llega a la API lleva solo el identificador del medio. La
  alternativa descartada era recibir el archivo por multipart, que habría obligado a dimensionar la
  API por el tamaño de los archivos y a resolver límites de tamaño y antivirus dentro del alcance de
  la entrega. La consecuencia asumida es que la validación del contenido ocurre después de la
  subida: por eso la confirmación verifica los magic bytes del archivo contra el tipo declarado y
  marca el medio como inválido si no coinciden.
- *El borrado del objeto no ocurre dentro de la transacción que borra la pieza.* Se encola un
  trabajo que un worker reclama con `FOR UPDATE SKIP LOCKED` y ejecuta con la transacción ya
  cerrada, con reintentos, límite de intentos y recuperación automática de los trabajos que quedaron
  a medias si el backend se reinicia. La alternativa —llamar al almacenamiento dentro de la
  transacción— retiene una conexión del pool esperando a un servicio externo, y deja la base y el
  bucket inconsistentes si el proceso muere entre ambos.
- *En los indicadores de mercado, la respuesta separa la frescura de la procedencia.* La frescura
  indica si el dato se obtuvo ahora, salió de caché o es el último valor conocido tras un fallo; la
  procedencia, si lo produjo el proveedor real o la fuente sintética de desarrollo. Inicialmente el
  respaldo sintético se activaba por falta de configuración y respondía igual que una fuente real,
  lo que significaba que un entorno mal configurado servía números inventados como si fueran
  observaciones del mercado. Se corrigió: la falta de configuración produce indisponibilidad, que es
  la verdad, y el respaldo sintético exige perfil de desarrollo y declaración explícita.

**Tácticas de atributos de calidad aplicadas.** Estas decisiones corresponden a tácticas que el
equipo había catalogado en la sesión de disponibilidad del 25 de agosto, aplicadas ahora sobre
código real.

| Táctica catalogada el 25-ago | Dónde quedó implementada |
|---|---|
| Timeout | Adaptador REST de indicadores: la llamada al proveedor tiene tiempo límite y ocurre fuera de toda transacción. |
| Retry | Reintentos acotados a tres, con espera configurable y recortada en código, para que ninguna configuración pueda inmovilizar un hilo del servidor. |
| Graceful degradation | Si el proveedor no responde y existe caché previa, se responde el último valor conocido marcado como degradado; si no existe, se responde 503 en lugar de un número inventado. |
| Transacciones (prevención) | La decisión de verificación bloquea la fila del perfil de forma pesimista para que dos administradores no se pisen. |
| Sanity checking | La confirmación de subida compara el tipo declarado contra el tipo realmente almacenado y contra los magic bytes del archivo. |

**Revisiones posteriores sobre este código.** Entre el 19 y el 20 de septiembre, otros integrantes
trabajaron sobre los módulos que entregué. Lo registro porque cambia lo que hoy está en `develop`
respecto de lo que yo mergeé. Sebastián endureció la validación del proveedor de indicadores y la
concurrencia de la caché, y llevó el módulo de medios a un ciclo controlado con tickets firmados y
purga durable. Sergio añadió validación real de documentos y políticas de Row-Level Security sobre
el módulo `fixers` como parte de FR-UC-23. En la sustentación debo poder responder tanto por mi
diseño original como por el estado actual del código.

**Riesgos y puntos abiertos que registro hoy**

- *Colisión de versiones de Flyway con la rama de FR-UC-14.* La rama
  `feature/fr-uc-14-lease-contracts` define migraciones V6 a V10 con contenido distinto al de las V6
  a V9 que ya están en `develop`. Si esa rama se mergea sin renumerar, Flyway encuentra dos
  migraciones con la misma versión y el arranque falla para todo el equipo. Es el riesgo con mayor
  impacto y mayor probabilidad antes de la entrega, y no depende de mí resolverlo.
- *El documento SAD sigue siendo la plantilla vacía a dos días del cierre.* Mis secciones están
  redactadas y con diagramas nuevos derivados del código, pero las demás secciones no tienen
  contenido. El documento pesa un tercio de la rúbrica.
- *Despliegue distribuido sin resolver.* La entrega exige que el sistema quede distribuido en dos o
  más computadores y arranque con un único script. El entorno actual levanta los tres contenedores
  en una sola máquina con los puertos publicados solo en la interfaz local.
- *Registro de la Callback URL en el tenant de Auth0.* Ninguno de mis tres casos de uso es
  demostrable sin sesión iniciada.
- *Inconsistencia arquitectónica registrada el 17 de septiembre:* queda resuelta en mis secciones
  del SAD, donde el cambio de microservicios a monolito modular y el cambio de proveedores respecto
  de la documentación de agosto se documentan explícitamente. Falta que quede además como decisión
  formal en el registro de decisiones arquitectónicas, sección que no me corresponde.

**Análisis preliminar de resultados.** Mi parte funcional de la entrega quedó cerrada: los tres
casos de uso están en `develop`, con pruebas y revisados por pares. El riesgo de mi ruta dejó de ser
técnico y pasó a ser de integración: lo que hoy puede hundir la entrega no es el código de mis casos
de uso, sino que la rama de un compañero rompa el arranque de la base de datos, que el documento de
arquitectura llegue vacío, o que la demostración en vivo no se pueda ejecutar por un registro de
configuración pendiente. Por eso el esfuerzo de los dos días que quedan lo dirijo a cerrar mis
secciones del documento y a forzar la resolución de esos tres bloqueos con el equipo, y no a añadir
funcionalidad nueva, que a esta altura solo agregaría riesgo.

---

## Entrada 7 — 21 de septiembre de 2026 · Cierre de mis secciones del SAD y versionado de la bitácora

**Personas involucradas:** yo. Se referencian los merges del día de Sebastián Méndez (FR-UC-04),
Sergio Parra (bloque de seguridad) y Santiago Forero (pipeline de despliegue).
**Tipo de entrada:** trabajo individual — documentación arquitectónica y control de configuración

**Descripción.**

*Revisión del estado real de los entregables.* Contrasté el contenido del documento SAD en Drive con
el estado de los tres repositorios. Durante el día entraron a `develop` el bloque de seguridad de
Sergio (backend PR #31 y frontend PR #28, con RLS, chat privado y verificación con `mediaId`),
FR-UC-04 de Sebastián (PR #33) y el pipeline de despliegue con manifiestos de Kubernetes de
Santiago. La rama `feature/fr-uc-14-lease-contracts` sigue sin mergear y sigue con la colisión de
migraciones que registré ayer, ahora contra un esquema que ya va en V16.

*Actualización de mis diagramas a versión 2.1.* El merge de FR-UC-04 introdujo una dependencia de
módulo que mi diagrama de componentes no tenía: `requests` ahora depende de `properties` a través de
`PropertyDirectory`, porque una solicitud de reparación cuelga de un inmueble del propietario.
Regeneré el diagrama de nivel 3 de la API con esa relación, actualicé la etiqueta del módulo
`properties` para que refleje que sirve a FR-UC-04 y a FR-UC-12, y ajusté el párrafo del documento
que enumera la forma del grafo de dependencias. La corrección importa porque mis secciones afirman
que los diagramas se derivan de `develop` y que `ModularityTest` verifica esas dependencias: un
diagrama desactualizado contradice su propia justificación.

*Consolidación en el documento del equipo.* Pegué en el SAD de Drive las secciones de Contexto y
Alcance y de Vista de contenedores, eliminando los párrafos de instrucciones de la plantilla. La
Vista de componentes requiere cuidado adicional porque esa sección ya contenía el texto del bloque
de seguridad redactado por Sergio, que debe conservarse junto al mío y no reemplazarse.

*Versionado de esta bitácora.* La rúbrica exige entregar las bitácoras como enlace al repositorio y
no como archivo en Drive. Por eso esta bitácora queda versionada en `docs/bitacoras/` del
repositorio de pruebas e infraestructura, donde el historial de Git deja evidencia verificable de
las fechas de cada entrada.

**Riesgos y puntos abiertos**

- La Vista de componentes del documento del equipo todavía no tiene mis tres diagramas de nivel 3 ni
  la tabla de módulos; sin ellos, la sección queda con la descripción del bloque de seguridad pero
  sin la descomposición de los contenedores que pide el nivel 3 del modelo C4.
- El documento se contradice sobre la pasarela de pagos: mi tabla de sistemas externos la declara
  como no integrada, que es lo que hay en `develop`, mientras la introducción y el ASR-SE-13
  describen una integración con una pasarela externa y un escenario de caída con MTTR. Hay que
  resolverlo con el equipo antes de subir, porque afecta lo que se puede demostrar en vivo.
- El pipeline de despliegue entró directamente a `develop` sin pull request, contra la convención
  acordada el 15 de septiembre.
