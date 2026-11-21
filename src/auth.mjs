import { timingSafeEqual } from 'node:crypto';

function constantTimeEqual(a, b) {
  const aa=Buffer.from(a,'utf8');
  const bb=Buffer.from(b,'utf8');
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

// Explicit opt-in to a public, no-login code scanner.
// Archive safety budgets and job limits remain in effect.
export function publicAccessEnabled(env=process.env) {
  return env.ARCHITECT_PUBLIC_ACCESS === 'true';
}

export function assertSecurePublicHost(host, env=process.env) {
  if (publicAccessEnabled(env)) return;
  const local = new Set(['127.0.0.1','::1','localhost']);
  if (local.has(host)) return;
  if (!env.ARCHITECT_USERNAME || !env.ARCHITECT_PASSWORD || env.ARCHITECT_PASSWORD.length < 16) {
    throw new Error('Public binding requires ARCHITECT_USERNAME and ARCHITECT_PASSWORD (minimum 16 characters). Set them as private environment variables.');
  }
}

// All application routes require Basic authentication when credentials are configured.
// A separate unauthenticated health route is handled in the server before this function.
export function authorized(req, env=process.env) {
  if (publicAccessEnabled(env)) return true;
  const user=env.ARCHITECT_USERNAME;
  const password=env.ARCHITECT_PASSWORD;
  if (!user && !password && env.HOST !== '0.0.0.0' && env.HOST !== '::' && env.NODE_ENV !== 'production') return true; // explicit local-only developer mode
  if (!user || !password) return false; // fail closed if not fully configured
  const header=req.headers.authorization;
  if (typeof header !== 'string' || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header) || header.length>8192) return false;
  let decoded;
  try {decoded=Buffer.from(header.slice(6),'base64').toString('utf8');}catch{return false;}
  const colon=decoded.indexOf(':');
  if (colon < 0) return false;
  const suppliedUser=decoded.slice(0,colon);
  const suppliedPassword=decoded.slice(colon+1);
  // Evaluate both comparisons; do not short-circuit based on username alone.
  const userOK=constantTimeEqual(suppliedUser,user);
  const passwordOK=constantTimeEqual(suppliedPassword,password);
  return userOK && passwordOK;
}
