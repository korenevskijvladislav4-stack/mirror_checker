import axios from "axios";
import { Env } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger();

function normalizeHostnameForCompare(rawUrl) {
  try {
    const withScheme = rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`;
    let host = new URL(withScheme).hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return "";
  }
}

function getFinalUrlFromResponse(resp, requestedUrl) {
  const fromIncoming =
    resp.request?.res?.responseUrl &&
    typeof resp.request.res.responseUrl === "string"
      ? resp.request.res.responseUrl
      : null;
  const fromRequest =
    resp.request?.responseUrl &&
    typeof resp.request.responseUrl === "string"
      ? resp.request.responseUrl
      : null;
  return fromIncoming || fromRequest || requestedUrl;
}

export async function isUrlReachable(url) {
  if (!url) return false;

  const normalized = url.includes("://") ? url : `https://${url}`;
  const expectedHost = normalizeHostnameForCompare(normalized);

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
    const finalUrl = getFinalUrlFromResponse(resp, normalized);
    const finalHost = normalizeHostnameForCompare(finalUrl);
    const noForeignRedirect =
      expectedHost !== "" &&
      finalHost !== "" &&
      expectedHost === finalHost;

    const reachable = ok && noForeignRedirect;

    logger.info(
      {
        url: normalized,
        finalUrl,
        status: resp.status,
        expectedHost,
        finalHost,
        noForeignRedirect,
        reachable,
      },
      "Mirror reachability check",
    );

    return reachable;
  } catch (e) {
    logger.warn(
      { url: normalized, error: e instanceof Error ? e.message : String(e) },
      "Mirror reachability check failed",
    );
    return false;
  }
}

