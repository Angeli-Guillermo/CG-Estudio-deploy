/**
 * Recibe las consultas del formulario de contacto (#contacto en index.html)
 * y las manda por email vía Resend.
 *
 * Reemplaza a Netlify Forms: ese mecanismo dependía de que Netlify sirviera
 * el sitio y parseara un <form> estático — desde la migración a Vercel, el
 * POST a "/" que hacía el JS devolvía 405 siempre, así que el 100% de las
 * consultas del sitio se perdían (el usuario veía el error y tenía que
 * escribir por WhatsApp/mail a mano). Ver auditoría 06-sep-2026.
 *
 * cgestudioasociados.com.ar todavía no está verificado como dominio propio en
 * Resend (límite de dominios del plan) — se manda desde el dominio ya
 * verificado de El Tano Design, con reply-to a quien completó el formulario.
 * El sitio ya acredita "Diseñado por El Tano Design" en el footer.
 *
 * Función serverless "plana" (sin @vercel/node) — Vercel detecta cualquier
 * archivo bajo /api como función Node y parsea el body JSON solo si el
 * Content-Type es application/json, que es lo que manda el front.
 */

export const config = { runtime: 'edge' };

interface LeadRequestBody {
  nombre?: unknown;
  email?: unknown;
  telefono?: unknown;
  area?: unknown;
  mensaje?: unknown;
  consentimiento?: unknown;
  botField?: unknown;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.LEADS_NOTIFY_EMAIL;
  if (!apiKey || !notifyEmail) {
    console.error('[api/leads] Falta RESEND_API_KEY o LEADS_NOTIFY_EMAIL en las env vars de Vercel');
    return new Response(JSON.stringify({ error: 'Servidor no configurado' }), { status: 500 });
  }

  let body: LeadRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 });
  }

  // Honeypot: si el campo trampa viene completo, es un bot. Respondemos 200
  // igual (para no darle información al bot) pero no mandamos el mail.
  if (asString(body.botField)) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const nombre = asString(body.nombre);
  const email = asString(body.email);
  const telefono = asString(body.telefono);
  const area = asString(body.area);
  const mensaje = asString(body.mensaje);
  const consentimiento = body.consentimiento === true || body.consentimiento === 'si';

  if (!nombre || !email || !mensaje || !consentimiento) {
    return new Response(JSON.stringify({ error: 'Faltan campos obligatorios' }), { status: 400 });
  }

  const html = `
    <h2>Nueva consulta — CG Estudio Asociados</h2>
    <p><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    ${telefono ? `<p><strong>Teléfono:</strong> ${escapeHtml(telefono)}</p>` : ''}
    ${area ? `<p><strong>Área de consulta:</strong> ${escapeHtml(area)}</p>` : ''}
    <p><strong>Mensaje:</strong><br>${escapeHtml(mensaje).replace(/\n/g, '<br>')}</p>
    <hr />
    <p style="color:#888;font-size:12px">Enviado desde cgestudioasociados.com.ar el ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</p>
  `;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'CG Estudio Asociados <notificaciones@eltanodesign.com.ar>',
      to: [notifyEmail],
      reply_to: email,
      subject: `Nueva consulta: ${area || 'Sin área'} — ${nombre}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text().catch(() => '');
    console.error('[api/leads] Resend devolvió error:', resendRes.status, errText);
    return new Response(JSON.stringify({ error: 'No se pudo enviar el email' }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
