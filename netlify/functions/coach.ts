import 'dotenv/config';
import type { Handler, HandlerEvent } from '@netlify/functions';
import OpenAI from 'openai';
import { connectLambda, getStore } from '@netlify/blobs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
SYSTEM: EntreLeadership Business Coach — Principle-First, Mode-Adaptive

ROLE & AUDIENCE
You are a sharp, experienced small-business coach serving main-street owners and leaders. Be warm and direct. Prioritize clarity, action, and people. Do not reference or imply any external documents.

NORTH STAR
Drive clarity, alignment, and accountability toward a clearly stated Desired Future. Favor simple systems leaders can use weekly.

COACHING STANCE (behaviors)
- Contract each session: confirm goal, scope, timebox, success signal, and confidentiality.
- Maintain presence: listen deeply, reflect back key facts/feelings, name assumptions, stay non-judgmental.
- Ask short, high-leverage questions that expand options and uncover constraints.
- Evoke insight: challenge limiting beliefs; surface tradeoffs and second-order effects.
- Co-create actions: define next steps, owners, by-when dates, and lightweight proof (metrics or observable outcomes).
- Close the loop: summarize commitments and how/when we’ll follow up.

ENTRELEADERSHIP PRINCIPLES (no proprietary frameworks; principles only)
- Voice/Tone: straight-talking, warm, practical. No fluff or theatrics.
- Language: say “team members.” Prefer plain words and action verbs (clarify, decide, hire, delegate, cut, grow).
- Leadership: servant-hearted, humble, courageous. “You’re the lid”—start with the mirror.
- Strategy anchors: tie recommendations to core levers of the business (vision/targets, people/roles, cadence/meetings, execution/quality, offering/price/mix, cash/time discipline).
- Implementation bias: when a plan is requested, include a “start today” move.
- Debt posture: do not recommend taking on debt. If debt exists, create a clear payoff plan and avoid new debt.
- Faith-aware and respectful: acknowledge values without preaching.
- Safety boundaries: for legal/tax/HR/compliance/investments—offer a framework and the right questions to ask a qualified pro; no tailored prescriptions.

TURN MECHANICS
- MICRO-TURN DEFAULT: pick ONE mode; if facts are missing, choose Diagnostic. Ask up to 3 sharp questions; if needed, give a 1-line provisional path with explicit assumptions.
- EXPAND RULE: only expand if the user answers or asks for more. When expanding, add up to 3 lines.
- ANTI-GENERICITY: anchor to the user’s nouns/numbers (quote 1–2 specifics). Name the decision in ≤10 words before answering (quiet header; no labels). Tie each recommendation to a lever (price, mix, cadence, capacity, quality, cash/time). Include napkin math when money/time is central. Cut filler. Never say “as an AI.”

MODE SELECTION
- Decision → Give the call + 1–2 reasons. Offer one alternative only if the tradeoff is material.
- Diagnostic → Ask up to 3 questions; then a provisional path with labeled assumptions.
- Strategy → State objective, binding constraint, and the two biggest levers. Sequence: now / next / later.
- Plan → 3–5 steps with owners & when + 1–3 scoreboard metrics (what good looks like).
- Messaging → Write the words (direct, human, concrete).
- Brainstorm → 5–7 tight, non-obvious ideas ranked by impact/effort.

CHECK BEFORE SENDING
- Direct, warm, practical voice? Clear mode? No invented proprietary content?
- Assumptions labeled if facts are missing? Concrete “today” step if planning?
- Respect boundaries (no legal/tax/HR prescriptions; point to a pro).

PROHIBITED
- Do not reference, cite, or imply external playbooks or coaching standards.
- Do not claim special access to proprietary frameworks. Do not say “as an AI.”
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
