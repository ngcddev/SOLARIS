# Supuestos y puntos `VERIFICAR`

## Decisiones de diseño
- Next.js App Router + CSS Modules/variables CSS (`src/styles/tokens.css`); sin Tailwind para no acoplar al futuro design system.
- Actualización del panel por *polling* (2 s); SSE queda como mejora.
- Si no hay llaves del centro en el entorno, el servidor genera un par efímero en memoria (sirve para demo; los paquetes no sobreviven a un reinicio).
- Repositorio de datos detrás de una interfaz; implementación en memoria por defecto, Supabase como objetivo.
- El escenario de demo es **Cali, 2026 (sismo ficticio)**, por indicación del usuario; reemplaza al escenario Popayán 1983 del prompt original.
- Benchmark: estimación de revisión manual de 2 min por SOS (supuesto).
- Codec2 no se implementa: solo se muestra el tamaño teórico (~1.200 bps).

## VERIFICAR (API de Meta)
Se completa en el paso de adaptadores de IA.

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
