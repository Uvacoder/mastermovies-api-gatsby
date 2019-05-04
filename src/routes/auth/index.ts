// MasterMovies API - Authorization Endpoint
import express, { Request, Response, Router } from "express";

import { cors } from "../../common/middleware/cors";
import { csrf } from "../../common/middleware/csrf";
import { AppConfig, AuthConfig } from "../../config";
import { serviceUnavailable } from "../common/serviceUnavailable";
import { authorizeFilm } from "./authorize";
import { query } from "./query";

/** Provides authentication and authorization */
export function AuthRouter(): Router {

  // Require config
  if (!AuthConfig) {
    return serviceUnavailable();
  }

  return express
    .Router()
    .all("/", cors(), index)
    .all("/authorize", cors({ methods: ["POST"], restrictOrigin: true }), csrf, authorizeFilm)
    .all("/query", cors(), query);
}

function index(req: Request, res: Response, _next: (err?: Error) => void): void {

  const base = AppConfig.base + req.originalUrl + "/";
  res.status(200).json({
    _message: AppConfig.title + " - Authorization Endpoint",
    authorize_url: base + "authorize",
    query_url: base + "query"
  });

}
