import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchWithApiFallback } from "@/lib/api-base";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
}

interface ChatRequestPayload {
  message: string;
  history: Array<{ role: ChatRole; content: string }>;
  model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  seed: number;
  thinking: boolean;
  contextProfile?: string;
}

interface AIInputProps {
  contextProfile?: string;
  accent?: "nebula" | "electric" | "sunset";
  compact?: boolean;
}

const DEFAULT_MODEL = "deepseek-ai/deepseek-v3.2";
const MAX_HISTORY = 8;
const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Gerar codigo", prompt: "Gere um codigo pronto para uso para este objetivo:" },
  { label: "Explicar codigo", prompt: "Explique esse codigo de forma simples, por etapas:" },
  { label: "Criar copy", prompt: "Crie uma copy persuasiva para este contexto:" },
  { label: "Corrigir erro", prompt: "Analise e corrija este erro com causa raiz e solucao:" }
];

const CHAT_THEME: Record<
  "nebula" | "electric" | "sunset",
  {
    glowA: string;
    glowB: string;
    overlay: string;
    userBubble: string;
    assistantBubble: string;
    action: string;
    send: string;
  }
> = {
  nebula: {
    glowA: "bg-fuchsia-400/18",
    glowB: "bg-violet-500/18",
    overlay:
      "bg-[linear-gradient(118deg,rgba(167,139,250,0.12),transparent_34%,rgba(56,189,248,0.12),transparent_70%,rgba(244,114,182,0.11))]",
    userBubble:
      "border-cyan-300/35 bg-gradient-to-r from-cyan-500/20 to-violet-500/24 text-cyan-50",
    assistantBubble:
      "border-violet-200/20 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-slate-100",
    action:
      "rounded-full border border-violet-200/25 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/35 hover:bg-cyan-400/10 hover:text-cyan-100",
    send:
      "h-9 min-w-[102px] rounded-xl border border-violet-300/35 bg-gradient-to-r from-violet-500/34 via-cyan-500/24 to-fuchsia-500/30 text-sm text-violet-50 hover:from-violet-500/44 hover:via-cyan-500/32 hover:to-fuchsia-500/38"
  },
  electric: {
    glowA: "bg-cyan-400/20",
    glowB: "bg-blue-500/18",
    overlay:
      "bg-[linear-gradient(118deg,rgba(56,189,248,0.15),transparent_34%,rgba(96,165,250,0.14),transparent_70%,rgba(34,211,238,0.1))]",
    userBubble:
      "border-cyan-300/35 bg-gradient-to-r from-cyan-500/24 to-blue-500/24 text-cyan-50",
    assistantBubble:
      "border-sky-200/25 bg-gradient-to-r from-blue-500/12 to-cyan-500/12 text-slate-100",
    action:
      "rounded-full border border-cyan-200/25 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/45 hover:bg-cyan-400/12 hover:text-cyan-100",
    send:
      "h-9 min-w-[102px] rounded-xl border border-cyan-300/35 bg-gradient-to-r from-cyan-500/34 via-blue-500/24 to-sky-500/30 text-sm text-cyan-50 hover:from-cyan-500/44 hover:via-blue-500/32 hover:to-sky-500/38"
  },
  sunset: {
    glowA: "bg-pink-400/18",
    glowB: "bg-orange-500/16",
    overlay:
      "bg-[linear-gradient(118deg,rgba(244,114,182,0.14),transparent_34%,rgba(251,146,60,0.12),transparent_70%,rgba(168,85,247,0.11))]",
    userBubble:
      "border-pink-300/35 bg-gradient-to-r from-pink-500/22 to-orange-500/22 text-pink-50",
    assistantBubble:
      "border-pink-200/20 bg-gradient-to-r from-pink-500/12 to-violet-500/10 text-slate-100",
    action:
      "rounded-full border border-pink-200/25 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition hover:border-pink-300/45 hover:bg-pink-400/12 hover:text-pink-100",
    send:
      "h-9 min-w-[102px] rounded-xl border border-pink-300/35 bg-gradient-to-r from-pink-500/34 via-violet-500/24 to-orange-500/30 text-sm text-pink-50 hover:from-pink-500/44 hover:via-violet-500/32 hover:to-orange-500/38"
  }
};

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function parseJsonSafe(raw: string) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function extractText(payload: any): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.delta === "string") {
    return payload.delta;
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const delta = choice?.delta || choice?.message || {};

  const candidates = [
    delta.content,
    delta.reasoning_content,
    delta.thinking,
    choice?.text,
    payload.content
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }

    if (Array.isArray(candidate)) {
      const text = candidate
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item.text === "string") return item.text;
          if (item && typeof item.content === "string") return item.content;
          return "";
        })
        .join("");

      if (text) {
        return text;
      }
    }
  }

  return "";
}

function parseSseBlock(block: string) {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event: eventName,
    data: dataLines.join("\n").trim()
  };
}

function toFriendlyError(rawMessage: string) {
  const value = String(rawMessage || "").trim();

  if (/Unauthorized|Authentication failed|HTTP 401/i.test(value)) {
    return "Servidor sem autorização no provedor. Verifique a chave NVIDIA_API_KEY no backend.";
  }

  if (/API key não configurada|NVIDIA_API_KEY/i.test(value)) {
    return "A chave da IA não está configurada no servidor.";
  }

  if (/HTTP 404/i.test(value)) {
    return "Rota da IA não encontrada no servidor.";
  }

  if (/HTTP 405/i.test(value)) {
    return "Não encontrei backend compatível nessa URL. Verifique o backend público ou rode o Node em 3000.";
  }

  if (/Failed to fetch|ECONNREFUSED|ERR_CONNECTION_REFUSED|NetworkError|Load failed/i.test(value)) {
    return "Não foi possível conectar ao backend de IA agora. Verifique se a API está online.";
  }

  if (/timeout|timed out|tempo limite/i.test(value)) {
    return "A IA demorou para responder. Tente novamente.";
  }

  if (/Resposta vazia/i.test(value)) {
    return "A IA retornou resposta vazia nessa tentativa.";
  }

  return "Falha ao gerar resposta agora. Tente novamente.";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function requestJson(payload: ChatRequestPayload, signal: AbortSignal) {
  const { response } = await fetchWithApiFallback("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  }

  const data = await response.json();
  const answer = String(data?.answer || "").trim();
  if (!answer) {
    throw new Error("Resposta vazia do backend.");
  }

  return answer;
}

async function requestStream(
  payload: ChatRequestPayload,
  signal: AbortSignal,
  onDelta: (delta: string) => void
) {
  const { response } = await fetchWithApiFallback("/api/chat-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  }

  if (!response.body) {
    throw new Error("Stream indisponível.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let done = false;

  const processBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed.data) {
      return;
    }

    if (parsed.data === "[DONE]") {
      done = true;
      return;
    }

    const data = parseJsonSafe(parsed.data);
    if (!data) {
      return;
    }

    if (parsed.event === "error") {
      done = true;
      throw new Error(String(data.error || "Falha no stream."));
    }

    if (parsed.event === "done") {
      const finalAnswer = String(data.answer || "").trim();
      if (finalAnswer && finalAnswer !== answer) {
        answer = finalAnswer;
      }
      done = true;
      return;
    }

    const delta = extractText(data);
    if (delta) {
      answer += delta;
      onDelta(delta);
    }
  };

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    while (true) {
      const marker = buffer.indexOf("\n\n");
      if (marker === -1) {
        break;
      }

      const block = buffer.slice(0, marker);
      buffer = buffer.slice(marker + 2);
      processBlock(block);

      if (done) {
        break;
      }
    }
  }

  if (!done && buffer.trim()) {
    processBlock(buffer);
  }

  if (!answer.trim()) {
    throw new Error("Resposta vazia do stream.");
  }

  return answer.trim();
}

function AnimatedOrb({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-8 w-8 shrink-0 items-center justify-center", className)}>
      <motion.span
        className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#67e8f9,#a78bfa,#f472b6,#22d3ee,#67e8f9)] blur-[2px]"
        animate={{ rotate: 360 }}
        transition={{ duration: 7.2, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
      />
      <span className="absolute inset-[1px] rounded-full bg-[#05060a]/90 backdrop-blur-md" />
      <span className="absolute inset-[6px] rounded-full bg-gradient-to-br from-cyan-300/95 via-violet-300/90 to-fuchsia-300/80" />
      <span className="absolute inset-[10px] rounded-full bg-[#04050a]" />
    </span>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-violet-200/85"
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
          transition={{
            duration: 0.9,
            repeat: Number.POSITIVE_INFINITY,
            delay: index * 0.12,
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}

export function AIInput({ contextProfile = "", accent = "nebula", compact = false }: AIInputProps) {
  const [isComposerOpen, setIsComposerOpen] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const openComposer = useCallback(() => {
    setIsComposerOpen(true);
    window.setTimeout(() => textareaRef.current?.focus(), 20);
  }, []);

  const closeComposer = useCallback(() => {
    setIsComposerOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isComposerOpen) {
        event.preventDefault();
        closeComposer();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeComposer, isComposerOpen]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isComposerOpen) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 64), 220)}px`;
  }, [inputValue, isComposerOpen]);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const history = useMemo(() => {
    return messages
      .filter((message) => !message.pending)
      .slice(-MAX_HISTORY)
      .map((message) => ({ role: message.role, content: message.content }));
  }, [messages]);

  const canSend = inputValue.trim().length > 0 && !isSending;
  const isMacShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
  const theme = CHAT_THEME[accent];
  const messageBoxClass = isComposerOpen
    ? compact ? "h-[190px] p-3" : "h-[250px] p-4"
    : "h-[92px] p-3";

  const applyQuickAction = useCallback(
    (presetPrompt: string) => {
      openComposer();
      setInputValue((prev) => (prev.trim() ? `${prev.trim()}\n\n${presetPrompt}` : `${presetPrompt}\n`));
      window.setTimeout(() => textareaRef.current?.focus(), 25);
    },
    [openComposer]
  );

  const clearInput = useCallback(() => {
    setInputValue("");
    window.setTimeout(() => textareaRef.current?.focus(), 20);
  }, []);

  const sendMessage = useCallback(async () => {
    const prompt = inputValue.trim();
    if (!prompt || isSending) return;

    openComposer();
    setInputValue("");

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString()
    };

    const assistantId = makeId();
    const assistantDraft: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      pending: true
    };

    setMessages((prev) => [...prev, userMessage, assistantDraft]);
    setIsSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const payload: ChatRequestPayload = {
      message: prompt,
      history,
      model: DEFAULT_MODEL,
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 2048,
      seed: 42,
      thinking: false,
      contextProfile
    };

    try {
      const streamAnswer = await requestStream(payload, controller.signal, (delta) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: `${message.content}${delta}`, pending: true, error: false }
              : message
          )
        );
      });

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? { ...message, content: streamAnswer, pending: false, error: false }
            : message
        )
      );
    } catch (streamError) {
      if (controller.signal.aborted) {
        setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        return;
      }

      try {
        const fallbackAnswer = await requestJson(payload, controller.signal);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: fallbackAnswer, pending: false, error: false }
              : message
          )
        );
      } catch (jsonError) {
        const friendly = toFriendlyError(`${String(streamError)} | ${String(jsonError)}`);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: friendly, pending: false, error: true }
              : message
          )
        );
      }
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  }, [contextProfile, history, inputValue, isSending, openComposer]);

  const onTextareaKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void sendMessage();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeComposer();
      }
    },
    [closeComposer, sendMessage]
  );

  return (
    <div className="relative w-full">
      <div className="relative overflow-hidden rounded-[24px] border border-white/15 bg-[#0a0714]/95 p-4 shadow-[0_30px_72px_rgba(0,0,0,0.62),0_0_40px_rgba(59,130,246,0.12)] sm:p-5">
        <div className={cn("pointer-events-none absolute inset-0", theme.overlay)} />
        <div className="pointer-events-none absolute inset-x-0 bottom-[-140px] mx-auto h-[250px] w-[760px] max-w-[120%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(129,140,248,0.38),rgba(30,27,75,0.05)_58%,transparent_74%)] blur-2xl" />
        <motion.div
          className={cn("pointer-events-none absolute -left-16 -top-16 h-44 w-44 rounded-full blur-3xl", theme.glowA)}
          animate={{ x: [0, 10, 0], y: [0, 8, 0] }}
          transition={{ duration: 6.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <motion.div
          className={cn("pointer-events-none absolute -right-20 -bottom-20 h-56 w-56 rounded-full blur-3xl", theme.glowB)}
          animate={{ x: [0, -12, 0], y: [0, -8, 0] }}
          transition={{ duration: 7.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AnimatedOrb className="h-7 w-7" />
            <p className="text-base font-medium tracking-tight text-slate-100">AI Workspace</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-violet-200/25 bg-white/[0.03] px-2.5 py-1 text-xs text-violet-100/90">
              {isMacShortcut ? "⌘ + Enter" : "Ctrl + Enter"}
            </span>
            {isComposerOpen && (
              <button
                type="button"
                onClick={closeComposer}
                className="rounded-lg border border-violet-200/25 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300 hover:text-violet-100"
              >
                Fechar
              </button>
            )}
          </div>
        </div>

        <div
          ref={messagesRef}
          className={cn(
            "relative z-10 mt-3 overflow-y-auto rounded-2xl border border-white/15 bg-[#090713]/82 transition-all duration-200",
            messageBoxClass
          )}
        >
          {messages.length === 0 ? (
            <div className="rounded-xl border border-white/15 bg-white/[0.02] p-3 text-sm text-slate-400">
              {isComposerOpen
                ? "O historico fica aqui no mesmo painel. Escreva uma pergunta para comecar a conversa."
                : "Chat recolhido. Clique em Abrir chat para continuar."}
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div className="max-w-[88%]">
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm leading-relaxed",
                        message.role === "user" ? theme.userBubble : theme.assistantBubble,
                        message.error && "border-rose-300/35 bg-rose-500/10 text-rose-100"
                      )}
                    >
                      {message.pending && !message.content
                        ? <TypingDots />
                        : (
                          <>
                            {message.content || "Sem resposta."}
                            {message.pending && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-violet-300/70" />}
                          </>
                        )}
                    </div>
                    <p className="mt-1 px-1 text-[11px] text-slate-500">
                      {message.role === "user" ? "Voce" : "IA"} {"•"} {formatTime(message.createdAt)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {isComposerOpen ? (
            <motion.div
              key="composer-open"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 mt-3 space-y-3"
            >
              <div className="flex flex-wrap gap-2">
                {QUICK_ACTIONS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyQuickAction(preset.prompt)}
                    className={theme.action}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="relative rounded-2xl border border-white/15 bg-[#090613]/72 p-4">
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={onTextareaKeyDown}
                  placeholder="Type your request..."
                  className="min-h-[96px] w-full resize-none bg-transparent text-base text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">ESC fecha • {isMacShortcut ? "⌘ + Enter" : "Ctrl + Enter"} envia</p>
                  <p className="text-xs text-slate-500">{inputValue.length} caracteres</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={clearInput} className="text-xs text-slate-400 hover:text-cyan-200">Limpar</button>
                    <Button
                      type="button"
                      onClick={() => void sendMessage()}
                      disabled={!canSend}
                      className={theme.send}
                    >
                      {isSending ? "Enviando..." : "Enviar"}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="composer-bubble"
              type="button"
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 8 }}
              transition={{ duration: 0.2 }}
              onClick={openComposer}
              className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-[#0d0a16]/95 px-3 py-2 text-sm text-slate-100 shadow-[0_16px_34px_rgba(0,0,0,0.45),0_0_20px_rgba(79,70,229,0.25)]"
            >
              <AnimatedOrb className="h-6 w-6" />
              <span>Abrir chat</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}


