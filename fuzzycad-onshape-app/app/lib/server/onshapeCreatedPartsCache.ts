import { onshapeFetch, parseJsonOrText } from "./onshapeApi";

/**
 * Server-side cache + in-flight dedup for the feature->created-parts
 * FeatureScript evaluation (see partstudio-feature-created-parts/route.ts).
 *
 * The right panel rebuilds its selectionId->feature map by asking, per
 * open mark, which entities that feature created. With several marks open
 * the client fires a burst of these; a rate-limited (429) response used to
 * never get cached client-side, so the next rebuild refetched it and fed a
 * self-sustaining request storm.
 *
 * Two mechanisms fix that here, at the source, so the client doesn't have
 * to throttle (which hurt responsiveness):
 *   - in-flight dedup: N concurrent requests for the SAME feature collapse
 *     into ONE real Onshape call, and all N await its single result.
 *   - short-TTL cache: a feature's created parts only change when the
 *     feature itself regenerates, so a recent successful result is safe to
 *     reuse for a couple of minutes instead of re-hitting Onshape.
 *
 * In-memory + per-serverless-instance, exactly like onshapeElementsCache --
 * an accepted tradeoff in this codebase: the burst is a single browser's
 * concurrent calls, which mostly land on one warm instance, and any
 * instance still dedups its own share.
 *
 * Only SUCCESSFUL results are cached; a failure is left uncached so it can
 * be retried later, while the in-flight dedup still prevents a failing call
 * from being made many times at once.
 */

type FeatureScriptFetchInput = {
  cacheKey: string;
  endpoint: string;
  accessToken: string;
  script: string;
  route: string;
  operation: string;
  ttlMs: number;
  force?: boolean;
};

export type FeatureScriptFetchResult = {
  ok: boolean;
  status: number;
  data: unknown;
  cache: "hit" | "miss" | "inflight" | "bypass";
};

type CacheEntry = {
  expiresAt: number;
  status: number;
  data: unknown;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FeatureScriptFetchResult>>();

async function fetchFromOnshape(
  input: FeatureScriptFetchInput,
): Promise<FeatureScriptFetchResult> {
  const res = await onshapeFetch(
    input.endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ script: input.script }),
    },
    { route: input.route, operation: input.operation },
  );

  const data = await parseJsonOrText(res);

  if (res.ok) {
    cache.set(input.cacheKey, {
      expiresAt: Date.now() + input.ttlMs,
      status: res.status,
      data,
    });
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
    cache: input.force ? "bypass" : "miss",
  };
}

export async function getCachedFeatureScript(
  input: FeatureScriptFetchInput,
): Promise<FeatureScriptFetchResult> {
  const now = Date.now();

  if (!input.force) {
    const cached = cache.get(input.cacheKey);
    if (cached && cached.expiresAt > now) {
      return { ok: true, status: cached.status, data: cached.data, cache: "hit" };
    }

    const pending = inflight.get(input.cacheKey);
    if (pending) {
      const result = await pending;
      return { ...result, cache: "inflight" };
    }
  }

  const promise = fetchFromOnshape(input).finally(() => {
    inflight.delete(input.cacheKey);
  });
  inflight.set(input.cacheKey, promise);

  return promise;
}
