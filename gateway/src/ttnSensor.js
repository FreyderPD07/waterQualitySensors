import { publicarLectura, obtenerUltimaLectura } from './mqtt.js';
import { guardarLectura } from './lecturasRepository.js';

export async function ttnSensorRoutes(fastify) {
    fastify.get('/mapa', async () => {
        const lectura = obtenerUltimaLectura();

        return {
            status: lectura ? 'ok' : 'Sin datos',
            data: lectura
        };
    });

    const sensorSchema = {
        body: {
            type: 'object',
            required: ['sensorid', 'ph', 'temperature', 'turbidez', 'conductividad'],
            properties: {
                sensorid: { type: 'string' },
                ph: { type: 'number', minimum: 0, maximum: 14 },
                temperature: { type: 'number' },
                turbidez: { type: 'number' },
                conductividad: { type: 'number' }
            }
        }
    };

    fastify.post('/registrar', { schema: sensorSchema }, async (request, reply) => {
        if (process.env.DEMO_MODE === 'true') {
            return reply.code(503).send({
                status: 'simulacion',
                message: 'Ruta deshabilitada durante la simulación; no se guardaron datos.'
            });
        }

        const { sensorid, ph, temperature, turbidez, conductividad } = request.body;
        const capturadoEn = new Date().toISOString();
        const datos = { ph, temperature, turbidez, conductividad };

        // Se guarda directamente para que el dato no dependa de que el broker lo devuelva.
        await guardarLectura({
            sensorId: sensorid,
            recibidoEn: capturadoEn,
            datos
        });

        try {
            await publicarLectura(`Calidad-agua/telemetria/${sensorid}`, {
                sensorid,
                ...datos,
                capturadoEn
            });
        } catch (error) {
            fastify.log.warn(`La lectura se guardó, pero no se pudo publicar en MQTT: ${error.message}`);
        }

        fastify.log.info(`Lectura recibida del sensor ${sensorid} y guardada correctamente`);

        return {
            status: 'Procesado_y_guardado',
            data: { sensorid, ...datos, capturadoEn }
        };
    });
}
