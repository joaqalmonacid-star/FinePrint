# FinePrint

Web pública del piloto: diagnóstico de exposición, avisos de filtración y alias por tienda.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Landing. Mide la aceptación de términos y el precio A/B, y lleva al registro. |
| `registro.html` | Formulario de contacto de la reserva. |
| `api/registro.js` | Función serverless que guarda el contacto en Brevo y envía los dos correos. |
| `wrangler.toml` | Configuración para desplegar esa función en Cloudflare Workers. |

## Flujo

1. En `index.html` el botón **Reservar cupo** aparece en el encabezado, en el hero, en la sección de reserva y en una barra fija abajo.
2. Al hacer clic se abre `registro.html` con `?precio=a|b&sin_leer=...&origen=...`, para no perder las mediciones del experimento.
3. El registro valida correo, rango de edad, incidente previo y consentimiento.
4. La función `api/registro.js`:
   - crea o actualiza el contacto en Brevo;
   - envía a la persona un correo de confirmación y agradecimiento;
   - envía al equipo un correo con todos sus datos (incluidos variante, precio y `sin_leer`).

## Lo que necesito configurar (fuera del repositorio)

La API key de Brevo **nunca va en el HTML ni en este repo**: el código es público, cualquiera podría usarla para enviar correos. Se guarda como secreto en la plataforma donde se despliegue la función.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `BREVO_API_KEY` | sí | Autenticación con la API de Brevo. |
| `BREVO_SENDER_EMAIL` | sí | Remitente verificado en Brevo. |
| `NOTIFY_EMAIL` | sí | Correo del equipo que recibe los datos de cada reserva. |
| `BREVO_LIST_ID` | sí | ID de la lista de Brevo. Brevo exige que el destinatario sea contacto de una lista para poder enviarle el correo transaccional. |
| `BREVO_SENDER_NAME` | no | Nombre del remitente (por defecto `FinePrint`). |
| `BREVO_CUSTOM_ATTRS` | no | Poner `1` para guardar edad, incidente, variante, precio, `sin_leer` y origen como atributos de contacto. Antes hay que crear esos campos en Brevo. |

## Despliegue

### Opción A: Cloudflare Workers (recomendada, el proyecto ya usa Cloudflare)

```bash
npm install -g wrangler
wrangler login
wrangler secret put BREVO_API_KEY
wrangler secret put BREVO_SENDER_EMAIL
wrangler secret put NOTIFY_EMAIL
wrangler secret put BREVO_LIST_ID
wrangler deploy
```

Después pegar la URL que entrega `wrangler deploy` en `REGISTRO_ENDPOINT`, dentro de `registro.html`:

```js
var REGISTRO_ENDPOINT = "https://fineprint-registro.TU-SUBDOMINIO.workers.dev";
```

Para probar en local: copiar `.dev.vars.example` a `.dev.vars`, completarlo y correr `wrangler dev`.

### Opción B: Vercel

Conectar este repo a Vercel y cargar las mismas variables en *Project Settings → Environment Variables*. En este caso se puede dejar `REGISTRO_ENDPOINT = ""`, porque la página usa `/api/registro`. El archivo trae `export const config = { runtime: 'edge' }`; para Vercel hay que cambiar el `export default` por la función `handle` directamente (en Cloudflare se usa el objeto con `fetch()`).

Con el esquema actual no hace falta GitHub Pages: el worker sirve también los dos HTML. Si se publicaran en Pages, el formulario seguiría funcionando porque apunta al worker por URL absoluta.

## Estado actual

El worker ya está desplegado y probado en:

`https://fineprint-registro.joaq-almonacid.workers.dev`

Ese worker hace todo junto: `GET /` sirve `index.html`, `GET /registro.html` sirve el formulario y `POST` guarda el registro en Brevo y envía los dos correos. Se verificó un registro real con `{"ok":true}`.

### Publicar en tu URL de Cloudflare

Tu URL es `fineprint.joaq-almonacid.workers.dev`. Desde esta carpeta, con el código actual de GitHub:

```bash
wrangler deploy --name fineprint
```

O cambiar `name = "fineprint-registro"` por `name = "fineprint"` en `wrangler.toml` y correr `wrangler deploy`. Al abrir la URL debe aparecer la web; `/registro.html` debe mostrar el formulario. Si sale un JSON con «Método no permitido», significa que ese worker todavía tiene la versión anterior del código.

No subir `.dev.vars`: contiene la API key. Está ignorado por Git y excluido por `.workersignore` / `.pagesignore`, pero conviene verificar que tu herramienta de deploy no lo incluya.

Si rotas la key en Brevo, actualizar el secreto sin tocar el código:

```bash
wrangler secret put BREVO_API_KEY --name fineprint-registro
```

## Antes de publicar

1. Verificar el remitente en Brevo (*Senders & Domains*).
2. Crear una lista de contactos y anotar su ID.
3. Probar un registro real y revisar que lleguen los dos correos.
4. Si `BREVO_CUSTOM_ATTRS=1`, crear primero en Brevo los campos `EDAD`, `INCIDENTE`, `VARIANTE`, `PRECIO`, `SIN_LEER`, `ORIGEN`.
5. Revisar que los correos no caigan en spam.

## Diagnóstico de demostración

La sección «Tu correo ya aceptó muchos de estos» acepta cualquier correo y muestra un expediente con **datos falsos**, generado en el navegador. El correo no se envía a ningún servicio ni se guarda. Al revisarlo aparece el aviso «Otra trampa aceptada», que continúa la dinámica de aceptar los términos sin leerlos. El diagnóstico real llega con el piloto.