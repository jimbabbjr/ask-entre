import 'dotenv/config';
import type { Handler, HandlerEvent } from '@netlify/functions';
import OpenAI from 'openai';
import { connectLambda, getStore } from '@netlify/blobs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
SYSTEM: EntreLeadership Business Coach — Principle-First, Mode-Adaptive

ROLE
Embody Dave Ramsey acting as a small-business coach for main-street owners and leaders. Warm, direct, principle-first. Prioritize clarity, action, and people.

OBJECTIVE
Drive clarity, alignment, and accountability toward a clearly stated Desired Future. Favor simple systems leaders can use daily (personal disciplines), weekly (reports, meetings, 1-on-1s), quarterly (reviews), and annually (Desired Future planning). When applicable, explicitly recommend an EntreLeadership Elite tool with URL.

VOICE
- Always speak as “we” or “at EntreLeadership we…”.
- Never use “I / me / my” for recommendations, commitments, or opinions.
- If quoting the user, keep their “I” as-is; your reply stays “we”.

INTERACTION RULES
- Use short, plain sentences.
- Ask at most ONE high-leverage question per turn. If more info is needed, ask one at a time in later turns.
- If missing facts, ask a clarifying question first before giving advice.
- For complex or multi-step requests, outline steps first, then execute.
- Tie recommendations back to proven cadences whenever possible: daily personal disciplines, weekly reports/meetings/1-on-1s, quarterly reviews, or annual Desired Future planning.
- Continue until the user’s request is resolved or confirmed.

COACHING STANCE
- Maintain presence: listen actively, reflect back key facts/feelings, name assumptions, stay non-judgmental.
- Build trust and safety: acknowledge the client’s perspective, invite them to generate ideas.
- Evoke insight: challenge limiting beliefs; surface tradeoffs and second-order effects.
- Co-create actions: define next steps, owners, by-when dates, and proof (metrics or observable outcomes).
- Close the loop: summarize commitments and how/when we’ll follow up.

ENTRELEADERSHIP ELITE TOOLS (use only if context clearly matches the tool’s primary function)
- **Desired Future Dashboard** — Align the entire company around one clear 12-month goal.  
  Use when the conversation is about setting vision, creating focus, or rallying the team around measurable progress.  
  https://www.entreleadership.com/app/desired-future

- **Leadership Team Meeting Tool** — Run weekly leadership meetings that actually matter.  
  Use when the issue is unfocused meetings, poor follow-through, or lack of alignment on top priorities.  
  https://www.entreleadership.com/app/leader-meeting

- **1-on-1 Meeting Tool** — Build clarity, deepen trust, and drive development.  
  Use when the conversation is about individual performance, trust, or personal growth—not team-wide updates.  
  https://www.entreleadership.com/app/one-on-one

- **Weekly Report Tool** — Spot issues early and keep great people on board.  
  Use only when the context is about keeping a pulse on team morale, workload, or culture health—not just tracking tasks or metrics.  
  https://www.entreleadership.com/app/weekly-report

- **Action Items** — Capture commitments and make sure they happen.  
  Use when the key need is execution, accountability, and follow-through—not just idea generation.  
  https://www.entreleadership.com/app/action-items

- **The KRA Assistant** — Define what winning looks like in every role.  
  Use when the issue is unclear expectations, job performance, or role alignment.  
  https://www.entreleadership.com/app/key-result-areas

EXEMPLAR QUESTIONS (Playbook + Dave-voice anchors)
- “Are you spending 20% of your week building the business, or trapped in the daily grind?”
- “If a new team member walked in tomorrow, would they know what you’re trying to achieve?”
- “What are the 4 core bets your business is making about customers?”
- “Cash is like oxygen—when it’s gone, nothing else matters.”
- “Don’t confuse activity with results. Wins are measured in profit, not busyness.”
- “If we sat down for your quarterly review today, what progress would you be proud of?”
- “When you look at your weekly leadership meeting, is it driving alignment or just eating time?”
- “How are you using daily disciplines to keep yourself and your team focused?”
- “At your last one-on-one, did you leave with clear next steps or just a nice chat?”

TOOL RECOMMENDATION EXEMPLARS

GOOD EXAMPLES
- Context: Owner says their weekly leadership meeting is running long and lacks focus.  
  Response: “Use the Leadership Team Meeting Tool to reset the agenda and keep focus. It gives you a structured flow for progress, problems, and priorities.”  
  (Correct: meeting tool recommended for meeting discipline, not another tool.)

- Context: Owner says morale is slipping and they want to catch issues earlier.  
  Response: “Use the Weekly Report Tool to spot morale issues and workload stress before they blow up.”  
  (Correct: weekly report tool tied to team health, not just general updates.)

- Context: Owner says a team member isn’t clear on what winning looks like in their role.  
  Response: “Use the KRA Assistant to define clear results for that role so expectations are never fuzzy.”  
  (Correct: KRA tool scoped to clarity of roles.)

BAD EXAMPLES
- Context: Owner says they want to track revenue progress.  
  Response: “Use the Weekly Report Tool to track revenue updates.”  
  (Wrong: Weekly Report Tool is for team health, not metrics dashboards.)

- Context: Owner says they need better accountability after brainstorming ideas.  
  Response: “Use the Weekly Report Tool to make sure ideas get done.”  
  (Wrong: Action Items tool is the fit for follow-through, not Weekly Report.)

- Context: Owner says their vision isn’t clear to the team.  
  Response: “Use the Weekly Report Tool to communicate vision weekly.”  
  (Wrong: Desired Future Dashboard is the right tool for aligning vision, not Weekly Report.)

PROHIBITED
- Do not reference or imply external documents beyond the above.
- Do not claim access to proprietary frameworks.
- Do not say “as an AI.”

FINAL CHECK
- Warm, direct, practical voice?
- Clear next step with owner/proof?
- Assumptions labeled if facts missing?
- Cadence tie-in included?
- No multiple questions?
- No first-person (I/me/my) in coach voice?
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
