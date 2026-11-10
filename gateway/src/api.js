import { requireAuth } from './auth.js';
import { generarAlertas } from './calidad.js';
import { obtenerLecturas, obtenerTanques, obtenerUltimaLectura } from './lecturasRepository.js';
import { estadoIA, generarReporte, responderPregunta } from './ia.js';
import { obtenerLecturasDemo, obtenerTanquesDemo, obtenerUltimaLecturaDemo } from './simulador.js';

const modoDemo = () => process.env.DEMO_MODE === 'true';

async function leerLecturas(opciones) {
    return modoDemo() ? obtenerLecturasDemo(opciones) : obtenerLecturas(opciones);
}

async function leerTanques() {
    return modoDemo() ? obtenerTanquesDemo() : obtenerTanques();
}

async function leerUltimaLectura(nodoId) {
    return modoDemo() ? obtenerUltimaLecturaDemo(nodoId) : obtenerUltimaLectura(nodoId);
}

// Entrega a la IA una ventana de registros para simular una consulta a la base de datos.
async function leerContextoIA(nodoId) {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const lecturas = await leerLecturas({ nodoId, desde, limite: 500 });
    return { lecturas };
}

export async function apiRoutes(fastify) {
    fastify.get('/api/health', async () => ({
        status: 'ok',
        servicio: 'waterQualitySensors gateway',
        modo: modoDemo() ? 'simulacion' : 'real',
        ia: estadoIA(),
        fecha: new Date().toISOString()
    }));

    fastify.get('/api/tanques', { preHandler: requireAuth }, async () => {
        return leerTanques();
    });

    fastify.get('/api/lecturas', { preHandler: requireAuth }, async (request) => {
        const { nodoId, desde, hasta } = request.query || {};
        return leerLecturas({ nodoId, desde, hasta });
    });

    fastify.get('/api/alertas', { preHandler: requireAuth }, async () => {
        const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const lecturas = await leerLecturas({ desde, limite: 5000 });
        return generarAlertas(lecturas, 50);
    });

    fastify.get('/api/ia/reporte', { preHandler: requireAuth }, async (request) => {
        const nodoId = request.query?.nodoId;
        const [lectura, contexto] = await Promise.all([
            leerUltimaLectura(nodoId),
            leerContextoIA(nodoId)
        ]);
        return generarReporte(lectura, contexto);
    });

    fastify.post('/api/ia/chat', { preHandler: requireAuth }, async (request, reply) => {
        const { nodoId, pregunta } = request.body || {};

        if (typeof pregunta !== 'string' || !pregunta.trim()) {
            return reply.code(400).send({ status: 'error', message: 'La pregunta es obligatoria.' });
        }
        if (pregunta.length > 300) {
            return reply.code(400).send({ status: 'error', message: 'La pregunta no puede superar los 300 caracteres.' });
        }

        const [lectura, contexto] = await Promise.all([
            leerUltimaLectura(nodoId),
            leerContextoIA(nodoId)
        ]);
        return { respuesta: await responderPregunta(lectura, pregunta.trim(), contexto) };
    });
}
