"use client";

import { UserButton } from "@clerk/nextjs";
import type { ChatStatus, UIMessage } from "ai";
import {
  AudioLinesIcon,
  BookOpenIcon,
  ChevronDownIcon,
  CodeIcon,
  FileTextIcon,
  HeartIcon,
  LightbulbIcon,
  Link2Icon,
  MailIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PenLineIcon,
  PlusIcon,
  Share2Icon,
  XIcon,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

import {
  isDynamicToolPart,
  isToolPart,
  toolIsOpenByDefault,
} from "./helpers";
import type { ConversationSnapshot, GmailStatus } from "./types";

const NAV_ITEMS = [{ icon: PlusIcon, label: "New chat", id: "new-chat" }] as const;

const QUICK_ACTIONS = [
  { icon: PenLineIcon, label: "Write" },
  { icon: BookOpenIcon, label: "Learn" },
  { icon: CodeIcon, label: "Code" },
  { icon: HeartIcon, label: "Life stuff" },
  { icon: LightbulbIcon, label: "Claude's choice" },
] as const;

function getDayOfWeek() {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date());
}

function ClientOnlyUserButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="size-8 rounded-full bg-muted/40" aria-hidden="true" />;
  }

  return <UserButton />;
}

function SidebarToggleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="5" height="12" rx="1" opacity="0.5" />
      <rect x="8" y="2" width="7" height="2" rx="1" />
      <rect x="8" y="7" width="7" height="2" rx="1" />
      <rect x="8" y="12" width="7" height="2" rx="1" />
    </svg>
  );
}

function ClaudeStar({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className="claude-logo"
      aria-hidden="true"
    >
      <path d="M32 4 L35.5 28.5 L58 20 L42 37 L60 44 L36.5 39.5 L40 62 L32 46 L24 62 L27.5 39.5 L4 44 L22 37 L6 20 L28.5 28.5 Z" />
    </svg>
  );
}

function EmptyState({ userName }: { userName?: string }) {
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    setDay(getDayOfWeek());
  }, []);

  const greetingDay = day ?? "there";
  const greeting = userName
    ? `Happy ${greetingDay}, ${userName}`
    : `Happy ${greetingDay}`;

  return (
    <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-9 py-20 animate-fade-up">
      <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/35 px-4 py-1.5 text-[13px] text-muted-foreground">
        <span>Free plan</span>
        <span className="text-border">-</span>
        <button className="text-[var(--claude-accent)] underline-offset-2 transition-colors hover:underline">
          Upgrade
        </button>
      </div>

      <div className="flex items-center gap-4">
        <ClaudeStar size={42} />
        <h1 className="greeting-text">{greeting}</h1>
      </div>
    </div>
  );
}

function AttachmentList() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;

  return (
    <div className="mb-2 flex max-w-full gap-2 overflow-x-auto pb-1">
      {files.map((file) => (
        <div
          key={file.id}
          className="group relative flex h-14 min-w-[180px] max-w-[220px] items-center gap-2 rounded-lg border border-input bg-background/80 px-2 pr-8 shadow-sm animate-in fade-in zoom-in duration-200"
        >
          <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/40">
            {file.mediaType?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={file.filename}
                className="h-full w-full object-cover"
              />
            ) : (
              <PaperclipIcon className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">{file.filename}</p>
            <p className="truncate text-[10px] uppercase text-muted-foreground">
              {file.mediaType?.split("/")[1] || "file"}
            </p>
          </div>
          <button
            onClick={() => remove(file.id)}
            className="absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded-full border border-input bg-background/80 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

type ChatInputProps = {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (message: PromptInputMessage) => void;
  status: ChatStatus;
  stop: () => void;
  hasMessages: boolean;
};

function ChatInput({ input, setInput, onSubmit, status, stop, hasMessages }: ChatInputProps) {
  const isGenerating = status === "streaming" || status === "submitted";

  return (
    <div className="input-container w-full">
      <div className="claude-container">
        <PromptInput
          onSubmit={onSubmit}
          maxFiles={10}
          maxFileSize={10 * 1024 * 1024}
          className="input-box input-box-chat"
        >
          <div className="flex min-h-0 w-full flex-1 flex-col px-4 pt-3 text-left">
            <AttachmentList />
            <PromptInputTextarea
              value={input}
              placeholder={hasMessages ? "Reply..." : "How can I help you today?"}
              onChange={(event) => setInput(event.currentTarget.value)}
              className="block min-h-0 w-full flex-1 resize-none border-none bg-transparent py-1 text-left text-base leading-7 text-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-0"
            />
          </div>

          <div className="mt-auto flex w-full items-center justify-between px-3 pb-3 pt-2">
            <button
              type="button"
              id="chat-attach-btn"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Attach file"
              title="Attach file"
              onClick={() => {
                const inputNode = document.querySelector('input[type="file"]') as
                  | HTMLInputElement
                  | null;
                inputNode?.click();
              }}
            >
              <PlusIcon size={20} />
            </button>

            <div className="ml-auto flex items-center gap-2">
              {!input.trim() && !isGenerating ? (
                <button
                  id="voice-input-btn"
                  type="button"
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Voice input"
                  title="Voice input"
                >
                  <AudioLinesIcon size={16} />
                </button>
              ) : null}
              <PromptInputSubmit
                status={status}
                onStop={stop}
                disabled={!input.trim() && !isGenerating}
                className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
              />
            </div>
          </div>
        </PromptInput>

      </div>
    </div>
  );
}

function EmptyStateInput({
  input,
  setInput,
  onSubmit,
  status,
  stop,
}: Omit<ChatInputProps, "hasMessages">) {
  const isGenerating = status === "streaming" || status === "submitted";

  return (
    <div className="empty-state-input-wrap">
      <div className="claude-container">
        <PromptInput
          onSubmit={onSubmit}
          maxFiles={10}
          maxFileSize={10 * 1024 * 1024}
          className="input-box input-box-empty"
        >
          <div className="flex min-h-0 w-full flex-1 flex-col px-4 pt-3 text-left">
            <AttachmentList />
            <PromptInputTextarea
              value={input}
              placeholder="How can I help you today?"
              onChange={(event) => setInput(event.currentTarget.value)}
              className="block min-h-0 w-full flex-1 resize-none border-none bg-transparent py-1 text-left text-base leading-7 text-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-0"
            />
          </div>

          <div className="mt-auto flex w-full items-center justify-between px-3 pb-3 pt-2">
            <button
              type="button"
              id="chat-attach-btn-empty"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={() => {
                const inputNode = document.querySelector('input[type="file"]') as
                  | HTMLInputElement
                  | null;
                inputNode?.click();
              }}
            >
              <PlusIcon size={20} />
            </button>
            <div className="ml-auto flex items-center gap-2">
              {!input.trim() && !isGenerating ? (
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <AudioLinesIcon size={16} />
                </button>
              ) : null}
              <PromptInputSubmit
                status={status}
                onStop={stop}
                disabled={!input.trim() && !isGenerating}
                className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
              />
            </div>
          </div>
        </PromptInput>

        <div className="mt-4 flex flex-wrap justify-center gap-2 animate-fade-up animation-delay-150">
          {QUICK_ACTIONS.map(({ icon: Icon, label }) => (
            <button
              key={label}
              id={`quick-action-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className="action-chip"
              onClick={() => setInput(label)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

export function ClaudeSidebar({
  onNewChat,
  conversations,
  activeConversationId,
  onSelectConversation,
  onGmailOpen,
  gmailConnected,
  isOpen,
  onToggle,
  className,
  onAfterAction,
}: {
  onNewChat: () => void;
  conversations: ConversationSnapshot[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onGmailOpen: () => void;
  gmailConnected: boolean;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
  onAfterAction?: () => void;
}) {
  const expanded = isOpen;
  const itemButtonClass = cn(
    "sidebar-icon-btn",
    expanded && "h-9 w-full justify-start gap-2 px-3"
  );

  return (
    <aside
      className={cn(
        "flex flex-shrink-0 flex-col gap-1 border-r border-border py-3 transition-[width] duration-200",
        expanded ? "items-stretch px-2" : "items-center px-1.5",
        className
      )}
      style={{ width: expanded ? "220px" : "56px", background: "var(--sidebar)" }}
    >
      <div className={cn("flex w-full flex-col gap-0.5", expanded ? "" : "items-center")}>
        <button
          className={cn(itemButtonClass, "mb-1")}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          onClick={onToggle}
        >
          <SidebarToggleGlyph />
          {expanded ? <span className="text-[13px]">Collapse</span> : null}
        </button>

        {NAV_ITEMS.map(({ icon: Icon, label, id }) => (
          <button
            key={id}
            id={`sidebar-nav-${id}`}
            className={itemButtonClass}
            aria-label={label}
            title={label}
            onClick={() => {
              if (id === "new-chat") onNewChat();
              onAfterAction?.();
            }}
          >
            <Icon size={17} />
            {expanded ? <span className="text-[13px]">{label}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {expanded ? (
          <div className="mt-2 space-y-1 px-1">
            <p className="px-3 text-[11px] uppercase tracking-wide text-muted-foreground/70">
              Recent chats
            </p>
            {conversations.length > 0 ? (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={cn(
                    "w-full truncate rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                    conversation.id === activeConversationId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
                  )}
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    onAfterAction?.();
                  }}
                  title={conversation.title}
                >
                  {conversation.title}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-[12px] text-muted-foreground/70">
                No previous chats yet.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className={cn("mb-2 flex w-full flex-col gap-0.5", expanded ? "" : "items-center")}>
        <button
          id="sidebar-group-chats"
          className={cn(itemButtonClass, "active")}
          aria-label="Current chat"
          title="Current chat"
        >
          <MessageSquareIcon size={17} />
          {expanded ? <span className="text-[13px]">Current chat</span> : null}
        </button>

        <button
          id="sidebar-gmail"
          className={cn(itemButtonClass, gmailConnected && "text-[var(--claude-accent)]")}
          aria-label={gmailConnected ? "Gmail Connected" : "Connect Gmail"}
          title={gmailConnected ? "Gmail Connected" : "Connect Gmail"}
          onClick={() => {
            onGmailOpen();
            onAfterAction?.();
          }}
        >
          <MailIcon size={17} />
          {expanded ? (
            <span className="text-[13px]">
              {gmailConnected ? "Gmail Connected" : "Connect Gmail"}
            </span>
          ) : null}
        </button>
      </div>

      <div className={cn("flex w-full flex-col gap-0.5", expanded ? "" : "items-center")}>
        <div className="relative">
          <button className={itemButtonClass} aria-label="Updates" title="Updates">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {expanded ? <span className="text-[13px]">Updates</span> : null}
          </button>
          <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-[var(--claude-accent)] ring-1 ring-sidebar" />
        </div>

        <div className={cn("mt-1", expanded && "px-3")}>
          <ClientOnlyUserButton />
        </div>
      </div>
    </aside>
  );
}

export function ChatHeader({
  hasMessages,
  currentConversationTitle,
  onOpenMobileSidebar,
}: {
  hasMessages: boolean;
  currentConversationTitle: string;
  onOpenMobileSidebar: () => void;
}) {
  return (
    <header className="chat-header">
      <div className="flex items-center gap-1">
        <button
          className="sidebar-icon-btn md:hidden"
          aria-label="Open sidebar"
          title="Open sidebar"
          onClick={onOpenMobileSidebar}
        >
          <SidebarToggleGlyph />
        </button>
        {hasMessages ? (
          <button
            id="conversation-title-btn"
            className="flex max-w-xs items-center gap-1.5 truncate rounded-lg px-2 py-1 text-[14px] font-medium text-foreground/75 transition-colors hover:bg-secondary"
          >
            <span className="truncate">{currentConversationTitle}</span>
            <ChevronDownIcon size={14} className="shrink-0 text-muted-foreground" />
          </button>
        ) : null}
      </div>

      {hasMessages ? (
        <div className="flex items-center gap-2">
          <button id="export-btn" className="header-action-btn" aria-label="Export">
            <FileTextIcon size={14} />
          </button>
          <button id="share-btn" className="header-action-btn" aria-label="Share">
            <Share2Icon size={14} />
            <span>Share</span>
          </button>
        </div>
      ) : null}
    </header>
  );
}

export function EmptyChatPane({
  firstName,
  input,
  setInput,
  onSubmit,
  status,
  stop,
}: {
  firstName?: string;
  input: string;
  setInput: (value: string) => void;
  onSubmit: (message: PromptInputMessage) => void;
  status: ChatStatus;
  stop: () => void;
}) {
  return (
    <div className="flex w-full min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center">
        <EmptyState userName={firstName} />
      </div>
      <EmptyStateInput
        input={input}
        setInput={setInput}
        onSubmit={onSubmit}
        status={status}
        stop={stop}
      />
    </div>
  );
}

export function ConversationPane({
  messages,
  input,
  setInput,
  onSubmit,
  status,
  stop,
}: {
  messages: UIMessage[];
  input: string;
  setInput: (value: string) => void;
  onSubmit: (message: PromptInputMessage) => void;
  status: ChatStatus;
  stop: () => void;
}) {
  return (
    <Conversation className="flex w-full min-h-0 flex-1 flex-col">
      <ConversationContent className="claude-container py-6">
        <div className="flex flex-col gap-6">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className={cn(
                "w-full animate-fade-up",
                message.role === "user" ? "message-user" : "message-assistant"
              )}
              style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
            >
              {message.role === "user" ? (
                <div className="bubble-user">
                  {message.parts.map((part, partIndex) =>
                    part.type === "text" ? <span key={partIndex}>{part.text}</span> : null
                  )}
                </div>
              ) : (
                <div className="bubble-assistant">
                  <div className="space-y-3">
                    {message.parts.map((part, partIndex) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse
                            className="text-[16px] leading-8"
                            key={`${message.id}-${partIndex}`}
                          >
                            {part.text}
                          </MessageResponse>
                        );
                      }
                      if (isToolPart(part)) {
                        const toolPart = part;
                        return (
                          <div className="mt-2 w-full" key={`${message.id}-${partIndex}`}>
                            <Tool
                              className="tool-card"
                              defaultOpen={toolIsOpenByDefault(toolPart.state)}
                            >
                              {isDynamicToolPart(toolPart) ? (
                                <ToolHeader
                                  type={toolPart.type}
                                  state={toolPart.state}
                                  toolName={toolPart.toolName}
                                  className="px-3 py-2"
                                />
                              ) : (
                                <ToolHeader
                                  type={toolPart.type}
                                  state={toolPart.state}
                                  className="px-3 py-2"
                                />
                              )}
                              <ToolContent className="px-3 pb-3">
                                <ToolInput input={toolPart.input} />
                                <ToolOutput
                                  output={toolPart.output}
                                  errorText={toolPart.errorText}
                                />
                              </ToolContent>
                            </Tool>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ConversationContent>

      <div className="relative">
        <div className="absolute -top-14 left-1/2 -translate-x-1/2">
          <ConversationScrollButton className="relative static bottom-auto left-auto transform-none" />
        </div>
      </div>

      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={onSubmit}
        status={status}
        stop={stop}
        hasMessages={messages.length > 0}
      />

      <p className="pt-0.5 pb-2 text-center text-[11px] text-muted-foreground/50">
        Lumina is AI and can make mistakes. Please double-check responses.
      </p>
    </Conversation>
  );
}

export function GmailConnectionDialog({
  open,
  onOpenChange,
  gmailStatus,
  gmailStatusLabel,
  gmailStatusLoading,
  gmailConnectLoading,
  gmailConnectError,
  onRefreshStatus,
  onConnectGmail,
  onDisconnectGmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gmailStatus: GmailStatus | null;
  gmailStatusLabel: string;
  gmailStatusLoading: boolean;
  gmailConnectLoading: boolean;
  gmailConnectError: string | null;
  onRefreshStatus: () => void | Promise<void>;
  onConnectGmail: () => void | Promise<void>;
  onDisconnectGmail: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gmail-dialog sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect Gmail</DialogTitle>
          <DialogDescription>
            Authorize Gmail in a secure tab. Once complete, return here and connection
            status will refresh automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2">
            <MailIcon className="size-4" />
            <span className="text-sm">{gmailStatusLabel}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Gmail access enables Lumina to draft and send emails via MCP tools.
          </p>
          {gmailConnectError ? (
            <p className="text-[13px] font-medium text-destructive">{gmailConnectError}</p>
          ) : null}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => void onRefreshStatus()}
            disabled={gmailStatusLoading}
          >
            {gmailStatusLoading ? "Refreshing..." : "Refresh Status"}
          </Button>
          {gmailStatus?.connected ? (
            <Button
              variant="destructive"
              onClick={() => void onDisconnectGmail()}
              disabled={gmailConnectLoading}
            >
              <XIcon className="mr-2 size-4" />
              {gmailConnectLoading ? "Disconnecting..." : "Disconnect Gmail"}
            </Button>
          ) : (
            <Button onClick={() => void onConnectGmail()} disabled={gmailConnectLoading}>
              <MailIcon className="mr-2 size-4" />
              {gmailConnectLoading ? "Opening..." : "Connect Gmail"}
              <Link2Icon className="ml-2 size-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
