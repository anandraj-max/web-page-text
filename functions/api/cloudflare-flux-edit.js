// Cloudflare Pages Function — POST /api/cloudflare-flux-edit
// Image-to-image / instruction edit via @cf/black-forest-labs/flux-2-klein-9b
// Sends multipart with input_image_0; same env vars + auth as the gen function.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

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
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return json(500, { error: 'Server not configured: CF_ACCOUNT_ID or CF_API_TOKEN missing' });
  }

  let prompt, sourceImage;
  try {
    const body = await request.json();
    prompt = (body.prompt || '').trim();
    sourceImage = body.sourceImage;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!prompt) return json(400, { error: 'No prompt provided' });
  if (!sourceImage) return json(400, { error: 'No source image provided' });

  // Strip data URL prefix and decode base64 to bytes
  const base64 = sourceImage.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  let bytes;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json(400, { error: 'Invalid sourceImage encoding' });
  }
  if (bytes.length === 0) return json(400, { error: 'Empty source image' });

  try {
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('width', '1024');
    fd.append('height', '1024');
    fd.append('input_image_0', new Blob([bytes], { type: 'image/jpeg' }), 'source.jpg');

    const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-klein-9b`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.CF_API_TOKEN },
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
      return json(500, { error: 'No image in response' });
    }
    return json(200, { image, mimeType: 'image/jpeg' });
  } catch (e) {
    return json(500, { error: 'Function exception: ' + (e?.message || String(e)) });
  }
}
