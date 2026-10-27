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
