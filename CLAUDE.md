# CLAUDE.md

Guía para Claude Code en este repositorio: **Malackathon 2026 — Betsson "Intelligent Game Validation"**.

## Objetivo

Prueba de concepto que navega el casino de Betsson, lanza un juego en **Real Play** y valida dos escenarios **a partir de lo que el jugador ve en pantalla**. El juego va en iframe/canvas, así que no hay DOM del juego que inspeccionar. Un clic en "Spin" NO es prueba de nada: hay que verificar la reacción visible del juego.

El reto pide Pragmatic Play, pero **se valora mucho que la solución escale a otros proveedores**. Ninguna lógica de los escenarios puede depender del proveedor.

Plazo: build window el 15/10/2026 10:15–20:00. Finalistas presentan 7 min el 16/10.

## Mercado: solo betsson.es

| Mercado | URL | Idioma | Moneda |
| --- | --- | --- | --- |
| `es` | https://www.betsson.es | Español | EUR |

- **No se trabaja en betsson.com.** Además, desde una IP española redirige a .es.
- La abstracción de mercado (`src/config/markets.ts`) se mantiene para no acoplar el código a .es.
- **Regulación DGOJ:** es probable que antes de jugar a slots aparezcan límites de sesión o avisos de juego responsable. Se modelan como pasos explícitos (`shell.prompts`).
- **Sin sesión no hay modo demo.** La página del juego muestra "Para jugar a este juego debes iniciar sesión". Calibrar exige credenciales.
- **Geolocalización:** los runners de GitHub Actions están en EE. UU. y puede que .es los bloquee. Comprobarlo pronto; la alternativa es un runner self-hosted con IP española. No intentar evadir controles de acceso.
- **Importes:** `src/utils/money.ts` deduce el separador decimal del propio texto (la cifra que termina en `[.,]\d{2}`), porque el shell escribe `1.234,56 €` y el juego puede escribir `€1,234.56`. Siempre en céntimos (enteros).

## Arquitectura: mercado × proveedor × juego

| Capa | Archivo | Contiene |
| --- | --- | --- |
| Mercado | `src/config/markets.ts` | URL, idioma, moneda, selectores del shell de Betsson (login, saldo, avisos) |
| Proveedor | `src/providers/<proveedor>.ts` | Etiquetas del HUD y mensaje de saldo insuficiente **por idioma**, y perfil visual por defecto: tecla de spin, posición del botón, regiones, umbrales |
| Juego | `src/games/catalog.ts` | id, nombre, proveedor, ruta por mercado y solo lo que el título haga distinto de su proveedor |

- `resolveGame()` combina proveedor y juego. Los escenarios reciben un `ResolvedGame` y no saben de qué proveedor es.
- Playwright genera un proyecto por mercado y juego (`es-sweet-bonanza`, `es-starburst`). Añadir un juego al catálogo crea su proyecto automáticamente; para CI hay que añadirlo también a la matriz del workflow.
- **Añadir un proveedor:** crear `src/providers/x.ts`, añadir un juego en `catalog.ts`, calibrar con `npm run calibrate`. Sin tocar escenarios.

Juegos actuales: **Sweet Bonanza** (Pragmatic Play) y **Starburst** (NetEnt).

### Cómo se ve el juego (sin DOM)
- **Iframe del juego:** el iframe visible más grande de la página. Hay otros, como el antifraude de group-ib.
- **Saldo, apuesta y premio:** OCR (tesseract.js) sobre la región `hud`, o el frame entero si no hay región. Se busca la etiqueta del idioma y se lee el importe que la sigue, en la misma línea o en la de debajo.
- **Spin:** se prueban los disparadores en orden (`spinKey` tras clicar en `focusPoint`, luego `spinButton`). Se da por empezado cuando cambia más de `spinStartDiff` de los píxeles de los rodillos.
- **Spin terminado:** los rodillos quietos (cambio < `stableDiff`) durante `stableForMs`.
- Las esperas son condiciones visuales con timeout, nunca `sleep` como prueba de que algo ocurrió.
- **Pendiente si hay API key:** un modelo de visión como respaldo para localizar controles y leer el HUD en proveedores sin perfil calibrado.

## Escenarios

### Escenario 1 — Spin completado en Real Play (cuenta `funded`)
Checks: moneda del mercado · crédito del juego = saldo Betsson · spin empezó · spin terminó · apuesta mostrada = apuesta usada · saldo del juego coherente · saldo Betsson: `después = antes − apuesta + premio`.

### Escenario 2 — Saldo insuficiente (cuenta `empty`)
Checks: moneda del mercado · se muestra el mensaje de saldo insuficiente · el mensaje está en el idioma esperado (no coincide con los patrones de otros idiomas) · spin rechazado · saldo del juego sin cambios · saldo Betsson sin cambios.

## Estructura

```
src/config/markets.ts      # mercado (.es)
src/config/credentials.ts  # BETSSON_ES_<FUNDED|EMPTY>_<USER|PASS> desde env; ruta de la sesión guardada
src/providers/             # types.ts, pragmatic.ts, netent.ts
src/games/catalog.ts       # catálogo de juegos + resolveGame()
src/pages/BetssonShell.ts  # lobby, login, saldo Betsson, abrir juego, localizar iframe
src/pages/GameFrame.ts     # juego en canvas: capturas, OCR del HUD, spin y detección de movimiento
src/vision/                # ocr.ts (tesseract.js), image.ts (recorte + pixelmatch)
src/report/                # Checks (soft checks con evidencia) y ChecksReporter (report/checks.md + job summary)
tests/auth.setup.ts        # login por cuenta, SIN trace/vídeo; se salta las cuentas sin credenciales
tests/scenario1-*.spec.ts, tests/scenario2-*.spec.ts
tests/calibrate.spec.ts    # capturas + texto OCR de cada región para ajustar perfiles
tests/unit/                # tests puros (parser de importes)
```

## Comandos

```bash
npm run test:unit                                  # tests unitarios, sin red
npm run test:sweet-bonanza                         # ambos escenarios con Sweet Bonanza
npm run test:starburst                             # ambos escenarios con Starburst
npm test                                           # todos los juegos
npm run calibrate -- --project=es-sweet-bonanza    # navegador visible + capturas/OCR por región
npm run report                                     # informe HTML (report/html)
npm run typecheck
```

`HEADED=1` para ver el navegador. El resumen pass/fail queda en `report/checks.md`. El escenario cuya cuenta no tenga credenciales en `.env` se marca como skipped.

## Estado de calibración

- **Verificado en el sitio real:** cookies, formulario de login (`input[name=email|password]`), rutas de Sweet Bonanza y Starburst, y que el juego se carga en la propia página del juego.
- **Sin verificar** (necesita sesión): selector de saldo, marcador de sesión iniciada, botón de dinero real, diálogos DGOJ, y todos los perfiles visuales de proveedor.

Las suposiciones pendientes están marcadas con `TODO(calibrate)`.

## Seguridad — no negociable

- **Ninguna credencial ni secreto en el repo, informes, capturas, vídeos ni presentación.** Credenciales solo vía `.env` (gitignored) o GitHub Secrets. `.env.example` sin valores.
- El login va en un proyecto aparte sin trace, vídeo ni capturas, porque el trace de Playwright registraría la contraseña tecleada.
- `.auth/` (sesiones guardadas) nunca se sube como artefacto.
- Las capturas de página completa enmascaran `market.shell.sensitive`.
- Una API key de visión/IA, si se usa, también va como secret.

## Entregables

1. **Repo GitHub**: código organizado, config por mercado y proveedor, sin secretos.
2. **Workflow** (`.github/workflows/game-validation.yml`): matriz por proyecto `<mercado>-<juego>`, publica los informes en GitHub Pages.
3. **Informe y evidencias**: pass/fail por check, por escenario, mercado y juego, con capturas, trace y vídeo.
4. **Presentación** (finalistas): 7 min, demo funcionando + decisiones técnicas. Enseñar dos proveedores con el mismo código.

## Criterios de evaluación (peso)

Escenarios funcionan 30 · "Ve como un jugador" 20 · Código y arquitectura 15 · Informe y evidencias 15 · Workflow GitHub 10 · Demo 10 · Bonus hasta +10.

Prioridad: primero que los dos escenarios pasen con Sweet Bonanza y con evidencia; después, el segundo proveedor.

## Convenciones

- Un check fallido no aborta el escenario si se puede seguir recogiendo evidencia; el informe muestra todos los checks.
- Las evidencias se adjuntan con nombre descriptivo; las de checks llevan prefijo `PASS`/`FAIL`.
- Documentación en español; identificadores y comentarios de código en inglés.
