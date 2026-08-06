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
