import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().optional().default(3000),

  GOOGLE_PROJECT_ID: z.string().optional(),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),

  GOOGLE_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEET_NAME: z.string().optional(),
  GOOGLE_SHEETS_VALUES_RANGE: z.string().optional().default("A1:D1000"),

  MIRROR_CHECK_TIMEOUT_MS: z.coerce.number().optional().default(5000),
  MIRROR_CHECK_MAX_REDIRECTS: z.coerce.number().optional().default(5),

  MIRROR_REFRESH_COMMAND_TEMPLATE: z.string().optional().default(""),

  // Regex-поля могут пригодиться, если URL не парсится по регулярке по умолчанию.
  MIRROR_URL_REGEX_PREFIX: z.string().optional().default("(?<prefix>[a-zA-Z-]+?)"),
  MIRROR_URL_REGEX_NUMBER: z.string().optional().default("(?<num>\\d+)"),
  MIRROR_URL_REGEX_SUFFIX: z.string().optional().default("(?<suffix>\\.[a-zA-Z0-9.-]+)$")
});

export const Env = EnvSchema.parse(process.env);

