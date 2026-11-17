# Desafío Homer

App de cumpleaños en español: invitados desde el celular, panel administrativo separado, tres juegos, resultados en vivo y persistencia. Frontend sin compilación, Node.js 24, Express, Server-Sent Events (SSE) y SQLite. No requiere servicios externos ni cuentas para los invitados.

## Ejecutar en tu computadora

Requisito: **Node.js 24 o superior**.

```bash
npm ci
cp .env.example .env
npm run admin:create
npm run dev
```

`admin:create` pide un usuario y una contraseña de al menos 12 caracteres. La contraseña no se muestra y se guarda con scrypt y sal aleatoria, nunca en el código. No hay credenciales predeterminadas. Podés crear más administradores repitiendo el comando; cada cuenta administra sus propias salas. Para automatización, el comando también acepta `ADMIN_USERNAME` y `ADMIN_PASSWORD` desde un gestor de secretos; no los guardes en archivos versionados ni los pases como argumentos de shell.

Abrí **http://localhost:3000/admin** e iniciá sesión. La fiesta se prepara automáticamente y siempre se abre el mismo panel. Los invitados entran directamente a `/` y escriben solo su nombre: no hay códigos de sala ni selección de fiestas. El QR y la invitación apuntan a esa misma página. Los identificadores internos se conservan para mantener el progreso y la compatibilidad con enlaces anteriores.

Para ejecutar sin modo de desarrollo:

```bash
npm start
```

## Sala de prueba

1. Entrá a `/admin`: se abre automáticamente la fiesta Desafío Homer.
2. Abrí el enlace en al menos tres **perfiles o contextos de navegador independientes**, o en distintos dispositivos. Las pestañas del mismo perfil comparten identidad a propósito.
3. Inscribí `AZUL_7`, `Juano99` y otras personas. Para comprobar la confirmación de alias, agregá también `Azu23`.
4. Cerrá las inscripciones. Si hay alias duplicados, elegí la inscripción correcta. Sorteá las salitas.
5. Iniciá cada juego desde la navegación del panel. El primero requiere al menos cuatro participantes y cuatro conectados. Los dos primeros duran exactamente 120 segundos según el servidor.
6. Para las fotos, iniciá el juego para sortear fotógrafos y lanzá la primera consigna. Cerrala y usá «Revisar» para recorrer las entregas, ver el **Tiempo hasta el envío** y elegir al ganador. Cargá una referencia antes de lanzar la tercera consigna.
7. Volvé a cualquier juego para ver sus resultados o usá «Resultados finales». Navegar conserva los datos; reiniciar pide confirmación y limpia solo ese juego.

El enlace local con `localhost` solo funciona en la computadora donde corre el servidor. Para compartir el QR con celulares, configurá la dirección pública en `PUBLIC_URL` y usá HTTPS como se explica abajo. Usar HTTP con una IP local permite entrar a la sala, pero normalmente no permite abrir la cámara en vivo.

## Publicar en Railway

Seguí [RAILWAY.md](RAILWAY.md): conexión del repositorio, volumen SQLite persistente, variables, dominio HTTPS y primera cuenta administrativa remota.

## Publicar con HTTPS

Se incluye una configuración de **Docker Compose + Caddy**, con un volumen para la base de datos y fotos y otro para los certificados. Requiere un servidor con Docker Compose, un dominio y acceso entrante a los puertos 80 y 443.

1. Apuntá el registro DNS A del dominio a la IP del servidor. Si publicás un AAAA, también tiene que apuntar correctamente al servidor por IPv6.
2. Copiá el proyecto al servidor y creá `.env` con:

   ```dotenv
   DOMAIN=cumple.tudominio.com
   COLOR_DELTA_E=32
   COLOR_MIN_COVERAGE=0.25
   ```

3. Levantá la app y creá la cuenta administrativa **en el contenedor**:

   ```bash
   docker compose up -d --build
   docker compose exec app npm run admin:create
   ```

4. Abrí `https://cumple.tudominio.com/admin`, compartí el QR de la fiesta. Caddy obtiene y renueva el certificado cuando el DNS y los puertos son correctos. Ver [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).

El servicio Node queda accesible solo desde la red interna de Docker. El proxy transmite los eventos SSE sin acumularlos; configuración basada en [reverse_proxy de Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). El despliegue habilita cookies `Secure`, cabecera HSTS y validación de origen. La cámara necesita un contexto seguro; `localhost` es una excepción para desarrollo. Ver [getUserMedia en MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

**No está publicado automáticamente**: esta entrega contiene la app local y la configuración de despliegue. Hace falta ejecutar estos pasos en tu servidor con tu dominio. La configuración de Docker se validó sintácticamente; no se probaron la emisión real del certificado ni un despliegue remoto.

### Otro alojamiento Node

Usá un proceso Node permanente, un disco persistente y un proxy con HTTPS y soporte para SSE:

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
PUBLIC_URL=https://cumple.tudominio.com
DATA_DIR=/ruta/persistente/cumple
TRUST_PROXY=1
```

Ejecutá `npm ci --omit=dev`, `npm run admin:create` y `npm start`. `TRUST_PROXY=1` presupone exactamente un proxy de confianza delante de la app. Ajustá la topología antes de usar otra configuración.

**Una sola instancia/proceso de la app**. SQLite guarda el estado y las fotos; las conexiones SSE viven en ese proceso. No uses varias réplicas ni un disco efímero. No es un export estático ni una función serverless. Hay un límite de 150 participantes por sala; las verificaciones funcionales usaron nueve sesiones y no constituyen una prueba de carga de 150 dispositivos.

### Datos y copias de seguridad

- Desarrollo: `data/cumple.sqlite` y los archivos WAL asociados.
- Docker: volumen `cumple_data` montado en `/app/data`.
- Las fotos del juego 2 se validan en memoria y se descartan; se guardan los hashes de las aprobadas. La referencia y las entregas del juego 3 se guardan en SQLite.
- Para copiar una base de datos, detené el servicio durante la copia o usá la API de backup de SQLite. Copiar solo el archivo principal mientras hay escrituras puede omitir cambios del WAL.
- El reinicio del juego 3 elimina sus entregas y referencia. Los demás juegos y los equipos se conservan.
- `docker compose down` conserva los volúmenes. **`docker compose down -v` los borra**, incluidas cuentas, salas y fotos.

## Reiniciar las pruebas completas

Al pie del panel administrativo, en **Empezar de cero**, está **Reiniciar toda la fiesta**. Después de confirmar, cierra las rondas, elimina participantes y equipos, borra los puntos y el progreso de los tres juegos, y elimina entregas y referencia. Vuelve a La previa con las inscripciones abiertas. Conserva la cuenta administrativa y el enlace de la fiesta. Los invitados conectados vuelven automáticamente al formulario para ingresar su nombre. No se puede deshacer. Los botones de reinicio individual siguen disponibles para borrar solo un juego.

## Reglas e integridad

### Sala y equipos

Los alias se normalizan quitando números, separadores, símbolos y marcas diacríticas. Se compara la cadena completa: `AZUL_7` coincide, `Azulina` no. El sorteo usa Fisher–Yates con aleatoriedad criptográfica, reparto por turnos y un intercambio entre equipos si las dos personas confirmadas coinciden en una salita. El tamaño máximo y mínimo difieren a lo sumo en uno. Con un solo alias presente no hay restricción adicional. El sorteo fija los equipos para la fiesta de Homero.

La identidad usa una cookie aleatoria `HttpOnly`, `SameSite=Strict`, con la sesión persistida durante 90 días. Volver desde el mismo perfil y dominio recupera identidad, equipo y partida. Si se borran las cookies o se cambia de navegador, no se puede inferir que sea la misma persona. Sesiones administrativas: siete días, cookie separada y cierre de sesión revocable.

### Animales / números (actualización del 16 de noviembre)

El mínimo admitido es **4 jugadores, con 4 conectados al iniciar**. Con tres, mover solo dos a otra silueta siempre deja a la tercera persona sola: se muestra el aviso y el servidor rechaza el inicio sin modificar la ronda. Con dos sería matemáticamente posible rotar la misma pareja, pero la app requiere tres salitas y esta modalidad busca mezclar compañeros; por eso no admite dos ni tres.

La asignación inicial mezcla los jugadores y usa hasta seis siluetas. Forma grupos pares y, si la cantidad es impar, un único grupo impar. Para 34 distribuye 8/8/6/6/6; para 35, 9/8/6/6/6; para 36, seis grupos de 6. La identidad de cada animal y sus integrantes son aleatorios.

Solo la dupla confirmada cambia de silueta y código. Antes de confirmar se comprueba que quitar dos no deje uno en origen, tanto entre los inscriptos como entre los conectados. Se elige otro animal; el destino gana dos, por lo que nunca queda con uno. Se priorizan los grupos de tres para devolverles movilidad, después los animales con otros conectados, después los ocupados por inscriptos y finalmente los vacíos. Se sortea entre opciones de igual prioridad.

Un grupo de tres **debe esperar a otra dupla**; no se cambia al tercero ni se descartan sus intentos independientes. En una partida sin desconexiones, la paridad conserva como máximo un grupo impar y los demás pares: con cuatro o más siempre queda algún intercambio posible, aunque no toda pareja puede intercambiar en cualquier instante. En particular, con cinco puede haber 3+2: la pareja de dos vuelve al grupo de tres y restaura el grupo de cinco.

Se guarda el último compañero de cada jugador. Se rechaza repetir inmediatamente una dupla cuando ambos tienen otras parejas válidas. Si no hay alternativas (por ejemplo, un grupo de dos), la repetición se permite para no trabar el juego. Nunca se reagrupa a terceros al desconectar o recargar. Una desconexión puede dejar a alguien temporalmente sin compañero conectado; tendrá que esperar una reconexión o una dupla que llegue. No es posible garantizar compañeros conectados frente a desconexiones arbitrarias sin mover a terceros.

Los códigos son cadenas de **4 dígitos**, incluidos ceros iniciales: `0000` a `9999`. No se reutilizan durante la ronda. Los códigos viejos dejan de existir al confirmar. Si se agota el espacio de 10.000 códigos, se rechaza el intercambio antes de sumar o cambiar jugadores; ese límite está muy por encima de las simulaciones de 300 intercambios en 2 minutos. Solo se cancelan los intentos de los participantes que rotan y los intentos de terceros dirigidos a sus códigos invalidados. El resto permanece intacto.

Confirmación recíproca, puntaje, invalidación de intentos y rotación se guardan en la misma transacción SQLite. Mismo equipo: 1 punto total; equipos distintos: 2 para cada uno. Duración: 120 segundos. Si quedó guardada una ronda anterior con códigos de seis dígitos, reiniciá **solo este juego** desde el panel para adoptar la nueva asignación; los otros juegos se conservan.

### Colores

El servidor decodifica y normaliza la imagen con Sharp, quita metadatos, toma una muestra de 160 × 160 y evalúa el **70% central** en CIE Lab mediante distancia CIE76. Por defecto exige al menos **25% del centro** dentro de **ΔE CIE76 ≤ 32** del color pedido. Son 3.136 de las 12.544 muestras del centro (112 × 112, coordenadas 24 a 135 inclusive), equivalente al 12,25% de toda la imagen muestreada, siempre dentro del centro. El centro abarca 70% del ancho y 70% del alto: 49% del área total. El umbral y la tolerancia son iguales para todos los colores. La decisión usa la fracción sin redondear; el porcentaje que se muestra se redondea, por lo que puede indicar 25% y todavía rechazar si la fracción real es ligeramente menor. La guía visual corresponde a esa región incluso si hay franjas alrededor del video.

Configuración:

| Variable | Predeterminado | Efecto |
| --- | --- | --- |
| `COLOR_DELTA_E` | `32` | Mayor valor acepta tonos más diferentes. Rango: mayor que 0 y hasta 100. |
| `COLOR_MIN_COVERAGE` | `0.25` | Fracción mínima del centro que debe coincidir. Rango: 0.10–1. |

Una foto rechazada conserva el color. Cada jugador tiene tres saltos persistidos. Cada desafío lleva un identificador; después de aprobarlo, cualquier envío con ese identificador queda invalidado. Un hash de los píxeles normalizados impide puntuar dos veces la misma captura en esa ronda, incluso entre jugadores. Es detección de repetición exacta normalizada, no un detector de fraude visual: una captura modificada sustancialmente puede tener otro hash. La tolerancia necesita ajustarse si la iluminación de la fiesta produce demasiados rechazos.

El frontend usa `getUserMedia`, permite revisar antes de enviar y ofrece un selector con `capture=environment` como alternativa. Según el navegador, ese selector puede permitir elegir una imagen existente. Hay controles claros de reintento si se niega el permiso. El cliente reduce a 1280 px; el servidor limita a 8 MB y 25 megapíxeles y acepta JPG, PNG y WebP. Las fotos HEIC dependen de que el navegador pueda decodificarlas; si no, se informa el error para usar la cámara o JPG.

### Fotos por equipo

Las cinco consignas tienen orden fijo. El servidor asigna un fotógrafo de cada equipo, priorizando miembros conectados. El administrador puede reemplazarlo. Solo el fotógrafo vigente puede entregar, una vez por equipo y consigna. Una captura válida es una imagen decodificable recibida para la consigna activa; el cumplimiento de la consigna lo decide el administrador.

El **Tiempo hasta el envío** va desde la activación en el servidor hasta la recepción completa del cuerpo de la foto. Incluye subida y red; no intenta estimar cuándo se apretó el obturador. Tras decodificar se revalida que la consigna siga abierta, el fotógrafo no haya cambiado y no exista otra entrega.

Cada consigna cerrada guarda un ganador o ninguno. Los totales se recalculan desde las adjudicaciones, de modo que corregir el ganador mueve el punto. Las entregas solo son accesibles para el administrador dueño de la sala. La referencia se muestra a los invitados desde el lanzamiento de la tercera consigna.

### Sincronización y concurrencia

- El estado público llega por SSE, con reconexión automática y lectura inicial por HTTP. Los celulares sincronizan su reloj con `serverNow` y `endsAt`; el servidor decide si una acción llegó a tiempo.
- El vencimiento se revisa cada 500 ms y antes de cada acción. Los 120 segundos siguen transcurriendo si se reinicia el proceso.
- Cada cambio se confirma dentro de una transacción `BEGIN IMMEDIATE`, sin esperas asíncronas dentro de la transacción. La decodificación de fotos ocurre antes y revalida el estado vigente al guardar.
- Los identificadores de desafío, ronda y consigna bloquean reintentos atrasados. Los reinicios verifican la generación del juego y no vuelven a borrar una ronda nueva.
- Las solicitudes de escritura requieren cabecera de la app, origen permitido y sesión del rol adecuado. Hay límites de entrada, de intentos y de fotos en procesamiento. Las contraseñas no se incluyen en los estados enviados al navegador.

## Verificación

```bash
npm run check
npm test
npm run test:browser
```

`npm test` usa bases temporales y nueve sesiones independientes; no modifica las salas reales. Cubre normalización, ambigüedad, distribución equilibrada, ambos puntajes de intercambio, códigos vencidos, concurrencia, privacidad, recarga, expiración, Lab, rechazo de píxeles aislados, cuarto salto, captura repetida, fotógrafos, tiempos, entrega única, referencia, adjudicación corregida, navegación, reinicios aislados y recuperación del servidor.

`test:browser` usa Chrome instalado en el sistema, un servidor temporal en `127.0.0.1:43071`, un panel y seis contextos de celular emulados. Guarda capturas en `test-results/`. Se puede cambiar el puerto con `TEST_PORT`. Para ejecutar el mismo recorrido en WebKit:

```bash
npx playwright install webkit
BROWSER_ENGINE=webkit npm run test:browser
```

El informe de los navegadores efectivamente comprobados está en [VERIFICATION.md](VERIFICATION.md). La emulación no reemplaza una prueba con cámaras físicas y la red del lugar.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `public/` | Interfaz responsive, panel, cámara, revisión y sincronización. |
| `server/game.js` | Reglas, sorteos, rondas, puntajes y vistas según rol. |
| `server/app.js` | API, autorización, SSE y transacciones. |
| `server/db.js` | Esquema SQLite y transacciones. |
| `server/auth.js` | Contraseñas y sesiones. |
| `server/images.js` | Decodificación, hash y validación Lab. |
| `scripts/create-admin.js` | Alta administrativa sin credenciales predeterminadas. |
| `test/` | Pruebas de reglas, HTTP concurrente, imágenes y navegador. |
| `compose.yaml`, `Dockerfile`, `Caddyfile` | Despliegue Node con volumen persistente y HTTPS. |
