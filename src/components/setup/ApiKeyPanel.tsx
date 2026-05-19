import { useCallback, useEffect, useRef } from 'react';
import { useApiStore } from '../../store/apiStore';
import { MODELS } from '../../services/claude/client';
import { ProviderCard } from './ProviderCard';
import { CLAUDE_CONFIG, GEMINI_CONFIG, OLLAMA_CONFIG, TAVILY_CONFIG } from './providerConfigs';

export function ApiKeyPanel() {
  const {
    provider,
    researchBackend,
    claudeApiKey, geminiApiKey, ollamaApiKey, ollamaModel, tavilyApiKey,
    claudeKeyValid, geminiKeyValid, ollamaKeyValid, tavilyKeyValid,
    isValidatingClaude, isValidatingGemini, isValidatingOllama, isValidatingTavily,
    setProvider, setResearchBackend,
    setClaudeApiKey, setGeminiApiKey, setOllamaApiKey, setOllamaModel, setTavilyApiKey,
    setClaudeKeyValid, setGeminiKeyValid, setOllamaKeyValid, setTavilyKeyValid,
    setIsValidatingClaude, setIsValidatingGemini, setIsValidatingOllama, setIsValidatingTavily,
  } = useApiStore();

  const validateClaude = useCallback(async () => {
    if (!claudeApiKey.trim()) return;
    setIsValidatingClaude(true);
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey: claudeApiKey.trim(),
        dangerouslyAllowBrowser: true,
      });
      await client.messages.create({
        model: MODELS.haiku,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      setClaudeKeyValid(true);
    } catch {
      setClaudeKeyValid(false);
    } finally {
      setIsValidatingClaude(false);
    }
  }, [claudeApiKey, setClaudeKeyValid, setIsValidatingClaude]);

  const validateGemini = useCallback(async () => {
    if (!geminiApiKey.trim()) return;
    setIsValidatingGemini(true);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey.trim()}`,
      );
      setGeminiKeyValid(res.ok);
    } catch {
      setGeminiKeyValid(false);
    } finally {
      setIsValidatingGemini(false);
    }
  }, [geminiApiKey, setGeminiKeyValid, setIsValidatingGemini]);

  const validateOllama = useCallback(async () => {
    if (!ollamaApiKey.trim()) return;
    setIsValidatingOllama(true);
    try {
      // Same proxy URL the runtime uses — vite.config.ts forwards it in
      // dev, api/ollama-proxy.ts forwards it in prod.
      const res = await fetch('/api/ollama-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ollamaApiKey.trim()}`,
        },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        }),
      });
      setOllamaKeyValid(res.ok);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
         
        console.warn('Ollama validation failed', res.status, detail);
      }
    } catch (err) {
       
      console.warn('Ollama validation error (likely CORS or network):', err);
      setOllamaKeyValid(false);
    } finally {
      setIsValidatingOllama(false);
    }
  }, [ollamaApiKey, ollamaModel, setOllamaKeyValid, setIsValidatingOllama]);

  const validateTavily = useCallback(async () => {
    if (!tavilyApiKey.trim()) return;
    setIsValidatingTavily(true);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tavilyApiKey.trim()}`,
        },
        body: JSON.stringify({ query: 'ping', max_results: 1, search_depth: 'basic' }),
      });
      setTavilyKeyValid(res.ok);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
         
        console.warn('Tavily validation failed', res.status, detail);
      }
    } catch (err) {
       
      console.warn('Tavily validation error:', err);
      setTavilyKeyValid(false);
    } finally {
      setIsValidatingTavily(false);
    }
  }, [tavilyApiKey, setTavilyKeyValid, setIsValidatingTavily]);

  // Auto-validate stored keys on mount
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (claudeApiKey.trim() && claudeKeyValid === null) validateClaude();
    if (geminiApiKey.trim() && geminiKeyValid === null) validateGemini();
    if (ollamaApiKey.trim() && ollamaKeyValid === null) validateOllama();
    if (tavilyApiKey.trim() && tavilyKeyValid === null) validateTavily();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const researchHint =
    researchBackend === 'anthropic'
      ? 'Uses Claude’s built-in web search. Requires the Claude key.'
      : researchBackend === 'tavily'
        ? 'Sends queries to Tavily, then synthesizes results with the active LLM. Requires the Tavily key.'
        : 'Searches Wikipedia, then synthesizes with the active LLM. No extra key needed.';

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-medium text-text-primary">
        Connect Your Services
      </h3>

      <div className="flex items-start gap-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3.5 py-3">
        <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div>
          <p className="text-xs font-medium text-emerald-400 mb-0.5">Your keys never leave your computer</p>
          <p className="text-xs text-text-muted leading-relaxed">
            CanvasClassBuild has no server and no accounts. Everything happens right here in your browser — we never see, store, or have access to your keys.
          </p>
        </div>
      </div>

      {/* LLM provider segmented control */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">Course-content provider</p>
        <div className="inline-flex rounded-lg border border-violet-500/15 bg-bg-card p-1 text-xs">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              provider === 'anthropic'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setProvider('anthropic')}
          >
            Claude
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              provider === 'ollama'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setProvider('ollama')}
          >
            Ollama Cloud
          </button>
        </div>
        <p className="text-xs text-text-muted">
          {provider === 'anthropic'
            ? 'Claude writes syllabus and chapter content. Best quality.'
            : 'Open-weight alternative. Used for syllabus and chapter content; the research stage uses whichever backend you pick below.'}
        </p>
      </div>

      {/* Research backend segmented control */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">Research backend</p>
        <div className="inline-flex rounded-lg border border-violet-500/15 bg-bg-card p-1 text-xs">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              researchBackend === 'anthropic'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setResearchBackend('anthropic')}
          >
            Claude web search
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              researchBackend === 'tavily'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setResearchBackend('tavily')}
          >
            Tavily
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              researchBackend === 'wikipedia'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setResearchBackend('wikipedia')}
          >
            Wikipedia
          </button>
        </div>
        <p className="text-xs text-text-muted">{researchHint}</p>
      </div>

      <ProviderCard
        config={CLAUDE_CONFIG}
        apiKey={claudeApiKey}
        keyValid={claudeKeyValid}
        isValidating={isValidatingClaude}
        setKey={setClaudeApiKey}
        validate={validateClaude}
        defaultExpanded={!claudeApiKey && (provider === 'anthropic' || researchBackend === 'anthropic')}
      />

      <ProviderCard
        config={OLLAMA_CONFIG}
        apiKey={ollamaApiKey}
        keyValid={ollamaKeyValid}
        isValidating={isValidatingOllama}
        setKey={setOllamaApiKey}
        validate={validateOllama}
        defaultExpanded={!ollamaApiKey && provider === 'ollama'}
      />

      {provider === 'ollama' && ollamaApiKey.trim() && (
        <div className="rounded-lg border border-violet-500/15 bg-bg-card px-3.5 py-3 space-y-1.5">
          <label htmlFor="ollama-model-input" className="block text-xs font-medium text-text-secondary">Ollama model</label>
          <input
            id="ollama-model-input"
            type="text"
            value={ollamaModel}
            onChange={(e) => setOllamaModel(e.target.value)}
            placeholder="gpt-oss:120b-cloud"
            className="w-full rounded-md bg-bg-base border border-violet-500/10 px-3 py-1.5 text-sm font-mono"
          />
          <p className="text-xs text-text-muted">
            Browse models at <a className="text-violet-400 hover:underline" href="https://ollama.com/search?c=cloud" target="_blank" rel="noreferrer">ollama.com/search?c=cloud</a>.
          </p>
        </div>
      )}

      <ProviderCard
        config={TAVILY_CONFIG}
        apiKey={tavilyApiKey}
        keyValid={tavilyKeyValid}
        isValidating={isValidatingTavily}
        setKey={setTavilyApiKey}
        validate={validateTavily}
        defaultExpanded={!tavilyApiKey && researchBackend === 'tavily'}
      />

      <ProviderCard
        config={GEMINI_CONFIG}
        apiKey={geminiApiKey}
        keyValid={geminiKeyValid}
        isValidating={isValidatingGemini}
        setKey={setGeminiApiKey}
        validate={validateGemini}
      />
    </div>
  );
}
