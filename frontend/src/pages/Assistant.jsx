import { useEffect, useRef, useState } from 'react';
import api from '../api';

export default function Assistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages([...messages, { role: 'user', content: text }]);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const { data } = await api.post('/ai/chat', { message: text, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, label: data.label }]);
    } catch (err) {
      setError(err.response?.data?.error || 'The assistant is unavailable right now');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>AI assistant</h1>
      <p><small>Ask about attendance, leave, payroll or company policy. Answers come from real data.</small></p>

      <div className="chat">
        {messages.length === 0 && <p className="chat-empty">Try: "How many sick leaves do I have left?"</p>}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
            {m.label && <div><small>{m.label}</small></div>}
          </div>
        ))}
        {loading && <div className="bubble assistant">Thinking...</div>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="error">{error}</p>}

      <form className="row" onSubmit={send}>
        <input
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Type your question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button disabled={loading}>Send</button>
      </form>
    </div>
  );
}