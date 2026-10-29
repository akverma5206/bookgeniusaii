import type { Config } from '@netlify/edge-functions'

// "quality" is used for planning and writing chapters; "fast" for translation and the chat helper.
const MODELS = {
  quality: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
} as const

// Runs as an Edge Function because serverless functions cut streamed replies off after ~30 seconds,
// which truncated book plans and long chapters. The Anthropic event stream is passed through untouched
// (no parsing here) to stay well inside the edge CPU limit; the page reads the events itself.
export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: { prompt?: unknown; mode?: unknown; maxTokens?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  if (!prompt.trim() || prompt.length > 60000) return new Response('Invalid prompt', { status: 400 })
  const model = body.mode === 'fast' ? MODELS.fast : MODELS.quality
  const maxTokens = Math.min(8000, Math.max(256, Number(body.maxTokens) || 4000))

  const base = (Netlify.env.get('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/+$/, '')
  const upstream = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': Netlify.env.get('ANTHROPIC_API_KEY') || '',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: req.signal,
  })

  if (!upstream.ok || !upstream.body) {
    console.error('AI Gateway error', upstream.status, await upstream.text().catch(() => ''))
    return new Response('AI request failed', { status: upstream.status === 429 ? 429 : 502 })
  }

  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export const config: Config = {
  path: '/api/ai',
}
