import type { AiProviderConfig, TenantSettings } from './types';
import { buildScopePrompt, buildSystemPrompt } from './prompt';
import { clamp, checkOutgoing, matchBlockedKeyword, sanitize } from './guardrail';

// --------------------------------------------------------------------------
// AiClient — any OpenAI-compatible /chat/completions endpoint.
// --------------------------------------------------------------------------

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  ok: boolean;
  text: string;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
}

async function fetchJsonOrText(
  url: string,
  init: RequestInit,
  timeoutSeconds: number
): Promise<{ status: number; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(
  cfg: AiProviderConfig,
  messages: AiMessage[],
  options: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<AiResult & { status?: number }> {
  if (!cfg.apiKey) {
    return { ok: false, text: '', error: 'کلید API هوش مصنوعی تنظیم نشده است.' };
  }

  const payload: Record<string, unknown> = {
    model: cfg.model || 'gpt-4o-mini',
    messages,
    temperature: options.temperature ?? cfg.temperature,
    max_tokens: options.maxTokens ?? cfg.maxTokens,
    stream: false
  };
  if (options.jsonMode) payload.response_format = { type: 'json_object' };

  const url = cfg.baseUrl.trim().replace(/\/+$/, '') + '/chat/completions';
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey.trim()}`
    },
    body: JSON.stringify(payload)
  };

  const first = await send(cfg, url, init, options.jsonMode ?? false);

  // Some gateways reject response_format; retry once as plain chat.
  if (!first.ok && (options.jsonMode ?? false) && [400, 404, 422].includes(first.status ?? 0)) {
    delete payload.response_format;
    return await send(cfg, url, { ...init, body: JSON.stringify(payload) }, false);
  }
  return first;
}

async function send(
  cfg: AiProviderConfig,
  url: string,
  init: RequestInit,
  _jsonMode: boolean
): Promise<AiResult & { ok: boolean; status?: number }> {
  try {
    const { status, body } = await fetchJsonOrText(url, init, cfg.timeoutSeconds || 45);
    if (status >= 400) {
      const errBody = body as { error?: { message?: string } | string } | null;
      const message =
        (typeof errBody?.error === 'string' ? errBody.error : errBody?.error?.message) ?? `HTTP ${status}`;
      return { ok: false, status, text: '', error: message };
    }
    const root = body as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string }; text?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    if (root?.error) {
      return { ok: false, status, text: '', error: root.error.message ?? 'خطای نامشخص از سرویس هوش مصنوعی' };
    }
    const choice = root?.choices?.[0];
    const content = choice?.message?.content ?? choice?.text ?? '';
    if (!content.trim()) {
      return { ok: false, status, text: '', error: 'پاسخ سرویس هوش مصنوعی خالی بود.' };
    }
    return {
      ok: true,
      status,
      text: content,
      promptTokens: root?.usage?.prompt_tokens,
      completionTokens: root?.usage?.completion_tokens
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      text: '',
      error: aborted ? 'سرویس هوش مصنوعی در مهلت پاسخ نداد.' : 'اتصال به سرویس هوش مصنوعی برقرار نشد.'
    };
  }
}

// --------------------------------------------------------------------------
// Reply pipeline
// --------------------------------------------------------------------------

export interface ReplyOutcome {
  sent: boolean;
  blocked: boolean;
  reason: string | null;
  reply: string;
  tokens: number;
  stage: string;
}

/**
 * Full guardrail pipeline for one incoming DM, independent of Instagram:
 * 1. keyword gate → 2. AI scope gate → 3. generation → 4. output inspection.
 */
export async function generateReply(
  cfg: AiProviderConfig,
  settings: TenantSettings,
  history: AiMessage[],
  incomingText: string
): Promise<ReplyOutcome> {
  const base: ReplyOutcome = { sent: true, blocked: false, reason: null, reply: '', tokens: 0, stage: '' };

  // Layer 1: hard keyword gate.
  const keyword = matchBlockedKeyword(incomingText, settings.guardrails.blockedKeywords);
  if (keyword) {
    return { ...base, blocked: true, reason: `کلمهٔ مسدود در پیام: ${keyword}`, reply: settings.persona.offTopicReply };
  }

  // Layer 2: AI scope gate (a second, cheap classification call).
  if (settings.guardrails.strictMode) {
    const gate = await chat(
      cfg,
      [
        { role: 'system', content: buildScopePrompt(settings) },
        { role: 'user', content: incomingText }
      ],
      { temperature: 0, maxTokens: 60, jsonMode: true }
    );

    if (gate.ok) {
      let onTopic: boolean | undefined;
      try {
        const start = gate.text.indexOf('{');
        const end = gate.text.lastIndexOf('}');
        if (start >= 0 && end > start) onTopic = JSON.parse(gate.text.slice(start, end + 1)).on_topic;
      } catch {
        onTopic = undefined;
      }
      if (onTopic === false) {
        return { ...base, blocked: true, reason: 'دروازهٔ موضوع: خارج از موضوع', reply: settings.persona.offTopicReply };
      }
    }
    // If the gate call failed or returned no verdict we continue; the prompt's own
    // hard rules are the safety net.
  }

  // Layer 3: generate the reply with conversation history.
  const result = await chat(cfg, [
    { role: 'system', content: buildSystemPrompt(settings) },
    ...history,
    { role: 'user', content: incomingText }
  ]);
  const tokens = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);

  if (!result.ok) {
    return { ...base, blocked: true, reason: result.error ?? 'سرویس هوش مصنوعی پاسخ نداد', reply: settings.guardrails.errorReply };
  }

  // Layer 4: sanitize + inspect output.
  const sanitized = sanitize(result.text, settings.persona);
  const problem = checkOutgoing(sanitized, settings);
  if (problem) {
    return { ...base, blocked: true, reason: problem, reply: settings.persona.offTopicReply, tokens };
  }

  return { sent: true, blocked: false, reason: null, reply: clamp(sanitized, settings.persona.maxChars), tokens, stage: 'ok' };
}
