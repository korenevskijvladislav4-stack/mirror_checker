import axios from "axios";
import { Env } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger();

export async function isUrlReachable(url) {
  if (!url) return false;

  const normalized = url.includes("://") ? url : `https://${url}`;

  const timeout = Env.MIRROR_CHECK_TIMEOUT_MS;
  const maxRedirects = Env.MIRROR_CHECK_MAX_REDIRECTS;

  try {
    const resp = await axios.get(normalized, {
      timeout,
      maxRedirects,
      // считаем ошибкой только настоящие сетевые/5xx проблемы,
      // всё остальное (включая 403/404) считаем "живо отвечает".
      validateStatus: (s) => s >= 200 && s < 600,
      headers: { "User-Agent": "mirror-update-bot" },
    });

    const ok = resp.status < 500;

    logger.info(
      { url: normalized, status: resp.status, reachable: ok },
      "Mirror reachability check",
    );

    return ok;
  } catch (e) {
    logger.warn(
      { url: normalized, error: e instanceof Error ? e.message : String(e) },
      "Mirror reachability check failed",
    );
    return false;
  }
}

