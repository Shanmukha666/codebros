import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hardenPage } from "./csp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "_site");
const frontendFolders = [
  "admin_course_builder",
  "admin_dashboard",
  "admin_student_management",
  "codebros_brand_logo",
  "codebros_create_account",
  "codebros_home",
  "codebros_password_2fa_recovery",
  "codebros_password_reset_success",
  "codebros_sign_in",
  "course_catalog_discovery",
  "course_lesson_player",
  "interactive_quiz_assessment",
  "online_coding_ide",
  "student_dashboard",
  "student_profile_account_settings",
  "student_progress_analytics"
];

if (!process.env.CODEBROS_API_URL) {
  console.warn("CODEBROS_API_URL is not set: the frontend will call /api on its own origin.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const folder of frontendFolders) {
  await cp(path.join(root, folder), path.join(output, folder), {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return name === folder || name === "code.html";
    }
  });
  const page = path.join(output, folder, "code.html");
  const html = await readFile(page, "utf8");
  await writeFile(page, hardenPage(html, process.env.CODEBROS_API_URL), "utf8");
}

await cp(path.join(root, "shared"), path.join(output, "shared"), { recursive: true });
await writeFile(
  path.join(output, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=codebros_home/code.html">
    <title>CodeBros</title>
  </head>
  <body>
    <p>Opening CodeBros...</p>
    <a href="codebros_home/code.html">Open CodeBros</a>
  </body>
</html>
`,
  "utf8"
);
await writeFile(path.join(output, ".nojekyll"), "", "utf8");
