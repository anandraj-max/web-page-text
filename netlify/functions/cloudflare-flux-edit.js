// Image-to-image / instruction edit via Cloudflare Workers AI FLUX.2 [klein] 9B.
// Same body shape as cloudflare-flux.js plus a base64 sourceImage. Builds a
// multipart form (the only shape klein-9b accepts) and forwards.
//
// Required env vars:
//   CF_ACCOUNT_ID
//   CF_API_TOKEN          — Workers AI: Read/Write
//   DASHBOARD_PASSWORD    — optional auth
//
// POST /.netlify/functions/cloudflare-flux-edit
// Body: { "prompt": "<edit instruction>", "sourceImage": "<base64 or data URL>" }
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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const expected = process.env.DASHBOARD_PASSWORD;
  if (expected) {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== expected) return json(401, { error: 'Unauthorized — wrong or missing password' });
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    return json(500, { error: 'Server not configured: CF_ACCOUNT_ID or CF_API_TOKEN missing' });
  }

  let prompt, sourceImage;
  try {
    const body = JSON.parse(event.body || '{}');
    prompt = (body.prompt || '').trim();
    sourceImage = body.sourceImage;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!prompt) return json(400, { error: 'No prompt provided' });
  if (!sourceImage) return json(400, { error: 'No source image provided' });

  // Accept either raw base64 or a data URL
  const base64 = sourceImage.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  let imageBytes;
  try {
    imageBytes = Buffer.from(base64, 'base64');
  } catch {
    return json(400, { error: 'Invalid sourceImage encoding' });
  }
  if (imageBytes.length === 0) {
    return json(400, { error: 'Empty source image' });
  }

  try {
    // Build multipart form-data — klein-9b's only accepted shape.
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('width', '1024');
    fd.append('height', '1024');
    // Node 18+ FormData accepts a Blob with a filename arg.
    fd.append('input_image_0', new Blob([imageBytes], { type: 'image/jpeg' }), 'source.jpg');

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-klein-9b`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiToken },
      body: fd,
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
      return json(500, { error: 'No image in response', resultKeys: data?.result ? Object.keys(data.result) : null });
    }
    return json(200, { image, mimeType: 'image/jpeg' });
  } catch (e) {
    return json(500, { error: 'Function exception: ' + (e?.message || String(e)) });
  }
};
