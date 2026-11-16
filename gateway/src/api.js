import { requireAuth } from './auth.js';
import { generarAlertas } from './calidad.js';
import { obtenerLecturas, obtenerTanques, obtenerUltimaLectura } from './lecturasRepository.js';
import { obtenerPredicciones, obtenerPrediccionesDemo } from './prediccionesRepository.js';
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

async function leerPredicciones(opciones) {
    return modoDemo() ? obtenerPrediccionesDemo(opciones) : obtenerPredicciones(opciones);
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

    // Estado general público para la página de inicio: no exige sesión ni expone datos para exportar.
    fastify.get('/api/publico/estado', async () => {
        const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const [tanques, lecturas] = await Promise.all([
            leerTanques(),
            leerLecturas({ desde, limite: 5000 })
        ]);

        // Última lectura de cada tanque (las lecturas llegan ordenadas de más antigua a más reciente).
        const ultimaPorNodo = new Map();
        for (const lectura of lecturas) ultimaPorNodo.set(lectura.nodoId, lectura);

        const resumenTanques = tanques.map((tanque) => {
            const ultima = ultimaPorNodo.get(tanque.nodoId) || null;
            return {
                nodoId: tanque.nodoId,
                nombre: tanque.nombre,
                clasificacion: ultima?.clasificacion || 'Sin datos',
                fecha: ultima?.fecha || null,
                ph: ultima?.ph ?? null,
                turbidez: ultima?.turbidez ?? null,
                conductividad: ultima?.conductividad ?? null,
                temperatura: ultima?.temperatura ?? null
            };
        });

        // Tendencia general: promedio por bloques de 6 horas para cada parámetro.
        const variables = ['ph', 'turbidez', 'conductividad', 'temperatura'];
        const tendencia = {};
        for (const variable of variables) {
            const bloques = new Map();
            for (const lectura of lecturas) {
                const valor = Number(lectura[variable]);
                if (!Number.isFinite(valor)) continue;
                const clave = Math.floor(new Date(lectura.fecha).getTime() / (6 * 3600000));
                const bloque = bloques.get(clave) || { total: 0, cantidad: 0 };
                bloque.total += valor;
                bloque.cantidad += 1;
                bloques.set(clave, bloque);
            }
            tendencia[variable] = [...bloques.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([clave, bloque]) => ({
                    t: new Date(clave * 6 * 3600000).toISOString(),
                    v: +(bloque.total / bloque.cantidad).toFixed(2)
                }));
        }

        return {
            tanques: resumenTanques,
            tendencia,
            generadoEn: new Date().toISOString()
        };
    });

    fastify.get('/api/tanques', { preHandler: requireAuth }, async () => {
        return leerTanques();
    });

    fastify.get('/api/lecturas', { preHandler: requireAuth }, async (request) => {
        const { nodoId, desde, hasta, limite } = request.query || {};
        const limiteNumerico = Number(limite);
        return leerLecturas({
            nodoId,
            desde,
            hasta,
            limite: Number.isFinite(limiteNumerico) ? Math.min(Math.max(limiteNumerico, 1), 20000) : undefined
        });
    });

    // Predicciones del modelo Random Forest: colección separada de las lecturas crudas.
    fastify.get('/api/predicciones', { preHandler: requireAuth }, async (request) => {
        const { nodoId, desde, hasta, limite } = request.query || {};
        const limiteNumerico = Number(limite);
        return leerPredicciones({
            nodoId,
            desde,
            hasta,
            limite: Number.isFinite(limiteNumerico) ? Math.min(Math.max(limiteNumerico, 1), 20000) : undefined
        });
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

        // Historial reciente de la conversación para dar continuidad a las respuestas.
        const historial = Array.isArray(request.body?.historial)
            ? request.body.historial
                .filter((item) => item && typeof item.contenido === 'string' && item.contenido.trim())
                .slice(-8)
                .map((item) => ({
                    rol: item.rol === 'ia' ? 'ia' : 'usuario',
                    contenido: item.contenido.trim().slice(0, 500)
                }))
            : [];

        const [lectura, contexto] = await Promise.all([
            leerUltimaLectura(nodoId),
            leerContextoIA(nodoId)
        ]);
        return { respuesta: await responderPregunta(lectura, pregunta.trim(), { ...contexto, historial }) };
    });
}
