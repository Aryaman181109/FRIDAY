import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/shell/AppShell";
import "./AISetupGate.css";

type Provider = "gemini" | "openai" | "openrouter" | "groq";
type SetupStatus = "checking" | "ready" | "required" | "saving";

interface AIProviderStatusResponse {
  configured: boolean;
  provider?: string | null;
  model?: string | null;
  message: string;
}

const PROVIDER_MODELS: Record<Provider, string> = {
  gemini: "gemini-2.0-flash",
  openai: "gpt-4.1-mini",
  openrouter: "openai/gpt-4.1-mini",
  groq: "llama-3.1-8b-instant",
};

function inferProvider(apiKey: string): Provider {
  const trimmedKey = apiKey.trim();

  if (trimmedKey.startsWith("sk-or-")) return "openrouter";
  if (trimmedKey.startsWith("gsk_")) return "groq";
  return trimmedKey.startsWith("sk-") ? "openai" : "gemini";
}

export default function AISetupGate() {
  const [status, setStatus] = useState<SetupStatus>("checking");
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkProvider() {
      try {
        const providerStatus = await invoke<AIProviderStatusResponse>(
          "ai_provider_status",
        );

        if (cancelled) return;
        setStatus(providerStatus.configured ? "ready" : "required");
      } catch (providerError) {
        if (cancelled) return;

        setError(
          providerError instanceof Error
            ? providerError.message
            : "I could not check FRIDAY's AI setup.",
        );
        setStatus("required");
      }
    }

    void checkProvider();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = useMemo(() => PROVIDER_MODELS[provider], [provider]);

  const handleApiKeyChange = useCallback((value: string) => {
    setApiKey(value);
    setProvider(inferProvider(value));
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length < 16) {
      setError("Paste a valid API key to continue.");
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      await invoke<AIProviderStatusResponse>("ai_save_provider_config", {
        request: {
          provider,
          apiKey: trimmedKey,
          model: selectedModel,
        },
      });
      setApiKey("");
      setStatus("ready");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "I could not save that API key.",
      );
      setStatus("required");
    }
  }, [apiKey, provider, selectedModel]);

  if (status === "ready") {
    return <AppShell />;
  }

  return (
    <main className="ai-setup">
      <motion.section
        className="ai-setup__panel"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="ai-setup__orb" aria-hidden />

        <p className="ai-setup__eyebrow">FIRST RUN</p>
        <h1 className="ai-setup__title">Activate FRIDAY</h1>
        <p className="ai-setup__copy">
          Paste your API key once. FRIDAY will save it locally and open normally
          after this.
        </p>

        <div className="ai-setup__providers" aria-label="AI provider">
          <button
            className={provider === "groq" ? "ai-setup__provider ai-setup__provider--active" : "ai-setup__provider"}
            type="button"
            onClick={() => setProvider("groq")}
          >
            Groq
          </button>
          <button
            className={provider === "gemini" ? "ai-setup__provider ai-setup__provider--active" : "ai-setup__provider"}
            type="button"
            onClick={() => setProvider("gemini")}
          >
            Gemini
          </button>
          <button
            className={provider === "openai" ? "ai-setup__provider ai-setup__provider--active" : "ai-setup__provider"}
            type="button"
            onClick={() => setProvider("openai")}
          >
            OpenAI
          </button>
          <button
            className={provider === "openrouter" ? "ai-setup__provider ai-setup__provider--active" : "ai-setup__provider"}
            type="button"
            onClick={() => setProvider("openrouter")}
          >
            OpenRouter
          </button>
        </div>

        <label className="ai-setup__field">
          <span>API Key</span>
          <input
            value={apiKey}
            onChange={(event) => handleApiKeyChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              }
            }}
            placeholder="Paste your key here"
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={status === "saving" || status === "checking"}
          />
        </label>

        <button
          className="ai-setup__submit"
          type="button"
          disabled={status === "saving" || status === "checking"}
          onClick={() => void handleSave()}
        >
          {status === "saving" ? "Saving..." : "Continue"}
        </button>

        {error && <p className="ai-setup__error">{error}</p>}
        {status === "checking" && (
          <p className="ai-setup__hint">Checking local setup...</p>
        )}
      </motion.section>
    </main>
  );
}
