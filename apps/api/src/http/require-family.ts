import type { RequestHandler } from "express";

/**
 * Authorisation seam for every /api route. Open for now.
 * Auth0 (event day) replaces this body: verify the token, resolve auth0_sub → family member → elders.
 */
export const requireFamily: RequestHandler = (_req, _res, next) => {
  next();
};
