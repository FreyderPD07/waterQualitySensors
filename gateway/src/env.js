import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carga siempre gateway/.env, sin importar desde qué carpeta se ejecute el proceso.
const directorio = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(directorio, '..', '.env') });
