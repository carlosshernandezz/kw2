# WhatsApp Cloud API - Recepcion De Operaciones

## Objetivo

Usar un unico numero de WhatsApp Business como canal de entrada. Los reportantes autorizados envian el comprobante con una descripcion en el pie de foto. KW2 identifica al remitente, conserva la evidencia y crea una recepcion auditable para revision humana.

Formato recomendado:

```text
EGRESO | Aquiles | comision 3%
```

## Flujo inicial

1. WhatsApp Cloud API envia el webhook a `POST /api/whatsapp/webhook`.
2. KW2 verifica `X-Hub-Signature-256` con el secreto de la aplicacion Meta.
3. El ID de mensaje evita duplicados aunque Meta reintente la entrega.
4. El numero remitente se compara con `whatsapp_reporters`.
5. La imagen se descarga a `data/whatsapp/`, fuera de `public/` y fuera de Git.
6. Se crea `operation_intakes` con estado `received` o `needs_information`.
7. La bandeja `/operaciones/recibidas` muestra reportante, hora, texto, evidencia y estado.

Esta fase no interpreta el comprobante, no crea asientos y no escribe Google Sheets.

## Variables privadas

Agregar solo al `.env` local:

```text
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_GRAPH_VERSION=v23.0
```

Nunca guardar tokens, codigos SMS, telefonos reales ni secretos en Git.

## Activacion

1. Respaldar y exportar las conversaciones importantes de WhatsApp Business.
2. Confirmar en Meta si el numero admite coexistencia antes de migrarlo.
3. Crear la aplicacion Meta y vincular la cuenta de WhatsApp Business.
4. Publicar exclusivamente el webhook por HTTPS; no exponer toda la app sin autenticacion.
5. Configurar como callback `https://DOMINIO/api/whatsapp/webhook` y usar el mismo `WHATSAPP_VERIFY_TOKEN`.
6. Suscribir el campo `messages`.
7. Registrar los reportantes autorizados en PostgreSQL.
8. Enviar primero una captura de prueba con pie de foto.

## Seguridad

- El webhook rechaza firmas invalidas.
- Los archivos tienen permisos locales restrictivos y no se sirven publicamente.
- Un remitente desconocido queda marcado como no autorizado.
- La app todavia no tiene login: antes de publicar acceso remoto hay que agregar autenticacion y roles.
- El historial anterior se conserva en la aplicacion/respaldo; no se asume que Meta lo importe a Cloud API.

