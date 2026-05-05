// Kling AI image generation — task creation
// JWT-signed (HS256) using KLING_ACCESS_KEY (iss) + KLING_SECRET_KEY (signing key).
// Endpoint: api-singapore.klingai.com (Global region)
//
// POST /.netlify/functions/kling-image-create
// Body: { "prompt": "...", "aspect_ratio": "1:1", "model": "kling-v2" }
// Returns: { task_id, status }

const crypto = require('crypto');

const KLING_BASE = 'https://api-singapore.klingai.com';

function b64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function makeJWT(accessKey, secretKey) {
  const headerB64 = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payloadB64 = b64url(Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })));
  const signing = `${headerB64}.${payloadB64}`;
  const sigB64 = b64url(crypto.createHmac('sha256', secretKey).update(signing).digest());
  return `${signing}.${sigB64}`;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...cors, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const expected = process.env.DASHBOARD_PASSWORD;
  if (expected) {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== expected) return json(401, { error: 'Unauthorized — wrong or missing password' });
  }

  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    return json(500, { error: 'Server not configured: KLING_ACCESS_KEY or KLING_SECRET_KEY missing' });
  }

  let prompt, aspectRatio, model;
  try {
    const body = JSON.parse(event.body || '{}');
    prompt = (body.prompt || '').trim();
    aspectRatio = body.aspect_ratio || '1:1';
    model = body.model || 'kling-v2';
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!prompt) return json(400, { error: 'No prompt provided' });

  try {
    const jwt = makeJWT(accessKey, secretKey);
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
    let data = null; try { data = JSON.parse(text); } catch {}

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
};
