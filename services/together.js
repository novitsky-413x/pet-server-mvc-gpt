const { TextDecoder } = require('util');

const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';

async function nonStreamingChat({
    model,
    messages,
    temperature = 0.3,
    top_p = 0.9,
    max_tokens = 4096,
    signal,
}) {
    const res = await fetch(TOGETHER_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model || process.env.TOGETHER_MODEL,
            messages,
            temperature,
            top_p,
            max_tokens,
            stream: false,
        }),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Together API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return {
        content: data?.choices?.[0]?.message?.content || '',
        usage: data?.usage || null,
        raw: data,
    };
}

async function* streamingChat({
    model,
    messages,
    temperature = 0.3,
    top_p = 0.9,
    max_tokens = 4096,
    signal,
}) {
    const res = await fetch(TOGETHER_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model || process.env.TOGETHER_MODEL,
            messages,
            temperature,
            top_p,
            max_tokens,
            stream: true,
        }),
        signal,
    });
    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(`Together API stream error ${res.status}: ${text}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
            const chunk = decoder.decode(result.value, { stream: true });
            const events = chunk.split('\n\n');
            for (const evt of events) {
                const line = evt.trim();
                if (!line) continue;
                if (line.startsWith('data:')) {
                    const payload = line.slice(5).trim();
                    if (payload === '[DONE]') return;
                    try {
                        const json = JSON.parse(payload);
                        const delta = json?.choices?.[0]?.delta?.content || '';
                        if (delta) yield delta;
                    } catch (_) {
                        // ignore malformed lines
                    }
                }
            }
        }
    }
}

module.exports = {
    nonStreamingChat,
    streamingChat,
};
