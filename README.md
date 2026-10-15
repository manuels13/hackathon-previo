# Intelligent Game Validation — Betsson · Malackathon 2026

Prueba de concepto que entra en **betsson.es**, abre un juego de **Pragmatic Play** en **Real Play** y valida los dos escenarios del reto **a partir de lo que ve el jugador**:

1. **Spin completado:** el saldo cumple `después = antes − apuesta + premio`, tanto en el juego como en la cartera de Betsson.
2. **Saldo insuficiente:** el spin se rechaza, aparece el mensaje correcto en el idioma del mercado y ningún saldo cambia.

El juego es un canvas dentro de un iframe, sin DOM utilizable: pulsar "Spin" no prueba nada por sí mismo. Por eso la solución combina dos fuentes de verdad independientes.

---

## La idea clave: VLM + análisis de tráfico

La solución **mezcla visión artificial (VLM) con análisis del tráfico HTTP**. Cada fuente cubre lo que la otra no puede ver, y cada comprobación importante se confirma con las dos.

| | VLM (lo que ve el jugador) | Tráfico HTTP (lo que pasa de verdad) |
| --- | --- | --- |
| **Qué aporta** | Saldo, moneda y apuesta tal como se muestran, posición del botón de spin, mensajes al jugador y su idioma | Apuesta cobrada, premio, saldos del servidor, cierre exacto de la ronda, moneda e idioma de la sesión de juego, cartera de Betsson |
| **Por qué hace falta** | El reto exige validar lo que el jugador ve; el canvas no tiene DOM | La pantalla puede estar en animación, tapada o mal leída; el servidor da números exactos y el momento exacto en que acaba el spin |
| **Coste** | De pago (tokens): se usa lo mínimo | Gratis: se escucha el tráfico que el propio juego y la web ya generan |

### Cómo se reparten el trabajo en un spin

1. **Antes del spin, VLM (1 llamada).** Una captura del juego. El VLM devuelve saldo, moneda, apuesta y la posición del botón de spin (coordenadas normalizadas 0..1000). El botón se marca con un anillo rojo como evidencia y se pulsa ese punto exacto.
2. **Durante el spin, comparación de píxeles local (gratis).** Confirma que los rodillos se mueven, sin gastar tokens.
3. **Después del spin, tráfico HTTP (0 llamadas al VLM).** El final del spin y su resultado no se leen de la pantalla, sino de las peticiones:
   - **Servidor del proveedor** (`/gs2c/ge/v3/gameService` y `/gs2c/SingleSessionAPI/data`): apuesta (`c × l`), premio (`tw`), saldo tras cada llamada y cierre de la ronda (`na=s` sin cascada pendiente `rs`).
   - **Web de Betsson**: la cartera (`/api/v2/wallet/balance`) y el tiempo de sesión que carga el propio lobby. Solo se leen; no se hacen peticiones propias ni se tocan tokens.
4. **Contraste cruzado.** Lo que leyó el VLM se compara con el servidor del juego y con la cartera de Betsson. Si una fuente miente o se equivoca, las otras lo delatan.

Resultado: **un spin completo cuesta 1 llamada al VLM.** Antes se analizaban capturas después del spin; ahora el tráfico HTTP las sustituye y además es más preciso.

### Cuándo se gastan llamadas extra al VLM

- **Escenario 2:** 1 llamada más para leer el mensaje que muestra el juego tras el intento (texto, idioma, saldo), porque el reto pide validar ese mensaje tal como lo ve el jugador.
- **Juegos nuevos:** si el VLM ve una pantalla de presentación, indica dónde está el botón de continuar; si la apuesta por defecto supera el tope, el test la baja con el botón "−" del juego y vuelve a leer la pantalla.

---

## Resultados (informe de Playwright)

Datos tomados de `report/checks.md`, el informe que genera la propia suite tras cada ejecución contra betsson.es.

### Escenario 1 — spin completado (Sweet Bonanza): 12/12

| Comprobación | Resultado | Detalle |
| --- | --- | --- |
| Sesión de Betsson activa | PASS | 1138 s de sesión restantes; cartera cargada |
| Saldo de la cabecera = cartera | PASS | cabecera "97,25 €", API de cartera 97.25 EUR |
| Juego cargado | PASS | 2713 ms |
| Sesión del juego en la moneda e idioma del mercado (HTTP) | PASS | servidor: EUR, `es`, jurisdicción ES |
| Moneda en pantalla (VLM) | PASS | pantalla "€", cartera EUR |
| Crédito en pantalla = cartera = servidor | PASS | pantalla 97.25, cartera 97.25, servidor 97.25 |
| Spin iniciado | PASS | rodillos en movimiento (píxeles) y petición de spin enviada (HTTP) |
| Spin completado | PASS | el servidor cerró la ronda |
| Apuesta mostrada = apuesta cobrada | PASS | pantalla 0.20, petición de spin 0.20 |
| Saldo del juego coherente | PASS | 97.25 − 0.20 + 0.00 = 97.05; servidor 97.05 |
| Saldo de Betsson coherente | PASS | 97.25 − 0.20 + 0.00 = 97.05; cartera 97.05, cabecera "97,05 €" |
| Cartera de Betsson = saldo del servidor | PASS | 97.05 = 97.05 |

### Escenario 2 — saldo insuficiente (Sweet Bonanza): 12/12

| Comprobación | Resultado | Detalle |
| --- | --- | --- |
| Sesión activa con la cuenta sin saldo | PASS | cuenta identificada como la vacía; 1194 s restantes |
| Saldo de la cabecera = cartera | PASS | "0,00 €" = 0.00 EUR |
| Diálogos de Betsson antes del juego | PASS | resueltos |
| Juego cargado | PASS | 3651 ms |
| Sesión del juego en la moneda e idioma del mercado (HTTP) | PASS | EUR, `es`, jurisdicción ES |
| Crédito en pantalla = cartera = servidor | PASS | 0.00 = 0.00 = 0.00 |
| Saldo menor que la apuesta | PASS | 0.00 frente a 2.00 |
| Spin rechazado, no cobrado | PASS | pantalla: no hubo spin (VLM); servidor: 0 peticiones de spin, 0 cobradas (HTTP) |
| Mensaje de saldo insuficiente en el idioma esperado | PASS | "Fondos insuficientes para realizar esta apuesta. Haga un depósito en su cuenta o reduzca el nivel de la apuesta." — idioma `es` |
| Moneda del mercado | PASS | "€" antes y después; cartera EUR |
| El saldo del juego no cambia | PASS | 0.00 → 0.00 (pantalla y servidor) |
| El saldo de Betsson no cambia | PASS | 0.00 → 0.00, cabecera "0,00 €" |

### Escenario 1 en otros juegos, buscados en Betsson por su nombre

| Juego | Apuesta | Resultado del spin | Cartera de Betsson | Comprobaciones |
| --- | --- | --- | --- | --- |
| Gates of Olympus | 0.20 € | sin premio | 97.83 → 97.63 | 12/12 |
| Big Bass Splash | bajada automáticamente a 0.10 € | premio de 0.02 € | 97.63 → 97.55 | 12/12 |

### Prueba negativa: la aplicación detecta un fallo

`tests/fault-injection.spec.ts` demuestra que la validación no aprueba siempre. Manipula por el camino las respuestas del servidor del juego para que el jugador vea **5,00 € más** de lo que hay en la cartera. No hace ningún spin, así que no gasta dinero.

| Comprobación | Resultado | Detalle |
| --- | --- | --- |
| El crédito en pantalla coincide con Betsson | **FAIL (esperado)** | pantalla 102.35, cartera 97.35, diferencia 5.00 |

En el trace aparece el paso `Inject the fault: game-server balances + 5.00 €`, las respuestas alteradas ("Fulfill request") y el error:

```
Error: Failed checks:
- Game credit on screen matches Betsson balance: screen 102.35, Betsson wallet 97.35,
  game server (as the game received it) 102.35; difference 5.00
```

El test usa `test.fail()`: el fallo es el resultado esperado, así que la suite queda en verde mientras el informe y el trace muestran el error igual que lo haría un defecto real.

### Carpeta `report`: informe y trazas de Playwright

La carpeta **`report/`** contiene el informe de la última ejecución completa de la suite contra betsson.es, con las **trazas de Playwright** de cada test:

| Ruta | Contenido |
| --- | --- |
| `report/checks.md` | Tabla de comprobaciones por escenario y juego, con el detalle de cada PASS/FAIL |
| `report/checks.json` | Lo mismo en JSON, para procesarlo |
| `report/html/index.html` | Informe HTML de Playwright: tests, pasos, errores y capturas adjuntas a cada comprobación |
| `report/html/data/*.zip` | **Trazas de Playwright** de cada test (escenario 1, escenario 2, entrada al juego y prueba de fallo) |
| `report/html/data/*.png` | Capturas de evidencia (saldo de la cabecera, pantalla del juego antes y después, botón marcado) |

Para abrir el informe y navegar por las trazas:

```powershell
npm run report                                            # abre el informe en http://localhost:9323
npx playwright show-trace report/html/data/<archivo>.zip  # abre una traza concreta
```

Cada traza muestra el test paso a paso: acciones, capturas del DOM en cada paso, peticiones de red (incluidas las del servidor del juego que usa el análisis de tráfico) y el error cuando lo hay. Por ejemplo, la traza de la prueba de fallo muestra las respuestas alteradas y el error `Failed checks`.

Se han quitado de las trazas los fotogramas del screencast (la tira de imágenes de la línea de tiempo), que ocupaban unos 170 MB por traza. El resto de la información está completa.

### Evidencias que deja cada ejecución

- **`report/checks.md` y `report/checks.json`:** tabla de comprobaciones por escenario, juego y proveedor. También se publica en el resumen del job de GitHub Actions.
- **`report/html`:** informe HTML de Playwright (`npm run report`), con las capturas adjuntas a cada comprobación.
- **`test-results/<test>/vlm/`:** capturas numeradas del flujo:
  - pantalla antes del spin;
  - botón de spin marcado con un anillo rojo;
  - botón de continuar o de "−", cuando se usan;
  - pantalla después del spin o con el mensaje.
- **`trace.zip`:** paso a paso del test (`npx playwright show-trace <ruta>`). Solo en local.
- **Llamadas del servidor decodificadas:** solo números (apuesta, premio, saldos, estado de la ronda).

---

## Funcionamiento de la aplicación

### Flujo de un escenario

1. **Conexión al Chrome de la persona (CDP).** Betsson bloquea los logins desde ventanas abiertas por automatización. Los tests se conectan a un Chrome normal abierto con `--remote-debugging-port=9222` y solo abren y cierran sus propias pestañas.
2. **Sesión y cuenta correctas.** El setup comprueba que la sesión de Betsson está abierta con la cuenta adecuada (con saldo para el escenario 1, sin saldo para el 2). Si no, cierra sesión y entra con la cuenta correcta. Al cerrar sesión cierra también el resumen DGOJ "Sesión finaliza".
3. **Saldo inicial.** Se lee la cartera que carga la web y el saldo de la cabecera, y se comparan.
4. **Entrada al juego.** El test resuelve los diálogos regulatorios de la DGOJ en cualquier orden:
   - aviso de "hace menos de 60 min";
   - límites de sesión: 1 hora y 25 %. Sin saldo no hay límite de pérdidas y ese paso se omite.

   Después espera a que el juego cargue (la pantalla pasa de gris a color) y pasa la presentación.
5. **Spin guiado por VLM y seguido por HTTP**, como se describe arriba.
6. **Saldo final.** Se vuelve al lobby y se comprueba la cartera de Betsson contra el servidor del juego.

Las comprobaciones son "suaves": un fallo no aborta el escenario y el informe muestra todas.

### Cualquier juego de Pragmatic, sin configurarlo

El juego se pasa por nombre y se busca en la propia web de Betsson, como haría un jugador:

- El buscador del lobby descarga el catálogo completo (`/api/v2/games?countryCode=ES`): unos 2200 juegos con nombre, `slug` y proveedor.
- Se elige el juego por nombre, `slug` o id, sin importar mayúsculas ni tildes. Si el nombre es ambiguo, no existe o el proveedor no está soportado, el test para con un mensaje claro.
- La ruta del juego sale del enlace del resultado de búsqueda.
- Lo que cambia de un juego a otro lo resuelve el VLM: dónde está el botón de continuar de la presentación, dónde están los botones de spin y "−", y cuál es la apuesta.

### Seguros para no gastar dinero por error

- **Tope de apuesta (`MAX_WAGER`, 1,00 € por defecto):** si la apuesta leída lo supera, el test la baja al mínimo con el botón "−". Si aun así lo supera, no hace el spin.
- **Escenario 2:** si la cartera o la pantalla cubren la apuesta, no se pulsa spin, porque sería un spin pagado.
- **Sesión:** el escenario 1 no empieza si a la sesión de Betsson le quedan menos de 2 minutos.

### Escalable a otros proveedores

La arquitectura separa **mercado × proveedor × juego**:

| Capa | Archivo | Contiene |
| --- | --- | --- |
| Mercado | `src/config/markets.ts` | URL, idioma, moneda, selectores de la web, diálogos DGOJ, APIs que se escuchan |
| Proveedor | `src/providers/<proveedor>.ts` | Zona de rodillos y umbrales, mensaje de saldo insuficiente por idioma, analizador de su tráfico |
| Registro de proveedores | `src/providers/index.ts` | Proveedores soportados, por el id que usa el catálogo de Betsson |
| Juego | catálogo de Betsson (en tiempo de ejecución) o `src/games/catalog.ts` (juego por defecto) | Nombre, ruta y proveedor |

Para añadir un proveedor basta con escribir su perfil y su `TrafficParser` y registrarlo. Los escenarios no cambian. Sin analizador de tráfico, la ronda se juzga por la pantalla y la cartera.

### El analizador de tráfico de Pragmatic

Se ha verificado con rondas reales grabadas, que también son tests unitarios:

- **`doSpin`:** apuesta = `c × l`, multiplicada por 1,25 si `bl=1` (apuesta "ante").
- **Respuestas:** `balance` es el saldo, `tw` el premio acumulado y `na` la siguiente acción.
- **Ronda cerrada:** `na=s` sin `rs` pendiente. Una cascada se marca con `rs=t` en Sweet Bonanza y con `rs=mc` en Gates of Olympus; con premio, la ronda termina en `doCollect`.
- **Spin rechazado por el servidor:** `nomoney=1`.

---

## Uso

### Requisitos

1. Node 20 o superior y `npm ci`.
2. Chrome abierto con el puerto de depuración y un perfil propio:
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\chrome-betsson"
   ```
3. Un archivo `.env` (ignorado por git) con estas variables:
   - `CDP_URL=http://127.0.0.1:9222`
   - `BETSSON_ES_FUNDED_USER` / `BETSSON_ES_FUNDED_PASS` (cuenta con saldo)
   - `BETSSON_ES_EMPTY_USER` / `BETSSON_ES_EMPTY_PASS` (cuenta sin saldo)
   - `BETSSON_ES_EXTRA_HEADERS` (cabeceras de los mentores, en JSON)
   - `VLM_BASE_URL`, `VLM_API_KEY` y `VLM_MODEL` (lista de modelos separada por comas; si uno está saturado o retirado, se pasa al siguiente)

   El VLM se usa a través de cualquier endpoint compatible con la API de OpenAI; actualmente Gemini.

### Comandos

```powershell
npm run scenario1                          # escenario 1 con Sweet Bonanza (juego por defecto)
npm run scenario1 -- "gates of olympus"    # escenario 1 con cualquier juego de Pragmatic, buscado en Betsson
npm run scenario2                          # escenario 2 (cambia sola a la cuenta sin saldo; no gasta dinero)
npm run scenario2 -- "big bass splash"
npm run fault                              # prueba negativa: debe detectar el saldo falso (no gasta dinero)
npm run game -- "gates of olympus"         # solo entra al juego y deja la pestaña abierta
npm run test:unit                          # tests unitarios (sin navegador)
npm run report                             # abre el informe HTML
npm run typecheck
```

`MAX_WAGER` cambia el tope de apuesta: `$env:MAX_WAGER="0.50"; npm run scenario1`.

### Tests unitarios

27 tests sin navegador, que cubren:

- lectura de importes;
- el anillo de evidencia;
- el analizador de tráfico de Pragmatic con rondas reales grabadas: Sweet Bonanza con cascada, Gates of Olympus con `rs=mc`, spin perdedor, dos rondas seguidas, apuesta ante y spin rechazado por saldo;
- la búsqueda de juegos en el catálogo;
- la inyección de fallos.

---

## Estructura

```
src/config/      markets.ts (mercado .es), credentials.ts (variables de entorno y cabeceras extra solo para los hosts de Betsson)
src/providers/   types.ts, pragmatic.ts (perfil y analizador de tráfico), index.ts (registro de proveedores)
src/games/       catalog.ts (juego por defecto), discover.ts (búsqueda en el catálogo de Betsson)
src/pages/       BetssonShell.ts (web de Betsson: login, cartera, diálogos, búsqueda), GameFrame.ts (iframe del juego)
src/flows/       vlmSpin.ts (escenario 1), vlmSpinAttempt.ts (escenario 2)
src/network/     RoundRecorder.ts (rondas según el servidor), faultInjection.ts (prueba negativa)
src/vision/      vlm.ts (cliente VLM con cambio de modelo), annotate.ts (anillo), image.ts (recorte, diferencia de píxeles, color)
src/report/      Checks (comprobaciones con evidencia), ChecksReporter (report/checks.md y resumen del job)
src/utils/       money.ts, secretInput.ts (escribe credenciales fuera del trace)
scripts/run.js   lanza un escenario con el juego pasado por argumento
tests/           auth.setup.ts, enter-game, scenario1, scenario2, fault-injection, unit/
```

---

## Seguridad

- **Secretos:** ninguno en el repositorio, los informes ni las capturas. Las credenciales van en `.env` o en GitHub Secrets.
- **Credenciales fuera del trace:**
  - Se comprobó que todo lo que pasa por la API de Playwright queda grabado en el trace.
  - Por eso el usuario y la contraseña se escriben por una conexión DevTools aparte (`Input.insertText`), y el trace del navegador se pausa durante el login.
  - Está verificado que ninguno de los dos aparece en el `trace.zip`.
- **Cabeceras de los mentores:** solo se envían a hosts de Betsson. Si se envían al proveedor, rompen su CORS y el juego no carga.
- **Datos personales:** las capturas de página tapan los datos del titular, y al VLM solo se le envían capturas del juego. Del cliente solo se usa, en memoria, el nombre de usuario, para saber qué cuenta está conectada.
- **Tráfico:** solo se guarda decodificado (números), nunca los cuerpos crudos.
- **CI:** el trace no se genera en CI porque contiene cookies de sesión.

---

## Limitaciones conocidas

- **CI:** GitHub Actions no puede usar el Chrome de una persona. La alternativa es un runner propio con Chrome abierto en el puerto 9222.
- **Saturación del VLM:** los modelos gratuitos o de previsualización se saturan a ratos (429/503). El cliente cambia de modelo automáticamente, pero una ejecución puede tardar más.
- **Proveedores:** de momento solo Pragmatic Play está registrado. Otros proveedores necesitan su perfil y, opcionalmente, su analizador de tráfico.
