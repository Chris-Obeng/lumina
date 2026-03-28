"use server";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFParse } from "pdf-parse";

export async function uploadFileAction(formData: FormData) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const file = formData.get("file") as File;
  const chatId = formData.get("chatId") as string;
  if (!file) {
    throw new Error("No file provided");
  }

  // Ensure user exists in our DB
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: "user-" + userId + "@lumina.ai", // Placeholder email as Clerk doesn't always provide it in claims without config
    },
  });

  let text = "";
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const workerFilePath = resolve(
      process.cwd(),
      "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs"
    );

    if (existsSync(workerFilePath)) {
      PDFParse.setWorker(pathToFileURL(workerFilePath).href);
    }

    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else {
    text = await file.text();
  }

  const document = await prisma.document.create({
    data: {
      chatId,
      filename: file.name,
      content: text,
    },
  });

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await splitter.splitText(text);

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  for (const chunk of chunks) {
    const vector = await embeddings.embedQuery(chunk);

    // Prisma doesn't support vector types directly in create/upsert yet for pgvector
    // unless using Unsupported, so we use executeRaw for the embedding
    const createdChunk = await prisma.chunk.create({
      data: {
        documentId: document.id,
        content: chunk,
      },
    });

    await prisma.$executeRaw`
      UPDATE "Chunk"
      SET "embedding" = ${vector}::vector
      WHERE "id" = ${createdChunk.id}
    `;
  }

  return { success: true, documentId: document.id };
}
