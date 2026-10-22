# Entrega 1 completa: cómo correrla

Rama `entrega-1-completa` en los tres repositorios (`fixup-backend`, `fixup-frontend` y este).
Los tres worktrees deben quedar uno al lado del otro, porque los compose construyen con
`../fixup-backend` y `../fixup-frontend`.

## En un solo computador, con cuentas de demostración

El perfil `demo` del backend carga los datos de Colombia (153 usuarios, 200+ inmuebles con fotos,
400+ solicitudes con cotizaciones, trabajos, visitas, pagos y calificaciones) y habilita
`GET /demo/token`, con el que la pantalla de ingreso ofrece entrar como cualquiera de las cinco
cuentas protagonistas sin Auth0.

1. PostgreSQL y el almacén de fotos (SeaweedFS) en Docker. Ejemplo con contenedores sueltos:

   ```bash
   docker run -d --name fixrent-db -e POSTGRES_DB=fixup_entrega1 -e POSTGRES_USER=fixup \
     -e POSTGRES_PASSWORD=fixup-local -p 127.0.0.1:5433:5432 postgres:17-alpine
   docker run -d --name fixrent-storage -p 127.0.0.1:9000:8333 \
     -v "$PWD/config/seaweedfs-s3.json:/etc/seaweedfs/s3.json:ro" \
     chrislusf/seaweedfs:latest server -dir=/data -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json
   ```

2. El backend con el perfil demo (desde `fixup-backend`, después de `./mvnw package -DskipTests`):

   ```bash
   SPRING_PROFILES_ACTIVE=demo \
   DATABASE_URL=jdbc:postgresql://localhost:5433/fixup_entrega1 DATABASE_USERNAME=fixup DATABASE_PASSWORD=fixup-local \
   FIXUP_STORAGE_ENDPOINT=http://localhost:9000 FIXUP_STORAGE_ACCESS_KEY=fixup FIXUP_STORAGE_SECRET_KEY=development-only-secret \
   CORS_ALLOWED_ORIGINS=http://localhost:4200 \
   java -jar target/fixup-backend-0.0.1-SNAPSHOT.jar --fixup.storage.auto-create-bucket=true
   ```

   El registro dice `Demo data loaded` y `Seed photos: … 0 failed` cuando termina.

3. El frontend (desde `fixup-frontend`, con Node 22): `npm start` y abrir http://localhost:4200.

Cuentas de demostración: Carolina Restrepo (propietaria), Andrés Moreno (arrendatario), Jhon Fredy
Cárdenas (técnico verificado), Inmobiliaria Cordillera y Soporte Fix&Rent (administración).

Los indicadores de mercado necesitan una fuente: la sintética de desarrollo solo existe con el
perfil `dev` (decisión del equipo), así que con el perfil demo la pantalla avisa que la fuente no
respondió. En la VM, que corre con `dev`, sí muestran datos marcados como sintéticos.

## En la VM de la universidad (API y datos) con la PWA en el Mac

Requiere estar en la red o la VPN de la universidad y el `.env.vm` del despliegue anterior
(plantilla en `config/vm.env.example`).

```bash
NEW_DB=fixup_entrega1 OLD_DB=fixup ./scripts/desplegar-vm.sh 10.43.99.147
```

El script respalda la base anterior (`fixup`) en `../../backups`, crea `fixup_entrega1`, liga las
cinco cuentas protagonistas a los usuarios reales de Auth0 de la base anterior y arranca todo con
`start-vm.sh`. Con `--solo-preparar` deja el `.env.vm` listo sin arrancar nada; con `--tunel` todo
pasa por SSH si la red bloquea los puertos 8080 y 9000.

En la VM el backend corre con el perfil `dev`: el ingreso es con Auth0 y el acceso de demostración
no aparece. Para volver a la versión anterior basta `POSTGRES_DB=fixup` en `.env.vm` y
`./scripts/start-vm.sh`.
