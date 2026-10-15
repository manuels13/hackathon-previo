# CLAUDE.md

Guía para Claude Code en este repositorio: **Malackathon 2026 — Betsson "Intelligent Game Validation"**.

## Objetivo

Prueba de concepto que entra en betsson.es, abre un juego en **Real Play** y valida los escenarios del reto **a partir de lo que el jugador ve**. El juego va en iframe/canvas, sin DOM utilizable: un clic en "Spin" no prueba nada, hay que verificar la reacción visible.

Se valora mucho que **escale a otros proveedores** además de Pragmatic Play: los escenarios no dependen del proveedor.

## Enfoque actual

1. **Login a mano en Chrome con CDP.** Betsson bloquea los logins hechos desde ventanas automatizadas. La persona abre Chrome con `--remote-debugging-port=9222` y un perfil propio (`chrome-betsson`), inicia sesión y los tests se conectan con `CDP_URL`: abren y cierran solo sus pestañas. La sesión de Betsson dura unos 19 minutos y se renueva con el uso.
2. **Shell de Betsson por DOM** (`BetssonShell`): lobby, saldo de la cabecera y diálogos regulatorios previos al juego (aviso de "sesión hace menos de 60 min" y límites DGOJ), resueltos en cualquier orden.
3. **Juego por visión**:
   - **VLM** (OpenRouter, API compatible con OpenAI): lee saldo, moneda, apuesta y posición del botón de spin antes del spin, y saldo y premio después. Solo **2 llamadas por spin**.
   - **jimp** marca el botón con un anillo rojo como evidencia antes del clic.
   - **Comparación de píxeles local** (gratis): detecta si el juego ha cargado (pasa a tener color), si los rodillos se mueven y si la pantalla se ha quedado quieta.
4. **Testigos independientes** que contrastan lo que lee el VLM:
   - **Tráfico del servidor del proveedor** (`RoundRecorder` y el analizador del proveedor): apuesta (`c×l`), premio (`tw`), saldos y cierre de la ronda. Marca exactamente el fin del spin, así que no hacen falta capturas de sondeo.
   - **Respuestas que la propia web de Betsson carga en el lobby**: `/api/v2/wallet/balance` y el tiempo de sesión restante. Solo se leen, sin peticiones propias ni tokens.

**OCR descartado**: se eliminó tesseract y la calibración de zonas del HUD.

## Arquitectura: mercado × proveedor × juego

| Capa | Archivo | Contiene |
| --- | --- | --- |
| Mercado | `src/config/markets.ts` | URL, idioma, moneda, selectores del shell, diálogos de entrada al juego |
| Proveedor | `src/providers/<proveedor>.ts` | Clic de la intro, zona de rodillos y umbrales, mensaje de saldo insuficiente por idioma y analizador de tráfico (opcional) |
| Juego | `src/games/catalog.ts` | id, nombre, proveedor, ruta por mercado y diferencias respecto a su proveedor |

**Añadir un proveedor**: crear `src/providers/x.ts`, añadir el juego al catálogo y (opcional) escribir su `TrafficParser`. Sin analizador, la ronda se juzga solo por pantalla y cartera.

Juegos: **Sweet Bonanza** (Pragmatic, verificado) y **Starburst** (NetEnt, sin calibrar ni probar).

### Tráfico de Pragmatic (verificado en una ronda real)
`POST /gs2c/ge/v3/gameService`, formularios url-encoded:
- `doSpin`: la petición lleva `c` (moneda) y `l` (líneas). Apuesta = `c×l`, ×1,25 si `bl=1` (ante).
- Respuestas: `balance`, `tw` (premio acumulado) y `na` (siguiente acción).
- **Ronda cerrada = `na=s` y sin `rs=t`.** La primera respuesta de una cascada ya trae `na=s`, pero con `rs=t` (cascada pendiente).

## Estructura

```
src/config/      markets.ts (mercado .es), credentials.ts (env, sesiones, cabeceras extra solo a hosts de Betsson)
src/providers/   types.ts, pragmatic.ts (+ analizador de tráfico), netent.ts
src/games/       catalog.ts + resolveGame()
src/pages/       BetssonShell.ts (DOM de Betsson), GameFrame.ts (iframe: captura, clic, entrar al juego)
src/flows/       vlmSpin.ts: los 5 pasos del spin guiado por VLM
src/network/     RoundRecorder.ts: rondas tal como las liquida el servidor del proveedor
src/vision/      vlm.ts (cliente VLM con reintentos y modelos de reserva), annotate.ts (anillo), image.ts (recorte, diff, color)
src/report/      Checks (comprobaciones con evidencia), ChecksReporter (report/checks.md + job summary)
src/utils/       money.ts (parseCents)
tests/           auth.setup.ts, enter-game.spec.ts, scenario1-completed-spin.spec.ts, fixtures.ts, unit/
```

## Comandos

```bash
npm run test:unit   # tests unitarios: importes, anillo, analizador de tráfico con una ronda real grabada
npm run game        # entra en Sweet Bonanza y deja la pestaña abierta en el juego (sin spins)
npm run scenario1   # escenario 1 completo con Sweet Bonanza (spin real con la apuesta configurada en el juego)
npm run report      # informe HTML
npm run typecheck
```

Requisitos: Chrome abierto con el puerto 9222 y la sesión iniciada; en `.env`: `CDP_URL`, `BETSSON_ES_FUNDED_USER/PASS`, `BETSSON_ES_EXTRA_HEADERS`, `VLM_BASE_URL`, `VLM_API_KEY` y `VLM_MODEL`.

## Pendiente

- **Escenario 2 (saldo insuficiente)**: hay que rehacerlo con el VLM (mensaje e idioma) y la red (spin rechazado). Necesita la cuenta sin saldo.
- **CI**: GitHub Actions no puede usar el Chrome de una persona. Opciones: un runner self-hosted con el Chrome abierto, o login automático si las cabeceras de los mentores lo permiten (sin confirmar).
- Calibrar Starburst (NetEnt).
- Modelos VLM gratis: OpenRouter tiene 50 peticiones al día y los proveedores se saturan a ratos (429 o respuestas vacías). El cliente reintenta y cambia de modelo.

## Seguridad — no negociable

- **Ningún secreto en el repo, informes, capturas, vídeos ni presentación.** Todo en `.env` (ignorado) o en GitHub Secrets.
- **Las cabeceras de los mentores** solo se envían a hosts de Betsson: si se envían a Pragmatic, rompen su CORS y el juego no carga. Nunca deben ir al repo.
- **El trace** no se genera en CI, porque guarda cabeceras y cookies de sesión. En local sí.
- **Las capturas de página** tapan `[data-cs-mask], [data-hj-suppress]` (nombre del titular). Al VLM solo se le envía la captura del juego.
- **El tráfico solo se guarda decodificado** (números). Nunca los cuerpos crudos: `currentcustomer` contiene datos personales.

## Convenciones

- Las comprobaciones no abortan el escenario; el informe muestra todas. Si una lectura del VLM falla después del spin, se siguen evaluando las comprobaciones de servidor y cartera.
- Documentación en español; código y comentarios en inglés.
