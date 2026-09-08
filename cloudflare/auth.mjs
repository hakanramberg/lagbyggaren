import { createRemoteJWKSet, jwtVerify } from 'jose';
const resolvers = new Map();
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function verifyIdentity(request, env, resolver) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER || '') || !env.ACCESS_AUD) throw new ApiError(503, 'Tränarinloggningen är inte färdigkonfigurerad.');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || token.length > 16000) throw new ApiError(401, 'Logga in med din godkända e-postadress.');
  if (!resolver) {
    if (!resolvers.has(env.ACCESS_ISSUER)) resolvers.set(env.ACCESS_ISSUER, createRemoteJWKSet(new URL(env.ACCESS_ISSUER + '/cdn-cgi/access/certs')));
    resolver = resolvers.get(env.ACCESS_ISSUER);
  }
  try {
    const { payload } = await jwtVerify(token, resolver, { algorithms: ['RS256'], issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5 });
    if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw Error();
    return payload.email.trim().toLowerCase();
  } catch { throw new ApiError(401, 'Inloggningen har gått ut eller är ogiltig. Logga in igen.'); }
}
