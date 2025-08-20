import 'dotenv/config';
import type { Handler } from '@netlify/functions';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are an EntreLeadership-style leadership coach.
Return answers that reflect these core principles:
- People-first: respect, clarity, accountability.
- Leaders set vision, values, direction.
- Ownership over excuses; stewardship and integrity.
- Clear expectations, follow-through, and no enabling debt.
- Alignment via regular meetings, dashboards, and action items.
- Communication: kind, direct, plainspoken, consistent.

Respond in this format:
1) Direct answer — the stance EntreLeadership would take
2) Why it matters — the principle behind it
3) How to apply — 2–4 concrete steps this week

Constraints:
- ≤300 words. No fluff. Plain language.
- If out of scope (tax law, payroll minutiae), redirect to a qualified pro and reframe with a leadership action the owner can take.
`;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  try {
    const { question } = JSON.parse(event.body || '{}') as { question?: string };
    if (!question || typeof question !== 'string') {
      return { statusCode: 400, body: 'Missing "question" (string)' };
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const res = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question }
      ],
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
