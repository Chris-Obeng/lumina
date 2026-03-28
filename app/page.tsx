"use client";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  ChatHeader,
  ClaudeSidebar,
  ConversationPane,
  EmptyChatPane,
  GmailConnectionDialog,
} from "@/components/chat-page/ui";
import {
  createConversationId,
  deriveConversationTitle,
} from "@/components/chat-page/helpers";
import type {
  ConversationSnapshot,
  GmailStatus,
} from "@/components/chat-page/types";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getConversationsAction } from "@/lib/actions/conversations";
import { checkAndSaveUser } from "@/lib/actions/user";
import { useChat } from "@ai-sdk/react";
import { useUser } from "@clerk/nextjs";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  const [input, setInput] = useState("");
  const { user } = useUser();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] =
    useState(createConversationId);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailStatusLoading, setGmailStatusLoading] = useState(true);
  const [gmailConnectLoading, setGmailConnectLoading] = useState(false);
  const [gmailDialogOpen, setGmailDialogOpen] = useState(false);
  const [gmailConnectError, setGmailConnectError] = useState<string | null>(
    null
  );
  const hydratedUserIdRef = useRef<string | null>(null);

  const { id: chatId, clearError, messages, sendMessage, setMessages, status, stop } =
    useChat({
      id: activeConversationId,
      experimental_throttle: 32,
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    });

  useEffect(() => {
    setConversations((previous) => {
      const nextTitle = deriveConversationTitle(messages);
      const existingIndex = previous.findIndex(
        (conversation) => conversation.id === activeConversationId
      );

      if (messages.length === 0 && existingIndex < 0) {
        return previous;
      }

      if (existingIndex >= 0) {
        const existing = previous[existingIndex]!;
        const nextConversation: ConversationSnapshot = {
          ...existing,
          title: nextTitle,
          updatedAt: Date.now(),
          messages,
        };
        const next = [...previous];
        next[existingIndex] = nextConversation;
        return next;
      }

      return [
        ...previous,
        {
          id: activeConversationId,
          title: nextTitle,
          updatedAt: Date.now(),
          messages,
        },
      ];
    });
  }, [activeConversationId, messages]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text.trim() && message.files.length === 0) return;

      if (message.files.length > 0) {
        const { uploadFileAction } = await import("@/lib/actions/upload");
        for (const filePart of message.files) {
          if (filePart.url) {
            const response = await fetch(filePart.url);
            const blob = await response.blob();
            const file = new File([blob], filePart.filename || "upload", {
              type: filePart.mediaType,
            });
            const formData = new FormData();
            formData.append("file", file);
            formData.append("chatId", chatId);
            await uploadFileAction(formData);
          }
        }
      }

      sendMessage({ text: message.text });
      setInput("");
    },
    [chatId, sendMessage]
  );

  const handleNewConversation = useCallback(() => {
    setInput("");
    setActiveConversationId(createConversationId());
    setMessages([]);
    clearError();
  }, [clearError, setMessages]);

  const refreshGmailStatus = useCallback(async () => {
    setGmailStatusLoading(true);
    try {
      const response = await fetch("/api/smithery/gmail");
      if (!response.ok) throw new Error("Failed to fetch Gmail status.");
      const data = (await response.json()) as GmailStatus;
      setGmailStatus(data);
      if (data.connected && data.mcpReference) {
        const { updateGmailReferenceAction } = await import(
          "@/lib/actions/gmail"
        );
        await updateGmailReferenceAction(data.mcpReference);
      }
    } catch {
      setGmailStatus({
        connected: false,
        state: "not_connected",
        mcpReference: null,
        authorizationUrl: null,
      });
    } finally {
      setGmailStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshGmailStatus();
    const onFocus = () => void refreshGmailStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshGmailStatus]);

  useEffect(() => {
    if (!user) return;

    void checkAndSaveUser().then((result) => {
      if (!result.success) {
        console.error("Failed to sync user record:", result.message);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || hydratedUserIdRef.current === user.id) return;
    hydratedUserIdRef.current = user.id;

    let isCancelled = false;

    void (async () => {
      try {
        const result = await getConversationsAction();
        if (!result.success || isCancelled) return;

        setConversations(result.conversations);
      } catch (error) {
        console.error("Failed to load chat history:", error);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  const handleConnectGmail = useCallback(async () => {
    setGmailConnectLoading(true);
    setGmailConnectError(null);
    try {
      const response = await fetch("/api/smithery/gmail", { method: "POST" });
      if (!response.ok) throw new Error("Could not start Gmail authorization.");
      const data = (await response.json()) as GmailStatus;
      setGmailStatus(data);
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, "_blank", "noopener,noreferrer");
      }
      setGmailDialogOpen(false);
    } catch {
      setGmailConnectError(
        "We could not start Gmail authorization. Please try again."
      );
    } finally {
      setGmailConnectLoading(false);
    }
  }, []);

  const handleDisconnectGmail = useCallback(async () => {
    setGmailConnectLoading(true);
    try {
      const { disconnectGmailAction } = await import("@/lib/actions/gmail");
      await disconnectGmailAction();
      await refreshGmailStatus();
      setGmailDialogOpen(false);
    } catch {
      setGmailConnectError("Failed to disconnect Gmail.");
    } finally {
      setGmailConnectLoading(false);
    }
  }, [refreshGmailStatus]);

  const gmailStatusLabel = useMemo(() => {
    if (gmailStatusLoading) return "Checking Gmail...";
    return gmailStatus?.connected ? "Gmail Connected" : "Gmail Not Connected";
  }, [gmailStatus?.connected, gmailStatusLoading]);

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );

  const currentConversationTitle = useMemo(
    () => deriveConversationTitle(messages),
    [messages]
  );

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      const target = conversations.find(
        (conversation) => conversation.id === conversationId
      );
      if (!target) return;
      setActiveConversationId(target.id);
      setMessages(target.messages);
      clearError();
      setInput("");
    },
    [clearError, conversations, setMessages]
  );

  const hasMessages = messages.length > 0;
  const firstName = user?.firstName || user?.fullName?.split(" ")[0];

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 110% at 50% 38%, var(--background-elevated) 0%, var(--background) 58%)",
      }}
    >
      <ClaudeSidebar
        className="hidden md:flex"
        onNewChat={handleNewConversation}
        conversations={sortedConversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onGmailOpen={() => {
          setGmailConnectError(null);
          setGmailDialogOpen(true);
        }}
        gmailConnected={!!gmailStatus?.connected}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((previous) => !previous)}
      />

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[260px] border-r border-border bg-[var(--sidebar)] p-0 sm:max-w-[260px]"
        >
          <ClaudeSidebar
            className="h-full border-r-0"
            onNewChat={handleNewConversation}
            conversations={sortedConversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onGmailOpen={() => {
              setGmailConnectError(null);
              setGmailDialogOpen(true);
            }}
            gmailConnected={!!gmailStatus?.connected}
            isOpen
            onToggle={() => setMobileSidebarOpen(false)}
            onAfterAction={() => setMobileSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          hasMessages={hasMessages}
          currentConversationTitle={currentConversationTitle}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col items-center overflow-hidden">
          {hasMessages ? (
            <ConversationPane
              messages={messages}
              input={input}
              setInput={setInput}
              onSubmit={handleSubmit}
              status={status}
              stop={stop}
            />
          ) : (
            <EmptyChatPane
              firstName={firstName}
              input={input}
              setInput={setInput}
              onSubmit={handleSubmit}
              status={status}
              stop={stop}
            />
          )}
        </main>
      </div>

      <GmailConnectionDialog
        open={gmailDialogOpen}
        onOpenChange={setGmailDialogOpen}
        gmailStatus={gmailStatus}
        gmailStatusLabel={gmailStatusLabel}
        gmailStatusLoading={gmailStatusLoading}
        gmailConnectLoading={gmailConnectLoading}
        gmailConnectError={gmailConnectError}
        onRefreshStatus={refreshGmailStatus}
        onConnectGmail={handleConnectGmail}
        onDisconnectGmail={handleDisconnectGmail}
      />
    </div>
  );
}
