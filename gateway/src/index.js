import './env.js';
import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';

import { conectMongoDB, cerrarMongoDB } from './db.js';
import { connectMqtt, cerrarMqtt } from './mqtt.js';
import { authRoutes, prepararIndices } from './auth.js';
import { apiRoutes } from './api.js';
import { ttnSensorRoutes } from './ttnSensor.js';

const directorio = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });
await app.register(fastifyStatic, {
    root: path.join(directorio, '..', '..', 'frontend'),
    prefix: '/'
});

await app.register(authRoutes);
await app.register(apiRoutes);
await app.register(ttnSensorRoutes);

app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ status: 'error', message: 'Ruta no encontrada' });
    }
    return reply.code(404).send({ status: 'error', message: 'Archivo no encontrado' });
});

const start = async () => {
    try {
        await conectMongoDB();
        await prepararIndices();
        await connectMqtt();

        await app.listen({
            port: Number(process.env.PORT) || 4000,
            host: '0.0.0.0'
        });

        app.log.info(`Frontend disponible en http://localhost:${Number(process.env.PORT) || 4000}`);
        console.log(app.printRoutes());
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
};

const cerrar = async () => {
    await app.close();
    await cerrarMqtt();
    await cerrarMongoDB();
    process.exit(0);
};

process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

start();
