import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del proyecto (logo, banner, etc.)
app.use(express.static(__dirname));
app.use('/assets', express.static(__dirname));

// Endpoint de verificación
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'INGELAB Confirmación de Asistencia',
    eventDate: '2026-11-13'
  });
});

// Todas las demás peticiones van a index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Solo iniciar el servidor HTTP si se ejecuta directamente y no está en Vercel
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  try {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor INGELAB listo en http://localhost:${PORT}`);
    });
  } catch(e) {}
}

// Exportación requerida para Vercel Serverless Functions / Express
export default app;
