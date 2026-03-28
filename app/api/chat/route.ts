import { createHash, randomUUID } from "node:crypto";
import {
  createAgentUIStreamResponse,
  dynamicTool,
  jsonSchema,
  stepCountIs,
  ToolLoopAgent,
  UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import Smithery from "@smithery/api";
import type { Connection } from "@smithery/api/resources/connections/connections";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

import { allTools } from "@/components/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- Mcp and Smithery Helpers ---
// (Keeping existing helpers from the original file for MCP integration)

type JsonRpcErrorShape = {
  code?: number;
  message?: string;
  data?: unknown;
};

type JsonRpcEnvelope = {
  id?: string | number | null;
  jsonrpc?: string;
  result?: unknown;
  error?: JsonRpcErrorShape;
};

type McpToolDefinition = {
  name: string;
  title?: string;
  description?: string | null;
  inputSchema?: unknown;
};

type McpToolsListResult = {
  tools?: McpToolDefinition[];
};

type McpToolCallResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  [key: string]: unknown;
};

function extractTextFromUiMessage(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join(" ")
    .trim();
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

function buildBraveMcpUrl(braveApiKey: string) {
  const url = new URL("https://brave.run.tools");
  url.searchParams.set("braveApiKey", braveApiKey);
  return url.toString();
}

function getBraveConnectionId(braveApiKey: string) {
  const hash = createHash("sha256").update(braveApiKey).digest("hex").slice(0, 12);
  return `brave-search-${hash}`;
}

function getGmailConnectionId(userId: string) {
  const prefix = process.env.SMITHERY_GMAIL_CONNECTION_ID ?? "gmail-account";
  return `${prefix}-${userId}`;
}

async function resolveSmitheryNamespace(smithery: Smithery) {
  const configuredNamespace = process.env.SMITHERY_NAMESPACE;
  if (configuredNamespace) {
    await smithery.namespaces.set(configuredNamespace);
    return configuredNamespace;
  }
  const { namespaces } = await smithery.namespaces.list();
  if (namespaces.length > 0) return namespaces[0]!.name;
  const namespace = await smithery.namespaces.create();
  return namespace.name;
}

function parseJsonRpcEnvelope(payload: unknown): JsonRpcEnvelope {
  if (typeof payload === "string") {
    const dataLines = payload
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== "[DONE]");

    for (let i = dataLines.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(dataLines[i]!) as JsonRpcEnvelope; } catch {}
    }
  } else if (payload && typeof payload === "object") {
    return payload as JsonRpcEnvelope;
  }
  throw new Error("Invalid MCP response payload.");
}

async function callSmitheryMcp<T>({
  smithery, namespace, connectionId, method, params,
}: {
  smithery: Smithery; namespace: string; connectionId: string; method: string; params?: Record<string, unknown>;
}): Promise<T> {
  const rawPayload = await smithery.connections.mcp.call(
    connectionId, { namespace },
    {
      headers: { Accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: randomUUID(), method, params: params ?? {} },
    },
  );
  const envelope = parseJsonRpcEnvelope(rawPayload);
  if (envelope.error) throw new Error(`MCP ${method} failed: ${envelope.error.message ?? "Unknown error"}`);
  return envelope.result as T;
}

async function ensureConnection({
  smithery, namespace, connectionId, mcpUrl, name,
}: {
  smithery: Smithery; namespace: string; connectionId: string; mcpUrl: string; name: string;
}) {
  try {
    return await smithery.connections.set(connectionId, { namespace, name, mcpUrl });
  } catch (error: any) {
    if (error.status !== 409) throw error;
    await smithery.connections.delete(connectionId, { namespace });
    return await smithery.connections.set(connectionId, { namespace, name, mcpUrl });
  }
}

async function createDynamicToolsForConnection({
  smithery, namespace, connectionId,
}: {
  smithery: Smithery; namespace: string; connectionId: string;
}) {
  const toolsList = await callSmitheryMcp<McpToolsListResult>({
    smithery, namespace, connectionId, method: "tools/list",
  });

  return Object.fromEntries(
    (toolsList.tools ?? []).map((toolDefinition) => [
      toolDefinition.name,
      dynamicTool({
        title: toolDefinition.title,
        description: toolDefinition.description ?? `Run MCP tool ${toolDefinition.name}.`,
        inputSchema: jsonSchema(toolDefinition.inputSchema || { type: "object", properties: {}, additionalProperties: true }),
        execute: async (input) => {
          const toolCallResult = await callSmitheryMcp<McpToolCallResult>({
            smithery, namespace, connectionId, method: "tools/call",
            params: { name: toolDefinition.name, arguments: input as Record<string, unknown> },
          });
          if (toolCallResult.isError) throw new Error(toolCallResult.content?.[0]?.text || "MCP tool error");
          return toolCallResult;
        },
      }),
    ]),
  );
}

async function createTools(userId: string) {
  const smithery = new Smithery({ apiKey: getRequiredEnv("SMITHERY_API_KEY") });
  const namespace = await resolveSmitheryNamespace(smithery);

  const braveApiKey = getRequiredEnv("BRAVE_API_KEY");
  const braveConnectionId = getBraveConnectionId(braveApiKey);
  await ensureConnection({ smithery, namespace, connectionId: braveConnectionId, name: "Brave Search", mcpUrl: buildBraveMcpUrl(braveApiKey) });
  const braveTools = await createDynamicToolsForConnection({ smithery, namespace, connectionId: braveConnectionId });

  const gmailConnectionId = getGmailConnectionId(userId);
  let gmailConnection: Connection | null = null;
  try {
    gmailConnection = await smithery.connections.get(gmailConnectionId, { namespace });
  } catch (error: any) {
    if (error?.status !== 404) {
      throw error;
    }
  }

  const gmailConnected = !!gmailConnection && (
    gmailConnection.status?.state === "connected" || !!gmailConnection.serverInfo
  );
  const gmailTools = gmailConnected ? await createDynamicToolsForConnection({ smithery, namespace, connectionId: gmailConnectionId }) : {};

  return { tools: { ...allTools, ...braveTools, ...gmailTools }, gmailConnected };
}

// --- RAG Pipeline ---

async function getRetrievedContext(userId: string, messages: UIMessage[], chatId: string) {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== "user") return "";

  // Only run retrieval when the current chat has uploaded documents
  // and the chat belongs to the authenticated user.
  const documentCount = await prisma.document.count({
    where: {
      chatId,
      chat: { userId },
    },
  });
  if (documentCount === 0) return "";

  const textInput = latestMessage.parts.map(p => p.type === "text" ? p.text : "").join(" ");

  try {
    // 1. Create Standalone Question
    const model = new ChatOpenAI({ modelName: "gpt-4o-mini", openAIApiKey: process.env.OPENAI_API_KEY });
    const standaloneQuestionTemplate = `Given the following conversation and a follow-up question, rephrase the follow-up question to be a standalone question.
  Chat History:
  {chat_history}
  Follow-up question: {question}
  Standalone question:`;
    const standaloneQuestionPrompt = PromptTemplate.fromTemplate(standaloneQuestionTemplate);

    const chatHistory = messages.slice(0, -1).map(m => `${m.role}: ${m.parts.filter(p => p.type === "text").map(p => (p as any).text).join(" ")}`).join("\n");

    const standaloneChain = standaloneQuestionPrompt.pipe(model).pipe(new StringOutputParser());
    const standaloneQuestion = await standaloneChain.invoke({ chat_history: chatHistory, question: textInput });

    // 2. Vector Search via Prisma
    const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });
    const vector = await embeddings.embedQuery(standaloneQuestion);

    // pgvector expects a string in the format: [1,2,3]
    const vectorLiteral = `[${vector.join(",")}]`;

    const similarChunks: Array<{ content: string; similarity: number }> = await prisma.$queryRaw`
      SELECT
        "Chunk"."content" AS "content",
        1 - ("Chunk"."embedding" <=> ${vectorLiteral}::vector) AS "similarity"
      FROM "Chunk"
      INNER JOIN "Document" ON "Chunk"."documentId" = "Document"."id"
      INNER JOIN "Chat" ON "Document"."chatId" = "Chat"."id"
      WHERE "Document"."chatId" = ${chatId}
        AND "Chat"."userId" = ${userId}
      ORDER BY similarity DESC
      LIMIT 3
    `;

    return similarChunks.map(c => c.content).join("\n\n");
  } catch (error) {
    console.error("Similarity search failed, continuing without retrieved context:", error);
    return "";
  }
}

export async function POST(request: Request) {
  const { messages, id: chatId }: { messages: UIMessage[], id: string } = await request.json();
  const { userId } = await auth();

  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Ensure chat exists
  await prisma.chat.upsert({
    where: { id: chatId },
    update: {},
    create: { id: chatId, userId },
  });

  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.role === "user") {
    const userMessageText = extractTextFromUiMessage(latestMessage);
    if (userMessageText.length > 0) {
      await prisma.message.create({
        data: {
          chatId,
          role: "user",
          content: userMessageText,
        },
      });
    }
  }

  const { tools, gmailConnected } = await createTools(userId);
  const context = await getRetrievedContext(userId, messages, chatId);

  const agent = new ToolLoopAgent({
    model: openai("gpt-4o-mini"),
    instructions: `You are Lumina, a helpful AI assistant.
      ${gmailConnected ? "You have access to Gmail." : "Gmail is not connected."}

      Use the following retrieved context if it's relevant to the user's question:
      ---
      ${context}
      ---

      Answer based on the context provided. If the context is not sufficient, use your general knowledge or tools.`,
    stopWhen: stepCountIs(20),
    tools,
    prepareStep: async ({ messages: stepMessages }) => {
      // Message windowing to prevent context overflow
      if (stepMessages.length > 20) {
        return {
          messages: [stepMessages[0], ...stepMessages.slice(-10)],
        };
      }
      return {};
    },
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    abortSignal: request.signal,
    onFinish: async ({ isAborted, responseMessage }) => {
      if (isAborted || responseMessage.role !== "assistant") {
        return;
      }

      const assistantMessageText = extractTextFromUiMessage(responseMessage);
      if (assistantMessageText.length === 0) {
        return;
      }

      await prisma.message.create({
        data: {
          chatId,
          role: "assistant",
          content: assistantMessageText,
        },
      });
    },
  });
}
