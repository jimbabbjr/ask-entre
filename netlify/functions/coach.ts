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
- Debt is never recommended and when the business has debt already, it should be addressed with a clear plan for repayment and avoidance of further debt.
- Safety: for tax/legal/investments/HR compliance—give a framework + questions for a pro; no tailored prescriptions.

MICRO-TURN DEFAULT
- Pick ONE mode. If facts are missing, choose Diagnostic.
- Ask high-leverage questions to gain clarity on which mode to use. If needed, give a 1-line provisional path with explicit assumptions.
- Aim to keep each turn small and focused.

EXPAND RULE
- Only expand if the user says yes or answers the question. If they ask for more, add up to 3 lines.

MODE SELECTION
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
Tighten the DRAFT so it reflects EntreLeadership voice and principles—ONLY where relevant to the QUESTION.
Enforce MICRO-TURN and PLAIN TEXT.

Rules:
- PLAIN TEXT ONLY. No markdown, bullets, numbering, headings, or formatting characters (* # - _ ' []).
- Keep it short by default: max 5 lines (~18 words each). Allow up to 12 lines only if the user requested [detail:high].
- Ask at most ONE high-leverage question only if material facts are missing; if you ask a question, make it the last line, prefix with "Question:", and STOP.
- Pick ONE mode (Decision, Diagnostic, Strategy, Plan, Messaging, Brainstorm). Prefer Diagnostic only when facts are missing.
- Anchor to the user's nouns/numbers; be decisive; cut filler; tie to levers (cash, control, capacity, quality, time).
- Don’t invent EL tools or claims. If something isn’t taught directly, say so and proceed from principles.
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

function enforceMicroTurn(answer: string, lastUserMsg: string): string {
  // Strip list bullets at line start (markdown-looking)
  answer = answer.replace(/^\s*[-*#]\s?/gm, '');
  // Strip simple formatting markers
  answer = answer.replace(/[*`_]/g, '');

  const wantsHighDetail = /\[detail\s*:\s*high\]/i.test(lastUserMsg || '');
  const maxLines = wantsHighDetail ? 12 : 5;

  let lines = answer.split('\n').map(l => l.trim()).filter(Boolean);

  // If a Q: appears anywhere, keep up to and including the first Q: line, then stop.
  const qIdx = lines.findIndex(l => /^Q:\s?/i.test(l));
  if (qIdx >= 0) lines = lines.slice(0, qIdx + 1);

  // Enforce line budget
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);

  return lines.join('\n');
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
        // Meeting example — Diagnostic (with Q last)
        { role: 'assistant', content:
          `Reset the meeting with a tight agenda, clear roles, hard time boxes.
           Protect time: wins (3m), scorecard (5m), top 3 issues (20m), actions (5m).
           Assign facilitator, scribe, timekeeper; start/end on time; cap metrics to 5–7.
           If it still runs long, cut topics or park items with owners/dates.
           Question: What are your top 3 issues and who will facilitate?`
},

// Optional: Decision example — no question
        { role: 'assistant', content:
           `Keep the crew and raise price 5–8% to cut backlog.
            Protect quality: assign a working lead and weekly scorecard.
            Keep ≥6 months OPEX liquid before adding headcount.
            If close rate stays >55% after price change, add one crew next quarter.`
 },

        // Real conversation history (lets the model see if it already asked a clarifier)
        ...messages
      ]
    });

    let answer = res.choices?.[0]?.message?.content?.trim() || 'Sorry, no answer generated.';

    // Observability: question text
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // Always run brand review; enforce micro-turn plain text
const lines = answer.split('\n').filter(l => l.trim());
let isMicroTurn = lines.length <= 5 && !/[#*_`\-]/.test(answer) && /(?:^|\n)Q:\s?.+/.test(answer);

// Optional: allow longer replies when explicitly requested
const wantsHighDetail = /\[detail\s*:\s*high\]/i.test(lastUserMsg || '');
if (wantsHighDetail) {
  const L = answer.split('\n').filter(l => l.trim());
  isMicroTurn = L.length <= 12 && !/[#*_`\-]/.test(answer) && /(?:^|\n)Q:\s?.+/.test(answer);
}

// Run brand review and enforce micro-turn (no markdown, optional Q-last)
const reviewed = await brandReview({
  client,
  model,
  question: lastUserMsg,
  draft: answer,
});
if (reviewed && reviewed.trim()) {
  answer = enforceMicroTurn(reviewed, lastUserMsg);
} else {
  answer = enforceMicroTurn(answer, lastUserMsg);
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
