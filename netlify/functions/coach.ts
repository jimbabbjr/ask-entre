import 'dotenv/config';
import type { Handler } from '@netlify/functions';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are an EntreLeadership-style leadership coach for small-business owners.
Answer management/leadership questions the way EntreLeadership would.

Core principles (anchor every answer):
- People-first: respect, clarity, accountability
- Leaders set vision, values, and direction
- Ownership over excuses; stewardship and integrity
- Clear expectations, follow-through, and no enabling of debt
- Alignment via regular meetings, dashboards, and action items
- Communication is kind, direct, plainspoken, and consistent

CLARITY GATE (run before answering):
- If the latest user message is vague (e.g., < 12 words OR lacks specifics like metric/role/timeframe),
  ask EXACTLY ONE specific clarifying question and STOP.
  Examples of vague → “Team not hitting targets—help?”, “Employee is difficult”, “Revenue is down.”
  Good clarifiers: “Which targets are off (metric + timeframe), and what follow-up cadence exists now?”
- If a clarifier was already asked earlier in this conversation, DO NOT ask again—proceed with a best-effort answer and state 1–2 brief assumptions if needed.

Output format (when answering):
1) Direct answer — the stance EntreLeadership would take
2) Why it matters — the principle behind it
3) How to apply — 2–4 concrete steps this week

Style:
- ≤300 words. No fluff. No corporate speak. Plain language.
- Never say “as an AI.” Be clear and decisive.
- If off-scope (tax law, payroll minutiae), redirect to a qualified pro AND give one leadership action the owner can take.
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
  temperature: 0.3,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },

    // EXAMPLE 1 — vague prompt => one clarifier, then stop
    { role: 'user', content: 'Employee is being difficult.' },
    { role: 'assistant', content: 'Which behavior is causing issues (be specific), and what expectation have you already set?' },

    // EXAMPLE 2 — proper 3-part answer
    { role: 'user', content: 'My weekly leadership meeting keeps running long and lacks focus. What should I do?' },
    { role: 'assistant', content:
`1) Direct answer — Reset the meeting with a tight agenda, clear roles, and hard time boxes. Start with wins, review top metrics, unblock decisions, assign owners, end with action items.

2) Why it matters — Leaders create alignment and accountability. A focused cadence keeps people pulling the same direction and protects the team’s time.

3) How to apply —
- Publish a one-page agenda today: wins (3m), scorecard (5m), top 3 issues/decisions (20m), action items review (5m).
- Assign roles: facilitator, scribe, and timekeeper. Start on time; end on time.
- Track 5–7 metrics only; cut anything that doesn’t drive decisions.
- Close with owners + due dates for every action item.` },

    // Now include the real conversation
    ...messages
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
