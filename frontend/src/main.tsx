import { FormEvent, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const ui = {
  page: { margin: 0, minHeight: '100vh', background: '#f2f2f2', color: '#222', fontFamily: 'system-ui, sans-serif' },
  app: { maxWidth: 800, margin: '0 auto', padding: 24, display: 'grid', gap: 12 },
  chat: { minHeight: 360, padding: 12, border: '1px solid #ddd', background: '#fafafa', overflow: 'auto', display: 'grid', gap: 8 },
  form: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  field: { padding: '10px 12px', border: '1px solid #ccc', background: '#fff', font: 'inherit' },
  msg: { maxWidth: '80%', padding: '10px 12px', borderRadius: 8, whiteSpace: 'pre-wrap' as const },
  user: { justifySelf: 'end', background: '#dcdcdc' },
  assistant: { justifySelf: 'start', background: '#ededed' },
}

function App() {
  const [status, setStatus] = useState('')
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])

  const processFfu = async () => {
    setStatus('Processing...')
    const data = await fetch('https://ffu-analyzer-production-d622.up.railway.app/process', { method: 'POST' }).then((r) => r.json())
    setStatus(`${data.status}: ${data.count} document(s) processed`)
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || thinking) return
    const history = [...messages]
    setInput('')
    setThinking(true)
    setMessages([...history, { role: 'user', content: input.trim() }])
    const data = await fetch('https://ffu-analyzer-production-d622.up.railway.app/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input.trim(), history }),
    }).then((r) => r.json())
    setMessages((m) => [...m, { role: 'assistant', content: data.response }])
    setThinking(false)
  }

  return (
    <div style={ui.page}>
      <div style={ui.app}>
        <button onClick={processFfu} style={ui.field}>Process FFU</button>
        <div>{status}</div>
        <div style={ui.chat}>
          {messages.map((message, i) => {
            if (message.role === 'user') { // make sure to not parse user messages
              return <div key={i} style={{ ...ui.msg, ...ui.user }}>{message.content}</div>
            }

            let parsed = null; // Try parse response as JSON
            try {
              parsed = JSON.parse(message.content);
            } catch (e) {
              // Not JSON
              return <div key={i} style={{ ...ui.msg, ...ui.assistant }}>{message.content}</div>
            }

            return (
              <div key={i} style={{ ...ui.msg, ...ui.assistant, display: 'flex', flexDirection: 'column', gap: '12px' }}>

                {/* Main text response */}
                <div>{parsed.answer}</div>

                {/* Dates, as list */}
                {parsed.important_dates && parsed.important_dates.length > 0 && (
                  <div>
                    <strong>Viktiga datum</strong>
                    <ul>
                      {parsed.important_dates.map((datum: string, idx: number) => (
                        <li key={idx}>{datum}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks, as list */}
                {parsed.risks && parsed.risks.length > 0 && (
                  <div>
                    <strong>Risker & krav</strong>
                    <ul>
                      {parsed.risks.map((risk: string, idx: number) => (
                        <li key={idx}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            )
          })}

          {thinking && <div style={{ ...ui.msg, ...ui.assistant, color: '#666' }}>Thinking...</div>}
        </div>
        <form onSubmit={send} style={ui.form}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the FFU documents" style={ui.field} />
          <button style={ui.field}>Send</button>
        </form>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
