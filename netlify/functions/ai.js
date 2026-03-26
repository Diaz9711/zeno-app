// Netlify serverless function — proxies ZENO requests to Google Gemini API (FREE)
// Deploy: add GEMINI_API_KEY to Netlify environment variables
// Get free key at: aistudio.google.com/apikey — no credit card needed

const GEMINI_MODEL = 'gemini-1.5-flash';

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'GEMINI_API_KEY not configured in Netlify environment variables' } })
    };
  }

  try {
    // Client sends Anthropic format — translate to Gemini
    const body = JSON.parse(event.body);
    const { system, messages, max_tokens = 1000 } = body;

    // Convert messages to Gemini format
    const contents = (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{
        text: typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map(c => c.text || '').join('')
            : String(m.content)
      }]
    }));

    const geminiBody = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(max_tokens, 8192),
        temperature: 0.75,
      }
    };

    // System prompt
    if (system) {
      geminiBody.systemInstruction = {
        parts: [{
          text: typeof system === 'string'
            ? system
            : Array.isArray(system)
              ? system.map(s => s.text || '').join('')
              : String(system)
        }]
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: { message: data.error?.message || `Gemini error ${response.status}` } })
      };
    }

    // Translate Gemini response → Anthropic format (client expects this shape)
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const anthropicResponse = {
      content: [{ type: 'text', text }],
      model: GEMINI_MODEL,
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount || 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
      }
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(anthropicResponse),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};
