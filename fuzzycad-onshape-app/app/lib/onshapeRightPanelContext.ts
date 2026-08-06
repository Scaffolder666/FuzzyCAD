/**
 * Same-origin fallback for handing documentId/workspaceId/elementId to the
 * "Element right panel" extension. Confirmed live (multiple fresh reloads,
 * real Onshape session): Onshape never puts these in that panel's initial
 * iframe URL and never replies to its applicationInit handshake, contrary
 * to the general client-messaging docs -- so the panel can't learn them
 * from Onshape at all right now. The main app (loaded as an "Element tab"
 * extension, same origin) reliably has them from its own URL query params,
 * so it writes them here and the right-panel iframe reads/subscribes to
 * localStorage instead -- ordinary same-origin browser storage, no Onshape
 * messaging involved. Requires the main FuzzyCAD Panel tab to have been
 * opened at least once in this browser; if it hasn't, there's nothing to
 * read yet.
 */
export const ONSHAPE_CONTEXT_STORAGE_KEY = "fuzzycad:onshapeContext";

export type SharedOnshapeContext = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  server: string;
  updatedAt: number;
};

export function writeSharedOnshapeContext(context: Omit<SharedOnshapeContext, "updatedAt">) {
  try {
    const full: SharedOnshapeContext = { ...context, updatedAt: Date.now() };
    window.localStorage.setItem(ONSHAPE_CONTEXT_STORAGE_KEY, JSON.stringify(full));
  } catch {
    // localStorage can throw in restrictive iframe sandboxes -- best-effort only.
  }
}

export function readSharedOnshapeContext(): SharedOnshapeContext | null {
  try {
    const raw = window.localStorage.getItem(ONSHAPE_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SharedOnshapeContext>;
    if (!parsed.documentId || !parsed.workspaceId || !parsed.elementId || !parsed.server) {
      return null;
    }
    return parsed as SharedOnshapeContext;
  } catch {
    return null;
  }
}
