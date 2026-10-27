# Supuestos y puntos `VERIFICAR`

## Decisiones de diseño
- Next.js App Router + CSS Modules/variables CSS (`src/styles/tokens.css`); sin Tailwind para no acoplar al futuro design system.
- Actualización del panel por *polling* (2 s); SSE queda como mejora.
- Si no hay llaves del centro en el entorno, el servidor genera un par efímero en memoria (sirve para demo; los paquetes no sobreviven a un reinicio).
- Repositorio de datos detrás de una interfaz; implementación en memoria por defecto, Supabase como objetivo.
- El escenario de demo es **Cali, 2026 (sismo ficticio)**, por indicación del usuario; reemplaza al escenario Popayán 1983 del prompt original.
- Benchmark: estimación de revisión manual de 2 min por SOS (supuesto).
- Codec2 no se implementa: solo se muestra el tamaño teórico (~1.200 bps).

- El audio del simulador ciudadano viaja **sin Codec2**: WAV mono PCM16 a 16 kHz fragmentado en paquetes firmados y cifrados de hasta ~60 kB (en la malla real irían fragmentos de ~200 bytes de audio Codec2). La UI muestra el tamaño teórico con Codec2.
- Los audios del escenario usan el fixture `SIMULATED_AUDIO:<texto>`, que solo entiende el mock de transcripción; en modo reglas no hay transcripción (el triage sigue con botones y tiempo de espera).
- Un audio grabado de verdad no se puede transcribir en modo simulado (devuelve vacío); requiere `META_API_KEY`.
- Ventana de replay 600 s, de deduplicación 120 s, límite 5 SOS por identidad cada 10 min: valores por defecto configurables (`.env`).
- Un mismo mensaje que llega por otro camino **dentro** de la ventana de deduplicación se fusiona; el mismo camino o fuera de la ventana se trata como repetición.
- Los audios no consumen el cupo por identidad y solo se aceptan fragmentos del remitente que inició ese audio.
- Malla: Bluetooth ~50 m (configurable), troncal LoRa ~2,5 km, pasarelas como sumideros, TTL por defecto 8 (10–12 en las simulaciones). Los nodos y teléfonos del escenario se generan con una semilla fija.
- Proximidad de nodos: se compara el **primer relevo** con la ubicación reportada; sin datos de nodos la señal es neutra (0,5).
- Pesos de confianza: firma 0,15, evento sísmico 0,25, corroboración 0,20, proximidad 0,15, coherencia 0,25; la foto de campo con personas suma hasta +10. Sin evento sísmico registrado, la señal vale 0,4.
- El evento sísmico de la demo es **ficticio** (M6,1, Cali, 2026) y la UI lo marca como simulado. El feed real de USGS está tras `USGS_FEED_ENABLED=true`.
- El mapa usa Leaflet sin *plugins* de clustering/calor: la vista de **densidad** son círculos translúcidos por caso. Los tiles de OpenStreetMap se ven en escala de grises con un filtro CSS.
- Las fotos de campo se guardan en memoria como data URL (máx. ~6 MB); en producción irían a un bucket privado.
- Una "imagen de ejemplo" sintética permite demostrar el flujo de fotos sin una foto real; está rotulada como tal.
- Estado en memoria: reiniciar el servidor borra todo (el esquema Postgres está en `supabase/schema.sql`, sin implementar).
- En el tipo del paquete, `urgency` del encabezado es una pista no autenticada; la prioridad real sale del triage.

## VERIFICAR (API de Meta)
Lista completa de puntos pendientes de confirmar con acceso real a la API (créditos pendientes). Cada uno está marcado `// VERIFICAR:` en el código:
1. `src/lib/ai/meta.ts`: forma de `response_format` (JSON schema) en Chat Completions y ruta `/chat/completions`.
2. `src/lib/ai/meta.ts`: campos multipart, *keyword biasing* y pista de idioma de `POST /asr/transcribe`; forma de la respuesta (`text` o `turns[]`).
3. `src/lib/ai/meta.ts`: petición de SAM 3.1 por `/responses` con `input_image`, una frase por llamada, y formato de máscaras (polígonos o cajas normalizadas).
4. `src/lib/ai/config.ts`: ID vigente de Spark (se usa `muse-spark-1.3` según los docs) y que `muse-wonder-1.0` siga disponible fuera de *preview*.
5. `src/lib/geo/geo.ts`: URL del feed de USGS.
6. Límites de tasa, costo por llamada y latencia reales de Spark/Wonder (el benchmark en modo `meta` incluye latencia de red).

### Hallazgos de https://dev.meta.ai/docs (consultado el 2026-10-27)
Confirmado en la documentación pública:
- Base URL `https://api.meta.ai/v1`, `Authorization: Bearer <key>`; la variable de entorno en los docs es `MODEL_API_KEY` (aquí se aceptan `META_API_KEY` y `MODEL_API_KEY`).
- IDs vigentes: `muse-spark-1.3` (también 1.2, 1.1), `muse-wonder-1.0` (preview), `muse-voice-transcribe-1.0`, `sam-3.1`.
- Transcripción por archivo: `POST /v1/asr/transcribe` (devuelve texto con marcas por turno, sin marcas por palabra).
- SAM 3.1: `POST /v1/responses` y `POST /v1/files`; devuelve cajas y máscaras.

Sin confirmar (marcados `// VERIFICAR:` en `src/lib/ai/meta.ts`):
- Forma exacta de `response_format` para salida estructurada (se asume el estilo OpenAI `json_schema`).
- Nombres de campos multipart de `/asr/transcribe`, parámetro de *keyword biasing* y de pista de idioma, y campo del texto en la respuesta.
- Formato de la petición y de las máscaras de SAM 3.1 vía `/responses` (se asumen coordenadas normalizadas y polígonos o cajas).
- Si el endpoint de Chat Completions usa la ruta `/chat/completions` (el sitio no la lista).
- Endpoint público de USGS usado para el feed opcional (`significant_day.geojson`).

### Comportamiento de la IA
- Sin `META_API_KEY` => modo simulado (mock determinista derivado del contenido). Con "Simular caída de internet" => nivel 3 (reglas) sin llamadas externas.
- Toda salida de modelo se valida con Zod; si falla, o si contiene lenguaje médico (lista en `src/lib/ai/safety.ts`), se usa el nivel 3 o una plantilla segura.
- El analista (Wonder) solo se invoca bajo demanda; sus sugerencias con ids inexistentes, equipos ocupados o dobles reservas se descartan.
- Confianza: umbral de baja confianza = 45/100; solo baja la prioridad un nivel y marca revisión humana.
