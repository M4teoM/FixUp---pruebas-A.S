# Imagen de ejecución para las pruebas de desempeño.
# El .jar se compila antes, en el workflow, con -DskipTests: las pruebas funcionales son trabajo
# del CI del backend; aquí se mide el sistema en ejecución y no se quiere que una prueba ajena
# intermitente impida medir. Misma base que el Dockerfile del backend (Temurin 21 JRE, usuario sin
# privilegios), para que lo medido sea lo que se despliega.
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system fixup && useradd --system --gid fixup fixup
COPY app.jar app.jar
USER fixup:fixup
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
