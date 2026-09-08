'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Store = require('./store.js');
const hash = token => crypto.createHash('sha256').update(token).digest('hex');

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '.data');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, 'workspace.json');
  let db;
  function persist(next) {
    // Write and flush before acknowledging. A crash leaves either the old or the new complete file.
    const tmp = filename + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, filename);
    db = next;
  }
  if (fs.existsSync(filename)) {
    db = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!db.state || !db.tokens) throw new Error('Lagringen kunde inte läsas. Återställ en säkerhetskopia.');
  } else {
    const ownerToken = options.ownerToken || process.env.OWNER_TOKEN;
    if (!ownerToken || ownerToken.length < 32) throw new Error('Ange OWNER_TOKEN med minst 32 slumpmässiga tecken före första starten.');
    const id = crypto.randomUUID();
    persist({ state: Store.initial(id, options.ownerName || process.env.OWNER_NAME || 'Huvudtränare'), ownerId: id, tokens: { [hash(ownerToken)]: id } });
  }
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const envelope = actor => ({ state: db.state, me: actor, owner: actor === db.ownerId });
  async function readBody(req) {
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Filen är för stor.'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/store.js': 'store.js', '/engine.js': 'engine.js', '/styles.css': 'styles.css', '/logo.png': 'logo.png' };
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
  const rate = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/config.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('window.LAGBYGGAREN_CONFIG = { shared: true };'); }
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (!url.pathname.startsWith('/api/')) {
      const file = files[url.pathname];
      if (!file || req.method !== 'GET') return send(res, 404, { error: 'Sidan finns inte.' });
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(__dirname, file)).pipe(res);
    }
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const actor = token.length <= 256 ? db.tokens[hash(token)] : null;
    if (!actor) {
      const key = req.socket.remoteAddress, now = Date.now();
      if (rate.size > 10000) rate.clear();
      const attempts = rate.get(key);
      const count = attempts && now - attempts.at < 60000 ? attempts.count + 1 : 1;
      rate.set(key, { at: attempts && count > 1 ? attempts.at : now, count });
      return send(res, count > 30 ? 429 : 401, { error: count > 30 ? 'För många försök. Vänta en minut.' : 'Öppna din personliga inbjudningslänk.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, envelope(actor));
    if (req.method !== 'POST') return send(res, 405, { error: 'Metoden stöds inte.' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON krävs.' });
    try {
      const body = await readBody(req);
      if (body.version !== db.state.version) return send(res, 409, { error: 'En kollega hann spara en ändring. Senaste uppgifterna har hämtats; försök igen.', ...envelope(actor) });
      if (url.pathname === '/api/action') {
        const next = Store.apply(db.state, body.action, actor, crypto.randomUUID());
        persist({ ...db, state: next });
        return send(res, 200, envelope(actor));
      }
      if (url.pathname === '/api/invite') {
        if (actor !== db.ownerId) return send(res, 403, { error: 'Huvudtränaren bjuder in kollegor.' });
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 70) throw new Error('Ange kollegans namn.');
        if (db.state.coaches.length >= 20) throw new Error('Max 20 tränare.');
        const id = crypto.randomUUID(), invitation = crypto.randomBytes(32).toString('hex');
        const next = structuredClone(db); next.state.coaches.push({ id, name: body.name.trim() }); next.state.version++; next.tokens[hash(invitation)] = id;
        persist(next);
        return send(res, 200, { ...envelope(actor), invitation });
      }
      if (url.pathname === '/api/revoke') {
        if (actor !== db.ownerId || body.id === actor) return send(res, 403, { error: 'Åtkomsten kan inte tas bort.' });
        const next = structuredClone(db);
        next.state.coaches = next.state.coaches.filter(c => c.id !== body.id);
        for (const key of Object.keys(next.tokens)) if (next.tokens[key] === body.id) delete next.tokens[key];
        next.state.version++; persist(next);
        return send(res, 200, envelope(actor));
      }
      send(res, 404, { error: 'Åtgärden finns inte.' });
    } catch (error) {
      const io = error.code && /^(EACCES|ENOSPC|EIO|EROFS|EPERM)$/.test(error.code);
      send(res, io ? 503 : 400, { error: io ? 'Kunde inte spara. Försök igen senare.' : error.message });
    }
  });
  server.requestTimeout = 15000;
  return server;
}
if (require.main === module) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => console.log('Lagbyggaren körs på port ' + server.address().port));
}
module.exports = { createApp };
