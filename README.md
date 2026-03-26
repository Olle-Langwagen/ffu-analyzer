# FFU Analyzer

## Live at: https://zooming-embrace-production.up.railway.app/

## What i built

I implemented streaming chat with using SSE. The backend now resolves `read_document` tool calls in the background and only streams the final answer text to the frontend.

I also implemented a structured response format for the final output (`answer`, `important_dates`, `risks`) so the UI can render the result in sections.

## Most important updates

- SSE streaming in `/chat` with token-by-token rendering
- Structured event for streaming events
- Structured response for final output, with fields for important dates and risks
- Frontend streaming parser with sequence handling and live UI updates
- Improved chat UX: dynamic thinking state, smart auto-scroll
- Themed UI (colors, typography, scrollbar)

## What i would do next

I would add fact-checking and retrieval capabilities to the agent so it can validate its own claims and cite specific sections of the contract. This would make the tool more trustworthy and useful.

I would also implement a more advanced UI with better formatting, such as highlighting important dates and risks, and allowing users to click on cited sections of the contract for more details.
