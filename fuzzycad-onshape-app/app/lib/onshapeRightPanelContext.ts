/**
 * documentId/workspaceId/elementId for the "Element right panel"
 * extension. Confirmed live (multiple fresh reloads, real Onshape
 * session): Onshape never puts these in that panel's initial iframe URL
 * and never replies to its applicationInit handshake, contrary to the
 * general client-messaging docs -- so the panel can't learn them from
 * Onshape at all, ever, on its own. Two independent sources feed the
 * same shape of context:
 *
 * 1. writeSharedOnshapeContext/readSharedOnshapeContext -- the main
 *    FuzzyCAD Panel tab (loaded as an "Element tab" extension, same
 *    origin) reliably has this from its own URL query params, and writes
 *    it here for the right panel to read. Passive: the right panel only
 *    gets this if the main tab happens to have been opened first.
 * 2. writeRightPanelSelectedContext/readRightPanelSelectedContext -- the
 *    right panel's own document/Part Studio picker (parameter-mark-panel)
 *    writes here once someone picks a document through it directly, no
 *    main tab involved. Takes priority when both exist, since it's an
 *    explicit, current choice made IN the right panel rather than a
 *    hand-me-down from whatever the main tab happened to have open.
 */
export const ONSHAPE_CONTEXT_STORAGE_KEY = "fuzzycad:onshapeContext";
export const RIGHT_PANEL_SELECTED_CONTEXT_STORAGE_KEY = "fuzzycad:rightPanelSelectedContext";

export type SharedOnshapeContext = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  server: string;
  updatedAt: number;
};

function writeContext(key: string, context: Omit<SharedOnshapeContext, "updatedAt">) {
  try {
    const full: SharedOnshapeContext = { ...context, updatedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(full));
  } catch {
    // localStorage can throw in restrictive iframe sandboxes -- best-effort only.
  }
}

function readContext(key: string): SharedOnshapeContext | null {
  try {
    const raw = window.localStorage.getItem(key);
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

export function writeSharedOnshapeContext(context: Omit<SharedOnshapeContext, "updatedAt">) {
  writeContext(ONSHAPE_CONTEXT_STORAGE_KEY, context);
}

export function readSharedOnshapeContext(): SharedOnshapeContext | null {
  return readContext(ONSHAPE_CONTEXT_STORAGE_KEY);
}

export function writeRightPanelSelectedContext(context: Omit<SharedOnshapeContext, "updatedAt">) {
  writeContext(RIGHT_PANEL_SELECTED_CONTEXT_STORAGE_KEY, context);
}

export function readRightPanelSelectedContext(): SharedOnshapeContext | null {
  return readContext(RIGHT_PANEL_SELECTED_CONTEXT_STORAGE_KEY);
}

export function clearRightPanelSelectedContext() {
  try {
    window.localStorage.removeItem(RIGHT_PANEL_SELECTED_CONTEXT_STORAGE_KEY);
  } catch {
    // best-effort only, same as writeContext above.
  }
}
