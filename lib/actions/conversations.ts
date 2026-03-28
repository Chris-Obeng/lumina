"use server";

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import type { UIMessage } from "ai";

type ConversationSnapshot = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
};

function deriveTitleFromMessages(messages: UIMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) return "New chat";

  const firstTextPart = firstUserMessage.parts.find((part) => part.type === "text");
  if (!firstTextPart || firstTextPart.type !== "text") return "New chat";

  const normalized = firstTextPart.text.replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";

  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

export async function getConversationsAction(): Promise<{
  success: boolean;
  conversations: ConversationSnapshot[];
}> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, conversations: [] };
  }

  const chats = await prisma.chat.findMany({
    where: { userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const conversations = chats
    .map((chat) => {
      const messages: UIMessage[] = chat.messages.map((message) => ({
        id: message.id,
        role: message.role as UIMessage["role"],
        parts: [{ type: "text", text: message.content }],
      }));

      const latestMessage = chat.messages[chat.messages.length - 1];
      const updatedAt = latestMessage
        ? latestMessage.createdAt.getTime()
        : chat.updatedAt.getTime();

      return {
        id: chat.id,
        title: chat.title?.trim() || deriveTitleFromMessages(messages),
        updatedAt,
        messages,
      };
    })
    .filter((conversation) => conversation.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    success: true,
    conversations,
  };
}
