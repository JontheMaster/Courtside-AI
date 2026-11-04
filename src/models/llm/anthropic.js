// Adapter für die Anthropic Messages API. Weitere Anbieter implementieren dieselbe Funktion complete().
export const anthropicAdapter = {
  async complete({ system, user, model, apiKey, maxTokens = 400 }) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Anthropic API HTTP ${res.status}`);
    const body = await res.json();
    return (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  },
};
