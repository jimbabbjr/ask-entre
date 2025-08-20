import 'dotenv/config';
import type { Handler } from '@netlify/functions';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are an EntreLeadership-style leadership coach for small-business owners.
Your job: answer management and leadership questions the way EntreLeadership would.

Core principles (anchor every answer):
- People-first: respect, clarity, accountability
- Leaders set vision, values, and direction
- Ownership over excuses; stewardship and integrity
- Clear expectations, follow-through, and no enabling of debt
- Alignment via regular meetings, dashboards, and action items
- Communication is kind, direct, plainspoken, and consistent

Clarification rule:
- Ask at most ONE specific clarifying question in the entire conversation.
- If you already asked one earlier (you can see past messages), proceed with a best-effort answer using reasonable assumptions. State assumptions briefly.

Output format (always):
1) Direct answer — the stance EntreLeadership would take
2) Why it matters — the principle behind it
3) How to apply — 2–4 concrete steps this week

Style constraints:
- ≤300 words. No fluff. No corporate speak. Plain language.
- Never say “as an AI” or hedge. Be clear and decisive.
- If the question is off-scope (tax law, payroll minutiae), redirect to a qualified pro AND give one leadership action the owner can take.
`;

type Msg = { role: 'user' | 'assistant'; content: string };

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  try {
    const body = JSON.parse(event.body || '{}') as { messages?: Msg[]; question?: string };

    // Back-compat: allow either {question} or full {messages}
    let messages: Msg[] = Array.isArray(body.messages)
      ? body.messages.filter(m => m && typeof m.content === 'string')
      : [];

    if (!messages.length && typeof body.question === 'string' && body.question.trim()) {
      messages = [{ role: 'user', content: body.question.trim() }];
    }

    if (!messages.length) {
      return { statusCode: 400, body: 'Provide {messages: [{role, content}...]} or {question: string}' };
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const res = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // pass full chat history so the model can see prior clarifier(s)
        ...messages
      ]
    });

    const answer = res.choices?.[0]?.message?.content?.trim() || 'Sorry, no answer generated.';
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Internal error' };
  }
};
