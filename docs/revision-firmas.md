# Revisión de la firma de documentos

Revisión del camino completo de firma —del envío al PDF certificado— y de lo que
se cambió a raíz de ella. El marco de referencia es la Ley 19.799 de Chile.

---

## Resumen

El backend tenía una arquitectura de firma sólida: estampado en servidor, cadena
de versiones con hash por paso, OTP hasheado, traza de auditoría. **El problema
no era la arquitectura, era que la mitad no estaba conectada y la otra mitad
declaraba cosas que no habían pasado.**

El único flujo que un usuario podía recorrer de punta a punta no capturaba
ninguna firma: estampaba el nombre del perfil en negrita. El portal con código al
correo —implementado, probado y con límites de petición— no lo llamaba nadie
desde la interfaz. Y la hoja de certificación, que es el documento probatorio,
afirmaba para todos los firmantes un método de identificación que en ese flujo no
se usaba.

---

## Hallazgos

### 1. El único flujo real de firma no capturaba ninguna firma · **alta**

`SignPortalPage` pedía iniciar sesión con la cuenta invitada y llamaba a
`submitAccountSignature(token)` **sin cuerpo**. En el servidor,
`signatureBase64` llegaba `undefined` y `instructionsFor` caía en la rama de
texto: se estampaba el nombre del perfil en Helvetica negrita.

El componente `SignaturePad` existía, estaba terminado, y no lo importaba ningún
camino vivo. Un producto de firma electrónica en el que nadie podía firmar.

### 2. El portal con código al correo estaba muerto en el frontend · **alta**

`POST /sign/:token/otp/request`, `/otp/verify` y `/sign/session/*` estaban
implementados con límites estrictos, códigos hasheados, intentos contados y
sesión JWT de vida corta. `grep -r "otp" frontend/src` no devolvía nada.

El efecto práctico: un firmante externo —el caso de uso central— tenía que
crearse una cuenta en la plataforma para firmar, que es exactamente lo que el
diseño del portal quería evitar.

### 3. La hoja de certificación declaraba un método que no ocurrió · **alta**

`certificate.service.ts` imprimía, literal y para todos:

```
Método: enlace único + código de un solo uso al correo
```

En el flujo con cuenta no había código de un solo uso. La hoja de certificación
es la pieza que se presenta cuando alguien impugna la firma: que afirme algo que
no pasó no es un detalle de copia, es un defecto en la prueba.

### 4. La certificación descartaba firmantes en silencio · **media**

```ts
for (const [index, signer] of data.signers.entries()) {
  if (y < MARGIN + 120) break;   // ← se acabó el sitio
```

Con muchas partes, los últimos no aparecían y nada lo indicaba. El test existente
**consagraba el fallo**: esperaba 2 páginas con 12 firmantes, que era justo la
prueba de que ocho se habían perdido.

### 5. Los campos de RUT no estampaban nada · **media**

El tipo `rut` existía en el enum desde la migración 004 y en el editor de campos.
En `instructionsFor` no tenía rama: caía en el `default`, que estampa
`field.value_text`, siempre `null` en un campo nuevo.

Se podía colocar un campo de RUT en el contrato, enviarlo a firma, y el contrato
salía con ese hueco en blanco.

### 6. Las iniciales estampaban la firma completa · **baja**

`case 'initials'` compartía rama con `signature`. En una caja de iniciales al pie
de página, la firma entera queda ilegible.

### 7. No se registraba consentimiento · **alta**

Nada guardaba que el firmante hubiese querido obligarse. La traza de auditoría
probaba que alguien pulsó un botón, no que consintió: es la diferencia entre una
firma y un clic.

### 8. El firmante no tenía identidad · **alta**

En `createAndSendForSignature`:

```ts
fullName: email.split('@')[0]
```

La hoja de certificación de un contrato podía decir «juan.perez». No había RUT en
ninguna parte del modelo, que en Chile es el dato que identifica a una persona.

### 9. No existía la noción de qué exige cada documento · **alta**

Un finiquito, un pagaré y un acuerdo de confidencialidad recorrían el mismo flujo
con la misma firma. Los dos primeros no pueden cerrarse así —el art. 177 del
Código del Trabajo exige ministro de fe; un pagaré sin firma autorizada ante
notario pierde el mérito ejecutivo, que es la única razón para usar un pagaré— y
la plataforma los daba por firmados.

### 10. La verificación pública mostraba un solo firmante · **media**

`useVerificationLookup` hacía `response.signers[0]`. Un contrato de tres partes
se verificaba públicamente como firmado por una.

### 11. La fecha se estampaba en UTC · **media**

`new Date().toISOString().slice(0, 10)`. El servidor corre en UTC: una firma a
las 21:30 en Santiago imprimía la fecha del día siguiente. En un contrato la
fecha no es presentación, determina plazos.

### 12. La suite de tests estaba en rojo antes de empezar · **media**

`signing.service.spec.ts` no compilaba contra la firma actual del servicio y
`documents.service.spec.ts` no resolvía sus dependencias. Dos suites rojas
permanentes son dos suites que nadie mira.

### 15. La autofirma se saltaba absolutamente todo · **alta**

`POST /documents/:id/stamp-sign` —el emisor firmando su propio documento— era un
camino paralelo completo. No pedía consentimiento, no ofrecía método, no
capturaba RUT, no declaraba nivel, no creaba sobre ni cadena de versiones, y
estampaba un bloque de texto en una posición fija al pie sin mirar qué había
ahí. Escribía directo en las columnas de `documents` que la migración 004 ya
había marcado como **legado**.

El resultado: la firma más débil del sistema, con el mismo aspecto que todas las
demás. Y es precisamente la que la contraparte va a impugnar diciendo «eso te lo
generaste tú».

### 16. Los errores de base de datos se perdían en silencio · **media**

`GlobalExceptionFilter` registraba `exception.message` solo para instancias de
`Error`. Los errores de Supabase llegan como **objetos planos**
(`{ code, message, details, hint }`), así que no entraban por ninguna rama: el
cliente recibía un 500 mudo y el log del servidor no decía nada.

Se descubrió al aplicar el trabajo anterior sobre una base sin migrar: el
insert fallaba con `column envelopes.document_type does not exist` y esa frase
—la única que hacía falta para diagnosticarlo— no aparecía en ningún sitio.

### Lo que ya estaba bien

- **Estampado en el servidor.** El endpoint antiguo aceptaba un PDF ya firmado en
  base64 y lo guardaba sin comprobar nada; el flujo de sobres lo corrigió.
- **Cadena de versiones** con hash por paso e índice único `(envelope_id, version)`
  como red ante firmas simultáneas.
- **OTP** hasheado, con caducidad e intentos contados.
- **Storage privado** con URLs firmadas de vida corta.
- **Límites de petición** estrictos en los endpoints abiertos a internet.
- **Auditoría** con hash antes y después de cada firma.
- **README honesto**: declaraba explícitamente que esto no es PAdES.

---

## Lo que se cambió

### Métodos de firma

El firmante elige cómo produce su marca, dentro de lo que el documento permite:

| Método | Qué deja como prueba | Nivel máximo |
|--------|----------------------|--------------|
| **Dibujar** | Un trazo propio, comparable con su firma manuscrita | FES+ |
| **Subir imagen** | Un PNG de su firma; vale como apariencia, no como autoría | FES+ |
| **Escribir** | El nombre compuesto tipográficamente; sin trazo peritable | FES |
| **Aceptar y firmar** | La aceptación registrada, sin grafismo | FES |
| **Certificado (FEA)** | Plena prueba (art. 1702 CC) | *No implementado* |

Cada método se presenta en la interfaz con lo que deja como evidencia, no solo
con su nombre: quien firma merece saber que dibujar y aceptar por clic no son
intercambiables antes de elegir.

La imagen de la firma se guarda además **aparte del PDF**, porque una pericia
caligráfica trabaja sobre el trazo original y no sobre el que quedó escalado
dentro de la caja del campo.

### Niveles de firma

La ley reconoce dos categorías: simple (art. 2 f) y avanzada (art. 2 g). El
art. 5 deja la carga de la prueba en quien invoca una firma simple, y ahí está la
diferencia que importa en la práctica:

| Nivel | Qué es |
|-------|--------|
| `fes` | Firma electrónica simple |
| `fes_verificada` | Firma simple con identidad comprobada en el acto. **No es una categoría legal**: es firma simple con la prueba resuelta |
| `fea` | Avanzada, con certificado de prestador acreditado — *no disponible* |
| `notarial` | Requiere ministro de fe — *no se cierra aquí* |
| `no_electronica` | Excluido por el art. 3 inciso 2 — *no se cierra aquí* |

`fes_verificada` exige las tres piezas juntas: identidad comprobada en el acto
(código al correo o sesión autenticada), RUT declarado y validado, y un grafismo
del propio firmante. Si falta cualquiera, la firma se declara como simple.
Declarar un nivel que la evidencia no sostiene es peor que no declararlo.

El nivel **se calcula al firmar** a partir de la evidencia real. Nunca se acepta
el que declare el cliente.

### Catálogo legal por tipo de documento

Veintidós tipos de documento, cada uno con su nivel mínimo, el recomendado, la
base legal, lo que hay que hacer además de firmar y lo que puede salir mal.
Evita los dos errores caros:

- **Firmar lo que la ley excluye.** Un pagaré, una compraventa de inmueble, un
  testamento o un acto de familia se rechazan **al crear el sobre**, con la
  explicación de qué hacer en su lugar. No al firmarlo, cuando ya se recogieron
  las firmas y hay que repetir el trámite.
- **Usar la firma más débil disponible** en un contrato que habrá que defender.
  Un contrato de trabajo pide RUT y firma verificada; un NDA no.

Los tipos que no se pueden cerrar aquí **siguen apareciendo en el selector**,
marcados. Ocultarlos solo lograría que alguien eligiera «otro» para un pagaré y
creyera que quedó firmado.

> El catálogo es orientación, no asesoría legal, y la API y la interfaz lo
> declaran en cada respuesta.

### Consentimiento expreso

Antes de firmar se muestra la declaración completa —visible, no detrás de un
enlace de «términos»— y hay que aceptarla explícitamente. Se guarda el momento y
el **SHA-256 del texto aceptado**, y el texto se congela en el sobre al crearlo:
el catálogo puede cambiar de redacción, pero la prueba tiene que seguir apuntando
a lo que se aceptó ese día.

Una restricción de base de datos impide que quede una fila `signed` sin método ni
consentimiento, por si mañana aparece un camino nuevo que lo olvide.

### Identidad: RUT

Validado por módulo 11 en el navegador —para no descubrirlo después de dibujar la
firma— y otra vez en el servidor, que es la autoridad. Se estampa en los campos
de tipo `rut`, aparece en la hoja de certificación y se **enmascara** en la
verificación pública: sirve para confirmar un RUT que ya se conoce, no para que
un tercero lo descubra desde el código de verificación.

### Portal de firma reconstruido

El firmante externo entra con un código de un solo uso enviado a su correo, o con
su cuenta si la tiene. Ve qué exige el documento **antes** de pedir el código
—enterarse de que hace falta el RUT después de haberlo pedido es justo cuando la
gente abandona—, elige el método, acepta la declaración y firma. Puede rechazar
indicando el motivo.

El botón de firmar solo se habilita cuando todo está completo, y dice qué falta
cuando no lo está.

### Hoja de certificación

Ahora declara, por firmante: método real de firma, forma de identificación, nivel
alcanzado, RUT, y el momento en que aceptó el consentimiento. Añade el tipo de
documento, el nivel exigido, la base legal y la declaración aceptada. Y **pagina**
en vez de cortar la lista.

### Verificación pública

Muestra todos los firmantes con su método y su nivel. Un verificador que solo ve
«firmado» no puede distinguir un clic de una firma con identidad comprobada, que
es precisamente lo que permite valorar el documento. Los documentos del flujo
antiguo se marcan como tales en vez de inventarles un método.

---

---

## Segunda ronda: correo y colocación de la firma

### Correo (Resend)

El bloqueante de producción está resuelto. Cuatro correos, con una regla que los
distingue: **el que el usuario está esperando en pantalla propaga su fallo; los
avisos, no.**

| Correo | Cuándo | Si falla |
|--------|--------|----------|
| Invitación a firmar | Al enviar el sobre, y al llegar el turno en secuencial | Se registra; el emisor todavía tiene el enlace |
| Código de un solo uso | Al pedirlo desde el portal | **Se propaga al usuario** |
| Firma registrada | Cada vez que una parte firma | Se registra y se sigue |
| Documento completado | Al cerrarse, al emisor **y a cada firmante** | Se registra y se sigue |

El último importa más de lo que parece: el firmante externo no tiene panel donde
mirar, así que sin ese correo nunca sabría que el documento se cerró ni cómo
descargarlo.

En secuencial solo se avisa a quien ya puede firmar. Mandarle el enlace al
tercero de la fila solo consigue que lo abra, vea «todavía no es tu turno» y lo
dé por roto.

Sin clave configurada, el servicio cae a un transporte que escribe el correo
completo en el log. Es lo que hacía antes el código de un solo uso; la
diferencia es que ahora es una decisión explícita y el arranque la advierte.

### El defecto de colocación

El motor de detección empujaba **toda** firma 27 pt por encima de su propio
renglón. La causa:

```ts
function avoidCollision(rect, boxes, Vh) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    const overlap = boxes.reduce((sum, box) => sum + intersectionArea(current, box.rect), 0);
    if (overlap / area <= COLLISION_RATIO) return { rect: current, penalized: false };
    current = clampRect({ ...current, y: current.y - step });
  }
  return { rect, penalized: true };   // ← devuelve el ORIGINAL, no el mejor intento
}
```

Dos fallos en nueve líneas:

- **El renglón de firma contaba como colisión.** La raya `______` es una caja de
  texto, y la firma se coloca justo encima de ella: el solape daba 0,22 contra
  un umbral de 0,15. Así que el caso más fiable que existe —un documento con su
  renglón de firma dibujado— disparaba siempre la evasión.
- **Al rendirse devolvía el rectángulo original**, no el mejor intento. En un
  documento denso la firma acababa sobre el texto, con la confianza penalizada
  0,3, y a menudo descartada por caer bajo el umbral mínimo.

El resultado medido antes del cambio: la firma flotaba a 27 pt de su raya, o
aterrizaba encima del contenido.

### Lo que se cambió

La colocación pasa a un módulo propio, `signaturePlacement.ts`, con cuatro
reglas en orden de prioridad:

1. **La firma se apoya en su renglón.** Es el sitio que el documento reservó.
2. **Si no cabe entera, encoge antes que moverse.** Una firma más pequeña sigue
   siendo legible y sigue donde toca; una desplazada, no.
3. **Nunca sobresale del ancho del renglón.** En un contrato a dos columnas,
   sobresalir significa invadir la firma de la otra parte.
4. **Si ni el mínimo cabe**, se coloca igualmente y se declara `tight`. La
   interfaz lo marca, y esas zonas no se envían.

El renglón es una **guía**; el renglón *de otra parte* sí es obstáculo. Se añade
una pasada final que separa sellos vecinos encogiéndolos por igual, porque
moverlos los despegaría de su renglón.

Medido después, sobre el mismo contrato: sello apoyado exactamente en la raya,
del ancho exacto de la raya, solape 0,000 y encaje `ideal`.

### El detector no estaba en el camino real

El hallazgo de fondo: el análisis solo corría en `EnvelopePreparePage`, que
escribe en IndexedDB y no llega al backend. **El flujo que la gente usa** —el
diálogo «Enviar para firma»— nunca lo invocaba: el servidor colocaba la firma en
fracciones fijas (`x: 0.08, y: 0.82`), a ciegas, sin saber qué había ahí.

Arreglar el motor sin esto no habría cambiado nada para el usuario.

Ahora el diálogo analiza el documento mientras se rellena el formulario, dice
qué encontró, y manda las coordenadas. El servidor las **valida** —página
inexistente o caja fuera de límites se descartan— y solo cae a la posición ciega
cuando no hay nada usable: un escaneo sin capa de texto, o zonas que no cubren a
todas las partes. Ese caso se advierte en el diálogo antes de enviar, en vez de
descubrirse con el documento ya firmado.

---

## Lo que sigue pendiente

### Declarado, no resuelto

- **Firma electrónica avanzada.** Requiere contrato con un prestador acreditado
  ante la Entidad Acreditadora y emitir PAdES. Sin ella, los documentos que
  exigen FEA —tributarios electrónicos, instrumentos públicos, constitución de
  sociedades— se rechazan con la explicación de dónde tramitarlos.
- **Sello de tiempo (RFC 3161).** Las horas son del reloj del servidor, es decir,
  autodeclaradas.
- **Tipografía caligráfica.** La firma escrita usa las fuentes estándar del PDF
  (cursiva de Times, oblicua de Helvetica, Courier). Una caligráfica real exige
  `@pdf-lib/fontkit` y traer el binario de la fuente al repositorio.
- **Caducidad de sobres.** `expires_at` se guarda y nada lo vigila.
- **Campos de fecha y RUT en el documento.** El detector solo localiza renglones
  de firma. La fecha y el RUT van en la hoja de certificación, no estampados
  junto a la firma, porque colocarlos a ciegas es justo lo que tapa contenido.

### Deuda que la revisión dejó a la vista

- `EnvelopePreparePage` —el editor visual de campos y firmantes— sigue escribiendo
  en IndexedDB a través del `envelopeService` local, no contra la API. Es el único
  sitio donde se pueden colocar campos a mano, y no llega al backend.
- `POST /documents/:id/sign` sigue aceptando un PDF arbitrario en base64. Está
  marcado como obsoleto en el README, pero sigue montado.

---

## Tercera ronda: la autofirma

El emisor firmando su propio documento tenía **su propio camino**, y ese camino
se saltaba todo lo que las dos rondas anteriores habían construido: sin
consentimiento, sin método, sin RUT, sin nivel declarado, sin cadena de
versiones, y con la firma estampada a ciegas al pie de la última página.

La corrección no fue duplicar las comprobaciones en el segundo camino, sino
**eliminar el segundo camino**. `POST /documents/:id/self-sign` crea un sobre de
un solo firmante y lo tramita por `SigningService.submitSignature`, el mismo que
usa un firmante externo. No emite enlace ni manda correo —el firmante está
autenticado y es quien hace la petición— y todo lo demás es idéntico.

El estampador a ciegas (`DocumentStampService`) se eliminó. Dejar por ahí una
pieza que coloca firmas sin mirar el contenido es invitar a que alguien la
vuelva a usar.

> Que la firma propia y la ajena compartan flujo no es elegancia: es que tener
> dos caminos hacia el mismo resultado es exactamente cómo divergieron.

### El esquema y el 500 mudo

Aplicar todo esto sobre la base de datos reveló dos cosas más:

- **La restricción de evidencia no podía validar el pasado.** Las cuatro firmas
  anteriores a esta revisión no tienen método ni consentimiento registrados. La
  restricción se añadió `NOT VALID`: rige para todo lo nuevo y deja el pasado
  como está. Rellenar esas filas con un valor por defecto habría sido **inventar
  cómo firmó una persona real**; la verificación pública las marca como
  heredadas, que es lo honesto.
- **La vista de verificación hubo que recrearla.** `CREATE OR REPLACE VIEW` no
  admite insertar columnas en medio de las existentes.

---

## Cómo verificarlo

```bash
cd backend  && npm test   # 193 pruebas
cd frontend && npm test   # 144 pruebas
```

La migración `012_signature_methods.sql` debe aplicarse en el editor SQL de
Supabase antes de desplegar.
