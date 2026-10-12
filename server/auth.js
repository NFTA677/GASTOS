import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { Usuario, Libro } from './models.js';
import { ErrorHttp, texto } from './errores.js';

const COOKIE = 'sesion';
const DURACION_MS = 30 * 24 * 60 * 60 * 1000;

function iniciarSesion(res, usuario) {
  const token = jwt.sign({ id: usuario.id }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.produccion,
    maxAge: DURACION_MS,
  });
}

const publico = (u) => ({ id: u.id, nombre: u.nombre, email: u.email });

export function requiereSesion(req, res, next) {
  try {
    const datos = jwt.verify(req.cookies[COOKIE] ?? '', config.jwtSecret);
    req.usuario = { id: datos.id };
    next();
  } catch {
    res.status(401).json({ error: 'Inicia sesión para continuar' });
  }
}

const limite = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' },
});

export const rutasAuth = Router();

rutasAuth.post('/registro', limite, async (req, res) => {
  const nombre = texto(req.body.nombre, 'el nombre', 60);
  const email = texto(req.body.email, 'el correo').toLowerCase();
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorHttp(400, 'El correo no es válido');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new ErrorHttp(400, 'La contraseña debe tener entre 8 y 72 caracteres');
  }
  if (await Usuario.exists({ email })) throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo');

  const usuario = await Usuario.create({ nombre, email, passwordHash: await bcrypt.hash(password, 11) });
  await Libro.create({ nombre: 'Personal', propietario: usuario._id });

  iniciarSesion(res, usuario);
  res.status(201).json({ usuario: publico(usuario) });
});

rutasAuth.post('/login', limite, async (req, res) => {
  const email = texto(req.body.email, 'el correo').toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const usuario = await Usuario.findOne({ email });
  if (!usuario || !(await bcrypt.compare(password, usuario.passwordHash))) {
    throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
  }
  iniciarSesion(res, usuario);
  res.json({ usuario: publico(usuario) });
});

rutasAuth.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});

rutasAuth.get('/yo', requiereSesion, async (req, res) => {
  const usuario = await Usuario.findById(req.usuario.id);
  if (!usuario) {
    res.clearCookie(COOKIE);
    throw new ErrorHttp(401, 'Inicia sesión para continuar');
  }
  res.json({ usuario: publico(usuario) });
});
