// Calls any OpenAI-compatible chat API. The key stays on the server.
export const callLLM = async ({ messages, tools, json = false }) => {
  const body = {
    model: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.2,
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (json) body.response_format = { type: 'json_object' };

  const response = await fetch(`${process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`AI provider error ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message;
};