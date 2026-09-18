import { z } from 'zod';
export const idSchema = z.string().uuid();
export const termSchema = z.object({
  id: z.string().max(100),
  word: z.string().min(1).max(150),
  reading: z.string().max(200),
});
export const documentSchema = z.object({
  id: idSchema,
  name: z.string().max(300),
  text: z.string().max(500000),
  digest: z.string().max(20000),
  terms: z.array(termSchema).max(500),
  status: z.enum(['extracted', 'analyzed']),
});
export const contextSchema = z.object({
  notes: z.string().max(100000),
  terms: z.array(termSchema).max(500),
  documents: z.array(documentSchema).max(30),
});
export const themeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100),
  context: contextSchema,
});
export const ownerSchema = z.object({ type: z.enum(['meeting', 'theme']), id: idSchema });
export const settingsSchema = z.object({
  apiKey: z.string().max(500).optional(),
  transcriptionModel: z.enum(['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-transcribe']),
  summaryModel: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .max(100),
  ffmpegPath: z.string().max(1000),
});
