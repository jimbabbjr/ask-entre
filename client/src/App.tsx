import { useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      const answer = (data?.answer || 'No answer.').trim();
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (e) {
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

  const lastAnswer = messages.length && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].content
    : '';

  return (
    <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Ask EntreLeadership</h1>
      <p style={{ color: '#6b7280', marginTop: 0, marginBottom: 16 }}>
        Ask a leadership/management question. Press <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> to send.
      </p>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            background: m.role === 'user' ? '#f3f4f6' : '#eef6ff',
            padding: '12px 14px',
            borderRadius: 12,
            whiteSpace: 'pre-wrap'
          }}>
            <b>{m.role === 'user' ? 'You' : 'Coach'}:</b> {m.content}
          </div>
        ))}
      </div>

      <textarea
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        placeholder='e.g., "How do I hold my sales manager accountable without killing morale?"'
        style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid #d1d5db' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={ask} disabled={loading} style={{ padding: '8px 12px', borderRadius: 10 }}>
          {loading ? 'Thinking…' : 'Ask (⌘/Ctrl+Enter)'}
        </button>
        {lastAnswer && (
          <>
            <button
              onClick={() => navigator.clipboard.writeText(lastAnswer)}
              style={{ padding: '8px 12px', borderRadius: 10 }}
            >
              Copy answer
            </button>
            <Thumbs
  lastQuestion={messages.filter(m => m.role === 'user').slice(-1)[0]?.content || ''}
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
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setGood(true); setOpen(true); }}>👍 Felt like EntreLeadership</button>
        <button onClick={() => { setGood(false); setOpen(true); }}>👎 Generic / off-brand</button>
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
    } catch (e) {
      alert('Could not send feedback. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        placeholder="Why?"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid #d1d5db' }}
      />
      <button onClick={send} disabled={sending} style={{ padding: '8px 12px', borderRadius: 10 }}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

