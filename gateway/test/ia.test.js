import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import { estadoIA, generarReporte, responderPregunta } from '../src/ia.js';

let servidor;
let base;
let ultimaPeticion;

const lectura = {
    nodoId: 'nodo-01',
    fecha: '2026-11-05T12:00:00.000Z',
    ph: 7.4,
    turbidez: 8.8,
    conductividad: 365,
    temperatura: 20.2,
    clasificacion: 'Riesgo'
};

const lecturas = [
    { ...lectura, fecha: '2026-11-05T06:00:00.000Z', turbidez: 6.1 },
    lectura,
    { ...lectura, fecha: '2026-11-05T15:00:00.000Z', turbidez: 9.2 }
];

before(async () => {
    servidor = http.createServer(async (request, response) => {
        let cuerpo = '';
        for await (const parte of request) cuerpo += parte;

        ultimaPeticion = {
            url: request.url,
            headers: request.headers,
            body: JSON.parse(cuerpo)
        };

        response.setHeader('content-type', 'application/json');

        if (request.url === '/falla') {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: 'fallo simulado' }));
            return;
        }

        const esReporte = JSON.stringify(ultimaPeticion.body).includes('Tarea: genera el reporte');
        const contenido = esReporte
            ? JSON.stringify({
                explicacion: 'Los registros de las últimas 24 horas muestran un pico de turbidez tras la lluvia.',
                recomendaciones: ['Hervir el agua antes de consumirla', 'Revisar la tapa del tanque']
            })
            : 'La serie consultada muestra un evento puntual de turbidez; vigila la próxima lectura.';

        response.end(JSON.stringify({ choices: [{ message: { content: contenido } }] }));
    });

    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;

    process.env.OPENROUTER_API_KEY = 'clave-de-prueba';
    process.env.OPENROUTER_MODEL = 'modelo/de-prueba';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    process.env.OPENROUTER_URL = `${base}/api/v1/chat/completions`;
    process.env.OPENROUTER_APP_NAME = 'WaterMLdetect';
});

after(async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_FALLBACK_MODELS;
    delete process.env.OPENROUTER_URL;
    await new Promise((resolve) => servidor.close(resolve));
});

test('el reporte usa OpenRouter, envía el contexto y parsea el JSON', async () => {
    const reporte = await generarReporte(lectura, { lecturas });

    assert.equal(reporte.explicacion, 'Los registros de las últimas 24 horas muestran un pico de turbidez tras la lluvia.');
    assert.deepEqual(reporte.recomendaciones, ['Hervir el agua antes de consumirla', 'Revisar la tapa del tanque']);
    assert.equal(reporte.fuente, 'openrouter');

    assert.equal(ultimaPeticion.body.model, 'modelo/de-prueba');
    assert.equal(ultimaPeticion.headers.authorization, 'Bearer clave-de-prueba');
    assert.equal(ultimaPeticion.headers['x-title'], 'WaterMLdetect');
    assert.match(ultimaPeticion.body.messages[0].content, /HelioWater/);
    assert.match(ultimaPeticion.body.messages[1].content, /contexto_datos/);
    assert.match(ultimaPeticion.body.messages[1].content, /muestra_aleatoria/);
    assert.match(ultimaPeticion.body.messages[1].content, /nodo-01/);
});

test('el chat usa OpenRouter y devuelve la respuesta del modelo', async () => {
    const respuesta = await responderPregunta(lectura, '¿Qué pasó con la turbidez?', { lecturas });
    assert.equal(respuesta, 'La serie consultada muestra un evento puntual de turbidez; vigila la próxima lectura.');
});

test('si OpenRouter falla, el asistente responde con el análisis local', async () => {
    process.env.OPENROUTER_URL = `${base}/falla`;
    const respuesta = await responderPregunta(lectura, '¿Es apta para beber?', { lecturas });
    assert.match(respuesta, /Última lectura/);
    process.env.OPENROUTER_URL = `${base}/api/v1/chat/completions`;
});

test('estadoIA informa el proveedor activo', () => {
    assert.equal(estadoIA().proveedor, 'openrouter');
    assert.equal(estadoIA().modelo, 'modelo/de-prueba');
});
