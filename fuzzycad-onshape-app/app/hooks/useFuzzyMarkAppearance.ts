"use client";

import { useEffect, useRef } from "react";
import type { FuzzyCADUncertaintyDocument } from "../lib/uncertainty/document";
import type { PartNode } from "../lib/partGraph";
import {
  fetchOnshapePartAppearance,
  setOnshapePartAppearance,
  type PartColor,
} from "../lib/onshapeClient";

const MARK_COLOR: PartColor = { red: 255, green: 149, blue: 0 };

type PartGraphLike = {
  byPathKey: Map<string, PartNode>;
};

type AppearanceQuery = {
  documentId: string;
  workspaceId: string;
  server: string;
};

type CachedOriginal = {
  documentId: string;
  elementId: string;
  partId: string;
  color: PartColor | null;
  opacity: number | null;
};

function extractAppearance(data: unknown): { color: PartColor | null; opacity: number | null } {
  if (!data || typeof data !== "object") {
    return { color: null, opacity: null };
  }

  const appearance = (data as Record<string, unknown>).appearance;

  if (!appearance || typeof appearance !== "object") {
    return { color: null, opacity: null };
  }

  const color = (appearance as Record<string, unknown>).color;
  const opacity = (appearance as Record<string, unknown>).opacity;

  const parsedColor =
    color && typeof color === "object"
      ? {
          red: Number((color as Record<string, unknown>).red ?? 0),
          green: Number((color as Record<string, unknown>).green ?? 0),
          blue: Number((color as Record<string, unknown>).blue ?? 0),
        }
      : null;

  return {
    color: parsedColor,
    opacity: typeof opacity === "number" ? opacity : null,
  };
}

/**
 * Colors the ORIGINAL Onshape part orange while it has at least one open
 * FuzzyCAD uncertainty mark, and restores its original color once every
 * mark on it is resolved or deleted — so someone browsing the model
 * directly in Onshape (not FuzzyCAD) can see "this has an open question"
 * without needing to open FuzzyCAD first.
 *
 * Known limits, all deliberate v1 scope cuts rather than oversights:
 *  - Onshape's public API only exposes PART-level appearance, not a
 *    per-occurrence override (confirmed against the public OpenAPI spec —
 *    no per-instance appearance endpoint found). A part instanced
 *    multiple times in the assembly recolors at every occurrence, not
 *    just the marked one.
 *  - Only parts living in the SAME document as the open assembly are
 *    marked — a part from a linked external document doesn't have a
 *    known workspace id here to write into, so it's silently skipped.
 *  - The "original color" cache is in-memory only, not persisted — a
 *    page reload while parts are still marked orange in Onshape won't
 *    remember what to restore them to; they stay orange until resolved.
 */
export function useFuzzyMarkAppearance(
  document: FuzzyCADUncertaintyDocument,
  partGraph: PartGraphLike | null,
  query: AppearanceQuery | null,
) {
  const cacheRef = useRef<Map<string, CachedOriginal>>(new Map());

  useEffect(() => {
    if (!query || !partGraph) {
      return;
    }

    const openPathKeys = new Set<string>();

    for (const annotation of document.annotations) {
      if (annotation.status !== "open") {
        continue;
      }
      for (const pathKey of annotation.target.pathKeys) {
        openPathKeys.add(pathKey);
      }
    }

    const cache = cacheRef.current;

    for (const pathKey of openPathKeys) {
      if (cache.has(pathKey)) {
        continue;
      }

      const instance = partGraph.byPathKey.get(pathKey)?.instance;

      if (
        !instance?.sourceDocumentId ||
        !instance.sourceElementId ||
        !instance.sourcePartId ||
        instance.sourceDocumentId !== query.documentId
      ) {
        continue;
      }

      const partQuery = {
        documentId: instance.sourceDocumentId,
        workspaceId: query.workspaceId,
        elementId: instance.sourceElementId,
        partId: instance.sourcePartId,
        server: query.server,
      };

      // Reserve the slot immediately so a re-run of this effect before the
      // GET resolves doesn't fire a second overlapping request for the
      // same part.
      cache.set(pathKey, {
        documentId: partQuery.documentId,
        elementId: partQuery.elementId,
        partId: partQuery.partId,
        color: null,
        opacity: null,
      });

      void (async () => {
        try {
          const current = await fetchOnshapePartAppearance(partQuery);
          const { color, opacity } = extractAppearance(current.data);

          cache.set(pathKey, { ...partQuery, color, opacity });

          await setOnshapePartAppearance(partQuery, MARK_COLOR);
        } catch (err) {
          console.warn(`[FuzzyCAD] appearance marking failed for ${pathKey}:`, err);
        }
      })();
    }

    for (const [pathKey, cached] of Array.from(cache.entries())) {
      if (openPathKeys.has(pathKey)) {
        continue;
      }

      cache.delete(pathKey);

      if (!cached.color) {
        // Never resolved an original (skipped, or the GET failed/hadn't
        // finished) — nothing safe to restore to.
        continue;
      }

      void setOnshapePartAppearance(
        {
          documentId: cached.documentId,
          workspaceId: query.workspaceId,
          elementId: cached.elementId,
          partId: cached.partId,
          server: query.server,
        },
        cached.color,
        cached.opacity ?? undefined,
      ).catch((err) => {
        console.warn(`[FuzzyCAD] appearance restore failed for ${pathKey}:`, err);
      });
    }
  }, [document, partGraph, query]);
}
