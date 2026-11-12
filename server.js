const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const defaultEndpoint = "https://api.openai.com/v1/chat/completions";
const envFiles = [".env.local", ".env"];

for (const file of envFiles) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) continue;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function cleanEndpoint(endpoint) {
  const trimmed = (endpoint || defaultEndpoint).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/developers")) return `${trimmed}/chat/completions`;
  return trimmed;
}

function providerHeaders(apiKey, extraHeaders) {
  const key = apiKey || process.env.AIAPI_KEY || process.env.OPENAI_API_KEY;
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  return headers;
}

function normalizeUsage(usage = {}) {
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens };
}

function estimateCost(usage, pricing) {
  const inputPerMillion = Number(pricing?.inputPerMillion || 0);
  const outputPerMillion = Number(pricing?.outputPerMillion || 0);
  return (usage.inputTokens / 1_000_000) * inputPerMillion + (usage.outputTokens / 1_000_000) * outputPerMillion;
}

function tokenEstimate(text) {
  return Math.max(1, Math.ceil(String(text || "").split(/\s+/).filter(Boolean).length * 1.35));
}

async function runDemoRequest({ body, pricing, stream }) {
  const started = performance.now();
  const prompt = body.messages?.filter((message) => message.role === "user").at(-1)?.content || "";
  const delayMs = stream ? 520 : 780;
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const text = [
    "Demo response from the local simulator.",
    "",
    `Prompt focus: ${prompt.slice(0, 140) || "No prompt supplied."}`,
    "",
    "Use a real OpenAI-compatible endpoint and API key to measure live model latency, first-token time, token usage, throughput, error rate, and estimated cost.",
  ].join("\n");
  const usage = {
    inputTokens: body.messages.reduce((sum, message) => sum + tokenEstimate(message.content), 0),
    outputTokens: tokenEstimate(text),
  };
  usage.totalTokens = usage.inputTokens + usage.outputTokens;

  const latencyMs = performance.now() - started;

  return {
    text,
    metrics: {
      ok: true,
      status: 200,
      latencyMs,
      firstTokenMs: stream ? Math.min(180, latencyMs) : null,
      throughput: usage.outputTokens / (latencyMs / 1000),
      costUsd: estimateCost(usage, pricing),
      ...usage,
    },
    responseHeaders: { "x-aiapi-tester": "demo" },
  };
}

function parseSseLines(buffer) {
  const lines = buffer.split(/\r?\n/);
  return lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, "").trim())
    .filter(Boolean);
}

async function runStreamingRequest({ endpoint, headers, body, pricing }) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...body,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  const status = response.status;
  const responseHeaders = Object.fromEntries(response.headers.entries());

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw Object.assign(new Error(text || `Request failed with ${status}`), { status, responseHeaders });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let usage = {};
  let firstTokenMs = null;
  let pending = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const chunks = pending.split(/\n\n/);
    pending = chunks.pop() || "";

    for (const chunk of chunks) {
      for (const line of parseSseLines(chunk)) {
        if (line === "[DONE]") continue;

        const parsed = JSON.parse(line);
        if (parsed.usage) usage = parsed.usage;

        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (delta) {
          if (firstTokenMs === null) firstTokenMs = performance.now() - started;
          text += delta;
        }
      }
    }
  }

  const latencyMs = performance.now() - started;
  const normalizedUsage = normalizeUsage(usage);
  const throughput = normalizedUsage.outputTokens ? normalizedUsage.outputTokens / (latencyMs / 1000) : 0;

  return {
    text,
    metrics: {
      ok: true,
      status,
      latencyMs,
      firstTokenMs,
      throughput,
      costUsd: estimateCost(normalizedUsage, pricing),
      ...normalizedUsage,
    },
    responseHeaders,
  };
}

async function runJsonRequest({ endpoint, headers, body, pricing }) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: false }),
  });
  const latencyMs = performance.now() - started;
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const raw = await response.text();

  if (!response.ok) {
    throw Object.assign(new Error(raw || `Request failed with ${response.status}`), {
      status: response.status,
      responseHeaders,
    });
  }

  const parsed = JSON.parse(raw);
  const text = parsed.choices?.[0]?.message?.content ?? parsed.output_text ?? "";
  const normalizedUsage = normalizeUsage(parsed.usage);
  const throughput = normalizedUsage.outputTokens ? normalizedUsage.outputTokens / (latencyMs / 1000) : 0;

  return {
    text,
    raw: parsed,
    metrics: {
      ok: true,
      status: response.status,
      latencyMs,
      firstTokenMs: null,
      throughput,
      costUsd: estimateCost(normalizedUsage, pricing),
      ...normalizedUsage,
    },
    responseHeaders,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  const {
    apiKey,
    endpoint,
    model,
    messages,
    temperature,
    maxTokens,
    topP,
    stream,
    pricing,
    extraHeaders,
  } = req.body || {};

  if (!model) return res.status(400).json({ error: "Model is required." });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "At least one message is required." });
  }

  const body = {
    model,
    messages,
    temperature: Number(temperature),
    max_tokens: Number(maxTokens),
    top_p: Number(topP),
  };

  for (const key of Object.keys(body)) {
    if (body[key] === "" || Number.isNaN(body[key]) || body[key] === undefined || body[key] === null) {
      delete body[key];
    }
  }

  try {
    const targetEndpoint = cleanEndpoint(endpoint);
    const result = targetEndpoint.startsWith("demo://")
      ? await runDemoRequest({ body, pricing, stream })
      : stream
        ? await runStreamingRequest({
            endpoint: targetEndpoint,
            headers: providerHeaders(apiKey, extraHeaders),
            body,
            pricing,
          })
        : await runJsonRequest({
            endpoint: targetEndpoint,
            headers: providerHeaders(apiKey, extraHeaders),
            body,
            pricing,
          });

    res.json(result);
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.message,
      metrics: {
        ok: false,
        status: error.status || 502,
      },
      responseHeaders: error.responseHeaders || {},
    });
  }
});

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

app.listen(port, () => {
  console.log(`AI API tester server listening on http://127.0.0.1:${port}`);
});
