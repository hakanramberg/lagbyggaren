import Store from '../store.js';
import { ApiError, verifyIdentity } from './auth.mjs';
const MAX_BYTES = 750000;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function load(env, email, linkHash) {
  let row = await env.DB.prepare('SELECT version, payload FROM workspace WHERE id = 1').first();
  if (!row) {
    const ownerEmail = (env.OWNER_EMAIL || '').trim().toLowerCase();
    if (!validEmail(ownerEmail)) throw new ApiError(503, 'Huvudtränaren är inte konfigurerad.');
    if (linkHash ? linkHash !== env.OWNER_TOKEN_HASH : email !== ownerEmail) throw new ApiError(403, 'Huvudtränaren behöver öppna appen först.');
    const id = crypto.randomUUID(), state = Store.initial(id, env.OWNER_NAME || 'Huvudtränare');
    state.coaches[0].email = ownerEmail;
    const data = { state, ownerId: id, ...(linkHash ? { tokens: { [linkHash]: id } } : {}) };
    await env.DB.prepare('INSERT OR IGNORE INTO workspace (id, version, payload) VALUES (1, 0, ?)').bind(JSON.stringify(data)).run();
    row = await env.DB.prepare('SELECT version, payload FROM workspace WHERE id = 1').first();
  }
  return JSON.parse(row.payload);
}
function envelope(data, actor) { return { state: data.state, me: actor, owner: actor === data.ownerId }; }
async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON krävs.');
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new ApiError(413, 'Filen är för stor.');
  if (!request.body) throw new ApiError(400, 'Uppgifter saknas.');
  const reader = request.body.getReader(), chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); throw new ApiError(413, 'Filen är för stor.'); } chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, 'Filen innehåller inte giltiga uppgifter.'); }
}
export function createHandler(verify = verifyIdentity) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const links = env.AUTH_MODE === 'links';
      if (url.pathname === '/config.js' && request.method === 'GET') return new Response('window.LAGBYGGAREN_CONFIG = ' + JSON.stringify({ shared: true, auth: links ? 'links' : 'access', pollMs: 30000, migration: true }) + ';', { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
      if (url.pathname === '/health') return json({ ok: true });
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      try {
        if (!env.DB) throw new ApiError(503, 'Gemensam lagring är inte konfigurerad.');
        let email, linkHash;
        if (links) {
          const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
          if (!token) throw new ApiError(401, 'Öppna din personliga tränarlänk.');
          if (!/^[a-f0-9]{64}$/.test(env.OWNER_TOKEN_HASH || '')) throw new ApiError(503, 'Tränarlänkar är inte konfigurerade.');
          linkHash = await digest(token);
        } else email = await verify(request, env);
        if (request.method !== 'GET') {
          if (request.headers.get('origin') !== url.origin) throw new ApiError(403, 'Öppna appen på dess egen webbadress.');
          if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'Begäran tillåts inte från en annan webbplats.');
        }
        const data = await load(env, email, linkHash);
        const actor = links ? data.tokens?.[linkHash] : data.state.coaches.find(c => c.email === email)?.id;
        if (!actor) throw new ApiError(403, 'Din e-postadress har inte bjudits in av huvudtränaren.');
        if (request.method === 'GET' && url.pathname === '/api/state') return json(envelope(data, actor));
        if (request.method !== 'POST') throw new ApiError(405, 'Metoden stöds inte.');
        const body = await readBody(request);
        if (body.version !== data.state.version) return json({ error: 'En kollega hann spara en ändring. Senaste uppgifterna har hämtats; försök igen.', ...envelope(data, actor) }, 409);
        const oldVersion = data.state.version;
        let result = {};
        if (url.pathname === '/api/action') {
          try { data.state = Store.apply(data.state, body.action, actor, crypto.randomUUID()); }
          catch (error) { throw new ApiError(400, error.message); }
        } else if (url.pathname === '/api/migrate') {
          if (actor !== data.ownerId) throw new ApiError(403, 'Endast huvudtränaren får flytta in historik.');
          if (data.state.players.length || data.state.proposals.length) throw new ApiError(400, 'Historik kan bara flyttas in i en tom grupp. Befintliga uppgifter skrivs inte över.');
          const source = body.snapshot;
          if (!source || source.schema !== 2 || !Array.isArray(source.proposals) || source.proposals.length > 200) throw new ApiError(400, 'Välj en säkerhetskopia från Lagbyggaren.');
          try {
            data.state.players = Store.validatePlayers(source.players);
            data.state.proposals = source.proposals.map(p => {
              const clean = Store.proposalData(p);
              if (!['review', 'accepted'].includes(p.status)) throw Error('Ogiltig status i historiken.');
              const now = new Date().toISOString();
              const record = { ...clean, id: crypto.randomUUID(), revision: 1, status: p.status, votes: {}, previous: [], createdBy: actor, createdAt: now, updatedAt: now, importedAt: now };
              if (p.status === 'accepted') {
                if (!Number.isFinite(Date.parse(p.acceptedAt))) throw Error('Ogiltigt datum i historiken.');
                record.acceptedAt = new Date(p.acceptedAt).toISOString(); record.acceptedBy = actor; record.reviewers = [];
              }
              return record;
            });
          } catch (error) { throw new ApiError(400, error.message); }
          data.state.version++;
        } else if (url.pathname === '/api/invite') {
          if (actor !== data.ownerId) throw new ApiError(403, 'Huvudtränaren bjuder in kollegor.');
          if (links) {
            if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 70) throw new ApiError(400, 'Ange kollegans namn.');
            if (data.state.coaches.length >= 20) throw new ApiError(400, 'Max 20 tränare i denna grupp.');
            const invitation = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
            const id = crypto.randomUUID();
            data.tokens[await digest(invitation)] = id;
            data.state.coaches.push({ id, name: body.name.trim() });
            data.state.version++; result = { invitation };
          } else {
          if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 70 || !validEmail(body.email)) throw new ApiError(400, 'Ange kollegans namn och e-postadress.');
          const invitedEmail = body.email.trim().toLowerCase();
          if (data.state.coaches.some(c => c.email === invitedEmail)) throw new ApiError(400, 'Den e-postadressen är redan inbjuden.');
          if (data.state.coaches.length >= 20) throw new ApiError(400, 'Max 20 tränare i denna grupp.');
          data.state.coaches.push({ id: crypto.randomUUID(), name: body.name.trim(), email: invitedEmail });
          data.state.version++; result = { inviteUrl: url.origin + '/', invitedEmail };
          }
        } else if (url.pathname === '/api/revoke') {
          if (actor !== data.ownerId || body.id === actor) throw new ApiError(403, 'Åtkomsten kan inte tas bort.');
          data.state.coaches = data.state.coaches.filter(c => c.id !== body.id); data.state.version++;
          if (links) for (const key of Object.keys(data.tokens)) if (data.tokens[key] === body.id) delete data.tokens[key];
        } else throw new ApiError(404, 'Åtgärden finns inte.');
        const encoded = JSON.stringify(data);
        if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) throw new ApiError(413, 'Gruppens lagring har nått appens storleksgräns. Exportera en säkerhetskopia och kontakta huvudtränaren.');
        // Atomic compare-and-swap prevents two Workers from overwriting each other's votes.
        const saved = await env.DB.prepare('UPDATE workspace SET version = ?, payload = ? WHERE id = 1 AND version = ?').bind(data.state.version, encoded, oldVersion).run();
        if (saved.meta.changes !== 1) {
          const current = await load(env, email, linkHash);
          if (links ? current.tokens?.[linkHash] !== actor : !current.state.coaches.some(c => c.id === actor && c.email === email)) throw new ApiError(403, 'Din åtkomst har tagits bort.');
          return json({ error: 'En kollega hann spara. Senaste uppgifterna har hämtats; försök igen.', ...envelope(current, actor) }, 409);
        }
        return json({ ...envelope(data, actor), ...result });
      } catch (error) {
        return json({ error: error instanceof ApiError ? error.message : 'Gemensam lagring är tillfälligt otillgänglig. Ändringen är inte bekräftad. Försök igen senare.' }, error instanceof ApiError ? error.status : 503);
      }
    }
  };
}
export default createHandler();
