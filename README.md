# ModelProbe

A local chat UI for testing any OpenAI-compatible chat completions API and seeing latency, speed, tokens and cost for each call.

You pick a provider (or paste an endpoint), enter a model name and API key, and chat. Every request goes through a small Express proxy that times it and returns the reply plus metrics. The side panel shows the latest and average latency, tokens per second, token counts and a latency chart for the last 12 runs.

## What it measures

- Total latency per request
- Time to first token (streaming mode)
- Output tokens per second
- Input, output and total tokens (from the API's `usage` field)
- Estimated cost, from per-million input/output prices
- Failed requests, with the status code and error text

## Features

- Presets for a built-in Demo simulator (no key needed) and OpenAI. Any other OpenAI-compatible endpoint can be set under Advanced.
- Streaming (SSE) and non-streaming requests.
- Editable system prompt, temperature and max tokens.
- Settings, chat history and the last 40 runs are kept in the browser's localStorage. The API key typed in the UI is stored there too and sent only to the local proxy.

## Stack

- React 19 + Vite
- Recharts, lucide-react
- Node.js + Express 5 proxy (`server.js`)

## Run

Needs Node.js 18 or newer (uses the built-in `fetch`).

```bash
npm install
npm run dev
```

This starts the API proxy on port 8787 and the Vite dev server on port 5173 (`/api` is proxied to 8787). Open http://localhost:5173.

Production build:

```bash
npm run build
npm start
```

`npm start` serves the built `dist/` folder and the API from the same Express server on port 8787.

## Config

Optional. Copy `.env.example` to `.env` (or `.env.local`) if you want a server-side fallback key instead of typing one in the UI.

- `AIAPI_KEY` - fallback API key
- `OPENAI_API_KEY` - used if `AIAPI_KEY` is not set
- `PORT` - proxy port, default 8787

## API

- `GET /api/health` - returns `{ ok: true }`
- `POST /api/chat` - body: `endpoint`, `model`, `messages`, `temperature`, `maxTokens`, `topP`, `stream`, `pricing`, optional `apiKey` and `extraHeaders`. Use `demo://...` as the endpoint for the simulator.
