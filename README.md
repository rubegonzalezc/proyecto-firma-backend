# SynchroSign API

Backend NestJS + Supabase para SynchroSign: gestión documental, firma y verificación pública.

## Stack

- **NestJS 11** — API REST modular
- **Supabase** — PostgreSQL + Storage (sin Supabase Auth)
- **BetterAuth** — Autenticación con email/contraseña (`/api/auth/*`)
- **class-validator** — Validación de DTOs
- **Helmet + Throttler** — Seguridad HTTP y rate limiting
- **Swagger** — Documentación en `/docs`

## Requisitos

- Node.js 20+
- Proyecto Supabase configurado (base de datos y storage)

## Configuración

### Variables locales

1. Copia variables de entorno:

```bash
cp .env.example .env
```

2. Completa `SUPABASE_SERVICE_ROLE_KEY` en `.env` (no disponible vía MCP por seguridad):

   Supabase Dashboard → **Settings** → **API** → `service_role` (secret)

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_URL` | `https://bvzppyxxwcmhenugfnrj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service role (**solo servidor**) |
| `DATABASE_URL` | Connection string PostgreSQL de Supabase |
| `BETTER_AUTH_SECRET` | Secreto de cifrado (mín. 32 caracteres) |
| `BETTER_AUTH_URL` | URL pública del backend (ej. `http://localhost:3000`) |
| `CORS_ORIGINS` | Orígenes del frontend separados por coma |

### Vercel (`proyecto-firma-backend.vercel.app`)

Configura las mismas variables en **Vercel → Project → Settings → Environment Variables**:

| Variable | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `API_PREFIX` | `api/v1` |
| `CORS_ORIGINS` | `https://sign.synchrodev.cl,http://localhost:5173` |
| `SUPABASE_URL` | `https://bvzppyxxwcmhenugfnrj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(service_role desde Supabase Dashboard)* |
| `APP_VERIFY_BASE_URL` | `https://sign.synchrodev.cl` |
| `BETTER_AUTH_SECRET` | Secret de 32+ caracteres (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | `https://proyecto-firma-backend.vercel.app` |
| `DATABASE_URL` | Connection string PostgreSQL de Supabase (pooler) |

> Usa **Node.js 22.x** en Vercel. No instales `@thallesp/nestjs-better-auth` (provoca `ERR_REQUIRE_ESM`).

### Migraciones Supabase

Aplica en Supabase SQL Editor, en orden:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_storage_bucket.sql
supabase/migrations/004_envelopes.sql
supabase/migrations/005_tokens_audit.sql
supabase/migrations/006_verification_v2.sql
supabase/migrations/007_mvp_better_auth.sql
supabase/migrations/008_better_auth_tables.sql
```

> La `003` es solo un guion de referencia histórico y no se ejecuta.

## Desarrollo

```bash
npm install
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/api/v1/health`

## Endpoints

### Públicos (disponibles ahora)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/verify/:code` | Verificar documento por código |

### Portal de firma (públicos, autenticados por enlace + código)

El firmante externo no tiene cuenta: se identifica con el enlace único que
recibe por correo más un código de un solo uso.

| Método | Ruta | Límite |
|--------|------|--------|
| GET | `/api/v1/sign/:token` | 30/min |
| POST | `/api/v1/sign/:token/otp/request` | 3 / 10 min |
| POST | `/api/v1/sign/:token/otp/verify` | 10 / 10 min |
| GET | `/api/v1/sign/session/me` | 60/min |
| GET | `/api/v1/sign/session/document` | 20/min |
| POST | `/api/v1/sign/session/submit` | 5/min |
| POST | `/api/v1/sign/session/decline` | 5/min |

### Protegidos (sesión Better Auth)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/auth/me` | Perfil del usuario |
| GET | `/api/v1/documents` | Listar documentos |
| POST | `/api/v1/documents` | Subir PDF (`multipart/form-data`) |
| GET | `/api/v1/documents/:id` | Detalle |
| POST | `/api/v1/documents/:id/sign` | **Obsoleto**: acepta el PDF ya firmado sin validarlo |
| GET | `/api/v1/documents/:id/download` | URL firmada de descarga |
| DELETE | `/api/v1/documents/:id` | Eliminar documento |
| POST | `/api/v1/envelopes` | Crear sobre con firmantes y campos |
| GET | `/api/v1/envelopes` | Listar sobres |
| GET | `/api/v1/envelopes/:id` | Detalle con firmantes y campos |
| PATCH | `/api/v1/envelopes/:id` | Modificar (solo en borrador) |
| POST | `/api/v1/envelopes/:id/send` | Emitir enlaces y enviar a firma |
| DELETE | `/api/v1/envelopes/:id` | Anular y revocar enlaces |
| GET | `/api/v1/envelopes/:id/download` | `?type=original\|current\|final` |
| GET | `/api/v1/envelopes/:id/audit` | Traza de auditoría |

## Autenticación (BetterAuth)

**No usamos Supabase Auth.** La autenticación usa [Better Auth](https://www.better-auth.com/) montada en `/api/auth/*`.

> **Importante:** no uses `@thallesp/nestjs-better-auth` — provoca `ERR_REQUIRE_ESM` en Vercel porque Better Auth es ESM-only. Este proyecto carga Better Auth vía `import()` dinámico desde `auth/auth.mjs`.

### Estado actual

- Rutas de auth: `POST/GET /api/auth/*` (Better Auth)
- `BetterAuthGuard` valida sesión con cookies
- Supabase se usa como **PostgreSQL + Storage** vía `service_role` en el servidor
- Decoradores `@Public()` y `@CurrentUser()` para rutas NestJS

## Seguridad

- **Service role key** solo en servidor (nunca en frontend)
- **RLS** en tablas (defensa en profundidad; el backend usa service role)
- **Storage privado** con paths `{user_id}/{document_id}/`
- **Rate limiting** global (100 req/min)
- **Helmet** para headers HTTP seguros
- **Validación estricta** de DTOs (`whitelist` + `forbidNonWhitelisted`)
- Verificación pública sin exponer `user_id` (vista `document_verifications`)

## Arquitectura

```
auth/
└── auth.mjs              # Instancia Better Auth (ESM, compatible con Vercel)

src/
├── bootstrap/            # Arranque compartido (local + serverless)
├── config/               # Variables de entorno validadas
├── common/               # Decorators, filters, types
├── infrastructure/
│   ├── auth/             # Runtime ESM, adaptador Node y guard
│   └── supabase/         # Cliente Supabase (service role)
└── modules/
    ├── auth/             # Perfil autenticado
    ├── documents/        # CRUD + upload
    ├── envelopes/        # Sobres multi-firmante
    ├── signing-portal/   # Portal público de firma
    └── verification/     # Verificación pública
```

## Flujo de firma multi-parte

1. El emisor sube el PDF → `POST /documents`
2. El frontend analiza el documento y propone las zonas de firma
3. El emisor define firmantes y campos → `POST /envelopes`
4. `POST /envelopes/:id/send` emite un enlace único por firmante
5. Cada firmante abre su enlace, pide un código al correo y lo canjea por una
   sesión corta
6. `POST /sign/session/submit` envía **solo la imagen de la firma**: el servidor
   resuelve las coordenadas y estampa
7. Al firmar el último se añade la hoja de certificación, se asigna el código de
   verificación y se calcula el hash final
8. Cualquiera puede verificar en `/verify/:code`, incluido el SHA-256

### El estampado ocurre en el servidor

`POST /documents/:id/sign` aceptaba un `signedPdfBase64` arbitrario y lo
guardaba sin comprobar nada: cualquier cliente podía subir el documento que
quisiera y quedaba marcado como verificado. En el flujo de sobres el cliente
solo envía la imagen de la firma, y el PDF resultante lo produce el servidor.

### Firma incremental

Cada firmante estampa sobre la versión que dejó el anterior, de modo que ve las
firmas previas. Cada paso queda registrado en `envelope_versions` con su propio
hash, lo que da una cadena de custodia comprobable. El índice único
`(envelope_id, version)` protege del caso en que dos firmantes en modo paralelo
envíen a la vez.

## Alcance de la firma

Esto es **firma electrónica simple con evidencia auditable**: imagen de firma,
identificación por enlace y código al correo, registro de IP y hora, y hash del
documento. No es PAdES: no hay certificado digital ni firma criptográfica
embebida en el PDF.

## Producción

```bash
npm run build
npm run start:prod
```

Configura `CORS_ORIGINS` con `https://sign.synchrodev.cl` y despliega en Vercel, Railway, Render, Fly.io, etc.

## Roadmap

- [ ] Envío real de correos (hoy el código de un solo uso se escribe en el log
      del servidor; sin proveedor, el portal no es usable en producción)
- [ ] `@pdf-lib/fontkit` para nombres fuera de WinAnsi (hoy se sustituyen)
- [ ] Caducidad automática de sobres (`expires_at` se guarda pero no hay cron)
- [ ] Integrar frontend con esta API
- [ ] Tests e2e con Supertest
- [ ] CI/CD con GitHub Actions
