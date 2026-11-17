# Publicar Desafío Homer en Railway

El repositorio incluye un Dockerfile. La aplicación escucha en `0.0.0.0` y usa el `PORT` del entorno. Railway se encarga del HTTPS; en este despliegue no se usan Caddy ni Docker Compose.

## Servicio

1. Conectá el repositorio `homerig/desafio-homer`, rama `main`, a un servicio del proyecto.
2. Usá el Dockerfile de la raíz. No hace falta definir un comando de compilación o inicio adicional: el Dockerfile ejecuta `node server/index.js`.
3. Agregá un **volumen persistente montado en `/app/data`**. Allí quedan la base SQLite, las cuentas y las fotos.
4. Generá un dominio público y configurá las variables de abajo antes del despliegue definitivo.
5. En la configuración del servicio, usá `/api/health` como ruta de healthcheck. Conservá **una sola réplica** y el servicio activo durante la fiesta.

## Variables

```dotenv
NODE_ENV=production
HOST=0.0.0.0
DATA_DIR=/app/data
PUBLIC_URL=https://TU-DOMINIO-PUBLICO
TRUST_PROXY=1
RAILWAY_RUN_UID=0
COLOR_DELTA_E=32
COLOR_MIN_COVERAGE=0.25
```

Reemplazá `PUBLIC_URL` por la URL HTTPS real, sin ruta. Se usa para el QR y la validación del origen de las solicitudes. La app rechaza el inicio en producción si esta URL no usa HTTPS. Dejá que Railway asigne `PORT` y que el dominio apunte a ese puerto.

`RAILWAY_RUN_UID=0` permite escribir en el volumen montado como root, aunque la imagen define por defecto el usuario `node`. Es la configuración indicada por [Railway para permisos de volúmenes](https://docs.railway.com/volumes#permissions). Sin el volumen, los datos no quedan protegidos frente a reemplazos del contenedor.

## Primera cuenta administrativa

Después de que el servicio esté funcionando, abrí una sesión SSH del contenedor mediante la CLI de Railway, seleccionando este proyecto, entorno y servicio:

```bash
railway login
railway link
railway ssh
```

Dentro del contenedor:

```bash
cd /app
npm run admin:create
```

Elegí usuario y contraseña (mínimo 12 caracteres). Luego entrá a `https://TU-DOMINIO-PUBLICO/admin`.

Usá SSH al contenedor desplegado, como describe la [documentación de Railway](https://docs.railway.com/cli/ssh). `railway run` ejecuta comandos en la computadora local y no crea la cuenta en el volumen remoto. Tampoco uses un comando de pre-deploy para crear la cuenta: el volumen aún no está montado en esa etapa, según la [documentación de volúmenes](https://docs.railway.com/volumes#volume-availability).

La cuenta y los participantes de las pruebas locales **no se suben a GitHub**. La instancia publicada empieza limpia. No hace falta guardar la contraseña en el repositorio ni en una variable permanente del servicio.

## Comprobación del despliegue

- `/api/health` devuelve `{"ok":true}`.
- Podés iniciar sesión en `/admin` y entrar como invitado desde `/`.
- El QR apunta al dominio público HTTPS.
- Dos teléfonos conectados reciben las actualizaciones; para iniciar animales hacen falta al menos cuatro jugadores conectados.
- Después de reiniciar el servicio, se mantienen la cuenta y los participantes gracias al volumen.

El repositorio está preparado para este despliegue; no se creó ni se publicó un servicio Railway desde esta entrega.
