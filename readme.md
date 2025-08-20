# Ask Entre (MVP)

A tiny web app that answers leadership/management questions **the EntreLeadership way**.

## What it does
- One endpoint: `/api/coach` → EL-style answer in 3 parts (Direct answer / Why it matters / How to apply)
- Asks **at most one** clarifying question if the prompt is vague
- Feedback endpoint `/api/feedback` (thumbs + why) → logs only
- Dark-mode friendly UI using EL palette

## Stack
- Vite + React (client)
- Netlify Functions (serverless)
- OpenAI API

## Local dev
```bash
npm run dev
# opens Netlify dev proxy on http://localhost:8888 (Vite on 5173)
