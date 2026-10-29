import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 8787);
const dataDirectory = new URL('./data/', import.meta.url);
const dataFile = new URL('./data/vida-conforto.json', import.meta.url);
const seed = { users: [{ id: 'admin-miguel', username: 'miguel', password: 'miguel', role: 'admin', name: 'Miguel' }, { id: 'employee-maria', username: 'maria', password: 'maria', role: 'employee', name: 'Maria Silva' }], clients: [], employees: [], services: [], auditLogs: [] };

async function loadData() {
  await mkdir(dataDirectory, { recursive: true });
  if (!existsSync(dataFile)) await writeFile(dataFile, JSON.stringify(seed, null, 2), 'utf8');
  return JSON.parse(await readFile(dataFile, 'utf8'));
}

async function saveData(data) { await writeFile(dataFile, JSON.stringify(data, null, 2), 'utf8'); }

function send(response, status, body) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' }); response.end(JSON.stringify(body)); }

async function body(request) { let value = ''; for await (const chunk of request) value += chunk; return value ? JSON.parse(value) : {}; }

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const data = await loadData();
    if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { ok: true, service: 'vida-conforto-api' });
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const input = await body(request);
      const user = data.users.find((item) => item.username === input.username && item.password === input.password);
      if (!user) return send(response, 401, { error: 'Credenciais inválidas.' });
      return send(response, 200, { user: { id: user.id, username: user.username, role: user.role, name: user.name }, token: randomUUID() });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      const input = await body(request);
      for (const collection of ['clients', 'employees', 'services']) if (Array.isArray(input[collection])) data[collection] = input[collection];
      data.auditLogs.push({ id: randomUUID(), action: 'sync', collection: 'all', at: new Date().toISOString() });
      await saveData(data);
      return send(response, 200, { ok: true });
    }
    const collections = new Set(['clients', 'employees', 'services']);
    const collection = parts[1];
    if (!collections.has(collection)) return send(response, 404, { error: 'Rota não encontrada.' });
    const id = parts[2];
    if (request.method === 'GET') return send(response, 200, id ? (data[collection].find((item) => String(item.id) === id) || null) : data[collection]);
    if (request.method === 'POST') { const item = { ...(await body(request)), id: randomUUID(), createdAt: new Date().toISOString() }; data[collection].push(item); data.auditLogs.push({ id: randomUUID(), action: 'create', collection, recordId: item.id, at: new Date().toISOString() }); await saveData(data); return send(response, 201, item); }
    if (!id) return send(response, 400, { error: 'É necessário indicar o identificador.' });
    const index = data[collection].findIndex((item) => String(item.id) === id);
    if (index < 0) return send(response, 404, { error: 'Registo não encontrado.' });
    if (request.method === 'PUT') { data[collection][index] = { ...data[collection][index], ...(await body(request)), id }; data.auditLogs.push({ id: randomUUID(), action: 'update', collection, recordId: id, at: new Date().toISOString() }); await saveData(data); return send(response, 200, data[collection][index]); }
    if (request.method === 'DELETE') { const [removed] = data[collection].splice(index, 1); data.auditLogs.push({ id: randomUUID(), action: 'delete', collection, recordId: id, at: new Date().toISOString() }); await saveData(data); return send(response, 200, removed); }
  } catch (error) { send(response, 500, { error: error.message || 'Erro interno.' }); }
});

server.listen(port, () => console.log(`Vida & Conforto API em http://localhost:${port}`));
