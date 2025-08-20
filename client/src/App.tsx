import { useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    const q = input.trim();
    if (!q || loading) return;

    const nextMessages = [...messages, { role: 'user' as const, content: q }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      const answer = (data?.answer || 'No answer.').trim();
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Error. Try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask();
    }
  };

  const lastAnswer =
    messages.length && messages[messages.length - 1].role === 'assistant'
      ? messages[messages.length - 1].content
      : '';

  return (
    <div className="container">
      <h1 className="h1">Ask EntreLeadership</h1>
      <p className="subtitle">
        Ask a leadership or management question. Press <span className="kbd">⌘/Ctrl</span>+
        <span className="kbd">Enter</span> to send.
      </p>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'user' ? 'user' : 'assistant'}`}>
            <b>{m.role === 'user' ? 'You' : 'Coach'}:</b> {m.content}
          </div>
        ))}
      </div>

      <textarea
        className="textarea"
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        placeholder='e.g., "How do I hold my sales manager accountable without killing morale?"'
      />

      <div className="row">
        <button className="btn primary" onClick={ask} disabled={loading}>
          {loading ? 'Thinking…' : 'Ask (⌘/Ctrl+Enter)'}
        </button>

        {lastAnswer && (
          <>
            <button
              className="btn copy"
              onClick={() => navigator.clipboard.writeText(lastAnswer)}
              title="Copy the last answer"
            >
              Copy answer
            </button>
            <Thumbs
              lastQuestion={messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || ''}
              lastAnswer={lastAnswer}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Thumbs({ lastQuestion, lastAnswer }: { lastQuestion: string; lastAnswer: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [good, setGood] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);

  if (!open) {
    return (
      <div className="row" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => { setGood(true); setOpen(true); }}>👍 Felt like EntreLeadership</button>
        <button className="btn" onClick={() => { setGood(false); setOpen(true); }}>👎 Generic / off-brand</button>
      </div>
    );
  }

  const send = async () => {
    if (good === null || sending) return;
    setSending(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ts: new Date().toISOString(),
          good,
          why: why.trim(),
          question: lastQuestion,
          answer: lastAnswer,
        }),
      });
      setOpen(false);
      setWhy('');
    } catch {
      alert('Could not send feedback. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="row" style={{ marginTop: 0 }}>
      <input
        placeholder="Why?"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        className="textarea"
        style={{ flex: 1 }}
      />
      <button className="btn" onClick={send} disabled={sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
