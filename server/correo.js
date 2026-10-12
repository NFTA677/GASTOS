import nodemailer from 'nodemailer';
import { config } from './config.js';

// Tres formas de enviar: la API de Cloudflare Email Service o la de Brevo, ambas por HTTPS (funcionan
// en hostings que bloquean los puertos de correo, como el plan gratuito de Render), o un servidor SMTP.
const c = config.correo;
const metodo = !c.remitente ? null
  : c.cuentaCloudflare && c.tokenCloudflare ? 'cloudflare'
  : c.claveBrevo ? 'brevo'
  : c.smtpHost ? 'smtp'
  : null;

// Qué servicio está configurado, para mostrarlo al administrador.
export const metodoCorreo = () => metodo;

export const correoDisponible = () => metodo !== null;

let transporte = null;
function smtp() {
  transporte ??= nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPuerto,
    secure: c.smtpPuerto === 465,
    ...(c.smtpUsuario && { auth: { user: c.smtpUsuario, pass: c.smtpClave } }),
    connectionTimeout: 15000,
    socketTimeout: 30000,
  });
  return transporte;
}

async function porBrevo({ para, asunto, texto, adjuntos }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': c.claveBrevo, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: c.nombreRemitente, email: c.remitente },
      to: [{ email: para }],
      subject: asunto,
      textContent: texto,
      ...(adjuntos.length && { attachment: adjuntos.map((a) => ({ name: a.nombre, content: a.buffer.toString('base64') })) }),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null))?.message ?? '';
    throw new Error(`Brevo respondió ${res.status}${detalle ? `: ${detalle}` : ''}`);
  }
}

// Cloudflare Email Service: POST /accounts/{cuenta}/email/sending/send con un token de API.
// El remitente debe ser de un dominio dado de alta en «Envío de email».
async function porCloudflare({ para, asunto, texto, adjuntos }) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(c.cuentaCloudflare)}/email/sending/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.tokenCloudflare}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: para,
      from: c.remitente,
      subject: asunto,
      text: texto,
      ...(adjuntos.length && {
        attachments: adjuntos.map((a) => ({ content: a.buffer.toString('base64'), filename: a.nombre, type: 'application/pdf', disposition: 'attachment' })),
      }),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok || cuerpo?.success === false) {
    const detalle = cuerpo?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? '';
    throw new Error(`Cloudflare respondió ${res.status}${detalle ? `: ${detalle}` : ''}`);
  }
  // La API puede aceptar la petición y aun así rebotar al destinatario.
  if (cuerpo?.result?.permanent_bounces?.length) throw new Error(`Cloudflare no pudo entregar a ${cuerpo.result.permanent_bounces.join(', ')}`);
}

/** Envía un correo de texto, con adjuntos opcionales [{ nombre, buffer }]. */
export async function enviarCorreo({ para, asunto, texto, adjuntos = [] }) {
  if (!metodo) throw new Error('El envío de correo no está configurado');
  if (metodo === 'cloudflare') return porCloudflare({ para, asunto, texto, adjuntos });
  if (metodo === 'brevo') return porBrevo({ para, asunto, texto, adjuntos });
  await smtp().sendMail({
    from: { name: c.nombreRemitente, address: c.remitente },
    to: para,
    subject: asunto,
    text: texto,
    attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.buffer })),
  });
}

// El texto de WhatsApp usa *negrita*; en un correo de texto plano esos asteriscos sobran.
export const sinFormatoWhatsapp = (texto) => texto.replace(/\*(.+?)\*/g, '$1');
