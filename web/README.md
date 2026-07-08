# KW2 Web

Aplicación interna de KW2 Mesa. En local corre con PostgreSQL en Docker; en producción
puede correr en Vercel usando PostgreSQL en la nube.

## Getting Started

Desde esta carpeta:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Variables

La app lee `.env` desde la raíz del repo en desarrollo local. Para Vercel, configura
las mismas variables en Project Settings → Environment Variables.

Base de datos:

```bash
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

Google Sheets en producción:

```bash
KW2_SHEET_ID=1bVhtBhS_cEDAnET8q5t4d4tT3pDE_bvEFD0oYjWaNWo
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

`GOOGLE_SERVICE_ACCOUNT_JSON` puede ser el JSON completo de la service account o el mismo JSON codificado en base64. Debe tener acceso de solo lectura al Sheet.

En local también funciona con:

```bash
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=kw2
POSTGRES_USER=kw2_app
POSTGRES_PASSWORD=...
```

Acceso web:

```bash
KW2_BASIC_AUTH_USERS=carlos:password1,jose:password2
```

WhatsApp:

```bash
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_GRAPH_VERSION=v23.0
```

El webhook `/api/whatsapp/webhook` queda sin Basic Auth para que Meta pueda llamarlo,
pero valida el verify token y la firma `X-Hub-Signature-256`.

## Deploy En Vercel

1. Sube el repo a GitHub.
2. Crea una base PostgreSQL en la nube y restaura el dump local.
3. En Vercel importa el repo y selecciona `web` como Root Directory.
4. Configura las variables de entorno.
5. Despliega.
6. En Meta, cambia el webhook a `https://tu-app.vercel.app/api/whatsapp/webhook`.

Estado actual:

- GitHub: repo privado `github.com/carlosshernandezz/kw2`.
- Producción: Vercel proyecto `kw2`, dominio esperado `https://kw2-six.vercel.app`.
- Base: Supabase `kw2-production`; usar **Transaction pooler** en `DATABASE_URL`, no Direct ni Session para Vercel.
- Si la contraseña de Supabase tiene caracteres especiales (`*`, `.`, etc.), URL-encodear la contraseña antes de pegarla en `DATABASE_URL` (`*` -> `%2A`).
- Basic Auth es temporal. El navegador recuerda credenciales por dominio y no hay logout; reemplazar por login real antes de operación con usuarios finales.
- El botón de sincronización con Google Sheets ejecuta el script local en la Mac mini. En Vercel ejecuta la sincronización cloud básica: `DATA` + snapshot `MOVIMIENTOS` + reimport seguro por `kw2_id` sobre Supabase.
