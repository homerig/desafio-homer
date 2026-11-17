# Verificación de entrega

## Actualización del 16 de noviembre: juego de números

Resultado actual: **32 pruebas aprobadas**, comprobación de sintaxis y recorrido de los tres juegos en Chrome y WebKit con celulares emulados. Se reemplazó la reagrupación automática por rotaciones exclusivas de la dupla. El mínimo ahora es cuatro; tres se rechaza antes de iniciar. Los apartados históricos que mencionan códigos de seis dígitos o reagrupaciones de terceros describen la versión anterior.

- 300 intercambios consecutivos por cada cantidad: 4, 5, 34, 35 y 36 (1.500 en total). En cada paso se comprueban códigos únicos de cuatro dígitos, invalidación de los anteriores, cambio de solo dos jugadores, conservación de intentos independientes, ausencia de solitarios y puntaje exacto.
- Con 34, 35 y 36 conexiones SSE reales se ejecutan dos duplas simultáneas, repitiendo cada confirmación: se guardan dos intercambios, sin puntos duplicados ni cambios en terceros.
- Se verifica el caso 3+2, la llegada prioritaria a los tres, el bloqueo de repetición cuando hay alternativas y su excepción cuando no las hay.
- Se verifica que 3.135/12.544 muestras de color se rechacen aunque el porcentaje mostrado redondee a 25%; 3.136/12.544 se aprueban. No se modificó el algoritmo de colores ni el juego de fotos.


Fecha: **15 de noviembre de 2026**.

| Comprobación ejecutada | Resultado |
| --- | --- |
| `npm run check` | Sintaxis correcta en servidor y frontend. |
| `npm test` | **23 pruebas aprobadas**, sin fallos. |
| HTTP + SSE | Una sala con **9 sesiones simultáneas**, administrador separado, reintentos concurrentes y reinicio del servidor. |
| `npm run test:browser` | **Chrome**, escritorio de 1440 × 1050 y **6 contextos móviles independientes**, usando perfiles emulados iPhone 13 y Pixel 7. |
| `BROWSER_ENGINE=webkit … npm run test:browser` | **WebKit 27.2**, mismo recorrido de escritorio y 6 contextos móviles. |
| Consola y layout en ambos motores | Sin errores JavaScript; sin desbordamiento horizontal en las pantallas finales móviles. |
| Dependencias tras actualizar Sharp | Instalación auditada: **0 vulnerabilidades informadas**. |
| `DOMAIN=cumple.example.com docker compose config --quiet` | Configuración Compose válida. |

## Actualización: Desafío Homer

Se repitieron las 23 pruebas y el recorrido completo en Chrome y WebKit después de quitar el código del ingreso. El administrador abre una única fiesta automáticamente; los invitados ingresan desde la página principal con su nombre. Se comprobó que no existe el campo de código y que las pantallas de equipo, animales, colores, fotos y resultados no desbordan horizontalmente a 320, 375, 390 y 430 píxeles.

## Escenarios comprobados

- Alta de la primera cuenta: contraseña externa, hash scrypt, contraseña débil rechazada y usuario existente sin sobrescribir.
- `AZUL_7`, `Azu23`, `Juani-10`, `Juano99` y otros alias normalizados; `Azulina` y `Juanito` excluidos. Confirmación cuando hay múltiples candidatos. Sorteo con una sola persona restringida presente.
- 480 sorteos de tamaños de 3 a 50 participantes: equipos equilibrados y personas restringidas separadas.
- 600 secuencias de intercambio, incluyendo desconexiones y grupos de dos y tres: códigos únicos y ningún animal con un único portador conectado cuando hay al menos dos conectados.
- Intercambio del mismo equipo: 1 punto total. Entre equipos: 2 puntos para cada uno. Códigos anteriores y solicitudes repetidas no duplican el puntaje.
- Formularios preservados al recibir actualizaciones en vivo. Recarga con la misma identidad, equipo y fecha de finalización de ronda.
- Vencimiento a los 120 segundos del reloj del servidor: intentos pendientes cerrados y acciones fuera de tiempo rechazadas.
- Fotos sintéticas correctas y de tono similar aprobadas; color incorrecto, bordes coincidentes y un píxel aislado rechazados.
- Tercer salto permitido, cuarto rechazado; contador conservado al recargar. Dos validaciones concurrentes del mismo desafío producen un solo punto. Captura aprobada no reutilizable.
- Cámara con selección de archivo, vista previa, envío y reintento; se corrigió una carrera entre `getUserMedia` y la carga de un archivo.
- Fotografías reservadas al fotógrafo vigente; una entrega por equipo/consigna. Tiempo hasta el envío registrado en servidor. Galería con Anterior/Siguiente y datos de cada entrega.
- Cambio de ganador de verde a roja retira el punto anterior y asigna uno al nuevo equipo. Repetir la adjudicación no suma de nuevo.
- Tercera consigna bloqueada hasta cargar la referencia. Invitados no pueden leer la referencia antes de lanzarla ni acceder a las entregas privadas.
- Navegación conserva los resultados, exige confirmar el cierre de una ronda activa y permite volver a juegos anteriores.
- Reinicio del juego 3 elimina entregas/referencia/puntaje propios; conserva equipos y puntajes de los juegos 1 y 2. Reintentar el reinicio con una generación anterior se rechaza.
- Invitados sin acceso a acciones administrativas. Solicitudes con origen ajeno rechazadas. Los estados individuales no contienen códigos de otras personas.
- Reinicio del proceso conserva sesiones, equipos, puntajes y saltos usados; las conexiones se restablecen por separado.

## Evidencia visual

Las capturas del recorrido automatizado están en `test-results/` (carpeta local ignorada por Git):

- `chrome-landing-desktop.png` y `webkit-landing-desktop.png`.
- `chrome-admin-lobby.png` y `webkit-admin-lobby.png`.
- `chrome-iphone-team.png`, `chrome-iphone-animal.png`, `chrome-iphone-color.png`.
- `chrome-photo-review.png` y `webkit-photo-review.png`.
- `chrome-iphone-results.png`, `chrome-android-results.png` y equivalentes WebKit.

## Límites de la comprobación

- **No se usaron iPhone ni Android físicos.** Los tamaños y perfiles móviles se emularon en macOS. WebKit de Playwright no equivale a ejecutar Safari en un iPhone real.
- La validación de color se probó con imágenes generadas y la carga de archivos. No se comprobó la precisión con iluminación real de la fiesta ni con cámaras físicas, ni los diálogos nativos de permiso de cada teléfono.
- No se publicó un servidor remoto. No se ejecutó una construcción Docker completa ni se emitió un certificado HTTPS real; sí se validó la configuración Compose.
- No se realizó una prueba de carga del límite de 150 jugadores ni de redes móviles con pérdida de señal prolongada.
- Para la prueba de WebKit en esta máquina se descargaron sus binarios a `/private/tmp/cumple-playwright` y se ejecutó:

  ```bash
  BROWSER_ENGINE=webkit PLAYWRIGHT_BROWSERS_PATH=/private/tmp/cumple-playwright npm run test:browser
  ```

Antes del cumpleaños, abrí la URL HTTPS definitiva en al menos un iPhone y un Android, habilitá la cámara y hacé una ronda breve con la luz y la red del lugar.

## Reinicio general

Se agregó una prueba HTTP que comprueba autorización, confirmación obligatoria, limpieza de participantes/equipos/juegos/fotos, conservación de la cuenta administrativa y rechazo de reintentos atrasados. Total actual: 24 pruebas aprobadas. El recorrido de navegador también comprueba que los invitados conectados regresan al formulario y pueden volver a inscribirse.
