import './env.js';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ObjectId } from 'mongodb';
import { getDb } from './db.js';

const scrypt = promisify(scryptCallback);
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET || TOKEN_SECRET.length < 32) {
    throw new Error('TOKEN_SECRET debe estar configurado y tener al menos 32 caracteres en gateway/.env');
}
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

// El correo definido en ADMIN_EMAIL siempre tiene rol administrador.
export function rolDe(usuario) {
    if (!usuario) return 'comunero';
    if (ADMIN_EMAIL && String(usuario.email || '').toLowerCase() === ADMIN_EMAIL) return 'admin';
    return usuario.rol === 'admin' ? 'admin' : 'comunero';
}

// MongoDB guarda _id como ObjectId; en modo demo son cadenas de texto.
export function filtroIdDocumento(id) {
    return /^[0-9a-f]{24}$/i.test(String(id)) ? { _id: new ObjectId(String(id)) } : { _id: String(id) };
}

const correoValido = (correo) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
const usuarioValido = (usuario) => /^[a-zA-Z0-9]{1,50}$/.test(usuario);
const telefonoValido = (telefono) => /^\d{10,15}$/.test(telefono);
const claveValida = (clave) => clave.length >= 8 && clave.length <= 12 && /[A-Z]/.test(clave) && /\d/.test(clave) && /[^A-Za-z0-9]/.test(clave);

function firmar(texto) {
    return createHmac('sha256', TOKEN_SECRET).update(texto).digest('base64url');
}

export function firmarToken(usuario) {
    const payload = Buffer.from(JSON.stringify({
        sub: String(usuario._id),
        nombre: usuario.nombre,
        email: usuario.email,
        rol: rolDe(usuario),
        exp: Date.now() + TOKEN_TTL_MS
    })).toString('base64url');

    return `${payload}.${firmar(payload)}`;
}

export function verificarToken(token) {
    if (!token || typeof token !== 'string') return null;

    const [payload, firmaRecibida] = token.split('.');
    if (!payload || !firmaRecibida) return null;

    const firmaEsperada = firmar(payload);
    const recibida = Buffer.from(firmaRecibida);
    const esperada = Buffer.from(firmaEsperada);
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;

    try {
        const datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!datos.exp || datos.exp < Date.now()) return null;
        return datos;
    } catch {
        return null;
    }
}

async function crearHashClave(clave) {
    const salt = randomBytes(16).toString('hex');
    const hash = await scrypt(clave, salt, 64);
    return { salt, hash: Buffer.from(hash).toString('hex') };
}

async function verificarClave(clave, salt, hash) {
    const calculado = Buffer.from(await scrypt(clave, salt, 64));
    const guardado = Buffer.from(hash, 'hex');
    return calculado.length === guardado.length && timingSafeEqual(calculado, guardado);
}

function validarRegistro(datos) {
    if (!datos || typeof datos !== 'object') return 'Datos inválidos.';

    for (const campo of ['usuario', 'nombre', 'email', 'telefono', 'vereda', 'password']) {
        if (typeof datos[campo] !== 'string' || !datos[campo].trim()) {
            return 'Todos los campos son obligatorios.';
        }
    }

    const usuario = datos.usuario.trim();
    const correo = datos.email.trim();
    const telefono = datos.telefono.trim();

    if (!usuarioValido(usuario)) return 'El usuario solo admite letras y números (máximo 50).';
    if (!correoValido(correo)) return 'El correo electrónico no es válido.';
    if (!telefonoValido(telefono)) return 'El teléfono debe tener entre 10 y 15 dígitos.';
    if (!claveValida(datos.password)) return 'La contraseña debe tener de 8 a 12 caracteres, con mayúscula, número y símbolo.';

    return null;
}

function usuarioPublico(documento) {
    return {
        id: String(documento._id),
        usuario: documento.usuario,
        nombre: documento.nombre,
        email: documento.email,
        telefono: documento.telefono,
        vereda: documento.vereda,
        rol: rolDe(documento)
    };
}

export async function requireAuth(request, reply) {
    const cabecera = request.headers.authorization || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
    const datos = verificarToken(token);

    if (!datos) {
        return reply.code(401).send({ status: 'error', message: 'Sesión no válida o expirada.' });
    }

    request.usuario = datos;
}

// Solo el administrador puede exportar datos, gestionar reportes y ver el detalle completo.
export async function requireAdmin(request, reply) {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (request.usuario?.rol !== 'admin') {
        return reply.code(403).send({ status: 'error', message: 'Esta función requiere rol de administrador.' });
    }
}

export async function prepararIndices() {
    if (process.env.DEMO_MODE === 'true') return;

    try {
        const db = getDb();
        await db.collection('usuarios').createIndex({ email: 1 }, { unique: true });
        await db.collection('usuarios').createIndex({ usuario: 1 }, { unique: true });
        await db.collection('lecturas').createIndex({ sensorId: 1, recibidoEn: 1 });
        await db.collection('reportes').createIndex({ creadoEn: -1 });
    } catch (error) {
        console.warn('No se pudieron crear los índices de MongoDB:', error.message);
    }
}

export async function authRoutes(fastify) {
    const demoMode = process.env.DEMO_MODE === 'true';
    const usuarios = () => getDb().collection('usuarios');
    const usuariosDemo = new Map();

    if (demoMode) {
        const { salt, hash } = await crearHashClave('Agua2026!');
        const demo = {
            _id: 'demo-user',
            usuario: 'demo',
            nombre: 'Usuario de demostración',
            email: 'demo@watermldetect.com',
            telefono: '3001234567',
            vereda: 'San Pedro',
            passwordSalt: salt,
            passwordHash: hash,
            rol: 'comunero'
        };
        usuariosDemo.set(demo.email, demo);
    }

    fastify.post('/api/auth/registro', async (request, reply) => {
        const error = validarRegistro(request.body);
        if (error) return reply.code(400).send({ status: 'error', message: error });

        const datos = request.body;
        const email = datos.email.trim().toLowerCase();
        const usuario = datos.usuario.trim();

        const existente = demoMode
            ? [...usuariosDemo.values()].find((item) => item.email === email || item.usuario === usuario)
            : await usuarios().findOne({ $or: [{ email }, { usuario }] });
        if (existente) {
            return reply.code(409).send({ status: 'error', message: 'El correo o el usuario ya está registrado.' });
        }

        const { salt, hash } = await crearHashClave(datos.password);
        const documento = {
            usuario,
            nombre: datos.nombre.trim(),
            email,
            telefono: datos.telefono.trim(),
            vereda: datos.vereda.trim(),
            passwordSalt: salt,
            passwordHash: hash,
            rol: 'comunero',
            creadoEn: new Date().toISOString()
        };

        if (demoMode) {
            documento._id = `demo-user-${usuariosDemo.size}`;
            usuariosDemo.set(email, documento);
        } else {
            try {
                const resultado = await usuarios().insertOne(documento);
                documento._id = resultado.insertedId;
            } catch (error) {
                if (error.code === 11000) {
                    return reply.code(409).send({ status: 'error', message: 'El correo o el usuario ya está registrado.' });
                }
                throw error;
            }
        }

        return reply.code(201).send({
            token: firmarToken(documento),
            usuario: usuarioPublico(documento)
        });
    });

    fastify.post('/api/auth/login', async (request, reply) => {
        const { email, password } = request.body || {};
        if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
            return reply.code(400).send({ status: 'error', message: 'Correo y contraseña son obligatorios.' });
        }

        const correo = email.trim().toLowerCase();
        const usuario = demoMode
            ? usuariosDemo.get(correo)
            : await usuarios().findOne({ email: correo });
        if (!usuario) {
            return reply.code(401).send({ status: 'error', message: 'Correo o contraseña incorrectos.' });
        }

        const claveCorrecta = await verificarClave(password, usuario.passwordSalt, usuario.passwordHash);
        if (!claveCorrecta) {
            return reply.code(401).send({ status: 'error', message: 'Correo o contraseña incorrectos.' });
        }

        return {
            token: firmarToken(usuario),
            usuario: usuarioPublico(usuario)
        };
    });

    // Busca el documento completo del usuario autenticado (necesario para editar el perfil).
    const buscarUsuarioPorId = async (id) => {
        if (demoMode) {
            return [...usuariosDemo.values()].find((item) => String(item._id) === String(id)) || null;
        }
        return usuarios().findOne(filtroIdDocumento(id));
    };

    fastify.get('/api/auth/perfil', { preHandler: requireAuth }, async (request, reply) => {
        const documento = await buscarUsuarioPorId(request.usuario.sub);
        if (!documento) return reply.code(404).send({ status: 'error', message: 'Usuario no encontrado.' });
        return { usuario: usuarioPublico(documento) };
    });

    fastify.put('/api/auth/perfil', { preHandler: requireAuth }, async (request, reply) => {
        const { nombre, telefono, vereda, password, passwordActual } = request.body || {};

        for (const [campo, valor, maximo] of [['nombre', nombre, 80], ['telefono', telefono, 15], ['vereda', vereda, 80]]) {
            if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > maximo) {
                return reply.code(400).send({ status: 'error', message: `El campo ${campo} es obligatorio y no puede superar ${maximo} caracteres.` });
            }
        }
        if (!telefonoValido(telefono.trim())) {
            return reply.code(400).send({ status: 'error', message: 'El teléfono debe tener entre 10 y 15 dígitos.' });
        }

        const documento = await buscarUsuarioPorId(request.usuario.sub);
        if (!documento) return reply.code(404).send({ status: 'error', message: 'Usuario no encontrado.' });

        const cambios = {
            nombre: nombre.trim(),
            telefono: telefono.trim(),
            vereda: vereda.trim()
        };

        // El cambio de contraseña es opcional; si se envía, exige la actual y valida la nueva.
        if (password !== undefined && password !== null && password !== '') {
            if (typeof password !== 'string' || !claveValida(password)) {
                return reply.code(400).send({ status: 'error', message: 'La nueva contraseña debe tener de 8 a 12 caracteres, con mayúscula, número y símbolo.' });
            }
            const claveCorrecta = await verificarClave(String(passwordActual || ''), documento.passwordSalt, documento.passwordHash);
            if (!claveCorrecta) {
                return reply.code(403).send({ status: 'error', message: 'La contraseña actual no es correcta.' });
            }
            const { salt, hash } = await crearHashClave(password);
            cambios.passwordSalt = salt;
            cambios.passwordHash = hash;
        }

        if (demoMode) {
            Object.assign(documento, cambios);
        } else {
            await usuarios().updateOne(filtroIdDocumento(request.usuario.sub), { $set: cambios });
            Object.assign(documento, cambios);
        }

        return {
            token: firmarToken(documento),
            usuario: usuarioPublico(documento)
        };
    });
}
