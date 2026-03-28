import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";

export type GmailStatus = {
  connected: boolean;
  state: string;
  authorizationUrl: string | null;
  mcpReference?: string | null;
};

export type ConversationSnapshot = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
};

export type ChatToolPart = ToolUIPart | DynamicToolUIPart;
