import { FormEvent, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const ui = {
  page: { margin: 0, minHeight: '100vh', background: '#f3f1e8', color: '#101b3d', fontFamily: 'Tektur, Segoe UI, sans-serif' },
  app: { maxWidth: 860, margin: '0 auto', padding: 24, display: 'grid', gap: 12 },
  chat: {
    minHeight: 420,
    maxHeight: '65vh',
    padding: 16,
    border: '1px solid #d8d3c6',
    borderRadius: 16,
    background: 'linear-gradient(180deg, #f8f6ef 0%, #f2eee4 100%)',
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    display: 'grid',
    gap: 12,
    alignContent: 'start' as const,
    boxShadow: '0 10px 24px rgba(16, 27, 61, 0.08)',
    boxSizing: 'border-box' as const,
    scrollbarGutter: 'stable both-edges' as const,
  },
  form: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  field: { padding: '11px 13px', border: '1px solid #cbc6b8', borderRadius: 10, background: '#fcfbf7', font: 'inherit', color: '#101b3d' },
  sendBtn: {
    padding: '11px 18px',
    border: '1px solid #0c1a44',
    borderRadius: 10,
    background: '#0c1a44',
    color: '#f7f6f1',
    font: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
  },
  processBtn: {
    padding: '10px 13px',
    border: '1px solid #cbc6b8',
    borderRadius: 10,
    background: '#f8f4ea',
    color: '#101b3d',
    font: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
  },
  msg: {
    maxWidth: '72ch',
    width: 'fit-content' as const,
    alignSelf: 'start' as const,
    padding: '10px 13px',
    borderRadius: 14,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.55,
    fontSize: 15,
    boxShadow: '0 2px 7px rgba(16, 27, 61, 0.06)',
  },
  user: { justifySelf: 'end', background: '#0f1e49', color: '#fbfaf5', border: '1px solid #0b173a' },
  assistant: { justifySelf: 'start', background: '#fbf9f3', color: '#101b3d', border: '1px solid #d8d3c6', fontFamily: 'Platypi, Georgia, serif', letterSpacing: '-0.01em' },
  sectionTitle: { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.7, color: '#ff3a1f', textTransform: 'uppercase' as const, marginBottom: 5 },
  list: { margin: '4px 0 0', paddingLeft: 18 },
  cursor: { display: 'inline-block', marginLeft: 2, color: '#ff3a1f', animation: 'none' as const },
}

function App() {
  const [status, setStatus] = useState('')
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const lastSequenceRef = useRef(0)
  const chatRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const latest = messages[messages.length - 1]
  const showThinkingBubble = Boolean(
    thinking && latest && latest.role === 'assistant' && latest.content.trim() === ''
  )
  const showStreamingCursor = Boolean(
    thinking && latest && latest.role === 'assistant' && latest.content.trim() !== ''
  )
  const thinkingLabel = status || 'Thinking...'

  const extractStreamingAnswerPreview = (raw: string): string | null => {
    const marker = '"answer":"'
    const start = raw.indexOf(marker)
    if (start === -1) return null

    let i = start + marker.length
    let out = ''
    let escaped = false

    while (i < raw.length) {
      const ch = raw[i]
      i += 1

      if (escaped) {
        if (ch === 'n') out += '\n'
        else if (ch === 't') out += '\t'
        else out += ch
        escaped = false
        continue
      }

      if (ch === '\\') {
        escaped = true
        continue
      }

      if (ch === '"') break
      out += ch
    }

    return out.length ? out : null
  }

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    const el = chatRef.current
    if (!el || !shouldAutoScrollRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, status, thinking])

  const onChatScroll = () => {
    const el = chatRef.current
    if (!el) return
    const threshold = 48
    shouldAutoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold
  }

  const processFfu = async () => {
    setStatus('Processing...')

    const data = await fetch('https://ffu-analyzer-production-d622.up.railway.app/process', { method: 'POST' }).then((r) => r.json())
    setStatus(`${data.status}: ${data.count} document(s) processed`)
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || thinking) return
    const history = [...messages]
    const userMessage = input.trim()
    setInput('')
    setThinking(true)
    setStatus('Preparing response...')
    setMessages([...history, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }])
    lastSequenceRef.current = 0
    shouldAutoScrollRef.current = true

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    const appendToken = (token: string) => {
      setMessages((prev) => {
        const next = [...prev]
        const lastIndex = next.length - 1
        if (lastIndex >= 0 && next[lastIndex].role === 'assistant') {
          next[lastIndex] = { ...next[lastIndex], content: next[lastIndex].content + token }
        }
        return next
      })
    }

    const setAssistantText = (text: string) => {
      setMessages((prev) => {
        const next = [...prev]
        const lastIndex = next.length - 1
        if (lastIndex >= 0 && next[lastIndex].role === 'assistant') {
          next[lastIndex] = { ...next[lastIndex], content: text }
        }
        return next
      })
    }

    const handleLifecycle = (phase: string) => {
      if (phase === 'accepted') setStatus('Request accepted...')
      if (phase === 'tool_resolution_started') setStatus('Analyzing and retrieving context...')
      if (phase === 'tool_resolution_done') setStatus('Context ready, generating response...')
      if (phase === 'generation_started') setStatus('Streaming answer...')
      if (phase === 'generation_done') setStatus('')
    }

    const handleEvent = (rawEvent: string) => {
      const lines = rawEvent.split('\n')
      const dataLines: string[] = []
      for (const line of lines) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) return

      const envelope = JSON.parse(dataLines.join('\n')) as {
        sequence: number
        event_type: string
        payload: Record<string, unknown>
      }

      if (typeof envelope.sequence === 'number' && envelope.sequence <= lastSequenceRef.current) return
      if (typeof envelope.sequence === 'number') lastSequenceRef.current = envelope.sequence

      if (envelope.event_type === 'lifecycle') {
        const phase = String(envelope.payload.phase ?? '')
        handleLifecycle(phase)
      }

      if (envelope.event_type === 'token') {
        appendToken(String(envelope.payload.delta ?? ''))
      }

      if (envelope.event_type === 'done') {
        const result = envelope.payload.result as { answer?: string; important_dates?: string[]; risks?: string[] } | undefined
        if (result) {
          setAssistantText(JSON.stringify({
            answer: result.answer ?? '',
            important_dates: Array.isArray(result.important_dates) ? result.important_dates : [],
            risks: Array.isArray(result.risks) ? result.risks : [],
          }))
        }
        setStatus('')
      }

      if (envelope.event_type === 'error') {
        const msg = String(envelope.payload.message ?? 'Unknown streaming error')
        setStatus(`Error: ${msg}`)
      }
    }

    try {
      
      //
      const response = await fetch('https://ffu-analyzer-production-d622.up.railway.app/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, history, stream: true }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          if (event.trim()) handleEvent(event)
        }
      }

      if (buffer.trim()) handleEvent(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Error: ${message}`)
      setMessages((prev) => {
        const next = [...prev]
        const lastIndex = next.length - 1
        if (lastIndex >= 0 && next[lastIndex].role === 'assistant' && !next[lastIndex].content) {
          next[lastIndex] = { ...next[lastIndex], content: 'Unable to stream response.' }
        }
        return next
      })
    } finally {
      setThinking(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <div style={ui.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Platypi:wght@300;400;500&family=Tektur:wght@400;500;600;700&display=swap');

        .chat-scroll {
          scrollbar-width: thin;
          scrollbar-color: #c2baab #f2eee4;
        }

        .chat-scroll::-webkit-scrollbar {
          width: 10px;
        }

        .chat-scroll::-webkit-scrollbar-track {
          background: #f2eee4;
          border-radius: 999px;
          margin: 6px 0;
        }

        .chat-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #d2cab9 0%, #beb5a3 100%);
          border: 2px solid #f2eee4;
          border-radius: 999px;
        }

        .chat-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #c6bea9 0%, #afa690 100%);
        }
      `}</style>
      <div style={ui.app}>
        <button onClick={processFfu} style={ui.processBtn}>Process FFU</button>
        <div className="chat-scroll" style={ui.chat} ref={chatRef} onScroll={onChatScroll}>
          {messages.map((message, i) => {
            if (message.role === 'user') { // make sure to not parse user messages
              return <div key={i} style={{ ...ui.msg, ...ui.user }}>{message.content}</div>
            }

            if (!message.content.trim()) return null

            let parsed = null; // Try parse response as JSON
            try {
              parsed = JSON.parse(message.content);
            } catch (e) {
              const preview = extractStreamingAnswerPreview(message.content)
              const fallback = message.content
                .replace(/\\n/g, '\n')
                .replace(/\\"/g, '"')
              return (
                <div key={i} style={{ ...ui.msg, ...ui.assistant }}>
                  {preview ?? fallback}
                  {showStreamingCursor && i === messages.length - 1 && <span style={ui.cursor}>|</span>}
                </div>
              )
            }

            return (
              <div key={i} style={{ ...ui.msg, ...ui.assistant, display: 'flex', flexDirection: 'column', gap: '12px' }}>

                {/* Main text response */}
                <div>{parsed.answer}</div>

                {/* Dates, as list */}
                {parsed.important_dates && parsed.important_dates.length > 0 && (
                  <div>
                    <span style={ui.sectionTitle}>Viktiga datum</span>
                    <ul style={ui.list}>
                      {parsed.important_dates.map((datum: string, idx: number) => (
                        <li key={idx}>{datum}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks, as list */}
                {parsed.risks && parsed.risks.length > 0 && (
                  <div>
                    <span style={ui.sectionTitle}>Risker & krav</span>
                    <ul style={ui.list}>
                      {parsed.risks.map((risk: string, idx: number) => (
                        <li key={idx}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            )
          })}

          {showThinkingBubble && <div style={{ ...ui.msg, ...ui.assistant, color: '#5b5a55' }}>{thinkingLabel}</div>}
        </div>
        <form onSubmit={send} style={ui.form}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the FFU documents" style={ui.field} />
          <button style={ui.sendBtn}>Send</button>
        </form>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
