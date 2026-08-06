"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

type ValueParameterEntry = {
  featureId: unknown;
  featureName: unknown;
  featureType: unknown;
  suppressed: unknown;
  parameterId: unknown;
  typeName: unknown;
  message: Record<string, unknown>;
};

type ApiResult = {
  endpoint?: string;
  status?: number;
  ok?: boolean;
  featureCount?: number;
  valueParameterCount?: number;
  valueParameters?: ValueParameterEntry[];
  rawData?: unknown;
  error?: string;
};

function formatValue(typeName: unknown, message: Record<string, unknown>): string {
  switch (typeName) {
    case "BTMParameterQuantity":
      return String(message.expression ?? "");
    case "BTMParameterBoolean":
      return String(message.value ?? "");
    case "BTMParameterEnum":
      return `${String(message.enumName ?? "")}: ${String(message.value ?? "")}`;
    case "BTMParameterString":
      return String(message.value ?? "");
    default:
      return JSON.stringify(message);
  }
}

/**
 * Visualizes every value-typed parameter across an ENTIRE Part Studio
 * feature tree at once, instead of clicking each feature one at a time in
 * the Onshape UI to see its edit panel. See the route's doc comment for
 * why value-typed params (Quantity/Boolean/Enum/String) are treated as
 * "safe to consider adjustable" and geometry-reference params are not.
 * Not linked from any nav. Disposable.
 */
function PartStudioFeatureParametersDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<ApiResult | null>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const partStudioElementId = searchParams.get("partStudioElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  async function run() {
    setResult(null);

    if (!documentId || !workspaceId || !partStudioElementId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/partStudioElementId query params. Example: ?documentId=...&workspaceId=...&partStudioElementId=...",
      );
      return;
    }

    setStatus("calling /api/onshape/partstudio-feature-parameters-debug...");

    try {
      const params = new URLSearchParams({ documentId, workspaceId, partStudioElementId, server });
      const res = await fetch(`/api/onshape/partstudio-feature-parameters-debug?${params.toString()}`);
      const data = (await res.json()) as ApiResult;

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Part Studio feature parameters debug</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <p>
        Fetches the full feature tree and flattens every value-typed parameter (Quantity/Boolean/
        Enum/String) across every feature and sub-feature into one table -- the same fields Onshape&apos;s
        own per-feature edit panel would show, all at once.
      </p>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        Fetch feature parameters
      </button>
      <p>status: {status}</p>
      {result?.valueParameters ? (
        <>
          <p>
            {result.featureCount} top-level feature(s), {result.valueParameterCount} value parameter(s)
            found.
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
            <thead>
              <tr>
                {["feature", "featureType", "suppressed", "featureId", "parameterId", "typeName", "value"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid #ccc",
                        padding: "4px 8px",
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {result.valueParameters.map((entry, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {String(entry.featureName ?? "")}
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {String(entry.featureType ?? "")}
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {String(entry.suppressed ?? "")}
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {String(entry.featureId ?? "")}
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {String(entry.parameterId ?? "")}
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {String(entry.typeName ?? "")}
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                    {formatValue(entry.typeName, entry.message)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {result !== null ? (
        <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 12, borderRadius: 8 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default function PartStudioFeatureParametersDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioFeatureParametersDebugInner />
    </Suspense>
  );
}
