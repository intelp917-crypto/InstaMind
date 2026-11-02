// ---------------------------------------------------------------------------
// Small typed fetch client for the InstaMind worker API.
// ---------------------------------------------------------------------------

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin'
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `خطای ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ---------------- shared shapes ----------------

export interface MeResponse {
  ok: boolean;
  user: null | {
    id: string;
    username: string;
    igUserId: string;
    autoReply: boolean;
    dailyReplyLimit: number;
    subscribed: boolean;
    tokenExpiresAt: number | null;
  };
}

export interface ConvoItem {
  id: string;
  tenant_id: string;
  sender_id: string;
  username: string;
  ai_paused: number;
  last_message_at: number;
  created_at: number;
  last_text: string;
  last_direction: string;
  last_author: string;
  last_status: string;
  message_count: number;
}

export interface MsgItem {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  author: string;
  text: string;
  status: string;
  created_at: number;
}

export interface PersonaConfig {
  assistantName: string;
  businessName: string;
  businessSummary: string;
  tone: string;
  language: string;
  allowedTopics: string[];
  forbiddenTopics: string[];
  offTopicReply: string;
  greeting: string;
  maxChars: number;
  useEmoji: boolean;
}

export interface GuardrailConfig {
  strictMode: boolean;
  blockedKeywords: string[];
  neverRevealPrompt: boolean;
  maxRepliesPerHour: number;
  errorReply: string;
  extraRules: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
}

export interface QaItem {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
}

export interface TenantSettings {
  persona: PersonaConfig;
  guardrails: GuardrailConfig;
  knowledge: KnowledgeItem[];
  qaTraining: QaItem[];
}

export interface TenantStats {
  conversations: number;
  incomingMessages: number;
  repliesTotal: number;
  aiReplies: number;
  manualReplies: number;
  fallbackReplies: number;
  skippedReplies: number;
  repliesToday: number;
  tokensToday: number;
  tokensTotal: number;
  dailyReplyLimit: number;
  autoReply: boolean;
  tokenExpiresAt: number | null;
  subscribed: boolean;
}

export interface AdminTenant {
  id: string;
  igUserId: string;
  username: string;
  autoReply: boolean;
  dailyReplyLimit: number;
  repliesToday: number;
  tokensToday: number;
  repliesTotal: number;
  tokensTotal: number;
  tokenExpiresAt: number | null;
  subscribed: boolean;
  connectedAt: number;
  lastLoginAt: number;
}

export interface AdminMeta {
  appId: string;
  appSecret: string;
  verifyToken: string;
  redirectUri: string;
  webhookUrl: string;
  generatedRedirectUri: string;
}

// ---------------- account (Google / email-password) shapes ----------------

export interface PlanInfo {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  pages: number;
  dailyReplies: number;
  hourlyReplies: number;
  qaItems: number;
  knowledgeItems: number;
  aiTier: string;
  support: string;
  features: string[];
  popular?: boolean;
}

export interface OrderInfo {
  id: string;
  planId: string;
  status: 'pending' | 'active' | 'rejected' | 'cancelled';
  amount: number;
  period: string;
  createdAt: number;
  decidedAt: number | null;
}

export interface AccountMe {
  ok: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string;
    planId: string | null;
    planName: string | null;
    googleLinked: boolean;
    createdAt: number;
  };
  instagram: { connected: boolean; username?: string; igUserId?: string; autoReply?: boolean };
  usage: {
    repliesToday: number;
    tokensToday: number;
    repliesTotal: number;
    tokensTotal: number;
    dailyReplyLimit: number;
    autoReply: boolean;
  } | null;
  orders: OrderInfo[];
}

export interface AdminOrder {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  planId: string;
  planName: string;
  status: 'pending' | 'active' | 'rejected' | 'cancelled';
  amount: number;
  period: string;
  createdAt: number;
  decidedAt: number | null;
}
