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
