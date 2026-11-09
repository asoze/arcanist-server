import { z } from "zod";

export const noteIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const usernameSchema = z.string().trim().min(1).max(64);

/** Body of `PUT /notes/:id`. Server owns id, version, timestamps and authorship. */
export const noteInputSchema = z
  .object({
    title: z.string().max(500).default(""),
    html: z.string().default(""),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
    shared: z.boolean().default(false),
    createdAt: z.number().int().positive().optional(),
  })
  .strict();
