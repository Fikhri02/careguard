import { z } from "zod";

export const FamilyMember = z.object({
  id: z.string(),
  elderId: z.string(),
  name: z.string().nullable(),
  phone: z.string(),
  createdAt: z.string(),
});
export type FamilyMember = z.infer<typeof FamilyMember>;
