// Cloudflare Pages Function — POST /api/nano-banana
// Gemini 2.5 Flash Image (Nano Banana). Requires GEMINI_API_KEY env var.
// Currently unused in the UI switcher — kept available for when billing is enabled.

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
      return json(401, { error: 'Unauthorized' });
    }
  }
  if (!env.GEMINI_API_KEY) {
    return json(500, { error: 'Server not configured: GEMINI_API_KEY missing' });
  }

  let prompt;
  try {
    const body = await request.json();
    prompt = (body.prompt || '').trim();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  if (!prompt) return json(400, { error: 'No prompt' });

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!r.ok) {
      return json(r.status, {
        error: 'Gemini API error',
        status: r.status,
        detail: data?.error?.message || text.slice(0, 400),
      });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textOut = parts.map((p) => p.text).filter(Boolean).join(' ');
      return json(500, {
        error: 'Gemini returned no image',
        textOutput: textOut || null,
        finishReason: data?.candidates?.[0]?.finishReason,
      });
    }
    const inline = imagePart.inlineData || imagePart.inline_data;
    return json(200, {
      image: inline.data,
      mimeType: inline.mimeType || inline.mime_type || 'image/png',
    });
  } catch (e) {
    return json(500, { error: 'Function exception: ' + (e?.message || String(e)) });
  }
}
