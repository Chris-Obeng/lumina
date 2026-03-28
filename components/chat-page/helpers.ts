import type { DynamicToolUIPart, UIMessage } from "ai";

import type { ChatToolPart } from "./types";

export function createConversationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveConversationTitle(chatMessages: UIMessage[]) {
  const firstUser = chatMessages.find((message) => message.role === "user");
  if (!firstUser) return "New chat";

  const firstText = firstUser.parts.find((part) => part.type === "text");
  if (!firstText || firstText.type !== "text" || !firstText.text.trim()) {
    return "New chat";
  }

  const normalized = firstText.text.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

export function isDynamicToolPart(part: unknown): part is DynamicToolUIPart {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: string }).type === "dynamic-tool"
  );
}

export function isToolPart(part: unknown): part is ChatToolPart {
  if (!part || typeof part !== "object") return false;
  const type = (part as { type?: string }).type;
  return (
    type === "dynamic-tool" ||
    (typeof type === "string" && type.startsWith("tool-"))
  );
}

export const toolIsOpenByDefault = (state: ChatToolPart["state"]) =>
  state === "output-available" || state === "output-error";
