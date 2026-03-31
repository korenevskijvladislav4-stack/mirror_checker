import { google } from "googleapis";
import { Env } from "../config/env.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function normalizeHeader(h) {
  return (h ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function letterToNumber(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64); // A=1
  }
  return n;
}

function numberToLetter(num) {
  let n = num;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseRangeStart(rangeA1) {
  // Пример: "A1:D1000" -> { startRow: 1, startCol: 1 }
  const first = rangeA1.split(":")[0];
  const m1 = first.match(/^([A-Za-z]+)(\d+)$/);
  if (!m1) return { startRow: 1, startCol: 1 };
  return { startCol: letterToNumber(m1[1]), startRow: Number(m1[2]) };
}

function findColumnIndex(headerRow, keys) {
  const normalizedKeys = new Set(keys.map(normalizeHeader));
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizedKeys.has(normalizeHeader(headerRow[i]))) return i;
  }
  return -1;
}

function extractUrlFromHyperlinkFormula(value) {
  const v = (value ?? "").toString().trim();
  if (!v.startsWith("=HYPERLINK")) return v;
  // Поддержим и ; и , как разделители аргументов.
  const m = v.match(/^=HYPERLINK\(\s*"([^"]+)"\s*[,;].*\)$/i);
  if (m) return m[1];
  return v;
}

function normalizeSpreadsheetId(raw) {
  const v = (raw ?? "").toString().trim();
  if (!v) return v;
  const m = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return v.split("#")[0].split("?")[0];
}

function buildAuth() {
  if (!Env.GOOGLE_CLIENT_EMAIL || !Env.GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "Не заданы GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY для сервисного аккаунта.",
    );
  }

  const credentials = {
    client_email: Env.GOOGLE_CLIENT_EMAIL,
    private_key: Env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    project_id: Env.GOOGLE_PROJECT_ID || undefined,
  };

  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

function getSheetsClient() {
  const auth = buildAuth();
  return google.sheets({ version: "v4", auth });
}

export async function readMirrorTable() {
  const sheets = getSheetsClient();

  if (!Env.GOOGLE_SPREADSHEET_ID) {
    throw new Error("Не задана переменная GOOGLE_SPREADSHEET_ID");
  }
  if (!Env.GOOGLE_SHEET_NAME) {
    throw new Error("Не задана переменная GOOGLE_SHEET_NAME");
  }

  const valuesRange = Env.GOOGLE_SHEETS_VALUES_RANGE;
  const range = valuesRange.includes("!")
    ? valuesRange
    : `${Env.GOOGLE_SHEET_NAME}!${valuesRange}`;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: normalizeSpreadsheetId(Env.GOOGLE_SPREADSHEET_ID),
    range,
  });

  const values = data.values ?? [];
  if (values.length < 2) {
    return { projects: [], meta: null };
  }

  const header = values[0].map(String);
  const { startRow, startCol } = parseRangeStart(Env.GOOGLE_SHEETS_VALUES_RANGE);

  const projectColIndex = findColumnIndex(header, ["проект", "project"]);
  const mirror1ColIndex = findColumnIndex(header, ["зеркало1", "зеркало 1", "mirror1", "mirror 1"]);
  const mirror2ColIndex = findColumnIndex(header, ["зеркало2", "зеркало 2", "mirror2", "mirror 2"]);
  const mirror3ColIndex = findColumnIndex(header, ["зеркало3", "зеркало 3", "mirror3", "mirror 3"]);

  if (projectColIndex < 0 || mirror1ColIndex < 0 || mirror2ColIndex < 0 || mirror3ColIndex < 0) {
    throw new Error(
      "Не найдены колонки в Google Sheet. Ожидаются заголовки: 'Проект', 'Зеркало 1', 'Зеркало 2', 'Зеркало 3'.",
    );
  }

  const projects = [];
  for (let i = 1; i < values.length; i++) {
    const rowValues = values[i];
    const project = rowValues[projectColIndex] ? String(rowValues[projectColIndex]) : "";
    if (!project) continue;

    const mirror1Raw = rowValues[mirror1ColIndex] ? String(rowValues[mirror1ColIndex]) : "";
    const mirror2Raw = rowValues[mirror2ColIndex] ? String(rowValues[mirror2ColIndex]) : "";
    const mirror3Raw = rowValues[mirror3ColIndex] ? String(rowValues[mirror3ColIndex]) : "";

    const mirror1 = extractUrlFromHyperlinkFormula(mirror1Raw);
    const mirror2 = extractUrlFromHyperlinkFormula(mirror2Raw);
    const mirror3 = extractUrlFromHyperlinkFormula(mirror3Raw);

    projects.push({
      rowNumber: startRow + i,
      project,
      mirror1,
      mirror2,
      mirror3,
    });
  }

  const meta = {
    startRow,
    startCol,
    colIndexToLetter: (colIndex) => numberToLetter(startCol + colIndex),
    mirror2ColIndex,
    mirror3ColIndex,
  };

  return { projects, meta };
}

export async function updateMirrorCell({
  spreadsheetId,
  sheetName,
  rowNumber,
  colLetter,
  value,
}) {
  const sheets = getSheetsClient();

  // Перезапишем ячейку формулой HYPERLINK, чтобы и текст, и ссылка совпадали.
  const formula = value
    ? `=HYPERLINK("${value}";"${value}")`
    : "";

  await sheets.spreadsheets.values.update({
    spreadsheetId: normalizeSpreadsheetId(spreadsheetId),
    range: `${sheetName}!${colLetter}${rowNumber}`,
    // USER_ENTERED, чтобы строка распозналась как формула HYPERLINK,
    // а не как обычный текст.
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[formula]] },
  });
}

export async function appendCheckLog({
  project,
  mirrorName,
  url,
  status,
  error,
  checkedAt,
}) {
  if (!Env.GOOGLE_SPREADSHEET_ID) {
    throw new Error("Не задана переменная GOOGLE_SPREADSHEET_ID");
  }

  const sheets = getSheetsClient();
  const sheetName = "Checks";

  const values = [
    [
      project ?? "",
      mirrorName ?? "",
      url ?? "",
      checkedAt ?? new Date().toISOString(),
      status ?? "",
      error ?? "",
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: normalizeSpreadsheetId(Env.GOOGLE_SPREADSHEET_ID),
    range: `${sheetName}!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}


