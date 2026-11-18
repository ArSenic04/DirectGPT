/**
 * HTTP + websocket server: Yjs rooms, the LLM gateway, session export and
 * (in production) the built client. One process, one port.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomRegistry, roomFromRequest } from './rooms';
import { completeLLM, LLMError, validateCallBody, type LLMConfig } from './llm';
import { buildExport, eventsCsv, questionnairesCsv, summaryCsv } from '../shared/exportData';
import { parseRoomName } from '../shared/room';
import type { ServerConfig } from '../shared/types';

export interface AppOptions {
  dataDir: string | null;
  staticDir: string | null;
  llm: LLMConfig;
  log?: boolean;
}

const MAX_BODY = 2 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.gif': 'image/gif', '.woff2': 'font/woff2',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new LLMError(413, { error: 'Request too large.', code: 'bad_request' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApp(opts: AppOptions) {
  const rooms = new RoomRegistry(opts.dataDir ? path.join(opts.dataDir, 'rooms') : null);
  const exportDir = opts.dataDir ? path.join(opts.dataDir, 'exports') : null;

  const config = (): ServerConfig => ({
    serverKeyConfigured: Boolean(opts.llm.envApiKey && opts.llm.envApiKey.trim()),
    defaultModel: opts.llm.defaultModel,
    baseUrlHost: (() => {
      try {
        return new URL(opts.llm.baseUrl).host;
      } catch {
        return opts.llm.baseUrl;
      }
    })(),
    mockLatencyMs: opts.llm.mockLatencyMs,
  });

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/api/config' && req.method === 'GET') return sendJson(res, 200, config());

    if (url.pathname === '/api/llm') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.', code: 'bad_request' });
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch (err) {
          if (err instanceof LLMError) throw err;
          throw new LLMError(400, { error: 'Invalid JSON body.', code: 'bad_request' });
        }
        const call = validateCallBody(parsed);
        const keyHeader = req.headers['x-openai-key'];
        const uiKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
        const result = await completeLLM(call, uiKey, opts.llm);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        if (err instanceof LLMError) {
          // Provider outcomes are reported in-band (see LLMResponse); only malformed requests are HTTP errors.
          if (err.body.code === 'bad_request') return sendJson(res, err.status, { ok: false, ...err.body });
          return sendJson(res, 200, { ok: false, ...err.body, status: err.status });
        }
        console.error('[llm] unexpected error', err);
        return sendJson(res, 200, { ok: false, error: 'Unexpected server error while calling the LLM.', code: 'provider_error' });
      }
    }

    if (url.pathname === '/api/rooms' && req.method === 'GET') {
      return sendJson(res, 200, { rooms: rooms.names() });
    }

    const exportMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/export$/);
    if (exportMatch && req.method === 'GET') {
      const name = decodeURIComponent(exportMatch[1]);
      if (!parseRoomName(name)) return sendJson(res, 400, { error: 'Invalid room name.' });
      const room = rooms.find(name);
      const exp = room ? buildExport(room.doc, name) : null;
      if (!exp) return sendJson(res, 404, { error: 'Room not found.' });
      if (exportDir) {
        try {
          fs.mkdirSync(exportDir, { recursive: true });
          fs.writeFileSync(path.join(exportDir, `${name}.json`), JSON.stringify(exp, null, 2));
        } catch (err) {
          console.error('[export] could not write export copy', err);
        }
      }
      const format = url.searchParams.get('format') ?? 'json';
      const download = url.searchParams.get('download') === '1';
      const disposition = (ext: string) => (download ? { 'Content-Disposition': `attachment; filename="${name}${ext}"` } : {});
      if (format === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...disposition('.json') });
        return void res.end(JSON.stringify(exp, null, 2));
      }
      const csv = format === 'events.csv' ? eventsCsv(exp) : format === 'summary.csv' ? summaryCsv(exp) : format === 'questionnaires.csv' ? questionnairesCsv(exp) : null;
      if (csv === null) return sendJson(res, 400, { error: 'format must be json, events.csv, summary.csv or questionnaires.csv' });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', ...disposition(`.${format}`) });
      return void res.end(csv);
    }

    return sendJson(res, 404, { error: 'Not found.' });
  }

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    if (!opts.staticDir || !fs.existsSync(opts.staticDir)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Client not built. Run "npm run build" (or use "npm run dev").');
      return;
    }
    const root = path.resolve(opts.staticDir);
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((err) => {
        console.error('[api] error', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      });
      return;
    }
    serveStatic(req, res, url);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const name = roomFromRequest(req);
    if (!name) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      rooms.get(name).handleConnection(ws);
    });
  });

  return { server, rooms, wss };
}
