// FinePrint · web estática + registro de reservas -> Brevo
// Un solo worker sirve index.html, registro.html y procesa el formulario.
// La API key NUNCA va en el navegador.

import indexHtml from '../index.html';
import registroHtml from '../registro.html';

export const config = { runtime: 'edge' };

const BREVO_API = 'https://api.brevo.com/v3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fila(label, value) {
  return '<tr><td style="padding:7px 12px;border-bottom:1px solid #E3E8EF;color:#5B6472;font-size:13px;">'
    + esc(label) + '</td><td style="padding:7px 12px;border-bottom:1px solid #E3E8EF;font-size:14px;">'
    + (value ? esc(value) : '—') + '</td></tr>';
}

async function enviar(headers, payload) {
  const r = await fetch(BREVO_API + '/smtp/email', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detalle = (await r.text()).slice(0, 300);
    throw new Error('Brevo rechazó el correo: ' + detalle);
  }
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET' || request.method === 'HEAD') {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const html = path === '/' || path === '/index.html' ? indexHtml
      : path === '/registro' || path === '/registro.html' ? registroHtml : null;
    if (!html) return json({ ok: false, error: 'Página no encontrada' }, 404);
    return new Response(request.method === 'HEAD' ? null : html, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405);

  let d;
  try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'JSON inválido' }, 400); }

  // Honeypot: los bots llenan el campo oculto. Respondemos éxito sin hacer nada.
  if (d.website) return json({ ok: true });

  const correo = String(d.correo || '').trim().toLowerCase();
  const nombre = String(d.nombre || '').trim();
  const telefono = String(d.telefono || '').trim();
  const edad = String(d.edad || '').trim();
  const incidente = String(d.incidente || '').trim();
  const variante = ['a', 'b'].indexOf(d.variante) !== -1 ? d.variante : '';
  const precio = String(d.precio_mostrado || '').slice(0, 20);
  const sinLeer = String(d.acepto_sin_leer || '').slice(0, 40);
  const origen = String(d.origen || '').slice(0, 200);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ ok: false, error: 'Correo inválido' }, 400);
  if (!edad) return json({ ok: false, error: 'Falta el rango de edad' }, 400);
  if (['si', 'no'].indexOf(incidente) === -1) return json({ ok: false, error: 'Falta el incidente' }, 400);
  if (!d.consent) return json({ ok: false, error: 'Falta el consentimiento' }, 400);

  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL;
  const notifyEmail = env.NOTIFY_EMAIL;
  const listId = Number(env.BREVO_LIST_ID);
  if (!apiKey || !senderEmail || !notifyEmail || !listId) {
    return json({ ok: false, error: 'Faltan secretos: BREVO_API_KEY, BREVO_SENDER_EMAIL, NOTIFY_EMAIL o BREVO_LIST_ID' }, 500);
  }

  const senderName = env.BREVO_SENDER_NAME || 'FinePrint';
  const headers = { 'api-key': apiKey, 'Content-Type': 'application/json' };
  const listIds = [listId];

  // 1) Guardar/actualizar contacto en Brevo.
  const attributes = { FNAME: nombre || 'Tu' };
  if (env.BREVO_CUSTOM_ATTRS === '1') {
    attributes.EDAD = edad;
    attributes.INCIDENTE = incidente;
    attributes.VARIANTE = variante;
    attributes.PRECIO = precio;
    attributes.SIN_LEER = sinLeer;
    attributes.ORIGEN = origen;
  }
  const contactRes = await fetch(BREVO_API + '/contacts', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      email: correo,
      attributes: attributes,
      listIds: listIds,
      updateEnabled: true,
    }),
  });
  if (!contactRes.ok) {
    const detalle = (await contactRes.text()).slice(0, 300);
    return json({ ok: false, error: 'No se pudo guardar el contacto en Brevo', detail: detalle }, 502);
  }

  const warnings = [];

  // 2) Correo de confirmación y agradecimiento para la persona.
  const userHtml = ''
    + '<div style="font-family:Arial,sans-serif;color:#101114;max-width:560px;margin:auto;">'
    + '<p style="font-family:Georgia,serif;font-size:24px;font-weight:bold;">FinePrint</p>'
    + '<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:normal;">Tu cupo está reservado.</h1>'
    + '<p>Hola ' + esc(nombre || '') + ',</p>'
    + '<p>Gracias por interesarte en el piloto. Ya dejamos tu cupo separado y te vamos a escribir en los próximos días con los detalles para partir.</p>'
    + '<p>En el piloto verás dónde están tus datos, te avisaremos si aparecen en una filtración nueva y te dejaremos lista la solicitud para pedir su borramiento. No se cobra nada hoy ni durante los 14 días: decides hasta el día 19 y solo se cobra si sigues.</p>'
    + '<p style="font-size:13px;color:#5B6472;">Usamos tu correo solo para este piloto. Si quieres que lo borremos, responde a este mensaje.</p>'
    + '<p style="font-family:Georgia,serif;font-size:20px;">— Equipo FinePrint<br>New Ventures Program, Universidad del Desarrollo</p>'
    + '</div>';
  try {
    await enviar(headers, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: correo, name: nombre || 'Tu' }],
      subject: 'Tu cupo en FinePrint está reservado',
      htmlContent: userHtml,
    });
  } catch (e) {
    warnings.push(e.message);
  }

  // 3) Correo interno con todos los datos del registro.
  const teamHtml = ''
    + '<div style="font-family:Arial,sans-serif;color:#101114;max-width:600px;margin:auto;">'
    + '<h1 style="font-family:Georgia,serif;font-size:26px;font-weight:normal;">Nueva reserva en FinePrint</h1>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + fila('Correo', correo)
    + fila('Nombre', nombre)
    + fila('Teléfono', telefono)
    + fila('Edad', edad)
    + fila('Incidente previo', incidente)
    + fila('Variante A/B', variante)
    + fila('Precio mostrado', precio)
    + fila('Aceptó términos sin leer', sinLeer)
    + fila('Origen', origen)
    + fila('Fecha (UTC)', new Date().toISOString())
    + '</table>'
    + '<p style="font-size:13px;color:#5B6472;margin-top:18px;">Registro enviado desde la página de reserva.</p>'
    + '</div>';
  try {
    await enviar(headers, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: notifyEmail }],
      subject: 'Nueva reserva FinePrint · ' + correo,
      htmlContent: teamHtml,
    });
  } catch (e) {
    warnings.push(e.message);
  }

  return json({
    ok: warnings.length === 0,
    error: warnings.length ? 'El registro se guardó pero falló un correo: ' + warnings.join(' | ') : undefined,
  });
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
