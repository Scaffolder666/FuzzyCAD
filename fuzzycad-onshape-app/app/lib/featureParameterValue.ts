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
