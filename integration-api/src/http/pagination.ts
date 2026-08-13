import { z } from "zod";

import { ApiError } from "./errors.js";

export interface CursorValue {
  id: string;
  createdAt: string;
}

const cursorSchema = z.object({
  id: z.string().regex(/^\d+$/),
  createdAt: z.string().datetime()
}).strict();

const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
}).strict();

export function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorValue {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ApiError(400, "validation_error", "The pagination cursor is invalid");
  }
}

export function parsePageQuery(value: unknown): { cursor: string | null; limit: number } {
  const result = pageQuerySchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "validation_error", "The query parameters are invalid");
  }
  if (result.data.cursor !== undefined) {
    decodeCursor(result.data.cursor);
  }
  return {
    cursor: result.data.cursor ?? null,
    limit: result.data.limit
  };
}
