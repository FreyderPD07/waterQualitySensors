import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';

import { authRoutes } from '../src/auth.js';
import { apiRoutes } from '../src/api.js';
import { ttnSensorRoutes } from '../src/ttnSensor.js';
import { clasificarLectura, normalizarLectura } from '../src/calidad.js';

let app;

before(async () => {
    app = Fastify();
    await app.register(fastifyCors, { origin: true });
    await app.register(fastifyStatic, {
        root: path.resolve('..', 'frontend'),
        prefix: '/'
    });
    await app.register(authRoutes);
    await app.register(apiRoutes);
    await app.register(ttnSensorRoutes);
    await app.ready();
});

after(async () => {
    await app.close();
});

test('el gateway sirve el frontend y sus archivos', async () => {
    for (const url of ['/', '/dashboard.html', '/app/index.js', '/styles/styles.css']) {
        const respuesta = await app.inject({ method: 'GET', url });
        assert.equal(respuesta.statusCode, 200, `${url} debe estar disponible`);
    }
});

test('la API de salud responde sin MongoDB', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(respuesta.statusCode, 200);
    assert.equal(respuesta.json().status, 'ok');
});

test('los endpoints privados rechazan solicitudes sin token', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/tanques' });
    assert.equal(respuesta.statusCode, 401);
});

test('el login valida que correo y contraseña estén presentes', async () => {
    const respuesta = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    assert.equal(respuesta.statusCode, 400);
});

test('se normaliza la estructura recibida desde TTN al formato del dashboard', () => {
    const lectura = normalizarLectura({
        sensorId: 'nodo-01',
        recibidoEn: '2026-11-05T12:00:00.000Z',
        datos: { ph: 7.2, turbidez: 1.4, conductividad: 420, temperature: 20 }
    });

    assert.equal(lectura.nodoId, 'nodo-01');
    assert.equal(lectura.temperatura, 20);
    assert.equal(lectura.clasificacion, 'Buena');
    assert.equal(clasificarLectura(lectura), 'Buena');
});
