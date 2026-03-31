import pLimit from "p-limit";
import { Env } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
import { readMirrorTable, updateMirrorCell, appendCheckLog } from "../services/sheetsClient.js";
import { isUrlReachable } from "../services/mirrorChecker.js";
import { buildNextMirrorUrl, extractMirrorNumber } from "../services/mirrorParser.js";
import { refreshMirror } from "../services/mirrorRefresher.js";

const logger = createLogger();
const MAX_CANDIDATE_ATTEMPTS = 5;
const EMPTY_MIRROR_CANDIDATE_ATTEMPTS = 5;

function computeNextNumber(a, b) {
  const n1 = extractMirrorNumber(a);
  const n2 = extractMirrorNumber(b);
  const nums = [n1, n2].filter((n) => typeof n === "number" && Number.isFinite(n));
  if (nums.length === 0) return null;
  return Math.max(...nums) + 1;
}

async function replaceIfDown({ row, meta, which, dryRun }) {
  const source = row.mirror1;
  const isMirror2 = which === "mirror2";
  const current = isMirror2 ? row.mirror2 : row.mirror3;
  const other = isMirror2 ? row.mirror3 : row.mirror2;

  const nextNumber = computeNextNumber(current, other);
  if (nextNumber === null) {
    // Оба зеркала без числового суффикса или пустые — пропускаем без ошибки.
    logger.warn(
      { project: row.project, which, current, other },
      "Пропускаем замену: нет числового суффикса ни в одном зеркале",
    );
    return false;
  }

  const base = extractMirrorNumber(current) !== null ? current : other;
  let newUrl = null;
  let selectedNumber = null;

  for (let offset = 0; offset < MAX_CANDIDATE_ATTEMPTS; offset++) {
    const candidateNumber = nextNumber + offset;
    const candidateUrl = buildNextMirrorUrl(base, candidateNumber);
    if (!candidateUrl) continue;

    const candidateReachable = await isUrlReachable(candidateUrl);
    logger.info(
      {
        project: row.project,
        which,
        candidateUrl,
        candidateNumber,
        candidateReachable,
      },
      "Checking replacement candidate",
    );

    if (candidateReachable) {
      newUrl = candidateUrl;
      selectedNumber = candidateNumber;
      break;
    }
  }

  if (!newUrl) {
    throw new Error(
      `${which}: не найден рабочий кандидат за ${MAX_CANDIDATE_ATTEMPTS} попыток (начиная с ${nextNumber}).`,
    );
  }

  logger.info(
    { project: row.project, which, from: current, to: newUrl, nextNumber: selectedNumber },
    "Refreshing mirror",
  );

  await refreshMirror({
    project: row.project,
    source,
    target: newUrl,
    dryRun,
  });

  // Если указана внешняя команда, имеет смысл проверить доступность.
  if (Env.MIRROR_REFRESH_COMMAND_TEMPLATE && Env.MIRROR_REFRESH_COMMAND_TEMPLATE.trim()) {
    const reachable = dryRun ? true : await isUrlReachable(newUrl);
    if (!reachable) {
      throw new Error(`${which} после refresh недоступен: ${newUrl}`);
    }
  }

  const colIndex = isMirror2 ? meta.mirror2ColIndex : meta.mirror3ColIndex;
  const colLetter = meta.colIndexToLetter(colIndex);

  if (!dryRun) {
    await updateMirrorCell({
      spreadsheetId: Env.GOOGLE_SPREADSHEET_ID,
      sheetName: Env.GOOGLE_SHEET_NAME,
      rowNumber: row.rowNumber,
      colLetter,
      value: newUrl,
    });
  }

  logger.info(
    {
      project: row.project,
      which,
      url_written: newUrl,
      rowNumber: row.rowNumber,
      colLetter,
      dryRun,
    },
    "Mirror cell updated in sheet",
  );

  // Обновим в локальном объекте, чтобы следующая замена считала max правильно.
  if (isMirror2) row.mirror2 = newUrl;
  else row.mirror3 = newUrl;
  return true;
}

async function fillEmptyFromOtherMirror({ row, meta, which, dryRun }) {
  const isMirror2 = which === "mirror2";
  const other = isMirror2 ? row.mirror3 : row.mirror2;
  const existingOtherUrl = other;

  const otherNum = extractMirrorNumber(other);
  if (otherNum === null) {
    logger.warn(
      { project: row.project, which, other },
      "Пропускаем заполнение пустого зеркала: в соседнем нет числового суффикса",
    );
    return false;
  }

  let selectedUrl = null;
  let selectedNumber = null;

  logger.info(
    {
      project: row.project,
      which,
      other,
      otherNum,
      attempts: EMPTY_MIRROR_CANDIDATE_ATTEMPTS,
    },
    "Start searching candidate for empty mirror",
  );

  const tried = new Set();

  const tryCandidate = async (candidateNumber, direction) => {
    if (!Number.isFinite(candidateNumber) || candidateNumber <= 0) return false;
    if (tried.has(candidateNumber)) return false;
    tried.add(candidateNumber);

    const candidateUrl = buildNextMirrorUrl(other, candidateNumber);
    if (!candidateUrl) return false;

    // Не вставляем, если кандидат уже стоит во второй ячейке зеркал.
    if (existingOtherUrl && candidateUrl === existingOtherUrl) {
      logger.info(
        { project: row.project, which, candidateUrl, candidateNumber, direction },
        "Skipping candidate (already used in other mirror cell)",
      );
      return false;
    }

    const candidateReachable = await isUrlReachable(candidateUrl);
    logger.info(
      { project: row.project, which, candidateUrl, candidateNumber, direction, candidateReachable },
      "Checking candidate for empty mirror",
    );

    if (candidateReachable) {
      selectedUrl = candidateUrl;
      selectedNumber = candidateNumber;
      return true;
    }
    return false;
  };

  // Ищем и вверх, и вниз: +1..+10, затем -1..-10.
  for (let offset = 1; offset <= EMPTY_MIRROR_CANDIDATE_ATTEMPTS; offset++) {
    // вверх
    if (await tryCandidate(otherNum + offset, "up")) break;
    // вниз
    if (await tryCandidate(otherNum - offset, "down")) break;
  }

  if (!selectedUrl) {
    logger.warn(
      {
        project: row.project,
        which,
        other,
        otherNum,
        attempts: EMPTY_MIRROR_CANDIDATE_ATTEMPTS,
      },
      "No candidate found for empty mirror; leaving cell empty",
    );
    return false;
  }

  const colIndex = isMirror2 ? meta.mirror2ColIndex : meta.mirror3ColIndex;
  const colLetter = meta.colIndexToLetter(colIndex);

  if (!dryRun) {
    await updateMirrorCell({
      spreadsheetId: Env.GOOGLE_SPREADSHEET_ID,
      sheetName: Env.GOOGLE_SHEET_NAME,
      rowNumber: row.rowNumber,
      colLetter,
      value: selectedUrl,
    });
  }

  logger.info(
    {
      project: row.project,
      which,
      url_written: selectedUrl,
      selectedNumber,
      rowNumber: row.rowNumber,
      colLetter,
      dryRun,
    },
    "Empty mirror cell filled in sheet",
  );

  if (isMirror2) row.mirror2 = selectedUrl;
  else row.mirror3 = selectedUrl;
  return true;
}

export async function runDailyMirrorUpdate({ dryRun = false } = {}) {
  const startedAt = Date.now();
  const { projects, meta } = await readMirrorTable();

  logger.info(
    { count: projects.length, dryRun, range: Env.GOOGLE_SHEETS_VALUES_RANGE },
    "Loaded mirror table",
  );

  const limit = pLimit(3);

  const jobs = projects.map((row) =>
    limit(async () => {
      const rowResult = {
        project: row.project,
        rowNumber: row.rowNumber,
        changed: [],
        filled: [],
        removed: [],
        errors: {},
      };

      const hasMirror2 = !!row.mirror2;
      const hasMirror3 = !!row.mirror3;

      const ok2 = hasMirror2 ? await isUrlReachable(row.mirror2) : null;
      const ok3 = hasMirror3 ? await isUrlReachable(row.mirror3) : null;

      // Если ячейка пустая, пробуем заполнить от соседнего зеркала +1..+10.
      if (!hasMirror2 && hasMirror3) {
        const filled = await fillEmptyFromOtherMirror({ row, meta, which: "mirror2", dryRun });
        if (filled) rowResult.filled.push("mirror2");
      }
      if (!hasMirror3 && hasMirror2) {
        const filled = await fillEmptyFromOtherMirror({ row, meta, which: "mirror3", dryRun });
        if (filled) rowResult.filled.push("mirror3");
      }

      if (hasMirror2 && ok2 === false) {
        try {
          const replaced = await replaceIfDown({ row, meta, which: "mirror2", dryRun });
          if (replaced) rowResult.changed.push("mirror2");
        } catch (e) {
          rowResult.errors.mirror2 = e instanceof Error ? e.message : String(e);
          if (!dryRun) {
            const colLetter = meta.colIndexToLetter(meta.mirror2ColIndex);
            await updateMirrorCell({
              spreadsheetId: Env.GOOGLE_SPREADSHEET_ID,
              sheetName: Env.GOOGLE_SHEET_NAME,
              rowNumber: row.rowNumber,
              colLetter,
              value: "",
            });
            row.mirror2 = "";
            rowResult.removed.push("mirror2");
          }
        }
      }

      // Если mirror3 существует и был недоступен, заменяем его с учётом того, что mirror2 мог уже поменяться.
      if (hasMirror3 && ok3 === false) {
        try {
          const replaced = await replaceIfDown({ row, meta, which: "mirror3", dryRun });
          if (replaced) rowResult.changed.push("mirror3");
        } catch (e) {
          rowResult.errors.mirror3 = e instanceof Error ? e.message : String(e);
          if (!dryRun) {
            const colLetter = meta.colIndexToLetter(meta.mirror3ColIndex);
            await updateMirrorCell({
              spreadsheetId: Env.GOOGLE_SPREADSHEET_ID,
              sheetName: Env.GOOGLE_SHEET_NAME,
              rowNumber: row.rowNumber,
              colLetter,
              value: "",
            });
            row.mirror3 = "";
            rowResult.removed.push("mirror3");
          }
        }
      }

      const checkedAt = new Date().toISOString();

      const logs = [];

      // mirror2
      if (hasMirror2 || rowResult.filled.includes("mirror2")) {
        const changed = rowResult.changed.includes("mirror2");
        const filled = rowResult.filled.includes("mirror2");
        const removed = rowResult.removed.includes("mirror2");
        const mirrorError = rowResult.errors.mirror2 ?? "";
        const status = changed
          ? "replaced"
          : filled
            ? "filled"
          : removed
            ? "removed"
          : ok2 === true
            ? "ok"
            : ok2 === false
              ? "down"
              : "skipped";
        logs.push(
          appendCheckLog({
            project: row.project,
            mirrorName: "mirror2",
            url: row.mirror2,
            status: mirrorError ? "error" : status,
            error: mirrorError,
            checkedAt,
          }),
        );
      }

      // mirror3
      if (hasMirror3 || rowResult.filled.includes("mirror3")) {
        const changed = rowResult.changed.includes("mirror3");
        const filled = rowResult.filled.includes("mirror3");
        const removed = rowResult.removed.includes("mirror3");
        const mirrorError = rowResult.errors.mirror3 ?? "";
        const status = changed
          ? "replaced"
          : filled
            ? "filled"
          : removed
            ? "removed"
          : ok3 === true
            ? "ok"
            : ok3 === false
              ? "down"
              : "skipped";
        logs.push(
          appendCheckLog({
            project: row.project,
            mirrorName: "mirror3",
            url: row.mirror3,
            status: mirrorError ? "error" : status,
            error: mirrorError,
            checkedAt,
          }),
        );
      }

      await Promise.all(logs);

      return rowResult;
    }),
  );

  const results = await Promise.all(jobs);

  const elapsedMs = Date.now() - startedAt;
  logger.info({ elapsedMs }, "Daily mirror update done");

  return { elapsedMs, results };
}

