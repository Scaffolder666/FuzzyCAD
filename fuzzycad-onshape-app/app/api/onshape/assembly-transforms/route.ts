import { NextRequest, NextResponse } from "next/server";

type OccurrenceUpdate = {
  path: string[];
  transform: number[];
};

type RequestBody = {
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  server?: string;
  occurrences: OccurrenceUpdate[];
};

/**
 * Onshape's BTAssemblyTransformDefinitionParams request body puts `transform`
 * at the TOP LEVEL, applied to every path in `occurrences` — there is no
 * per-occurrence transform field (confirmed against the public OpenAPI spec:
 * BTOccurrence-74 only has `path` and metadata, no transform). A request
 * shaped like `{isRelative, occurrences: [{path, transform}]}` fails with
 * "Failed to provide a transform matrix" because Onshape never finds a
 * top-level `transform` field. Since FuzzyCAD's occurrences generally each
 * need a DIFFERENT transform (different parts moved/rotated by different
 * amounts), one Onshape call is made per {path, transform} pair rather than
 * batching them into a single call.
 */
export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 }
    );
  }

  let body: RequestBody;

  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    documentId,
    workspaceId,
    assemblyElementId,
    server = "https://cad.onshape.com",
    occurrences,
  } = body;

  if (!documentId || !workspaceId || !assemblyElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or assemblyElementId" },
      { status: 400 }
    );
  }

  if (!Array.isArray(occurrences) || occurrences.length === 0) {
    return NextResponse.json(
      { error: "occurrences must be a non-empty array" },
      { status: 400 }
    );
  }

  const endpoint = `${server}/api/assemblies/d/${documentId}/w/${workspaceId}/e/${assemblyElementId}/occurrencetransforms`;

  const results = await Promise.all(
    occurrences.map(async (occurrence) => {
      // Transforms are absolute (computed from current placement + delta).
      const payload = {
        isRelative: false,
        occurrences: [{ path: occurrence.path }],
        transform: occurrence.transform,
      };

      const onshapeRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await onshapeRes.text();

      let data: unknown;

      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      return { path: occurrence.path, status: onshapeRes.status, ok: onshapeRes.ok, data };
    })
  );

  const ok = results.every((result) => result.ok);

  return NextResponse.json(
    { endpoint, ok, results, status: ok ? 200 : (results.find((r) => !r.ok)?.status ?? 400) },
    { status: ok ? 200 : (results.find((r) => !r.ok)?.status ?? 400) }
  );
}
