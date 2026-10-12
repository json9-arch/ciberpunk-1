'use strict';

// Servidor sin dependencias externas. Mantén DISCORD_WEBHOOK_URL en .env, nunca en el frontend.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000);

// Carga simple de .env para desarrollo local (no sobrescribe variables existentes).
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (_) {}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon'
};
const emailPattern = /^[^\s@]+@[\w-]+\.com$/i;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 12_000) {
        reject(Object.assign(new Error('El cuerpo de la solicitud es demasiado grande.'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (_) { reject(Object.assign(new Error('JSON inválido.'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

async function handleContact(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido.' });
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || !/^https:\/\/discord\.com\/api\/webhooks\//.test(webhook)) {
    return sendJson(res, 503, { error: 'El webhook no está configurado en el servidor.' });
  }

  let data;
  try { data = await readJson(req); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: error.message || 'Solicitud inválida.' }); }

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const account = typeof data.account === 'string' ? data.account.trim() : '';
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (!name || name.length > 100) return sendJson(res, 400, { error: 'El nombre es obligatorio y debe tener hasta 100 caracteres.' });
  if (!emailPattern.test(account) || account.length > 254) return sendJson(res, 400, { error: 'La cuenta/correo debe tener el formato nombre@dominio.com.' });
  if (!message || message.length > 500) return sendJson(res, 400, { error: 'El mensaje es obligatorio y debe tener como máximo 500 caracteres.' });

  // No permitir menciones de roles/usuarios a través del contenido enviado.
  const discordPayload = {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: 'Nuevo mensaje de contacto',
      color: 0x00F0FF,
      fields: [
        { name: 'Nombre', value: name.slice(0, 100) },
        { name: 'Cuenta / correo', value: account.slice(0, 254) },
        { name: 'Mensaje', value: message.slice(0, 500) }
      ],
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const discordResponse = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
      signal: AbortSignal.timeout(10000)
    });

    if (!discordResponse.ok) {
      const discordError = await discordResponse.text();

      console.error(
        'Discord respondió con HTTP',
        discordResponse.status,
        'Detalle:',
        discordError
      );

      return sendJson(res, 502, {
        error: 'Discord no aceptó el mensaje. Inténtalo más tarde.'
      });
    }

    return sendJson(res, 200, { ok: true });

  } catch (error) {
    console.error('Error enviando mensaje à Discord:', error.message);

    return sendJson(res, 502, {
      error: 'No se pudo conectar con Discord.'
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/contact') return handleContact(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método no permitido.' });

  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    return sendJson(res, 403, { error: 'Acceso denegado.' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => console.log(`CYBER ART COMMISSIONS disponible en http://localhost:${PORT}`));