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
    process.env.DEMO_MODE = 'true';
    // Las pruebas no deben depender de internet ni consumir cuota de OpenRouter.
    process.env.OPENROUTER_API_KEY = '';
    process.env.LLM_URL = '';
    app = Fastify();
    await app.register(fastifyCors, { origin: true });
    await app.register(fastifyStatic, {
        root: path.resolve('..', 'frontend'),
        prefix: '/'
    });
    await app.register(fastifyStatic, {
        root: path.resolve('node_modules', 'chart.js', 'dist'),
        prefix: '/vendor/',
        decorateReply: false
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
    for (const url of ['/', '/dashboard.html', '/app/index.js', '/styles/styles.css', '/vendor/chart.umd.js']) {
        const respuesta = await app.inject({ method: 'GET', url });
        assert.equal(respuesta.statusCode, 200, `${url} debe estar disponible`);
    }
});

test('la API de salud responde sin MongoDB', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(respuesta.statusCode, 200);
    assert.equal(respuesta.json().status, 'ok');
    assert.equal(respuesta.json().modo, 'simulacion');
});

test('los endpoints privados rechazan solicitudes sin token', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/tanques' });
    assert.equal(respuesta.statusCode, 401);
});

test('el login valida que correo y contraseña estén presentes', async () => {
    const respuesta = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    assert.equal(respuesta.statusCode, 400);
});

test('la simulación permite iniciar sesión y entregar tanques y lecturas sin MongoDB', async () => {
    const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'demo@watermldetect.com', password: 'Agua2026!' }
    });
    assert.equal(login.statusCode, 200);

    const headers = { authorization: `Bearer ${login.json().token}` };
    const tanques = await app.inject({ method: 'GET', url: '/api/tanques', headers });
    assert.equal(tanques.statusCode, 200);
    assert.equal(tanques.json().length, 2);

    const lecturas = await app.inject({ method: 'GET', url: '/api/lecturas?nodoId=nodo-01', headers });
    assert.equal(lecturas.statusCode, 200);
    assert.ok(lecturas.json().length >= 50);
    assert.ok(lecturas.json().every((lectura) => lectura.nodoId === 'nodo-01'));

    const reporte = await app.inject({ method: 'GET', url: '/api/ia/reporte?nodoId=nodo-01', headers });
    assert.equal(reporte.statusCode, 200);
    assert.ok(Array.isArray(reporte.json().recomendaciones));

    const registroSensor = await app.inject({
        method: 'POST',
        url: '/registrar',
        payload: { sensorid: 'nodo-01', ph: 7, temperature: 20, turbidez: 1, conductividad: 400 }
    });
    assert.equal(registroSensor.statusCode, 503, 'el modo de demo no debe guardar datos como reales');
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
