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
| `RESEND_API_KEY` | Clave de Resend (**obligatoria en producción**) |
| `MAIL_FROM` | Remitente, con el dominio verificado en Resend |

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
| `RESEND_API_KEY` | *(desde el panel de Resend)* |
| `MAIL_FROM` | `SynchroSign <no-reply@synchrodev.cl>` |

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
supabase/migrations/009_better_auth_user_ids_text.sql
supabase/migrations/010_envelopes_better_auth_user_id.sql
supabase/migrations/011_user_notifications.sql
supabase/migrations/012_signature_methods.sql
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
| GET | `/api/v1/legal/catalog` | Tipos de documento, niveles de firma y métodos |
| GET | `/api/v1/legal/document-types/:id` | Qué firma exige un tipo de documento |

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
| POST | `/api/v1/documents/:id/self-sign` | Firmar tu propio documento (mismo flujo que un firmante externo) |
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

## Correo (Resend)

Sin proveedor de correo el portal no funciona: el firmante externo nunca recibe
ni el enlace ni el código de un solo uso.

| Correo | Cuándo | Si falla |
|--------|--------|----------|
| Invitación a firmar | Al enviar el sobre, y al llegar el turno en modo secuencial | Se registra; el emisor todavía tiene el enlace en la respuesta |
| Código de un solo uso | Al pedirlo desde el portal | **Se propaga al usuario**: está esperándolo en pantalla |
| Firma registrada | Cada vez que una parte firma | Se registra y se sigue |
| Documento completado | Al cerrarse el sobre, al emisor y a cada firmante | Se registra y se sigue |

El dominio de `MAIL_FROM` debe estar **verificado en Resend**. Sin verificar,
Resend solo permite enviar desde `onboarding@resend.dev` y solo a la dirección
de la propia cuenta.

Sin `RESEND_API_KEY` el servicio cae a un transporte de registro que escribe el
correo completo —código incluido— en el log del servidor. Es lo práctico en
desarrollo, y el arranque lo advierte.

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
2. El frontend analiza el documento y localiza los renglones de firma
3. El emisor define firmantes y campos → `POST /envelopes`
4. `POST /envelopes/:id/send` emite un enlace único por firmante
5. Cada firmante abre su enlace, pide un código al correo y lo canjea por una
   sesión corta
6. `POST /sign/session/submit` envía el método elegido, la marca de firma, el
   consentimiento y el RUT: el servidor valida, resuelve las coordenadas y
   estampa
7. Al firmar el último se añade la hoja de certificación, se asigna el código de
   verificación y se calcula el hash final
8. Cualquiera puede verificar en `/verify/:code`: firmantes, método de cada
   firma, nivel alcanzado, RUT enmascarado y SHA-256

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

## Autofirma

Cuando el emisor firma su propio documento, `POST /documents/:id/self-sign` crea
un sobre de un solo firmante y lo tramita por el **mismo** flujo que una firma
externa: consentimiento expreso, método, RUT, nivel legal, cadena de versiones,
hoja de certificación y colocación detectada. No emite enlace ni manda correo,
porque el firmante está autenticado y es quien hace la petición.

Antes tenía su propio camino, que se saltaba todo eso y producía la firma más
débil del sistema con el mismo aspecto que las demás — justo la que la
contraparte impugna. Tener dos caminos hacia el mismo resultado es exactamente
cómo divergieron.

## Dónde se coloca la firma

El análisis del documento ocurre en el **navegador**, que es donde pdf.js tiene
la capa de texto resuelta, y viaja al servidor como coordenadas normalizadas.
El servidor no se fía de ellas: descarta las que apunten a páginas inexistentes
o se salgan de la página antes de estampar nada.

El motor de colocación (`frontend/src/features/signatures/services/signaturePlacement.ts`)
sigue cuatro reglas, en este orden:

1. **La firma se apoya en su renglón.** Es el sitio que el documento reservó.
2. **Si no cabe entera, encoge antes que moverse.** Una firma más pequeña sigue
   siendo legible y sigue donde toca; una desplazada, no.
3. **Nunca sobresale del ancho del renglón.** En un contrato a dos columnas,
   sobresalir significa invadir la firma de la otra parte.
4. **Si ni el tamaño mínimo cabe**, se coloca igualmente y se declara `tight`.
   La interfaz lo marca en vez de fingir que el resultado es bueno, y esas zonas
   no se envían: se cae al respaldo del servidor.

El renglón de firma es una **guía, no un obstáculo**. Tratarlo como obstáculo
era el defecto que motivó esta revisión: empujaba la firma 27 pt por encima de
su propia raya.

Cuando el documento no se puede analizar —un escaneo sin capa de texto— el
servidor usa una posición fija al pie. Es a ciegas y puede tapar contenido, así
que el diálogo de envío lo advierte antes de enviar.

## Métodos de firma

El firmante elige cómo produce su marca, dentro de lo que el tipo de documento
permite:

| Método | Qué hace | Nivel máximo |
|--------|----------|--------------|
| `draw` | Traza su firma en el lienzo | FES+ |
| `upload` | Adjunta un PNG de su firma manuscrita | FES+ |
| `type` | Escribe su nombre y elige un estilo tipográfico | FES |
| `click` | Acepta expresamente; se estampa su nombre | FES |
| `certificate` | Firma con certificado de un prestador acreditado | FEA *(no implementado)* |

El servidor valida el método contra `envelope_signers.allowed_methods`, exige el
consentimiento expreso y, si el documento lo pide, un RUT con dígito verificador
válido. Solo entonces estampa: un PDF firmado con una firma que no cumple hay
que invalidarlo a mano.

## Niveles de firma y marco legal

La Ley 19.799 reconoce dos categorías: firma **simple** (art. 2 f) y firma
**avanzada** (art. 2 g). El art. 5 deja la carga de la prueba en quien invoca un
documento firmado con firma simple, y ahí está la diferencia práctica:

| Nivel | Qué es | Disponible |
|-------|--------|-----------|
| `fes` | Firma electrónica simple | Sí |
| `fes_verificada` | Firma simple con identidad comprobada en el acto: código al correo o sesión autenticada, RUT declarado y grafismo propio del firmante. **No es una categoría legal**, es firma simple con mejor prueba | Sí |
| `fea` | Firma electrónica avanzada, con certificado de prestador acreditado | No |
| `notarial` | Requiere ministro de fe (finiquito, pagaré, compraventa de inmueble) | No |
| `no_electronica` | Excluido por el art. 3 inciso 2 (actos de familia, testamento) | No |

El nivel se **calcula al firmar** a partir de la evidencia real; nunca se acepta
el que declare el cliente. El catálogo de tipos de documento
(`src/modules/legal/document-types.catalog.ts`) decide el mínimo exigible: el
emisor puede subirlo, nunca bajarlo. Un sobre de un tipo que la ley no deja
cerrar electrónicamente se rechaza al crearse, no al firmarse.

> El catálogo es orientación, no asesoría legal, y así lo declara la API.

## Alcance de la firma

Esto es **firma electrónica simple con evidencia auditable**: imagen o marca de
firma, identificación por enlace más código al correo o sesión autenticada,
consentimiento expreso con su hash, RUT validado, registro de IP y hora, y hash
del documento en cada paso. No es PAdES: no hay certificado digital ni firma
criptográfica embebida en el PDF, y por tanto no hay FEA.

## Producción

```bash
npm run build
npm run start:prod
```

Configura `CORS_ORIGINS` con `https://sign.synchrodev.cl` y despliega en Vercel, Railway, Render, Fly.io, etc.

## Roadmap

- [x] Envío real de correos vía Resend
- [ ] `@pdf-lib/fontkit` para nombres fuera de WinAnsi (hoy se sustituyen) y
      para una tipografía caligráfica real en la firma escrita
- [ ] Firma electrónica avanzada: integrar un prestador acreditado y emitir
      PAdES con sello de tiempo (RFC 3161)
- [ ] Caducidad automática de sobres (`expires_at` se guarda pero no hay cron)
- [ ] Detección de campos de fecha y RUT en el documento (hoy solo se localizan
      los renglones de firma; la fecha va en la hoja de certificación)
- [ ] Integrar frontend con esta API
- [ ] Tests e2e con Supertest
- [ ] CI/CD con GitHub Actions
