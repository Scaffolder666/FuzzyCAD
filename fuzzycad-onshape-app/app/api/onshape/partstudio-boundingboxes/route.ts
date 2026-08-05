import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type BoundingBox = {
  lowX: number;
  lowY: number;
  lowZ: number;
  highX: number;
  highY: number;
  highZ: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBoundingBox(data: unknown): BoundingBox | null {
  if (!isRecord(data)) {
    return null;
  }

  const keys = ["lowX", "lowY", "lowZ", "highX", "highY", "highZ"] as const;
  const box: Partial<BoundingBox> = {};

  for (const key of keys) {
    const value = data[key];
    if (typeof value !== "number") {
      return null;
    }
    box[key] = value;
  }

  return box as BoundingBox;
}

/**
 * Per-part bounding boxes for a Part Studio (GET /api/parts/d/{did}/w/{wid}/e/{eid}/partid/{partid}/boundingboxes,
 * confirmed present in Onshape's public OpenAPI spec — there is no
 * batch/multi-part variant, so this fans out one request per requested
 * partId). Used by stepSolidBinding.ts to bind each STEP solid to its
 * real partId by nearest-bbox match, replacing the old assembly path's
 * purely positional zip (stepPathKeyBinding.ts).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");
  const partIdsParam = params.get("partIds");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !partStudioElementId || !partIdsParam) {
    return NextResponse.json(
      {
        error:
          "Missing documentId, workspaceId, partStudioElementId, or partIds",
      },
      { status: 400 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const partIds = partIdsParam.split(",").filter(Boolean);

  const results = await Promise.all(
    partIds.map(async (partId) => {
      const endpoint = `${server}/api/parts/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/partid/${encodeURIComponent(partId)}/boundingboxes`;

      const res = await onshapeFetch(
        endpoint,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
        { route: "/api/onshape/partstudio-boundingboxes", operation: "fetch-part-bbox" },
      );

      const data = await parseJsonOrText(res);

      return {
        partId,
        ok: res.ok,
        status: res.status,
        boundingBox: res.ok ? parseBoundingBox(data) : null,
      };
    }),
  );

  return NextResponse.json({ ok: true, results });
}
