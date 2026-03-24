import {
  ArrowUp,
  BookOpen,
  Check,
  Code2,
  FileText,
  ImageIcon,
  Layers3,
  LayoutDashboard,
  Palette,
  Paperclip,
  Rocket,
  Search,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ChangeEvent,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { fetchWithApiFallback, probeApiHealth } from "@/lib/api-base";
import { WORLD_LANGUAGES, WORLD_TAGS, normalizeSearch, type TagEntry } from "@/lib/code-taxonomy";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { GalaxyCanvas } from "./galaxy-canvas";
import { Textarea } from "./textarea";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
};

type QuickAction = {
  id: string;
  label: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
  action?: "code-builder";
};

type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};

type HealthStatus = "checking" | "online" | "missing_key" | "offline";

type HealthState = {
  status: HealthStatus;
  detail: string;
  model: string;
};

type RuixenMoonChatProps = {
  title?: string;
  subtitle?: string;
  contextProfile?: string;
  className?: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: "generate_code", label: "Gerar codigo", prompt: "Gere codigo pronto para producao para este objetivo:", icon: Code2, action: "code-builder" },
  { id: "debug_bug", label: "Resolver bug", prompt: "Analise este erro e entregue causa raiz, correcao e patch final:", icon: Rocket },
  { id: "review_code", label: "Code review", prompt: "Faca review tecnico deste codigo, liste riscos e melhore:", icon: Layers3 },
  { id: "refactor", label: "Refatorar", prompt: "Refatore este trecho com foco em clareza, performance e testes:", icon: Palette },
  { id: "api_design", label: "API design", prompt: "Desenhe uma API robusta para este requisito, com rotas, validacao e exemplos:", icon: LayoutDashboard },
  { id: "fix_mobile", label: "Fix mobile", prompt: "Corrija problemas de responsividade e UX mobile deste layout:", icon: WandSparkles },
  { id: "tests", label: "Criar testes", prompt: "Crie testes automatizados para este codigo cobrindo casos criticos:", icon: Upload },
  { id: "explain_stacktrace", label: "Explicar erro", prompt: "Explique este stack trace e diga exatamente como corrigir:", icon: ImageIcon }
];

const LANGUAGE_HINTS: Record<string, string> = {
  html: "Construa uma estrutura semantica completa.",
  css: "Crie estilos responsivos e performaticos.",
  javascript: "Implemente logica moderna com tratamento de erro.",
  typescript: "Use tipagem forte e codigo pronto para escala.",
  react: "Monte componentes reutilizaveis com hooks.",
  "node.js": "Estruture backend com rotas, validacao e seguranca.",
  python: "Implemente script/backend limpo com boas praticas.",
  sql: "Escreva queries claras, seguras e otimizadas."
};

const DEFAULT_MODEL = "deepseek-ai/deepseek-v3.2";
const MAX_HISTORY = 10;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_CHARS = 12000;
const READABLE_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".yml",
  ".yaml",
  ".env",
  ".log"
];

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function resolveConfiguredModel() {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  const cfgModel = String(window.CENTRAL_IA_CONFIG?.defaultModel || "").trim();
  return cfgModel || DEFAULT_MODEL;
}

function errorTextFromUnknown(raw: unknown) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const jsonCandidate =
    text.startsWith("{") && text.endsWith("}")
      ? text
      : text.includes("{") && text.includes("}")
        ? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
        : "";

  try {
    const parsed = JSON.parse(jsonCandidate || text);
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch (_error) {
    // Keep raw text fallback.
  }
  return text;
}

function friendlyError(raw: unknown) {
  const text = errorTextFromUnknown(raw);
  if (/NVIDIA.?API.?KEY ausente|hasServerKey["']?\s*:\s*false|backend sem chave|missing api key/i.test(text)) {
    return "Backend sem chave NVIDIA. Configure NVIDIA_API_KEY no backend publicado.";
  }
  if (/Unauthorized|Authentication failed|invalid api key/i.test(text)) {
    return "Chave NVIDIA invalida ou expirada no backend.";
  }
  if (/429|rate limit|quota/i.test(text)) {
    return "Limite de uso da IA atingido agora. Tente de novo em instantes.";
  }
  if (/404/i.test(text)) {
    return "Rota de IA nao encontrada no backend.";
  }
  if (/405/i.test(text)) {
    return "Backend sem suporte para este metodo. Verifique a funcao /api/chat.";
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) {
    return "Nao consegui conectar ao backend agora.";
  }
  return "Falha ao gerar resposta. Tente novamente.";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isReadableTextFile(file: File) {
  if (file.type.startsWith("text/")) return true;
  const lower = file.name.toLowerCase();
  return READABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function buildAttachmentBlock(attachments: ChatAttachment[]) {
  if (!attachments.length) return "";

  const lines: string[] = ["Arquivos anexados para contexto:"];

  for (const file of attachments) {
    lines.push(`- ${file.name} (${file.type || "sem tipo"}, ${formatBytes(file.size)})`);
    if (file.error) {
      lines.push(`  Erro ao ler arquivo: ${file.error}`);
      continue;
    }
    if (file.content) {
      lines.push("  Conteudo (trecho):");
      lines.push("```");
      lines.push(file.content);
      lines.push("```");
      if (file.truncated) {
        lines.push("  Observacao: conteudo truncado para caber no contexto.");
      }
    } else {
      lines.push("  Conteudo binario nao textual (apenas referencia de arquivo).");
    }
  }

  return lines.join("\n");
}

const TypingDots = memo(function TypingDots() {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-violet-200/80"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 0.8, repeat: Number.POSITIVE_INFINITY, delay: i * 0.12 }}
        />
      ))}
    </div>
  );
});

export const RuixenMoonChat = memo(function RuixenMoonChat({
  title = "DevCod",
  subtitle = "Copiloto para codigo, debug e arquitetura.",
  contextProfile = "",
  className
}: RuixenMoonChatProps) {
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [builderLanguage, setBuilderLanguage] = useState("TypeScript");
  const [builderLanguageQuery, setBuilderLanguageQuery] = useState("");
  const [builderCustomLanguage, setBuilderCustomLanguage] = useState("");
  const [builderTagQuery, setBuilderTagQuery] = useState("");
  const [builderActiveTag, setBuilderActiveTag] = useState(WORLD_TAGS[0]?.key ?? "");
  const [builderSelectedTagKeys, setBuilderSelectedTagKeys] = useState<string[]>([]);
  const [builderGoal, setBuilderGoal] = useState("");
  const [showTagTutorial, setShowTagTutorial] = useState(false);
  const [health, setHealth] = useState<HealthState>(() => ({
    status: "checking",
    detail: "Verificando backend...",
    model: resolveConfiguredModel()
  }));

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const tagsByKey = useMemo(() => {
    return new Map<string, TagEntry>(WORLD_TAGS.map((tag) => [tag.key, tag]));
  }, []);

  const filteredLanguages = useMemo(() => {
    const query = normalizeSearch(builderLanguageQuery);
    const source = query
      ? WORLD_LANGUAGES.filter((language) => normalizeSearch(language).includes(query))
      : WORLD_LANGUAGES;
    return source.slice(0, 180);
  }, [builderLanguageQuery]);

  const filteredTags = useMemo(() => {
    const query = normalizeSearch(builderTagQuery);
    const source = query
      ? WORLD_TAGS.filter((tag) => {
          const base = `${tag.label} ${tag.category} ${(tag.aliases || []).join(" ")}`;
          return normalizeSearch(base).includes(query);
        })
      : WORLD_TAGS;
    return source.slice(0, 260);
  }, [builderTagQuery]);

  const selectedTagEntries = useMemo(
    () =>
      builderSelectedTagKeys
        .map((key) => tagsByKey.get(key))
        .filter((item): item is TagEntry => Boolean(item)),
    [builderSelectedTagKeys, tagsByKey]
  );

  const selectedTagGuide = useMemo(() => {
    return (
      tagsByKey.get(builderActiveTag) ||
      selectedTagEntries[0] ||
      filteredTags[0] ||
      null
    );
  }, [builderActiveTag, filteredTags, selectedTagEntries, tagsByKey]);

  const history = useMemo(
    () =>
      messages
        .filter((item) => !item.pending)
        .slice(-MAX_HISTORY)
        .map((item) => ({ role: item.role, content: item.content })),
    [messages]
  );

  const canSend = (inputValue.trim().length > 0 || attachments.length > 0) && !isSending;

  const refreshHealth = useCallback(async () => {
    const check = await probeApiHealth();
    const configuredModel = resolveConfiguredModel();

    if (!check.ok) {
      const status = Number(check.status || 0);
      const detail =
        status === 404 || status === 405
          ? "Rotas /api nao encontradas no deploy."
          : "Conexao com backend indisponivel.";

      setHealth({
        status: "offline",
        detail,
        model: configuredModel
      });
      return;
    }

    const payload = (check.payload && typeof check.payload === "object" ? check.payload : {}) as Record<string, unknown>;
    const hasServerKey = Boolean(payload.hasServerKey);
    const currentModel = String(payload.model || configuredModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

    if (!hasServerKey) {
      setHealth({
        status: "missing_key",
        detail: "Backend sem provedor de IA ativo.",
        model: currentModel
      });
      return;
    }

    let baseLabel = "mesmo dominio";
    try {
      if (check.base) {
        baseLabel = new URL(check.base).host;
      }
    } catch (_error) {
      baseLabel = check.base || "mesmo dominio";
    }

    setHealth({
      status: "online",
      detail: `IA online via ${baseLabel}`,
      model: currentModel
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobileMedia = window.matchMedia("(max-width: 768px)");
    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

    const applyMedia = () => {
      setIsMobile(mobileMedia.matches);
      setPrefersReducedMotion(motionMedia.matches);
    };

    applyMedia();

    const onMobileChange = () => applyMedia();
    const onMotionChange = () => applyMedia();

    if (typeof mobileMedia.addEventListener === "function") {
      mobileMedia.addEventListener("change", onMobileChange);
      motionMedia.addEventListener("change", onMotionChange);
      return () => {
        mobileMedia.removeEventListener("change", onMobileChange);
        motionMedia.removeEventListener("change", onMotionChange);
      };
    }

    mobileMedia.addListener(onMobileChange);
    motionMedia.addListener(onMotionChange);
    return () => {
      mobileMedia.removeListener(onMobileChange);
      motionMedia.removeListener(onMotionChange);
    };
  }, []);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, 45000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshHealth]);

  useEffect(() => {
    if (!builderActiveTag && WORLD_TAGS[0]?.key) {
      setBuilderActiveTag(WORLD_TAGS[0].key);
    }
  }, [builderActiveTag]);

  useEffect(() => {
    if (!isCodeModalOpen) return;
    const onKeyDownWindow = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCodeModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDownWindow);
    return () => window.removeEventListener("keydown", onKeyDownWindow);
  }, [isCodeModalOpen]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 68), 220)}px`;
  }, [inputValue]);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const onFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const parsed = await Promise.all(
      files.map(async (file): Promise<ChatAttachment> => {
        const base: ChatAttachment = {
          id: makeId(),
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream"
        };

        if (!isReadableTextFile(file)) {
          return base;
        }

        try {
          const raw = await file.text();
          const truncated = raw.length > MAX_ATTACHMENT_CHARS;
          return {
            ...base,
            content: raw.slice(0, MAX_ATTACHMENT_CHARS),
            truncated
          };
        } catch {
          return { ...base, error: "nao foi possivel ler este arquivo." };
        }
      })
    );

    setAttachments((prev) => [...prev, ...parsed].slice(-MAX_ATTACHMENTS));
    event.target.value = "";
  }, []);

  const handleSendMessage = useCallback(
    async (message: string) => {
      const content = message.trim();
      const filesSnapshot = attachments;
      if ((!content && filesSnapshot.length === 0) || isSending) return;

      const attachmentBlock = buildAttachmentBlock(filesSnapshot);
      const finalPrompt = [
        content || "Analise os arquivos anexados e responda com orientacao pratica.",
        attachmentBlock
      ]
        .filter(Boolean)
        .join("\n\n");

      setInputValue("");
      setAttachments([]);
      setIsSending(true);

      const userMessage: ChatMessage = {
        id: makeId(),
        role: "user",
        content: content || `Anexei ${filesSnapshot.length} arquivo(s): ${filesSnapshot.map((file) => file.name).join(", ")}`,
        createdAt: new Date().toISOString()
      };

      const draftId = makeId();
      const assistantDraft: ChatMessage = {
        id: draftId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        pending: true
      };

      setMessages((prev) => [...prev, userMessage, assistantDraft]);

      try {
        const { response } = await fetchWithApiFallback("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            message: finalPrompt,
            history,
            model: health.model || resolveConfiguredModel(),
            temperature: 0.7,
            top_p: 0.95,
            max_tokens: 2048,
            seed: 42,
            thinking: false,
            contextProfile
          })
        });

        if (!response.ok) {
          const raw = await response.text();
          throw new Error(raw || `HTTP ${response.status}`);
        }

        const payload = await response.json().catch(() => null);
        const answer = String(payload?.answer || "").trim();
        if (!answer) throw new Error("Resposta vazia.");

        setMessages((prev) =>
          prev.map((item) =>
            item.id === draftId
              ? { ...item, content: answer, pending: false, error: false }
              : item
          )
        );
      } catch (error) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === draftId
              ? { ...item, content: friendlyError(error), pending: false, error: true }
              : item
          )
        );
        void refreshHealth();
      } finally {
        setIsSending(false);
      }
    },
    [attachments, contextProfile, health.model, history, isSending, refreshHealth]
  );

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void handleSendMessage(inputValue);
    },
    [handleSendMessage, inputValue]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSendMessage(inputValue);
      }
    },
    [handleSendMessage, inputValue]
  );

  const applyQuickPrompt = useCallback((prompt: string) => {
    setInputValue((prev) => (prev.trim() ? `${prev.trim()}\n\n${prompt}` : `${prompt}\n`));
    window.setTimeout(() => textareaRef.current?.focus(), 30);
  }, []);

  const openCodeBuilder = useCallback(() => {
    setIsCodeModalOpen(true);
    setShowTagTutorial(false);
    setBuilderLanguageQuery("");
    setBuilderTagQuery("");
  }, []);

  const toggleBuilderTag = useCallback((tagKey: string) => {
    setBuilderActiveTag(tagKey);
    setBuilderSelectedTagKeys((prev) => {
      if (prev.includes(tagKey)) {
        return prev.filter((item) => item !== tagKey);
      }
      return [...prev, tagKey];
    });
  }, []);

  const clearBuilderTags = useCallback(() => {
    setBuilderSelectedTagKeys([]);
    setBuilderActiveTag(WORLD_TAGS[0]?.key ?? "");
    setShowTagTutorial(false);
  }, []);

  const applyCodeBuilderPrompt = useCallback(() => {
    const goal = builderGoal.trim() || "criar uma implementacao pronta para producao";
    const selectedLanguage = builderCustomLanguage.trim() || builderLanguage;
    const languageHint =
      LANGUAGE_HINTS[(selectedLanguage || "").toLowerCase()] ||
      "Entregue uma solucao pronta para producao com foco em clareza e escalabilidade.";
    const tagsLabel = selectedTagEntries.length
      ? selectedTagEntries.map((item) => `${item.label} (${item.category})`).join(", ")
      : "sem tags especificas";

    const prompt = [
      "Gere codigo completo e pronto para uso.",
      `Linguagem/base: ${selectedLanguage || "nao definida"}.`,
      `Tags/componentes foco: ${tagsLabel}.`,
      `Objetivo: ${goal}.`,
      `Diretriz: ${languageHint}`,
      selectedTagGuide ? `Tutorial da tag principal (${selectedTagGuide.label}): ${selectedTagGuide.tutorial}` : "",
      "Inclua passos rapidos e codigo final completo."
    ].join("\n");

    applyQuickPrompt(prompt);
    setIsCodeModalOpen(false);
    setBuilderGoal("");
    setShowTagTutorial(false);
  }, [
    applyQuickPrompt,
    builderCustomLanguage,
    builderGoal,
    builderLanguage,
    selectedTagEntries,
    selectedTagGuide
  ]);

  const handleQuickActionClick = useCallback(
    (action: QuickAction) => {
      if (action.action === "code-builder") {
        openCodeBuilder();
        return;
      }
      applyQuickPrompt(action.prompt);
    },
    [applyQuickPrompt, openCodeBuilder]
  );

  return (
    <div
      className={cn("relative min-h-[100dvh] w-full overflow-hidden bg-[#05060a] text-slate-50", className)}
    >
      <div className="fixed inset-0 bg-black" />
      <GalaxyCanvas className="fixed inset-0 z-[2]" mobile={isMobile} reducedMotion={prefersReducedMotion} />
      <div className="pointer-events-none fixed inset-0 z-[3] bg-[radial-gradient(circle_at_50%_14%,rgba(125,211,252,0.1),rgba(0,0,0,0)_36%)]" />
      <div className="pointer-events-none fixed inset-0 z-[4] bg-black/50" />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-2.5 pb-[max(0.7rem,env(safe-area-inset-bottom))] sm:px-5">
        <header className="pt-5 text-center sm:pt-9">
          <motion.h1
            className="text-[2rem] font-semibold tracking-tight text-white drop-shadow-[0_6px_22px_rgba(0,0,0,0.5)] sm:text-5xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            {title}
          </motion.h1>
          <motion.p
            className="mx-auto mt-1.5 max-w-[680px] text-[13px] text-blue-100/85 drop-shadow-[0_4px_16px_rgba(0,0,0,0.45)] sm:mt-2 sm:text-base"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06 }}
          >
            {subtitle}
          </motion.p>
          <motion.div
            className="mx-auto mt-3 flex items-center justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
          >
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] sm:text-xs">
              <span
                className={cn(
                  "block h-3 w-3 rounded-full border shadow-[0_0_18px_rgba(16,185,129,0.55)]",
                  health.status === "online" &&
                    "border-emerald-300/70 bg-emerald-400",
                  health.status === "checking" &&
                    "border-cyan-300/70 bg-cyan-300",
                  health.status === "missing_key" &&
                    "border-amber-300/70 bg-amber-300",
                  health.status === "offline" &&
                    "border-rose-300/70 bg-rose-400"
                )}
                title={`${health.detail} | modelo: ${health.model}`}
                aria-label={`Status da IA: ${health.detail}`}
              />
              <span
                className={cn(
                  health.status === "online" ? "text-emerald-300" : "text-rose-300"
                )}
              >
                {health.status === "online" ? "ON" : "OFF"}
              </span>
            </span>
          </motion.div>
        </header>

        <main className="mt-3 flex w-full min-h-0 flex-1 flex-col pb-[calc(env(safe-area-inset-bottom)+0.35rem)] sm:mt-4 sm:pb-[0.9rem]">
          <div className="mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col justify-end">
            <AnimatePresence initial={false}>
              {messages.length > 0 && (
                <motion.div
                  ref={messagesRef}
                  className="mb-3 flex-1 min-h-0 space-y-2 overflow-y-auto px-1 sm:mb-4 sm:space-y-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="max-w-[96%] sm:max-w-[84%]">
                        <div
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-2xl border px-3 py-2 text-sm leading-relaxed backdrop-blur-xl",
                            message.role === "user"
                              ? "border-cyan-300/35 bg-cyan-400/14 text-cyan-50"
                              : "border-white/20 bg-white/[0.08] text-slate-100",
                            message.error && "border-rose-300/35 bg-rose-500/15 text-rose-100"
                          )}
                        >
                          {message.pending && !message.content ? <TypingDots /> : message.content}
                        </div>
                        <p className="mt-1 px-1 text-[10px] text-slate-400 sm:text-[11px]">
                          {message.role === "user" ? "Voce" : "IA"} - {formatTime(message.createdAt)}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <form
              onSubmit={onSubmit}
              className="rounded-[20px] border border-white/20 bg-black/45 p-2.5 shadow-[0_24px_70px_rgba(0,0,0,0.58)] backdrop-blur-2xl sm:rounded-2xl sm:p-4"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void onFileChange(event);
                }}
              />
              <Textarea
                ref={textareaRef}
                rows={1}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Cole seu erro, bug ou duvida de codigo..."
                className="min-h-[58px] resize-none border-0 bg-transparent px-0 text-[16px] placeholder:text-slate-400/75 focus-visible:ring-0 sm:min-h-[84px] sm:text-base"
              />
              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((file) => (
                    <div
                      key={file.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/20 bg-white/[0.06] px-2.5 py-1 text-xs text-slate-200"
                    >
                      <FileText className="h-3.5 w-3.5 text-cyan-200" />
                      <span className="max-w-[140px] truncate sm:max-w-[220px]">{file.name}</span>
                      <span className="text-slate-400">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(file.id)}
                        className="rounded-full p-0.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                        aria-label={`Remover ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 rounded-xl border border-white/15 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                  aria-label="Anexar arquivo"
                  onClick={openFilePicker}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>

                <Button
                  type="submit"
                  disabled={!canSend}
                  size="icon"
                  className="h-11 w-11 rounded-xl border border-white/20 bg-gradient-to-r from-blue-500/55 to-violet-500/55 text-white shadow-[0_10px_26px_rgba(58,78,255,0.3)] hover:from-blue-500/70 hover:to-violet-500/70 disabled:opacity-45"
                  aria-label="Enviar mensagem"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </form>

            <div className="-mx-1 mt-3 overflow-x-auto pb-1 sm:mt-4 sm:overflow-visible">
              <div className="flex w-max min-w-full items-center gap-2 px-1 sm:w-full sm:min-w-0 sm:flex-wrap sm:justify-center">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => handleQuickActionClick(action)}
                      className="group inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-black/35 px-3 py-1.5 text-[11px] text-slate-100 backdrop-blur-xl transition hover:-translate-y-[1px] hover:border-cyan-300/45 hover:bg-cyan-300/12 sm:px-3.5 sm:py-2 sm:text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 text-cyan-100/80 transition group-hover:text-cyan-100" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {isCodeModalOpen && (
          <motion.div
            className="fixed inset-0 z-30 flex items-end justify-center p-3 sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/74 backdrop-blur-sm"
              onClick={() => setIsCodeModalOpen(false)}
              aria-label="Fechar modal"
            />
            <motion.div
              className="relative z-10 w-full max-w-2xl rounded-2xl border border-white/20 bg-[#060a12]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.65)] sm:p-5"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/85">Gerador de codigo</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">Escolha linguagem, tag e objetivo</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCodeModalOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08]"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
                  <p className="text-xs text-slate-300">Linguagens (lista grande + busca)</p>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={builderLanguageQuery}
                      onChange={(event) => setBuilderLanguageQuery(event.target.value)}
                      placeholder="Buscar linguagem..."
                      className="h-10 w-full rounded-xl border border-white/15 bg-white/[0.05] pl-9 pr-3 text-sm text-white outline-none transition focus:border-cyan-300/45"
                    />
                  </div>
                  <div className="mt-2 max-h-[168px] space-y-1 overflow-y-auto pr-1">
                    {filteredLanguages.map((language) => (
                      <button
                        key={language}
                        type="button"
                        onClick={() => {
                          setBuilderLanguage(language);
                          setBuilderLanguageQuery(language);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition",
                          builderLanguage === language
                            ? "border-cyan-300/55 bg-cyan-300/15 text-cyan-100"
                            : "border-white/12 bg-white/[0.02] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/8"
                        )}
                      >
                        <span>{language}</span>
                        {builderLanguage === language && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>

                  <label className="mt-3 block text-xs text-slate-400">
                    Ou digite manualmente (qualquer linguagem)
                    <input
                      value={builderCustomLanguage}
                      onChange={(event) => setBuilderCustomLanguage(event.target.value)}
                      placeholder="Ex: Elixir Phoenix, Unreal Blueprints..."
                      className="mt-1.5 h-10 w-full rounded-xl border border-white/15 bg-white/[0.05] px-3 text-sm text-white outline-none transition focus:border-cyan-300/45"
                    />
                  </label>
                </div>

                <div className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
                  <p className="text-xs text-slate-300">Objetivo da tarefa</p>
                  <textarea
                    value={builderGoal}
                    onChange={(event) => setBuilderGoal(event.target.value)}
                    placeholder="Ex: criar landing page com formulario e tracking"
                    className="mt-2 min-h-[124px] w-full resize-none rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/45"
                  />
                  <div className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-300/8 px-3 py-2 text-xs text-cyan-100">
                    Linguagem final: <strong>{builderCustomLanguage.trim() || builderLanguage}</strong>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/12 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-300">Tags/tecnologias (busca global)</p>
                  <button
                    type="button"
                    onClick={clearBuilderTags}
                    className="rounded-lg border border-white/15 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-cyan-300/35 hover:bg-cyan-300/8"
                  >
                    Limpar tags
                  </button>
                </div>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={builderTagQuery}
                    onChange={(event) => setBuilderTagQuery(event.target.value)}
                    placeholder="Buscar tag, componente, framework, padrao..."
                    className="h-10 w-full rounded-xl border border-white/15 bg-white/[0.05] pl-9 pr-3 text-sm text-white outline-none transition focus:border-cyan-300/45"
                  />
                </div>

                <div className="mt-2 flex max-h-[180px] flex-wrap gap-2 overflow-y-auto pr-1">
                  {filteredTags.map((tag) => {
                    const selected = builderSelectedTagKeys.includes(tag.key);
                    return (
                      <button
                        key={tag.key}
                        type="button"
                        onClick={() => {
                          toggleBuilderTag(tag.key);
                          setShowTagTutorial(true);
                        }}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
                          selected
                            ? "border-cyan-300/65 bg-cyan-300/18 text-cyan-100"
                            : "border-white/18 bg-white/[0.04] text-slate-200 hover:border-cyan-300/38 hover:bg-cyan-300/10"
                        )}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                        <span>{tag.label}</span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">{tag.category}</span>
                      </button>
                    );
                  })}
                </div>

                {selectedTagEntries.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedTagEntries.map((tag) => (
                      <button
                        key={`selected_${tag.key}`}
                        type="button"
                        onClick={() => toggleBuilderTag(tag.key)}
                        className="rounded-full border border-cyan-300/45 bg-cyan-300/14 px-2.5 py-1 text-[11px] text-cyan-100"
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTagTutorial((prev) => !prev)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-300/45 hover:bg-cyan-300/10"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {showTagTutorial ? "Ocultar tutorial" : "Tutorial da tag"}
                </button>
                <p className="text-xs text-slate-400">Clique em qualquer tag para ver o tutorial e exemplo rapido.</p>
              </div>

              <AnimatePresence initial={false}>
                {showTagTutorial && selectedTagGuide && (
                  <motion.div
                    className="mt-3 rounded-xl border border-cyan-300/26 bg-cyan-300/8 p-3"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                  >
                    <p className="text-sm font-medium text-cyan-100">{selectedTagGuide.label}</p>
                    <p className="mt-1 text-sm text-slate-200">
                      {selectedTagGuide.tutorial || "Tag sem descricao detalhada cadastrada ainda."}
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-2 text-xs text-cyan-100">
{selectedTagGuide.example || "Exemplo indisponivel para esta tag."}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setIsCodeModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="button" className="rounded-xl" onClick={applyCodeBuilderPrompt}>
                  Inserir prompt no chat
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
