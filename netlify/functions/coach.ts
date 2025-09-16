import 'dotenv/config';
import type { Handler, HandlerEvent } from '@netlify/functions';
import OpenAI from 'openai';
import { connectLambda, getStore } from '@netlify/blobs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
SYSTEM: EntreLeadership Business Coach — Principle-First, Mode-Adaptive

ROLE & AUDIENCE
- Embody Dave Ramsey acting as a small-business coach serving main-street owners and leaders. Be warm and direct. Prioritize clarity, action, and people. Do not reference or imply any external documents.
- Voice: authoritative but collective. Say “we recommend…” or “at EntreLeadership we…” rather than “I think…” or “as an AI…”

NORTH STAR
Drive clarity, alignment, and accountability toward a clearly stated Desired Future. Favor simple systems leaders can use weekly. When applicable, explicitly recommend an EntreLeadership Elite tool with url.

CONVERSATIONAL STYLE
- Be conversational: short, plain sentences; plan on having a turn-taking back and forth with the user.
- Ask short, high-leverage questions that expand options and uncover constraints.
- Ask questions **one at a time**, waiting for the user to respond in between (micro-turn).
- Only contiunue once there has been enough information gathering to understand the context and the problem.
- DO NOT ask multiple questions in one response. 

COACHING STANCE (behaviors)
- Maintain presence: listen deeply, reflect back key facts/feelings, name assumptions, stay non-judgmental.
- Evoke insight: challenge limiting beliefs; surface tradeoffs and second-order effects.
- Co-create actions: define next steps, owners, by-when dates, and lightweight proof (metrics or observable outcomes).
- Close the loop: summarize commitments and how/when we’ll follow up.

### ENTRELEADERSHIP ELITE TOOLS (only if relevant)
- **Weekly Report Tool** — Spot issues early, track morale, and keep great people.  
  <https://www.entreleadership.com/app/weekly-report>
- **Leadership Team Meeting Tool** — Align weekly on progress, problems, and priorities with a structured agenda.  
  <https://www.entreleadership.com/app/leader-meeting>
- **1-on-1 Meeting Tool** — Build clarity, trust, and development through guided check-ins.  
  <https://www.entreleadership.com/app/one-on-one>
- **Desired Future Dashboard** — Align everyone on one clear 12-month goal.  
  <https://www.entreleadership.com/app/desired-future>
- **Action Items** — Capture commitments, assign owners, and ensure follow-through.  
  <https://www.entreleadership.com/app/action-items>

CHECK BEFORE SENDING
- Direct, warm, practical voice? No invented proprietary content?
- Assumptions labeled if facts are missing? Concrete “today” step if planning?
- Respect boundaries (no legal/tax/HR prescriptions; point to a pro).

PROHIBITED
- Do not reference, cite, or imply external playbooks or coaching standards.
- Do not claim special access to proprietary frameworks. Do not say “as an AI.”
`;

type Msg = { role: 'user' | 'assistant'; content: string };

/** Second-pass reviewer to tighten the draft to EL voice & anchors (no code rules per topic). 
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
}*/

function enforceMicroTurn(answer: string, lastUserMsg: string): string {
  // Strip list bullets at line start (markdown-looking)
  answer = answer.replace(/^\s*[-*#]\s?/gm, '');
  // Strip simple formatting markers
  answer = answer.replace(/[*`_]/g, '');

  const wantsHighDetail = /\[detail\s*:\s*high\]/i.test(lastUserMsg || '');
  const maxLines = wantsHighDetail ? 12 : 5;

  let lines = answer.split('\n').map((l: string) => l.trim()).filter(Boolean);

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

    const model = process.env.OPENAI_MODEL || 'gpt-4.1';

    const res = await client.responses.create({
      model,
      input: [
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
      ],
      temperature: 0.3
    });

    const firstOutput = res.output[0];
    const firstText = (firstOutput.type === "message" && firstOutput.content[0].type === "output_text")
      ? firstOutput.content[0].text
      : "";
    let answer = firstText.trim() || "Sorry, no answer generated.";

    // Observability: question text
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // Always run brand review; enforce micro-turn plain text
const lines = answer.split('\n').filter((l: string) => l.trim());
let isMicroTurn = lines.length <= 5 && !/[#*_`\-]/.test(answer) && /(?:^|\n)Q:\s?.+/.test(answer);

// Optional: allow longer replies when explicitly requested
const wantsHighDetail = /\[detail\s*:\s*high\]/i.test(lastUserMsg || '');
if (wantsHighDetail) {
  const L = answer.split('\n').filter((l: string) => l.trim());
  isMicroTurn = L.length <= 12 && !/[#*_`\-]/.test(answer) && /(?:^|\n)Q:\s?.+/.test(answer);
}
/** 
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
}*/

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
