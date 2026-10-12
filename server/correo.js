import nodemailer from 'nodemailer';
import { config } from './config.js';

// Dos formas de enviar: la API de Brevo por HTTPS (funciona en hostings que bloquean los puertos
// de correo, como el plan gratuito de Render) o un servidor SMTP cualquiera.
const c = config.correo;
const metodo = c.claveBrevo && c.remitente ? 'brevo' : c.smtpHost && c.remitente ? 'smtp' : null;

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

/** Envía un correo de texto, con adjuntos opcionales [{ nombre, buffer }]. */
export async function enviarCorreo({ para, asunto, texto, adjuntos = [] }) {
  if (!metodo) throw new Error('El envío de correo no está configurado');
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
