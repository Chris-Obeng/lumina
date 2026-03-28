"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function checkAndSaveUser() {
  try {
    const { sessionClaims, userId } = await auth();

    if (!userId) {
      return { success: false, message: "No authenticated user" };
    }

    const user = await currentUser();
    const primaryEmail =
      user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses?.[0]?.emailAddress ??
      (typeof sessionClaims?.email === "string" ? sessionClaims.email : undefined);

    const fallbackEmail = `user-${userId}@lumina.ai`;
    const email = primaryEmail ?? fallbackEmail;

    const savedUser = await prisma.user.upsert({
      where: { id: userId },
      update: primaryEmail ? { email: primaryEmail } : {},
      create: {
        id: userId,
        email,
      },
    });

    return {
      success: true,
      message: "User synced",
      userId: savedUser.id,
    };
  } catch (error) {
    console.error("Error in checkAndSaveUser:", error);
    return { success: false, message: "Internal server error" };
  }
}
