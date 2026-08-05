import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Client-upload token endpoint for large STEP files (see
 * onshapeClient.ts's uploadStepBufferToBlob). A re-exported, edited STEP
 * file can exceed Vercel's ~4.5MB serverless request body limit even
 * gzipped (confirmed live against a real Part Studio) — Vercel Blob's
 * client-upload flow lets the browser PUT the file straight to blob
 * storage instead of through one of our own request bodies, sidestepping
 * that ceiling entirely. This route only ever hands out a short-lived
 * upload token; it never sees the file's bytes itself.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/octet-stream", "application/gzip"],
        addRandomSuffix: true,
        // Cleaned up right after partstudio-import-step/route.ts (or
        // import-step/route.ts) reads it back — this cap is just a
        // backstop in case a push fails before cleanup runs.
        maximumSizeInBytes: 200 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        // Nothing to do — the caller already has the blob URL from
        // upload()'s own return value and drives the next step itself.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
