import { requireAuth } from './auth.js';
import { generarAlertas } from './calidad.js';
import { obtenerLecturas, obtenerTanques, obtenerUltimaLectura } from './lecturasRepository.js';
import { generarReporte, responderPregunta } from './ia.js';

export async function apiRoutes(fastify) {
    fastify.get('/api/health', async () => ({
        status: 'ok',
        servicio: 'waterQualitySensors gateway',
        fecha: new Date().toISOString()
    }));

    fastify.get('/api/tanques', { preHandler: requireAuth }, async () => {
        return obtenerTanques();
    });

    fastify.get('/api/lecturas', { preHandler: requireAuth }, async (request) => {
        const { nodoId, desde, hasta } = request.query || {};
        return obtenerLecturas({ nodoId, desde, hasta });
    });

    fastify.get('/api/alertas', { preHandler: requireAuth }, async () => {
        const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const lecturas = await obtenerLecturas({ desde, limite: 5000 });
        return generarAlertas(lecturas, 50);
    });

    fastify.get('/api/ia/reporte', { preHandler: requireAuth }, async (request) => {
        const lectura = await obtenerUltimaLectura(request.query?.nodoId);
        return generarReporte(lectura);
    });

    fastify.post('/api/ia/chat', { preHandler: requireAuth }, async (request, reply) => {
        const { nodoId, pregunta } = request.body || {};

        if (typeof pregunta !== 'string' || !pregunta.trim()) {
            return reply.code(400).send({ status: 'error', message: 'La pregunta es obligatoria.' });
        }
        if (pregunta.length > 300) {
            return reply.code(400).send({ status: 'error', message: 'La pregunta no puede superar los 300 caracteres.' });
        }

        const lectura = await obtenerUltimaLectura(nodoId);
        return { respuesta: await responderPregunta(lectura, pregunta.trim()) };
    });
}
