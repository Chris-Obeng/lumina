"use server";

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

export async function updateGmailReferenceAction(gmailMcpReference: string) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {
      gmailMcpReference,
    },
    create: {
      id: userId,
      email: `user-${userId}@lumina.ai`,
      gmailMcpReference,
    },
  });

  return { success: true, user };
}

export async function disconnectGmailAction() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      gmailMcpReference: null,
    },
  });

  return { success: true };
}
