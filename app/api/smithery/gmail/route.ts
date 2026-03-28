import Smithery from "@smithery/api";
import type { Connection } from "@smithery/api/resources/connections/connections";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
}

function hasErrorStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { status?: unknown }).status === status;
}

function getGmailConnectionId(userId: string) {
  const prefix = process.env.SMITHERY_GMAIL_CONNECTION_ID ?? "gmail-account";
  return `${prefix}-${userId}`;
}

function getGmailMcpUrl() {
  return process.env.SMITHERY_GMAIL_MCP_URL ?? "https://server.smithery.ai/gmail";
}

async function resolveSmitheryNamespace(smithery: Smithery) {
  const configuredNamespace = process.env.SMITHERY_NAMESPACE;

  if (configuredNamespace) {
    await smithery.namespaces.set(configuredNamespace);
    return configuredNamespace;
  }

  const { namespaces } = await smithery.namespaces.list();

  if (namespaces.length > 0) {
    return namespaces[0]!.name;
  }

  const namespace = await smithery.namespaces.create();
  return namespace.name;
}

async function ensureGmailConnection({
  smithery,
  namespace,
  connectionId,
}: {
  smithery: Smithery;
  namespace: string;
  connectionId: string;
}) {
  try {
    return await smithery.connections.set(connectionId, {
      namespace,
      name: "Gmail",
      mcpUrl: getGmailMcpUrl(),
    });
  } catch (error) {
    if (!hasErrorStatus(error, 409)) {
      throw error;
    }

    await smithery.connections.delete(connectionId, { namespace });
    return await smithery.connections.set(connectionId, {
      namespace,
      name: "Gmail",
      mcpUrl: getGmailMcpUrl(),
    });
  }
}

function buildGmailMcpReference(namespace: string, connectionId: string) {
  return `${namespace}:${connectionId}`;
}

function toConnectionState(
  connection: Connection | null,
  namespace: string,
  connectionId: string
) {
  const statusState = connection?.status?.state;
  const connected = statusState === "connected" || (!statusState && !!connection?.serverInfo);

  return {
    connected,
    state: statusState ?? (connected ? "connected" : "not_connected"),
    mcpReference: connected
      ? buildGmailMcpReference(namespace, connectionId)
      : null,
    authorizationUrl:
      statusState === "auth_required"
        ? (connection?.status as { authorizationUrl?: string }).authorizationUrl ?? null
        : null,
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const smithery = new Smithery({
    apiKey: getRequiredEnv("SMITHERY_API_KEY"),
  });
  const namespace = await resolveSmitheryNamespace(smithery);
  const connectionId = getGmailConnectionId(userId);

  try {
    const connection = await smithery.connections.get(connectionId, { namespace });
    return Response.json({
      namespace,
      connectionId,
      ...toConnectionState(connection, namespace, connectionId),
    });
  } catch (error) {
    if (hasErrorStatus(error, 404)) {
      return Response.json({
        namespace,
        connectionId,
        connected: false,
        state: "not_connected",
        mcpReference: null,
        authorizationUrl: null,
      });
    }

    throw error;
  }
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const smithery = new Smithery({
    apiKey: getRequiredEnv("SMITHERY_API_KEY"),
  });
  const namespace = await resolveSmitheryNamespace(smithery);
  const connectionId = getGmailConnectionId(userId);
  const connection = await ensureGmailConnection({
    smithery,
    namespace,
    connectionId,
  });

  return Response.json({
    namespace,
    connectionId,
    ...toConnectionState(connection, namespace, connectionId),
  });
}
