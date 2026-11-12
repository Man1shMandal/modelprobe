import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  KeyRound,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";

const presets = [
  {
    label: "Demo",
    endpoint: "demo://simulated-chat",
    model: "demo-simulator",
    inputPerMillion: 0,
    outputPerMillion: 0,
  },
  {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini",
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
  },
];

const formatMs = (value) => (value == null ? "n/a" : `${Math.round(value)} ms`);
const formatNumber = (value, digits = 0) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });

function loadState(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveState(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function Metric({ icon: Icon, label, value, detail }) {
  return (
    <section className="metric">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}

function App() {
  const [config, setConfig] = useState(() =>
    loadState("aiapi-config", {
      provider: "Demo",
      endpoint: presets[0].endpoint,
      apiKey: "",
      model: presets[0].model,
      temperature: 0.7,
      topP: 1,
      maxTokens: 800,
      stream: true,
      inputPerMillion: presets[0].inputPerMillion,
      outputPerMillion: presets[0].outputPerMillion,
      systemPrompt: "You are a concise, careful assistant.",
    }),
  );
  const [messages, setMessages] = useState(() =>
    loadState("aiapi-messages", [
      {
        role: "assistant",
        content: "Ask anything. I will show the response and the key API metrics.",
      },
    ]),
  );
  const [prompt, setPrompt] = useState("");
  const [runs, setRuns] = useState(() => loadState("aiapi-runs", []));
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updateConfig = (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveState("aiapi-config", next);
  };

  const selectProvider = (label) => {
    const preset = presets.find((item) => item.label === label);
    if (!preset) return;
    updateConfig({
      provider: preset.label,
      endpoint: preset.endpoint,
      model: preset.model,
      inputPerMillion: preset.inputPerMillion,
      outputPerMillion: preset.outputPerMillion,
    });
  };

  const summary = useMemo(() => {
    const successful = runs.filter((run) => run.ok);
    const latest = runs[0];
    const averageLatency = successful.reduce((sum, run) => sum + (run.latencyMs || 0), 0) / (successful.length || 1);
    const totalTokens = successful.reduce((sum, run) => sum + (run.totalTokens || 0), 0);
    return { latest, averageLatency, totalTokens };
  }, [runs]);

  const chartRuns = useMemo(
    () =>
      [...runs]
        .reverse()
        .slice(-12)
        .map((run, index) => ({
          name: `${index + 1}`,
          latency: Math.round(run.latencyMs || 0),
        })),
    [runs],
  );

  async function sendPrompt(event) {
    event?.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || status === "running") return;

    setError("");
    setStatus("running");

    const userMessage = { role: "user", content: trimmed };
    const pendingMessages = [...messages, userMessage];
    setMessages(pendingMessages);
    setPrompt("");

    const startedAt = new Date();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: config.apiKey,
          endpoint: config.endpoint,
          model: config.model,
          messages: [
            ...(config.systemPrompt ? [{ role: "system", content: config.systemPrompt }] : []),
            ...pendingMessages.filter((message) => message.role !== "assistant"),
          ],
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          topP: config.topP,
          stream: config.stream,
          pricing: {
            inputPerMillion: config.inputPerMillion,
            outputPerMillion: config.outputPerMillion,
          },
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed.");

      const assistantMessage = { role: "assistant", content: result.text || "(No text returned)" };
      const nextMessages = [...pendingMessages, assistantMessage];
      setMessages(nextMessages);
      saveState("aiapi-messages", nextMessages);

      const run = {
        id: crypto.randomUUID(),
        at: startedAt.toISOString(),
        model: config.model,
        ok: true,
        status: result.metrics.status,
        latencyMs: result.metrics.latencyMs,
        firstTokenMs: result.metrics.firstTokenMs,
        throughput: result.metrics.throughput,
        inputTokens: result.metrics.inputTokens,
        outputTokens: result.metrics.outputTokens,
        totalTokens: result.metrics.totalTokens,
        costUsd: result.metrics.costUsd,
      };
      const nextRuns = [run, ...runs].slice(0, 40);
      setRuns(nextRuns);
      saveState("aiapi-runs", nextRuns);
    } catch (caught) {
      const nextRuns = [
        {
          id: crypto.randomUUID(),
          at: startedAt.toISOString(),
          model: config.model,
          ok: false,
          latencyMs: 0,
          firstTokenMs: null,
          throughput: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          error: caught.message,
        },
        ...runs,
      ].slice(0, 40);
      setRuns(nextRuns);
      saveState("aiapi-runs", nextRuns);
      setError(caught.message);
      setMessages(pendingMessages);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>ModelProbe</h1>
            <p>{config.model}</p>
          </div>
        </div>

        <div className="setup">
          <label>
            <span>Provider</span>
            <select value={config.provider} onChange={(event) => selectProvider(event.target.value)}>
              {presets.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="key-field">
            <span>API key</span>
            <div className="key-input">
              <KeyRound size={15} />
              <input
                autoComplete="off"
                type="password"
                placeholder={config.endpoint.startsWith("demo://") ? "Not needed" : "Paste key"}
                value={config.apiKey}
                onChange={(event) => updateConfig({ apiKey: event.target.value })}
              />
            </div>
          </label>
        </div>
      </header>

      <section className="main-grid">
        <section className="panel chat-panel">
          <div className="chat-window">
            {messages.map((message, index) => (
              <article className={`bubble ${message.role}`} key={`${message.role}-${index}`}>
                <div className="avatar">{message.role === "user" ? <MessageSquare size={15} /> : <Bot size={15} />}</div>
                <p>{message.content}</p>
              </article>
            ))}
            {status === "running" ? (
              <article className="bubble assistant loading">
                <div className="avatar">
                  <RefreshCw size={15} />
                </div>
                <p>Testing...</p>
              </article>
            ) : null}
          </div>

          {error ? (
            <div className="error-box">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          ) : null}

          <form className="prompt-bar" onSubmit={sendPrompt}>
            <textarea
              placeholder="Type a prompt..."
              value={prompt}
              rows="3"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendPrompt(event);
              }}
            />
            <button disabled={status === "running" || !prompt.trim()} type="submit">
              {status === "running" ? <RefreshCw size={18} /> : <Send size={18} />}
              Send
            </button>
          </form>
        </section>

        <aside className="side-panel">
          <div className="metrics">
            <Metric
              icon={Clock3}
              label="Latency"
              value={formatMs(summary.latest?.latencyMs)}
              detail={`Avg ${formatMs(summary.averageLatency)}`}
            />
            <Metric
              icon={Zap}
              label="Speed"
              value={`${formatNumber(summary.latest?.throughput, 1)} tok/s`}
              detail={`${formatNumber(summary.latest?.outputTokens)} output tokens`}
            />
            <Metric
              icon={CheckCircle2}
              label="Tokens"
              value={formatNumber(summary.latest?.totalTokens)}
              detail={`${formatNumber(summary.totalTokens)} this session`}
            />
          </div>

          <section className="panel chart-panel">
            <h2>Latency</h2>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartRuns}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e7ef" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <Tooltip />
                <Line type="monotone" dataKey="latency" stroke="#0f766e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <section className="panel advanced">
            <button className="advanced-toggle" type="button" onClick={() => setAdvancedOpen((open) => !open)}>
              <Settings2 size={16} />
              Advanced
              {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {advancedOpen ? (
              <div className="advanced-body">
                <label>
                  <span>Endpoint</span>
                  <input value={config.endpoint} onChange={(event) => updateConfig({ endpoint: event.target.value })} />
                </label>
                <label>
                  <span>Model</span>
                  <input value={config.model} onChange={(event) => updateConfig({ model: event.target.value })} />
                </label>
                <label>
                  <span>System prompt</span>
                  <textarea rows="3" value={config.systemPrompt} onChange={(event) => updateConfig({ systemPrompt: event.target.value })} />
                </label>
                <div className="two-col">
                  <label>
                    <span>Temperature</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={config.temperature}
                      onChange={(event) => updateConfig({ temperature: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Max tokens</span>
                    <input
                      type="number"
                      min="1"
                      value={config.maxTokens}
                      onChange={(event) => updateConfig({ maxTokens: event.target.value })}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </section>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
