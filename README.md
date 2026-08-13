# SynchroSign API

Backend NestJS + Supabase para SynchroSign: gestión documental, firma y verificación pública.

## Stack

- **NestJS 11** — API REST modular
- **Supabase** — PostgreSQL + Storage (sin Supabase Auth)
- **BetterAuth** — Autenticación (pendiente de implementar)
- **class-validator** — Validación de DTOs
- **Helmet + Throttler** — Seguridad HTTP y rate limiting
- **Swagger** — Documentación en `/docs`

## Requisitos

- Node.js 20+
- Proyecto Supabase configurado (base de datos y storage)

## Configuración

1. Copia variables de entorno:

```bash
cp .env.example .env
```

2. Completa en `.env`:

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service role (**solo servidor**) |
| `CORS_ORIGINS` | Orígenes del frontend separados por coma |

3. Aplica migraciones en Supabase SQL Editor:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_storage_bucket.sql
```

> Las migraciones `001` y `002` ya están aplicadas en el proyecto vinculado.

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

### Protegidos (requieren BetterAuth — pendiente)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/auth/me` | Perfil del usuario |
| GET | `/api/v1/documents` | Listar documentos |
| POST | `/api/v1/documents` | Subir PDF (`multipart/form-data`) |
| GET | `/api/v1/documents/:id` | Detalle |
| POST | `/api/v1/documents/:id/sign` | Registrar firma + PDF firmado |
| GET | `/api/v1/documents/:id/download` | URL firmada de descarga |
| DELETE | `/api/v1/documents/:id` | Eliminar documento |

> Mientras BetterAuth no esté integrado, las rutas protegidas responden **503** con el mensaje `Autenticación pendiente: BetterAuth será integrado próximamente`.

## Autenticación (BetterAuth — planificado)

**No usamos Supabase Auth.** La autenticación se implementará con [BetterAuth](https://www.better-auth.com/) en una fase posterior.

### Estado actual

- `BetterAuthGuard` bloquea rutas protegidas hasta la integración
- Supabase se usa solo como **PostgreSQL + Storage** vía `service_role` en el servidor
- Decoradores `@Public()` y `@CurrentUser()` listos para cuando exista sesión

### Próximos pasos de auth

1. Instalar y configurar BetterAuth en el backend
2. Migrar esquema: `profiles` y `documents` dejarán de depender de `auth.users`
3. Reemplazar `BetterAuthGuard` por validación de sesión real
4. Exponer endpoints de auth (`/api/auth/*`) al frontend

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
src/
├── config/           # Variables de entorno validadas
├── common/           # Decorators, filters, types
├── infrastructure/
│   └── supabase/     # Cliente Supabase (solo admin/service role)
└── modules/
    ├── auth/         # Guard placeholder + perfil (BetterAuth pendiente)
    ├── documents/    # CRUD + upload + firma
    ├── verification/ # Endpoint público
    └── health/
```

## Flujo de firma (cuando auth esté listo)

1. Frontend autentica con **BetterAuth**
2. Frontend sube PDF original → `POST /documents`
3. Frontend firma localmente con pdf-lib
4. Frontend envía PDF firmado en base64 → `POST /documents/:id/sign`
5. Backend guarda en Storage y registra `verification_code`
6. Cualquiera puede verificar en `/verify/:code`

## Producción

```bash
npm run build
npm run start:prod
```

Configura `CORS_ORIGINS` con tu dominio de Vercel y despliega en Railway, Render, Fly.io, etc.

## Roadmap

- [ ] Integrar BetterAuth
- [ ] Migración de esquema para usuarios independientes de Supabase Auth
- [ ] Integrar frontend con esta API
- [ ] Tests e2e con Supertest
- [ ] CI/CD con GitHub Actions
