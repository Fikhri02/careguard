import type { ApiError } from "@careguard/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import type { Logger } from "../ports/logger.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } } satisfies ApiError);
};

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const send = (status: number, code: string, message: string) => {
      res.status(status).json({ error: { code, message } } satisfies ApiError);
    };

    if (err instanceof z.ZodError) return send(400, "validation_error", z.prettifyError(err));
    if (err instanceof ValidationError) return send(400, err.code, err.message);
    if (err instanceof NotFoundError) return send(404, err.code, err.message);
    if (err instanceof ConflictError) return send(409, err.code, err.message);

    // body-parser errors (malformed JSON, payload too large) carry a 4xx `status`.
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status < 500) return send(status, "bad_request", err instanceof Error ? err.message : "Bad request");

    log.error("unhandled error", { error: err instanceof Error ? err.message : String(err) });
    send(500, "internal_error", "Something went wrong");
  };
}
