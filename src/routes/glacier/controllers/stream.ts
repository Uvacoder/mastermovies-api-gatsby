import { join } from "path";

import { Config } from "../../../config";
import { verifyJwt } from "../../../lib/jsonWebToken";
import { logger } from "../../../lib/logger";
import { HTTP_CODES } from "../../../middleware/respond";
import { Export } from "../../../models/export";
import { Thumbnail } from "../../../models/thumbnail";
import { IApiContext } from "../../../types/App";
import { streamFile } from "../lib/streamFile";

/** Supported resource types */
export const enum EType {
  EXPORT = 0,
  THUMBNAIL = 1,
}

const AUTH_REQUIRED: { [key in EType]: boolean } = {
  [EType.EXPORT]: true,
  [EType.THUMBNAIL]: false,
};

const CACHE_DURATION: { [key in EType]: number } = {
  [EType.EXPORT]: 0,
  [EType.THUMBNAIL]: 600,
};

/** Serve binary streaming of Thumbnail and Export resources */
export async function stream(ctx: IApiContext, type: EType) {
  // Validate the request and generate basic info
  const validatedRequest = validateRequest(ctx, type);
  if (validatedRequest == null) return;
  const { id, authRequired } = validatedRequest;

  // Check existence and get basic meta from database
  const typeMeta = await getTypeMeta(type, id);
  if (!typeMeta) {
    ctx.standard(HTTP_CODES.NOT_FOUND);
    return;
  }
  const { mime, filename, filmId } = typeMeta;

  // Check authorisation
  if (authRequired) {
    const authorised = await verifyAuth(ctx, type, filmId);
    if (!authorised) return;
  }

  // Generate path and stream it!
  const path = generatePath(type, id, filmId);
  applyCacheDuration(ctx, type);
  const shouldDownload = typeof ctx.query.download !== "undefined";

  return streamFile(ctx, path, mime, shouldDownload ? filename : void 0);
}

/** Validate type and return auth requirement */
function validateRequest(ctx: IApiContext, type: EType): { authRequired: boolean; id: number } | null {
  if (isNaN(ctx.params.id)) {
    ctx.standard(HTTP_CODES.BAD_REQUEST, '"id" must be a number');
    return null;
  }

  const authRequired = AUTH_REQUIRED[type];
  if (typeof authRequired !== "boolean") throw new Error("Could not find authorisation requirement for type " + type);

  return {
    id: parseInt(ctx.params.id, 10),
    authRequired,
  };
}

/** Verify authorisation of a resource */
async function verifyAuth(ctx: IApiContext, type: EType, filmId: number): Promise<boolean> {
  // Verify authorisation
  let authorised = false;
  switch (type) {
    case EType.EXPORT:
      const token: unknown = ctx.query.authorisation;
      if (typeof token === "string") {
        const secret = Config.get("glacier").auth.download.secret;
        const payload = verifyJwt(token, secret) as { resourceId: number };
        if (payload) {
          if (payload.resourceId === filmId) authorised = true;
        }
      }
      break;
  }

  if (authorised) {
    return true;
  }

  ctx.standard(HTTP_CODES.UNAUTHORIZED);
  return false;
}

/** Retrieve some metadata from the database */
async function getTypeMeta(
  type: EType,
  id: number,
): Promise<{
  filmId: number;
  mime?: string;
  filename?: string;
} | null> {
  switch (type) {
    case EType.EXPORT:
      return (Export.query().findById(id).select("filename", "mime", "film_id as filmId").first() as unknown) as {
        filename: string;
        mime: string;
        filmId: number;
      };

    case EType.THUMBNAIL:
      return (Thumbnail.query().findById(id).select("mime", "film_id as filmId").first() as unknown) as {
        mime?: string;
        filmId: number;
      };
    default:
      return null;
  }
}

/** Generate the content path on disk */
function generatePath(type: EType, id: number, filmId: number): string {
  const ROOT = Config.get("glacier").path;

  switch (type) {
    case EType.EXPORT:
      return join(ROOT, "exports", id.toString());
    case EType.THUMBNAIL:
      return join(ROOT, "thumbs", id.toString());
    default:
      logger.error({
        msg: "Failed to generate path",
        filmId,
        id,
        type,
      });
      throw new Error("Failed to generate glacier content path");
  }
}

/** Generate the content path on disk */
function applyCacheDuration(ctx: IApiContext, type: EType): void {
  if (typeof CACHE_DURATION[type] !== "undefined") ctx.cache = CACHE_DURATION[type];
}
