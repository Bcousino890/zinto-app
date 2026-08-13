# Checklist de preparación para el E2E bidireccional

Fecha: 13 de agosto de 2026. Bloque 5 del plan
(`docs/api/NEXT-PHASE-PLAN-2026-08-13.md`). No se ha empezado nada de esto —
sigue completamente bloqueado hasta recibir los datos de abajo.

---

## Formato exacto de los datos que necesito (corto, sin ambigüedad)

Envíame estas 5 líneas, rellenas:

```
Empresa piloto (nombre exacto o ID en el CRM):
Canal a probar (ej. whatsapp_official, whatsapp_meta — el que tenga esa empresa conectado):
Número de prueba España (con prefijo, ej. +34...):
Número de prueba Chile (con prefijo, ej. +56...):
Confirmación: estos números son de prueba, autorizados para recibir mensajes de test durante el E2E, y no pertenecen a clientes reales.
```

No hace falta nada más que esto para arrancar. Si algún canal de la empresa
piloto no admite plantillas o mensajes interactivos, no pasa nada — esos dos
tipos solo se prueban en los canales que sí los soporten (lo confirmo yo
mismo contra `GET /channels` antes de probar cada tipo).

## Qué NO debe ser

- No un número de un cliente real, aunque esté disponible o "no le
  importaría".
- No un número compartido con otro uso en producción durante la ventana de
  prueba (el E2E va a mandarle mensajes de test de verdad).
- No una empresa con datos sensibles reales si se puede evitar — si la
  empresa piloto es una cuenta real de producción, lo tendré en cuenta y
  seré especialmente cuidadoso con lo que quede en logs o en el propio CRM
  tras la prueba.

---

## Qué falta además de los datos, antes de que el E2E pueda arrancar de verdad

Esto es importante y quiero dejarlo explícito para que no haya sorpresas:
**los datos de arriba son necesarios pero no suficientes.** El E2E completo
(nota, tag, pipeline, deal y tarea en ambos sentidos, no solo mensajes)
necesita escritura real habilitada para la empresa piloto, y eso implica
pasos que hoy están explícitamente prohibidos por instrucción tuya:

1. **Aplicar `migrations/001_integration_api.sql` en producción** — ya
   verificada dos veces en staging, con rollback probado, pero sigue sin
   aplicarse hasta que tú lo autorices explícitamente.
2. **Habilitar escrituras de forma acotada**, siguiendo la secuencia ya
   descrita en el plan (Fase F): una sola clave de API y la empresa piloto,
   con los scopes mínimos necesarios, `READ_ONLY_MODE=false` solo para esa
   combinación, la regla de Nginx de escritura ajustada solo para permitirlo
   ahí. Nada de esto se hace sin instrucción tuya, paso por paso.
3. Si el E2E va a incluir envío de media (imagen/video/audio/documento) a un
   número real, además hace falta cerrar los 5 pasos operativos del proxy de
   media (`docs/api/ACTIVATION-READINESS-2026-08-13.md`, fila del proxy de
   media) — si prefieres, el E2E de texto/plantilla/interactivo puede
   arrancar antes y dejar media para una segunda ronda una vez esos 5 pasos
   estén cerrados.

**No voy a dar ninguno de estos pasos por mi cuenta.** En cuanto me pases los
5 datos de arriba, te preguntaré explícitamente por cada uno de estos tres
puntos antes de tocar nada en producción — esto es solo para que sepas de
antemano qué voy a preguntar, no para bloquear que me envíes los datos ya.

## Cobertura mínima del E2E, una vez arrancado (recordatorio, sin cambios respecto al plan)

- Contacto en ambos sentidos.
- Texto saliente y entrante por cada canal que devuelva `GET /channels` para
  la empresa piloto.
- Imagen, vídeo, audio y documento dentro de los límites reales del
  proveedor (requiere el proxy de media activo, ver arriba).
- Plantilla e interactivo solo en los canales que los soporten.
- Nota, tag, pipeline, deal (incluido `deal.stage.changed`) y tarea en ambos
  sentidos.
- Mensajes de días anteriores y chats antes vacíos.
- Desconexión y reconexión de canal.
- Timeout, duplicado, evento repetido, orden invertido y caída temporal del
  receptor del webhook.

## Qué reporto al terminar

Un informe con el mismo nivel de detalle que el resto de esta sesión: qué se
probó, qué pasó exactamente en cada caso, cualquier discrepancia entre lo
esperado y lo observado, y si algo queda pendiente de ajustar antes de abrir
la API a un partner real fuera de la empresa piloto.
