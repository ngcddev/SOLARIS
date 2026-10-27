# Modelo de amenazas

Alcance: el MVP de Solaris (simuladores, ingesta, IA, panel). Lo que depende de la hoja de ruta (malla BLE/LoRa real, app nativa) se indica como tal.

## Activos
- Ubicación y datos de personas que piden ayuda.
- Integridad de la cola de prioridades (que un atacante no desplace casos reales).
- Disponibilidad del centro de mando durante el desastre.
- Llave privada del centro de mando.

## Amenazas y mitigaciones

| # | Amenaza | Mitigación en el MVP | Pendiente / hoja de ruta |
|---|---|---|---|
| 1 | **SOS falsos** (bromas, ubicaciones inventadas, intentos de saturar al centro) | Puntaje de confianza con desglose: coincidencia con evento sísmico (tiempo y espacio), corroboración por otros remitentes, proximidad del primer nodo que retransmitió (el alcance Bluetooth corrobora la ubicación), coherencia del contenido, firma/identidad. **Un SOS de baja confianza nunca se descarta**: baja un nivel y queda marcado para revisión humana (evita que un atacante logre "silenciar" casos reales). El brigadista puede marcar como falso. | Verificación por SMS/teléfono como señal adicional. Detección de patrones entre identidades. |
| 2 | **Suplantación** de un remitente | Cada paquete lleva firma Ed25519 sobre encabezado + llave del remitente + contenido; se verifica antes de aceptar. Una firma que no corresponde a la llave declarada se rechaza (`bad_signature`). | Vincular identidad a un número verificado; rotación de llaves. |
| 3 | **Alteración** en tránsito (un relevo malicioso) | El cuerpo va cifrado y autenticado (`crypto_box_seal`) y firmado; cambiar encabezado o cuerpo rompe la firma o el descifrado. Solo el TTL es mutable, y por eso queda fuera de la firma (un relevo puede acortar la vida del mensaje, no cambiar su contenido). | Un relevo puede descartar paquetes; la redundancia por varios caminos y pasarelas lo mitiga. |
| 4 | **Repetición (replay)** | El ID de 16 bytes aleatorios se registra solo después de verificar la firma (no se puede "envenenar" el registro con paquetes falsos). Mismo ID por **otro camino** dentro de la ventana de deduplicación = duplicado legítimo (se fusiona y se cuenta el camino); mismo camino o fuera de la ventana = repetición bloqueada. Además se rechazan timestamps fuera de la ventana configurable (`REPLAY_WINDOW_S`), pasados o futuros. | Ventana y registro persistentes en base de datos (hoy en memoria). |
| 5 | **Inundación de la red / del centro** | Límite por identidad (`RATE_LIMIT_MAX` por `RATE_LIMIT_WINDOW_MIN`); los duplicados no consumen el cupo; tamaño máximo de paquete y de lote en `/api/ingest`; fragmentos de audio acotados (máx. 16) y solo aceptados del mismo remitente que inició el audio; lista de revocación de identidades. Deduplicación por nodo y TTL en la malla evitan tormentas de reenvío. | Límite por pasarela/IP, cuotas globales, protección de DoS en el borde. Un atacante con muchas identidades sigue siendo un riesgo: la corroboración y la revisión humana lo acotan. |
| 6 | **Privacidad de la ubicación** | El contenido (incluida la ubicación) viaja cifrado hacia la llave pública del centro: los teléfonos y nodos que retransmiten no pueden leerlo. Solo el encabezado (urgencia, TTL, ID aleatorio, hora) es visible. No se registra contenido descifrado ni llaves en logs. La retransmisión exige permiso explícito y una notificación visible. Las fotos solo las suben brigadistas/drones, no los ciudadanos. | Cifrado de datos en reposo en Postgres; retención mínima; metadatos del encabezado (hora, urgencia) siguen siendo observables. Si el centro es comprometido, toda la información lo está. |
| 7 | **Robo de la llave del centro** | La llave privada solo vive en `.env.local` (git-ignorado) o en memoria efímera; `.env.example` no contiene valores; `generate-keys` se niega a sobrescribir. | Gestor de secretos y rotación; llaves por jornada. |
| 8 | **IA que alucina o da consejo médico** | Salidas validadas con Zod; ids inventados o equipos ocupados se descartan en las recomendaciones; un filtro bloquea lenguaje médico y lo reemplaza por una plantilla segura; si algo falla, se usa el nivel 3 (reglas). La decisión final siempre es humana. | Evaluación periódica del filtro con más casos. |
| 9 | **Caída de internet** | Nivel 3 por reglas, sin IA ni red; el interruptor del panel lo demuestra. | Modelo local (N2). |
| 10 | **Entradas maliciosas** (JSON, imágenes) | Zod en todas las rutas; las imágenes se limitan a PNG/JPEG/WebP en data URL y por tamaño; no se ejecuta contenido subido. | Antivirus/re-encode de imágenes en servidor. |

## Supuestos de confianza
- La pasarela y el centro de mando son de confianza; los teléfonos y relevos no.
- El reloj de los teléfonos puede desviarse: por eso la ventana de timestamps es amplia (10 min por defecto).
- El MVP guarda estado en memoria; reiniciar el servidor borra casos, el registro de repeticiones y los contadores.
