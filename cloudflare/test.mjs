import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { verifyIdentity } from './auth.mjs';
import { createHandler } from './worker.mjs';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.kid = 'test'; jwk.alg = 'RS256';
const resolver = createLocalJWKSet({ keys: [jwk] });
const baseEnv = { ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com', ACCESS_AUD: 'test-audience', OWNER_EMAIL: 'owner@example.com', OWNER_NAME: 'Huvudtränare' };
async function token(email, overrides = {}) {
  return new SignJWT({ email, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(overrides.iss || baseEnv.ACCESS_ISSUER).setAudience(overrides.aud || baseEnv.ACCESS_AUD).setSubject(email).setIssuedAt().setExpirationTime(overrides.exp || '1h').sign(privateKey);
}
function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(fs.readFileSync(new URL('../migrations/0001_workspace.sql', import.meta.url), 'utf8'));
  return { prepare(sql) { let args = []; const statement = { bind(...values) { args = values; return statement; }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; } }; return statement; }, close() { sqlite.close(); } };
}
function request(path, jwt, body, origin = 'https://lagbyggaren.example.workers.dev') {
  return new Request('https://lagbyggaren.example.workers.dev' + path, { method: body ? 'POST' : 'GET', headers: { ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}), 'content-type': 'application/json', origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('Access verifies signature, issuer, audience, expiration and email; email headers alone never authorize', async () => {
  const good = await token('owner@example.com');
  assert.equal(await verifyIdentity(request('/api/state', good), baseEnv, resolver), 'owner@example.com');
  for (const bad of [null, good.slice(0, -5) + 'wrong', await token('owner@example.com', { aud: 'other' }), await token('owner@example.com', { iss: 'https://other.cloudflareaccess.com' }), await token('owner@example.com', { exp: 1 })]) await assert.rejects(verifyIdentity(request('/api/state', bad), baseEnv, resolver));
  await assert.rejects(verifyIdentity(new Request('https://x/api/state', { headers: { 'cf-access-authenticated-user-email': 'owner@example.com' } }), baseEnv, resolver));
  await assert.rejects(verifyIdentity(request('/api/state', good), { ...baseEnv, ACCESS_AUD: '' }, resolver));
});
test('D1 shared workflow, revocation, unanimous voting, concurrent updates and no cross-origin writes', async () => {
  const db = database(), env = { ...baseEnv, DB: db, ASSETS: { fetch: () => new Response('static') } };
  const handler = createHandler((req, env) => verifyIdentity(req, env, resolver));
  const owner = await token('owner@example.com'), colleague = await token('coach@example.com'), outsider = await token('outsider@example.com');
  let current;
  async function call(route, jwt = owner, action) {
    const res = await handler.fetch(request(route, jwt, action), env); const body = await res.json(); if (res.ok && body.state) current = body; return { status: res.status, ...body };
  }
  try {
    assert.equal((await call('/api/state', outsider)).status, 403);
    current = await call('/api/state'); assert.equal(current.state.coaches[0].email, 'owner@example.com');
    assert.equal((await call('/api/state', outsider)).status, 403);
    const initial = current.state.version;
    const races = await Promise.all([
      call('/api/invite', owner, { version: initial, name: 'Kollega', email: 'coach@example.com' }),
      call('/api/invite', owner, { version: initial, name: 'Annan', email: 'other@example.com' })
    ]);
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
    current = await call('/api/state');
    if (!current.state.coaches.some(c => c.email === 'coach@example.com')) await call('/api/invite', owner, { version: current.state.version, name: 'Kollega', email: 'coach@example.com' });
    if (current.state.coaches.some(c => c.email === 'other@example.com')) await call('/api/revoke', owner, { version: current.state.version, id: current.state.coaches.find(c => c.email === 'other@example.com').id });
    assert.equal((await call('/api/invite', colleague, { version: current.state.version, name: 'X', email: 'x@example.com' })).status, 403);
    const player = { id: 'player', name: 'Spelare', first: 'MV', second: '', level: 2 };
    async function act(type, data, jwt = owner) { return call('/api/action', jwt, { version: current.state.version, action: { type, data } }); }
    assert.equal((await act('player.save', player)).status, 200);
    assert.equal((await call('/api/state', colleague)).state.players[0].level, 2);
    assert.equal((await handler.fetch(request('/api/action', owner, { version: current.state.version, action: { type: 'players.replace', data: [] } }, 'https://evil.example'), env)).status, 403);
    const data = { name: 'Vikingaspelen 2026', kind: 'Turnering', date: '', teams: [[player]], slots: ['MV', 'V6', 'M9', 'H6', 'M6'], mode: 'balanced', targets: [], variation: true };
    assert.equal((await act('proposal.save', data)).status, 200);
    const id = current.state.proposals[0].id;
    await act('proposal.vote', { id, revision: 1, choice: 'approve', comment: '' });
    assert.equal((await act('proposal.accept', { id, revision: 1 })).status, 400);
    await act('proposal.vote', { id, revision: 1, choice: 'adjust', comment: 'Ändra lagen' }, colleague);
    await act('proposal.save', { ...data, id, revision: 1 });
    assert.deepEqual(current.state.proposals[0].votes, {});
    assert.equal((await act('proposal.vote', { id, revision: 1, choice: 'approve', comment: '' }, colleague)).status, 400);
    await act('proposal.vote', { id, revision: 2, choice: 'approve', comment: '' });
    await act('proposal.vote', { id, revision: 2, choice: 'approve', comment: '' }, colleague);
    assert.equal((await act('proposal.accept', { id, revision: 2 })).status, 200);
    assert.equal((await act('proposal.save', { ...data, id, revision: 2 })).status, 400);
    const snapshot = structuredClone(current.state.proposals[0]);
    await act('player.save', { ...player, level: 1, previous: player });
    assert.deepEqual(current.state.proposals[0], snapshot);
    const removedId = current.state.coaches.find(c => c.email === 'coach@example.com').id;
    await call('/api/revoke', owner, { version: current.state.version, id: removedId });
    assert.equal((await call('/api/state', colleague)).status, 403);
    const fresh = createHandler((req, env) => verifyIdentity(req, env, resolver));
    const res = await fresh.fetch(request('/api/state', owner), env);
    assert.deepEqual((await res.json()).state.proposals[0], snapshot);
    assert.equal((await handler.fetch(request('/api/state', null), env)).status, 401);
    assert.equal((await handler.fetch(request('/api/state', owner), { ...env, DB: null })).status, 503);
  } finally { db.close(); }
});

test('migration preserves player IDs and accepted history, resets pending votes, and never overwrites a group', async () => {
  const env = { ...baseEnv, DB: database() }, handler = createHandler((req, env) => verifyIdentity(req, env, resolver)), jwt = await token('owner@example.com');
  try {
    const initial = await (await handler.fetch(request('/api/state', jwt), env)).json();
    const player = { id: 'stable', name: 'Spelare', first: 'MV', second: '', level: 2 };
    const p = { name: 'Tidigare lag', kind: 'Match', date: '', teams: [[player]], slots: ['MV','V6','M9','H6','M6'], mode: 'balanced', targets: [], variation: true, status: 'accepted', acceptedAt: '2026-08-01T00:00:00.000Z' };
    const snapshot = { schema: 2, players: [player], proposals: [p, { ...p, name: 'Utkast', status: 'review', votes: { old: { choice: 'approve' } } }] };
    const imported = await handler.fetch(request('/api/migrate', jwt, { version: initial.state.version, snapshot }), env);
    assert.equal(imported.status, 200);
    const data = await imported.json();
    assert.equal(data.state.players[0].id, 'stable');
    assert.equal(data.state.proposals[0].status, 'accepted');
    assert.equal(data.state.proposals[0].acceptedAt, p.acceptedAt);
    assert.deepEqual(data.state.proposals[1].votes, {});
    assert.equal((await handler.fetch(request('/api/migrate', jwt, { version: data.state.version, snapshot }), env)).status, 400);
  } finally { env.DB.close(); }
});

test('personal links isolate votes and support revocation without Access', async () => {
  const secret = 'a'.repeat(64);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('hex');
  const env = { ...baseEnv, AUTH_MODE: 'links', OWNER_TOKEN_HASH: hash, DB: database() }, handler = createHandler();
  async function call(path, key, body) {
    const req = request(path, null, body);
    if (key) req.headers.set('authorization', 'Bearer ' + key);
    const res = await handler.fetch(req, env);
    return { status: res.status, ...await res.json() };
  }
  try {
    assert.equal((await call('/api/state')).status, 401);
    assert.equal((await call('/api/state', 'b'.repeat(64))).status, 403);
    let owner = await call('/api/state', secret);
    assert.equal(owner.owner, true);
    const invited = await call('/api/invite', secret, { version: owner.state.version, name: 'Kollega' });
    assert.equal(invited.status, 200);
    assert.match(invited.invitation, /^[a-f0-9]{64}$/);
    assert.equal('tokens' in invited, false);
    const colleague = await call('/api/state', invited.invitation);
    assert.equal(colleague.owner, false);
    assert.notEqual(colleague.me, owner.me);
    assert.equal((await call('/api/invite', invited.invitation, { version: colleague.state.version, name: 'Extra' })).status, 403);
    const player = { id: 'p', name: 'Spelare', first: 'MV', second: '', level: 2 };
    owner = await call('/api/action', secret, { version: invited.state.version, action: { type: 'player.save', data: player } });
    assert.equal((await call('/api/state', invited.invitation)).state.players[0].level, 2);
    const proposal = { name: 'Träning', kind: 'Träning', date: '', teams: [[player]], slots: ['MV', 'V6', 'M9', 'H6', 'M6'], mode: 'balanced', targets: [], variation: true };
    owner = await call('/api/action', secret, { version: owner.state.version, action: { type: 'proposal.save', data: proposal } });
    const id = owner.state.proposals[0].id;
    owner = await call('/api/action', secret, { version: owner.state.version, action: { type: 'proposal.vote', data: { id, revision: 1, choice: 'approve', comment: '' } } });
    const vote = await call('/api/action', invited.invitation, { version: owner.state.version, action: { type: 'proposal.vote', data: { id, revision: 1, choice: 'adjust', comment: 'Byt målvakt' } } });
    assert.equal(Object.keys(vote.state.proposals[0].votes).length, 2);
    assert.equal((await call('/api/action', secret, { version: vote.state.version, action: { type: 'proposal.accept', data: { id, revision: 1 } } })).status, 400);
    assert.equal((await call('/api/revoke', secret, { version: vote.state.version, id: colleague.me })).status, 200);
    assert.equal((await call('/api/state', invited.invitation)).status, 403);
  } finally { env.DB.close(); }
});
