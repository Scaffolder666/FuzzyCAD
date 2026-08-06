/**
 * Renders a value-typed BTM* parameter's message into a short display
 * string. Shared between the feature-parameters debug dump and the
 * production mark-uncertain panel so the two show the same value for the
 * same parameter.
 */
export function formatFeatureParameterValue(
  typeName: unknown,
  message: Record<string, unknown>,
): string {
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
 * Pulls the leading numeric magnitude out of a quantity expression like
 * "5*mm" or "110 mm" -- good enough for a range slider / number input
 * default, not a full FeatureScript expression parser. Returns null for
 * anything that doesn't start with a plain number (formulas referencing
 * other parameters, etc).
 */
export function parseNumericMagnitude(expression: string): number | null {
  const match = expression.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const value = parseFloat(match[0]);
  return Number.isNaN(value) ? null : value;
}

/**
 * Replaces just the leading numeric magnitude in a quantity expression,
 * keeping everything else (the "*mm" / " in" unit suffix, any surrounding
 * formula text) intact -- so an accepted proposed value like "6.5" becomes
 * "6.5*mm" when the original was "5*mm", instead of losing the unit.
 * Falls back to the bare new value if the original had no leading number
 * to anchor on.
 */
export function substituteNumericMagnitude(originalExpression: string, newMagnitude: string): string {
  const match = originalExpression.match(/-?\d+(\.\d+)?/);
  if (!match || match.index === undefined) {
    return newMagnitude;
  }
  const before = originalExpression.slice(0, match.index);
  const after = originalExpression.slice(match.index + match[0].length);
  return `${before}${newMagnitude}${after}`;
}
