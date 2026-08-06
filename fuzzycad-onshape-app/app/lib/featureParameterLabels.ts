/**
 * Turns a raw Onshape identifier (parameterId or featureType -- both are
 * lowerCamelCase, e.g. "offsetDistance", "extrude") into a plain-language
 * label a non-CAD collaborator can read at a glance, without a per-field
 * dictionary to maintain. Good enough for "Offset distance" / "Draft
 * angle" / "Extrude"; not attempting anything smarter than word-splitting
 * camelCase.
 */
function humanizeIdentifier(id: string): string {
  const withSpaces = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const lower = withSpaces.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function parameterLabel(parameterId: string): string {
  return humanizeIdentifier(parameterId);
}

export function featureTypeLabel(featureType: string): string {
  return humanizeIdentifier(featureType);
}

function strippedBooleanPrefix(parameterId: string): string | null {
  const match = parameterId.match(/^(has|is)([A-Z].+)$/);
  if (!match) return null;
  return match[2].charAt(0).toLowerCase() + match[2].slice(1);
}

/**
 * Whether a numeric parameter is currently in effect, inferred from
 * sibling boolean flags on the same feature via Onshape's own naming
 * convention: a boolean gate's name, with any has/is prefix stripped, is
 * a camelCase prefix of every parameter it gates -- e.g. hasOffset gates
 * offsetDistance/offsetOppositeDirection, startOffset (no prefix) gates
 * startOffsetDistance/startOffsetBound. Confirmed against a real Extrude
 * feature's parameter list (2026-08-06): every quantity parameter that
 * was a no-op default in that capture (offsetDistance, draftAngle,
 * secondDirectionDepth, startOffsetDistance, ...) had exactly this
 * relationship to a false sibling boolean.
 *
 * Not exhaustive -- in that same capture, thickness/thickness1/thickness2
 * were also inactive defaults (this was a plain solid extrude, not a
 * thin-walled one) but aren't gated by any boolean with a matching name,
 * so this can't catch every case. Deliberately errs toward showing a
 * parameter when its gate is ambiguous, never toward hiding one that
 * might actually matter.
 */
export function isParameterActive(
  parameterId: string,
  siblingBooleans: { parameterId: string; value: boolean }[],
): boolean {
  for (const bool of siblingBooleans) {
    if (bool.value) continue;

    const candidates = [bool.parameterId, strippedBooleanPrefix(bool.parameterId)].filter(
      (candidate): candidate is string => candidate !== null,
    );

    for (const candidate of candidates) {
      if (parameterId !== candidate && parameterId.startsWith(candidate)) {
        return false;
      }
    }
  }
  return true;
}
