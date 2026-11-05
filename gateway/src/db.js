import './env.js';
import { MongoClient } from 'mongodb';
import dns from 'node:dns';

export const DB_NAME = process.env.MONGO_DB || 'Monitoreo_Agua';

let cliente = null;

export async function conectMongoDB() {
    // Se aceptan ambos nombres para no romper configuraciones anteriores.
    const mongoUrl = process.env.MONGO_URL || process.env.MONGO_URI;

    if (!mongoUrl) {
        throw new Error('MONGO_URL no está definida en gateway/.env');
    }

    dns.setServers(['8.8.8.8', '1.1.1.1']);

    cliente = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 15000 });
    await cliente.connect();
    await cliente.db(DB_NAME).command({ ping: 1 });

    console.log('Conectado a MongoDB');
    return cliente;
}

export function getDb() {
    if (!cliente) {
        throw new Error('MongoDB todavía no está conectado');
    }
    return cliente.db(DB_NAME);
}

export async function cerrarMongoDB() {
    if (cliente) {
        await cliente.close();
        cliente = null;
    }
}
