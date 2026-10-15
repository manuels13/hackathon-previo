# CLAUDE.md

Guía para Claude Code en este repositorio: **Malackathon 2026 — Betsson "Intelligent Game Validation"**.

## Objetivo

Prueba de concepto que entra en betsson.es, abre un juego en **Real Play** y valida los escenarios del reto **a partir de lo que el jugador ve**. El juego va en iframe/canvas, sin DOM utilizable: un clic en "Spin" no prueba nada, hay que verificar la reacción visible.

Se valora mucho que **escale a otros proveedores** además de Pragmatic Play: los escenarios no dependen del proveedor.

## Enfoque actual

1. **Login a mano en Chrome con CDP.** Betsson bloquea los logins hechos desde ventanas automatizadas. La persona abre Chrome con `--remote-debugging-port=9222` y un perfil propio (`chrome-betsson`), inicia sesión y los tests se conectan con `CDP_URL`: abren y cierran solo sus pestañas. La sesión de Betsson dura unos 19 minutos y se renueva con el uso.
2. **Shell de Betsson por DOM** (`BetssonShell`): lobby, saldo de la cabecera y diálogos regulatorios previos al juego (aviso de "sesión hace menos de 60 min" y límites DGOJ), resueltos en cualquier orden.
3. **Juego por visión**:
   - **VLM** (Gemini, API compatible con OpenAI): en el escenario 1, **1 sola llamada por spin**, con la captura previa. Lee saldo, moneda, apuesta y posición del botón de spin. Después del spin no se analiza ninguna captura. En el escenario 2 hay una segunda llamada con la respuesta del juego (mensaje, idioma, saldo), porque el reto pide validar el mensaje que ve el jugador.
   - **jimp** marca el botón con un anillo rojo como evidencia antes del clic.
   - **Comparación de píxeles local** (gratis): detecta si el juego ha cargado (pasa a tener color), si los rodillos se mueven y si la pantalla se ha quedado quieta.
4. **El resultado del spin se verifica con las peticiones HTTP**, contrastadas con lo que leyó el VLM antes del spin:
   - **Tráfico del servidor del proveedor** (`RoundRecorder` y el analizador del proveedor): sesión del juego (`SingleSessionAPI/data`: moneda, idioma, jurisdicción), apuesta (`c×l`), premio (`tw`), saldos y cierre de la ronda. Marca exactamente el fin del spin.
   - **Respuestas que la propia web de Betsson carga en el lobby**: `/api/v2/wallet/balance` y el tiempo de sesión restante. Solo se leen, sin peticiones propias ni tokens.

5. **Cambio de cuenta en el Chrome de la persona.** El escenario 2 necesita la cuenta sin saldo: el propio test cierra sesión y entra con ella, así que también funciona lanzado suelto. Las credenciales no llegan al trace: se escriben por una conexión DevTools aparte (`src/utils/secretInput.ts`, `Input.insertText`), porque todo lo que pasa por la API de Playwright queda en `test.trace`, y el trace del navegador se pausa durante el login. Está comprobado que ni el usuario ni la contraseña aparecen en el trace.zip. `auth.setup.ts` vuelve a la cuenta con saldo en la siguiente ejecución. La cuenta conectada se identifica comparando en memoria `loginInformation.username` de `/api/v2/es/currentcustomer` con el usuario del `.env`; no se guarda nada. Al cerrar sesión, Betsson muestra el resumen DGOJ "Sesión finaliza", que se cierra con "Cerrar".

### Escenario 2 (verificado: 12/12)
- Sin saldo, el formulario DGOJ de límites de sesión **no tiene límite de pérdidas** (no aparecen los botones de %). Muestra "No dispones de saldo, pero puedes crear la sesión…" y la sesión se inicia igual. Por eso el paso del 25% es opcional (`optionalSteps`).
- **Seguro:** si la cartera o la pantalla cubren la apuesta, no se hace clic, porque sería un spin pagado.
- Tras el clic se muestrea la pantalla durante 6 s y se guarda el fotograma que más cambia: es el mensaje del juego.
- Sweet Bonanza rechaza el spin en el propio cliente: no se envía ningún `doSpin`. Muestra "Fondos insuficientes para realizar esta apuesta. Haga un depósito en su cuenta o reduzca el nivel de la apuesta." con el botón ACEPTAR. Si el servidor rechazara (`nomoney=1`), el analizador lo marca como `rejected`.

### Prueba negativa (inyección de fallo)
`tests/fault-injection.spec.ts` manipula con `page.route` las respuestas del servidor del juego (`src/network/faultInjection.ts`) para que el juego muestre 5,00 € más que la cartera de Betsson.
- La comprobación "Game credit on screen matches Betsson balance" lo detecta leyendo la pantalla con el VLM.
- `test.fail()` marca ese fallo como esperado: la suite sigue en verde y el error "Failed checks: …" aparece en el trace y en el informe.
- No hace spin. Verificado: pantalla 102,35 frente a cartera 97,35, diferencia 5,00.

**OCR descartado**: se eliminó tesseract y la calibración de zonas del HUD.

## Arquitectura: mercado × proveedor × juego

| Capa | Archivo | Contiene |
| --- | --- | --- |
| Mercado | `src/config/markets.ts` | URL, idioma, moneda, selectores del shell, diálogos de entrada al juego |
| Proveedor | `src/providers/<proveedor>.ts` | Clic de la intro, zona de rodillos y umbrales, mensaje de saldo insuficiente por idioma y analizador de tráfico (opcional) |
| Juego | `src/games/catalog.ts` | id, nombre, proveedor, ruta por mercado y diferencias respecto a su proveedor |

**Añadir un proveedor**: crear `src/providers/x.ts`, añadir el juego al catálogo y (opcional) escribir su `TrafficParser`. Sin analizador, la ronda se juzga solo por pantalla y cartera.

Juegos: **Sweet Bonanza** es el juego por defecto (catálogo). **Cualquier otro juego se busca en Betsson por su nombre**, sin configurarlo: `npm run scenario1 -- "gates of olympus"` (`scripts/run.js` lo pasa como `GAME`).
- `BetssonShell.findGame` abre el buscador de juegos del lobby, que carga el catálogo completo (`/api/v2/games?countryCode=ES`, unos 2200 juegos con nombre, `slug` y proveedor).
- `pickGame` (`src/games/discover.ts`) elige el juego por nombre, slug o id. Falla con un mensaje claro si el nombre es ambiguo, no existe o el proveedor no está soportado.
- La ruta del juego sale del enlace del resultado de la búsqueda.
- Los proveedores soportados se registran por su id de Betsson en `src/providers/index.ts`.
- Cada juego es distinto, así que el VLM resuelve lo que antes estaba calibrado para Sweet Bonanza:
  - **Pantalla de presentación:** si la ve, devuelve dónde está el botón de continuar y el test lo pulsa (1 llamada más).
  - **Apuesta por defecto alta:** si supera `MAX_WAGER` (1,00 € por defecto), el test pulsa "−" hasta el mínimo y vuelve a leer (1 llamada más). Si sigue por encima, no hace el spin.
- Verificado con 12/12 en Gates of Olympus (también con un spin con premio y cascada) y en Big Bass Splash (bajando la apuesta a 0,10 €).

### Tráfico de Pragmatic (verificado en una ronda real)
`POST /gs2c/ge/v3/gameService`, formularios url-encoded:
- `doSpin`: la petición lleva `c` (moneda) y `l` (líneas). Apuesta = `c×l`, ×1,25 si `bl=1` (ante).
- Respuestas: `balance`, `tw` (premio acumulado) y `na` (siguiente acción).
- **Ronda cerrada = `na=s` y sin `rs`.** La primera respuesta de una cascada ya trae `na=s`, pero con `rs` pendiente: `rs=t` en Sweet Bonanza, `rs=mc` en Gates of Olympus. Con premio, la ronda termina en `doCollect`.

## Estructura

```
src/config/      markets.ts (mercado .es), credentials.ts (env, sesiones, cabeceras extra solo a hosts de Betsson)
src/providers/   types.ts, pragmatic.ts (+ analizador de tráfico)
src/games/       catalog.ts + resolveGame()
src/pages/       BetssonShell.ts (DOM de Betsson), GameFrame.ts (iframe: captura, clic, entrar al juego)
src/flows/       vlmSpin.ts: spin guiado por VLM (1 llamada) y seguido por HTTP; vlmSpinAttempt.ts: intento sin saldo (2 llamadas)
src/network/     RoundRecorder.ts: rondas tal como las liquida el servidor del proveedor
src/vision/      vlm.ts (cliente VLM con reintentos y modelos de reserva), annotate.ts (anillo), image.ts (recorte, diff, color)
src/report/      Checks (comprobaciones con evidencia), ChecksReporter (report/checks.md + job summary)
src/utils/       money.ts (parseCents), secretInput.ts (escribe credenciales fuera del trace)
tests/           auth.setup.ts, enter-game.spec.ts, scenario1-completed-spin.spec.ts, fault-injection.spec.ts,
                 scenario2-insufficient-balance.spec.ts, fixtures.ts, unit/
```

## Comandos

```bash
npm run test:unit   # tests unitarios: importes, anillo, analizador de tráfico con una ronda real grabada
npm run game        # entra en Sweet Bonanza y deja la pestaña abierta en el juego (sin spins)
npm run scenario1   # escenario 1 completo con Sweet Bonanza (spin real con la apuesta configurada en el juego)
npm run scenario1 -- "gates of olympus"   # cualquier juego de Pragmatic, buscado en Betsson por su nombre
npm run scenario2   # escenario 2: cambia a la cuenta sin saldo e intenta un spin (no gasta dinero)
npm run fault       # prueba negativa: inyecta un saldo falso (+5 €) en el juego y debe detectarlo (sin spin, no gasta)
npm run report      # informe HTML
npm run typecheck
```

Requisitos: Chrome abierto con el puerto 9222 y la sesión iniciada; en `.env`: `CDP_URL`, `BETSSON_ES_FUNDED_USER/PASS`, `BETSSON_ES_EMPTY_USER/PASS`, `BETSSON_ES_EXTRA_HEADERS`, `VLM_BASE_URL`, `VLM_API_KEY` y `VLM_MODEL`.

## Pendiente

- **CI**: GitHub Actions no puede usar el Chrome de una persona. Opciones: un runner self-hosted con el Chrome abierto, o login automático si las cabeceras de los mentores lo permiten (sin confirmar).
- Modelos VLM: los modelos de Gemini se saturan a ratos (503) o se retiran (404). El cliente cambia al siguiente modelo de `VLM_MODEL`.

## Seguridad — no negociable

- **Ningún secreto en el repo, informes, capturas, vídeos ni presentación.** Todo en `.env` (ignorado) o en GitHub Secrets.
- **Las cabeceras de los mentores** solo se envían a hosts de Betsson: si se envían a Pragmatic, rompen su CORS y el juego no carga. Nunca deben ir al repo.
- **El trace** no se genera en CI, porque guarda cabeceras y cookies de sesión. En local sí.
- **Las capturas de página** tapan `[data-cs-mask], [data-hj-suppress]` (nombre del titular). Al VLM solo se le envía la captura del juego.
- **El tráfico solo se guarda decodificado** (números). Nunca los cuerpos crudos: `currentcustomer` contiene datos personales.

## Convenciones

- Las comprobaciones no abortan el escenario; el informe muestra todas. Si una lectura del VLM falla después del spin, se siguen evaluando las comprobaciones de servidor y cartera.
- Documentación en español; código y comentarios en inglés.
