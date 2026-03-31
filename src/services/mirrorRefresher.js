import { execa } from "execa";
import { Env } from "../config/env.js";

function renderTemplate(template, vars) {
  return template.replace(/{(\w+)}/g, (m, key) => {
    const v = vars[key];
    return v === undefined ? m : String(v);
  });
}

export async function refreshMirror({ project, source, target, dryRun }) {
  if (dryRun) {
    return { skipped: true, reason: "dryRun" };
  }

  const template = Env.MIRROR_REFRESH_COMMAND_TEMPLATE;
  if (!template || !template.trim()) {
    // В этом режиме мы просто обновляем URL в таблице без внешней команды.
    return { skipped: true, reason: "no-command-template" };
  }

  const cmd = renderTemplate(template, { project, source, target });

  // shell:true чтобы команда могла быть любым строковым шаблоном (cmd/pwsh/ssh/rsync и т.д.)
  await execa(cmd, { shell: true, stdio: "inherit" });
  return { skipped: false, command: cmd };
}

