import { z } from "zod";

export const Elder = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  createdAt: z.string(),
});
export type Elder = z.infer<typeof Elder>;
