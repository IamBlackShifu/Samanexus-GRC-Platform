import { z } from "zod";

export const organisationSchema = z.object({
  setupKey: z.uuid(),
  name: z.string().trim().min(2).max(255),
  sector: z.enum(["care", "professional_services", "charity", "other"]),
  size: z.enum(["micro", "small", "medium"]),
  primaryContactName: z.string().trim().min(2).max(255),
  primaryContactEmail: z.string().trim().toLowerCase().email().max(255),
  frameworkCodes: z.array(z.literal("CE")).length(1),
});

export const sectorLabels: Record<string, string> = {
  care: "Care", professional_services: "Professional services", charity: "Charity", other: "Other",
};

export function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(value)) : "Not recorded";
}
