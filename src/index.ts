// Entry point, spin up the ExpressJS server
import cookieParser from "cookie-parser";
import express, { Request, Response } from "express";
import helmet from "helmet";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { promisify } from "util";

import csurf from "csurf";
import { createPool } from "./common/database";
import { error, info, ok, wait, warn } from "./common/logger";
import { rateLimiter } from "./common/ratelimit";
import config from "./config/app.config.js";
import { createRoutes } from "./routes";
import { statusResponse } from "./routes/common/standardResponses";

process.stdout.write("MasterMovies API\nAuthor: Marcus Cemes\nTimes are in UTC\n\n");

if (process.env.NODE_ENV === "production") {
  ok("Running in production mode");
} else {
  warn("In development mode, unsuitable for production!");
}

(async () => {
  try {
    // Create the database pool
    wait("Connecting to database...");
    const pool = await createPool();

    // Create the express application
    wait("Creating Express.js application...");
    const app = express();
    const PORT = process.env.PORT || config.port;

    // Global rate limiting
    wait("Initializing rate-limiter...");
    app.use(rateLimiter(new RateLimiterMemory({
      points: 60,
      duration: 60
    })));

    // Add CSRF protection
    wait("Initializing CRSF protection...");
    app.use(cookieParser());
    app.use(csurf({ cookie: {
      key: "CSRF-Secret",
      secure: false, // TODO
      httpOnly: true,
    }}));
    app.use((req: Request, res: Response, next: () => void) => {
      res.cookie("CSRF-Token", req.csrfToken());
      next();
    });

    // Secure headers
    wait("Initializing secure headers...");
    app.use(helmet({
      dnsPrefetchControl: false,
      hsts: false
    }));

    // Create the express application routes
    wait("Initializing router endpoints...");
    const routes = createRoutes(pool);
    app.use(routes);

    // Register 404 handler
    wait("Initializing error handlers...");
    app.use((_req: Request, res: Response, _next: () => void) => {
      statusResponse(res, 404);
    });

    // Register CSRF error handler
    app.use((err: any, _req: Request, res: Response, next: (err?: any) => void) => {
      if (err.code !== "EBADCSRFTOKEN") { next(err); return; }
      statusResponse(res, 403); // Forbidden
    });

    // Register an error handler
    app.use((err: any, req: Request, res: Response, _next: (err?: any) => void) => {
      warn("Uncaught error in route '" + req.originalUrl + "'");
      warn("Message: " + err.message);
      if (process.env.NODE_ENV === "production") {
        err.stack.split("\n")
          .filter(v => v.indexOf("mastermovies") !== -1 && v.indexOf("node_modules") === -1)
          .forEach(v => warn(v));
      } else {
        warn(err.stack);
      }
      statusResponse(res, 500);
    });

    // Listen for connections
    app.set("trust proxy", true);
    app.set("json spaces", 2);
    const server = app.listen(PORT, () => {
      ok(`Listening on http://127.0.0.1:${PORT}\n`);
    });

    // Attempt a graceful shutdown
    let shutdown: () => void;
    shutdown = async () => {
      shutdown = () => {/* */};
      info("Waiting for server connections to close...");
      await promisify(server.close);

      info("Draining database connection pool...");
      await pool.end();

      ok("Server stopped successfully", () => process.exit(0));
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

  } catch (err) {
    error("An error occurred during startup:");
    error(err.message || err);
    process.exit(1);
  }
})();
