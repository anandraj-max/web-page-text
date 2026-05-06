// Cloudflare Pages Function — POST /api/kling-image-create
// Submits a Kling text-to-image task. Returns task_id for polling.
// Uses Web Crypto SubtleCrypto for HS256 JWT (Workers runtime is V8, not Node).

const KLING_BASE = 'https://api-singapore.klingai.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function strToB64Url(s) {
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function makeJWT(accessKey, secretKey) {
  const enc = new TextEncoder();
  const headerB64 = strToB64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payloadB64 = strToB64Url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const signing = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signing));
  const sig = b64url(new Uint8Array(sigBuf));
  return `${signing}.${sig}`;
}

export async function onRequestOptions() {
  return new Response('', { status: 200, headers: cors });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (env.DASHBOARD_PASSWORD) {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== env.DASHBOARD_PASSWORD) {
      return json(401, { error: 'Unauthorized — wrong or missing password' });
    }
  }
  if (!env.KLING_ACCESS_KEY || !env.KLING_SECRET_KEY) {
    return json(500, { error: 'Server not configured: KLING_ACCESS_KEY or KLING_SECRET_KEY missing' });
  }

  let prompt, aspectRatio, model;
  try {
    const body = await request.json();
    prompt = (body.prompt || '').trim();
    aspectRatio = body.aspect_ratio || '1:1';
    model = body.model || 'kling-v2';
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!prompt) return json(400, { error: 'No prompt provided' });

  try {
    const jwt = await makeJWT(env.KLING_ACCESS_KEY, env.KLING_SECRET_KEY);
    const r = await fetch(`${KLING_BASE}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name: model,
        prompt,
        aspect_ratio: aspectRatio,
        n: 1,
      }),
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!r.ok) {
      return json(r.status, {
        error: 'Kling API error',
        status: r.status,
        detail: data?.message || text.slice(0, 400),
      });
    }
    if (data?.code !== 0) {
      return json(500, {
        error: 'Kling returned non-zero code',
        code: data?.code,
        detail: data?.message,
      });
    }
    return json(200, {
      task_id: data?.data?.task_id,
      status: data?.data?.task_status,
    });
  } catch (e) {
    return json(500, { error: 'Function exception: ' + (e?.message || String(e)) });
  }
}
