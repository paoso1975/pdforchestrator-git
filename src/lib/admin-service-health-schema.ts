import { z } from "zod";

export const serviceHealthSchema = z.object({
  checkedAt: z.string().datetime(),
  services: z.array(z.object({
    id: z.string(), label: z.string(), status: z.enum(["ok", "warning", "error"]), message: z.string(), durationMs: z.number().int().nonnegative(),
    variables: z.array(z.object({ name: z.string(), configured: z.boolean(), value: z.string().nullable(), sensitive: z.boolean() })), details: z.array(z.string()),
  })),
});
export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

export function describeHealthVariable(
  environment: Record<string, string | undefined>,
  name: string,
  options: { aliases?: string[]; sensitive?: boolean; transform?: (value: string) => string } = {},
) {
  const found = [name, ...(options.aliases ?? [])].find((candidate) => Boolean(environment[candidate]));
  const rawValue = found ? environment[found]! : null;
  return {
    name: found ?? name,
    configured: Boolean(rawValue),
    value: rawValue ? (options.sensitive ? "Configurata · valore nascosto" : options.transform ? options.transform(rawValue) : rawValue) : null,
    sensitive: options.sensitive ?? false,
  };
}
