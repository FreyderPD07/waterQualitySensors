import './env.js';
import mqtt from 'mqtt';
import { guardarLectura } from './lecturasRepository.js';

let client;
let ultimaLectura = null;

export function obtenerUltimaLectura() {
    return ultimaLectura;
}

export async function connectMqtt() {
    const brokerURL = process.env.MQTT_URL || 'mqtt://localhost:1883';

    client = mqtt.connect(brokerURL, {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD
    });

    client.on('connect', () => {
        console.log('Conectado exitosamente al broker MQTT');

        const topic = process.env.TTN_TOPIC || 'v3/turbidez-app@ttn/devices/+/up';

        client.subscribe(topic, { qos: 0 }, (error, granted) => {
            if (error) {
                console.error('Error al suscribirse al tópico:', error.message);
                return;
            }

            const aceptada = granted?.some((suscripcion) => suscripcion.topic === topic && suscripcion.qos === 0);
            if (!aceptada) {
                console.error('TTN no aceptó la suscripción', granted);
                return;
            }

            console.log(`Suscrito a la lectura de TTN: ${topic}`);
        });
    });

    client.on('message', async (topic, payload) => {
        try {
            const mensaje = JSON.parse(payload.toString());
            const datos = mensaje.uplink_message?.decoded_payload;
            const metadatos = mensaje.uplink_message?.rx_metadata?.[0] || {};

            console.log('\nLectura recibida desde TTN');
            console.log('Tópico:', topic);
            console.log('Dispositivo:', mensaje.end_device_ids?.device_id);

            ultimaLectura = {
                sensorId: mensaje.end_device_ids?.device_id ?? null,
                recibidoEn: new Date().toISOString(),
                datos: datos ?? null,
                rssi: metadatos.rssi ?? null,
                snr: metadatos.snr ?? null,
                bateria: mensaje.uplink_message?.last_battery_percentage ?? null
            };

            if (datos) {
                console.log('Datos decodificados');
                console.dir(datos, { depth: null });
                await guardarLectura(ultimaLectura);
            } else {
                console.log('Mensaje recibido sin decoded_payload');
                console.dir(mensaje, { depth: null });
            }
        } catch (error) {
            console.error('Error al procesar el mensaje:', error.message);
        }
    });

    client.on('error', (error) => {
        console.error('Error en la conexión MQTT', error);
    });
}

export async function publicarLectura(topic, data) {
    if (!client || !client.connected) {
        throw new Error('No hay conexión con el broker MQTT');
    }

    return new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(data), { qos: 1 }, (error) => {
            if (error) {
                reject(error);
                return;
            }

            console.log(`Publicación MQTT completada en ${topic}`);
            resolve();
        });
    });
}

export function cerrarMqtt() {
    return new Promise((resolve) => {
        if (!client) {
            resolve();
            return;
        }
        client.end(false, {}, resolve);
    });
}
