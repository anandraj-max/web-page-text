// Cloudflare Workers AI — FLUX-1-schnell image generation
// Truly free up to ~200 images/day (10K neurons). No credit card required.
//
// Required env vars:
//   CF_ACCOUNT_ID       — Cloudflare Account ID (from dashboard right sidebar)
//   CF_API_TOKEN        — API token with Workers AI permission
//   DASHBOARD_PASSWORD  — (optional) shared password gate
//
// POST /.netlify/functions/cloudflare-flux
// Body: { "prompt": "..." }
// Returns: { "image": "<base64>", "mimeType": "image/jpeg" }

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Optional auth gate — only enforced if DASHBOARD_PASSWORD is set
  const expected = process.env.DASHBOARD_PASSWORD;
  if (expected) {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== expected) {
      return json(401, { error: 'Unauthorized — wrong or missing password' });
    }
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    return json(500, {
      error: 'Server not configured: CF_ACCOUNT_ID or CF_API_TOKEN missing',
    });
  }

  // Parse body
  let prompt;
  try {
    const body = JSON.parse(event.body || '{}');
    prompt = (body.prompt || '').trim();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!prompt) {
    return json(400, { error: 'No prompt provided' });
  }

  // Call Cloudflare Workers AI — FLUX-1-schnell model
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        // steps controls quality vs speed for flux-schnell. Max 8 on free tier.
        steps: 4,
      }),
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!r.ok) {
      return json(r.status, {
        error: 'Cloudflare API error',
        status: r.status,
        detail: data?.errors?.[0]?.message || text.slice(0, 400),
      });
    }

    if (!data?.success) {
      return json(500, {
        error: 'Cloudflare returned failure',
        errors: data?.errors,
        messages: data?.messages,
      });
    }

    const image = data?.result?.image;
    if (!image) {
      return json(500, {
        error: 'No image in response',
        keys: data?.result ? Object.keys(data.result) : null,
      });
    }

    return json(200, {
      image,
      mimeType: 'image/jpeg',
    });
  } catch (e) {
    return json(500, { error: 'Function exception: ' + (e?.message || String(e)) });
  }
};
