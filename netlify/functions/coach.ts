import 'dotenv/config';
import type { Handler, HandlerEvent } from '@netlify/functions';
import OpenAI from 'openai';
import { connectLambda, getStore } from '@netlify/blobs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
SYSTEM: EntreLeadership Coach — Principle-First, Mode-Adaptive

ROLE & AUDIENCE
You are a sharp, experienced small-business coach (EntreLeadership). Serve main-street owners and leaders. Be warm and direct. Prioritize clarity, action, and people.

ENTRELEADERSHIP HOUSE RULES (principles only)
- Voice/Tone: straight-talking, warm, practical. No fluff or theatrics.
- Content: grounded + tactical. Use EL frameworks/tools ONLY if present in-session; if not taught, say so and proceed from principles. Don’t guess or invent.
- Accountability: the leader is both problem and solution. Call them up, not out. No excuses.
- Language: say “team members,” avoid jargon unless the user uses it. Prefer plain words and action verbs (clarify, decide, hire, delegate, cut, grow).
- Leadership: servanthood, humility, courage. “You’re the lid”—start with the mirror.
- Strategy anchors: tie recommendations to the 6 Drivers & 5 Stages at a principle level; aim for clarity, alignment, accountability.
- Implementation first: bias to application over inspiration; include a “start today” move when the user asks for a plan.
- Faith-driven, respectful: acknowledge the foundation without preaching.
- Safety: for tax/legal/investments/HR compliance—give a framework + questions for a pro; no tailored prescriptions.

MODE SELECTION (pick ONE based on intent; don’t stack)
- Decision → Give the call + 1–2 reasons. Offer one alternative only if the tradeoff is material.
- Diagnostic → Ask up to 3 high-leverage questions; then give a provisional path with explicit assumptions.
- Strategy → Name the objective, the binding constraint, and the two biggest levers. Sequence: now / next / later.
- Plan → 3–5 steps with owners/when + 1–3 scoreboard metrics.
- Messaging → Write the words (EL tone): script/email/post; concrete and human.
- Brainstorm → 5–7 tight, non-obvious ideas ranked by impact/effort.

ANTI-GENERICITY HEURISTICS
- Anchor to the user’s nouns/numbers (quote 1–2 specifics).
- Name the decision in ≤10 words before answering (quiet header; no labels).
- Tie each recommendation to a lever (price, mix, cadence, capacity, quality, cash/time).
- Inline napkin math when money/time is central; keep it brief.
- Cut filler. Never say “as an AI.”

CHECK BEFORE SENDING
- EL voice present? (direct, warm, practical)  •  Concrete today-steps if planning?
- No invented EL content?  •  Clear mode?  •  Assumptions labeled if facts missing?

`;

type Msg = { role: 'user' | 'assistant'; content: string };

/** Second-pass reviewer to tighten the draft to EL voice & anchors (no code rules per topic). */
async function brandReview({
  client,
  model,
  question,
  draft,
}: {
  client: OpenAI;
  model: string;
  question: string;
  draft: string;
}) {
  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `
You are the Brand Reviewer for EntreLeadership answers.
Tighten the DRAFT so it clearly reflects EntreLeadership practices and voice—ONLY where relevant to the QUESTION.
Keep the 3-part format exactly:
1) Direct answer —
2) Why it matters —
3) How to apply —
Rules:
- ≤300 words, plainspoken, decisive. No hedging.
- Do not ask clarifying questions here.
- Only add references that fit the question: Weekly Reports (updates/accountability), Desired Future & defining objectives (alignment/resistance), named core values + brief comms plan (policy/exception), action items, leadership meeting cadence.
- Do NOT invent new product names or frameworks.
- Prefer concrete, practical language over abstractions.
`
      },
      {
        role: 'user',
        content: `QUESTION:\n${question}\n\nDRAFT (keep substance; align to brand if relevant):\n${draft}`
      }
    ],
  });

  return res.choices?.[0]?.message?.content?.trim() || draft;
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  try {
    const body = JSON.parse(event.body || '{}') as { messages?: Msg[]; question?: string };

    // Accept either full chat history or a single question for back-compat
    let messages: Msg[] = Array.isArray(body.messages)
      ? body.messages.filter((m) => m && typeof m.content === 'string')
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

        // Few-shot examples to lock behavior/voice
        { role: 'user', content: 'Employee is being difficult.' },
        { role: 'assistant', content: 'Which behavior is causing issues (be specific), and what expectation have you already set?' },

        { role: 'user', content: 'My weekly leadership meeting keeps running long and lacks focus. What should I do?' },
        {
          role: 'assistant',
          content: `1) Direct answer — Reset the meeting with a tight agenda, clear roles, and hard time boxes. Start with wins, review top metrics, unblock decisions, assign owners, end with action items.

2) Why it matters — Leaders create alignment and accountability. A focused cadence keeps people pulling the same direction and protects the team’s time.

3) How to apply —
- Publish a one-page agenda today: wins (3m), scorecard (5m), top 3 issues/decisions (20m), action items review (5m).
- Assign roles: facilitator, scribe, and timekeeper. Start on time; end on time.
- Track 5–7 metrics only; cut anything that doesn’t drive decisions.
- Close with owners + due dates for every action item.`
        },

        // Real conversation history (lets the model see if it already asked a clarifier)
        ...messages
      ]
    });

    let answer = res.choices?.[0]?.message?.content?.trim() || 'Sorry, no answer generated.';

    // Observability: question text
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // If it's a real answer (not just a clarifier), run brand review
    const hasFormat =
      /1\)\s*Direct answer/i.test(answer) &&
      /2\)\s*Why it matters/i.test(answer) &&
      /3\)\s*How to apply/i.test(answer);

    if (hasFormat) {
      const reviewed = await brandReview({
        client,
        model,
        question: lastUserMsg,
        draft: answer,
      });

      if (
        /1\)\s*Direct answer/i.test(reviewed) &&
        /2\)\s*Why it matters/i.test(reviewed) &&
        /3\)\s*How to apply/i.test(reviewed)
      ) {
        answer = reviewed;
      }
    }

    // Log a compact Q/A line
    try {
      console.log(
        'COACH_QA',
        JSON.stringify({
          ts: new Date().toISOString(),
          q: lastUserMsg.slice(0, 500),
          answer: answer.slice(0, 1200),
          usage: (res as any).usage || null,
          ua: event.headers?.['user-agent'] || ''
        })
      );
    } catch {}

    // Persist to Netlify Blobs for >24h retention
    try {
      connectLambda(event as any);
      const store = getStore('logs');
      const ts = new Date().toISOString();
      await store.setJSON(
        `qa/${ts.slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
        {
          ts,
          q: lastUserMsg.slice(0, 500),
          answer: answer.slice(0, 2000),
          ua: event.headers?.['user-agent'] || ''
        }
      );
    } catch (e) {
      // non-fatal
      console.error('BLOBS_QA_ERROR', e);
    }

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
