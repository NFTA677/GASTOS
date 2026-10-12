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

async function esAdmin(usuario) {
  if (config.adminEmails.length) return config.adminEmails.includes(usuario.email);
  const primero = await Usuario.findOne().sort({ createdAt: 1 }).select('_id');
  return Boolean(primero?._id.equals(usuario._id));
}

const publico = async (u) => ({ id: u.id, nombre: u.nombre, email: u.email, esAdmin: await esAdmin(u) });

export async function requiereAdmin(req, res, next) {
  const usuario = await Usuario.findById(req.usuario.id);
  if (!usuario || !(await esAdmin(usuario))) throw new ErrorHttp(403, 'Solo el administrador puede ver esto');
  next();
}

export async function requiereSesion(req, res, next) {
  let id;
  try {
    id = jwt.verify(req.cookies[COOKIE] ?? '', config.jwtSecret).id;
  } catch {
    // Sin cookie o con una caducada o manipulada.
  }
  // Se comprueba que la cuenta siga existiendo: así una cuenta eliminada pierde el acceso al momento.
  if (!id || !(await Usuario.exists({ _id: id }))) {
    return res.status(401).json({ error: 'Inicia sesión para continuar' });
  }
  req.usuario = { id };
  next();
}

// Alta de una cuenta con su libro «Personal»; la usan el registro y el administrador.
export async function crearUsuario(cuerpo) {
  const nombre = texto(cuerpo.nombre, 'el nombre', 60);
  const email = texto(cuerpo.email, 'el correo').toLowerCase();
  const password = cuerpo.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorHttp(400, 'El correo no es válido');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new ErrorHttp(400, 'La contraseña debe tener entre 8 y 72 caracteres');
  }
  if (await Usuario.exists({ email })) throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo');

  const usuario = await Usuario.create({ nombre, email, passwordHash: await bcrypt.hash(password, 11) });
  await Libro.create({ nombre: 'Personal', propietario: usuario._id });
  return usuario;
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
  const usuario = await crearUsuario(req.body);
  iniciarSesion(res, usuario);
  res.status(201).json({ usuario: await publico(usuario) });
});

rutasAuth.post('/login', limite, async (req, res) => {
  const email = texto(req.body.email, 'el correo').toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const usuario = await Usuario.findOne({ email });
  if (!usuario || !(await bcrypt.compare(password, usuario.passwordHash))) {
    throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
  }
  iniciarSesion(res, usuario);
  res.json({ usuario: await publico(usuario) });
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
  res.json({ usuario: await publico(usuario) });
});
