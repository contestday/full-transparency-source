// Publishes a clean snapshot of the committed code to the PUBLIC repository.
//
//   node scripts/publish-public.mjs        (or: npm run publish:public)
//
// - Takes exactly what is committed at HEAD (git archive): nothing untracked,
//   so .env.local, uploads/ and other ignored files can never be included.
// - Adds it as ONE new commit on the public repo, authored by GitHub's private
//   noreply address. The private repo's history (and any old commit details)
//   is never copied.
// - Refuses to publish if the snapshot contains anything that looks like a key,
//   or any word listed in the private, uncommitted .public-blocklist file.
// - Leaves out any path listed in the private, uncommitted .public-exclude file
//   (one path or folder per line), e.g. features that are paused.
// - With --replace-history, the public repo's history is replaced by this one
//   snapshot (force push). Use only to remove something published by mistake.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_REPO = process.env.PUBLIC_REPO ?? "contestday/full-transparency-source";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

const sha = run("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
if (run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root })) {
  console.error("Commit your changes first: the public copy is made from HEAD only.");
  process.exit(1);
}

const replaceHistory = process.argv.includes("--replace-history");
const listFile = (name) =>
  existsSync(path.join(root, name))
    ? readFileSync(path.join(root, name), "utf8")
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter((w) => w && !w.startsWith("#"))
    : [];
if (!existsSync(path.join(root, ".public-blocklist"))) {
  console.error("Missing .public-blocklist: refusing to publish without the private word check.");
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), "ft-public-"));
const repoUrl = `https://github.com/${PUBLIC_REPO}.git`;
try {
  // Fresh clone of the public repo (or an empty repo on first publish).
  try {
    if (replaceHistory) throw new Error("start afresh");
    run("git", ["clone", "--quiet", repoUrl, work]);
  } catch {
    run("git", ["init", "--quiet", "-b", "main", work]);
    run("git", ["remote", "add", "origin", repoUrl], { cwd: work });
  }
  for (const f of readdirSync(work)) if (f !== ".git") rmSync(path.join(work, f), { recursive: true, force: true });

  // Extract exactly HEAD's tracked files (git itself writes them, so this works
  // the same on Windows, macOS and Linux). The index already equals HEAD, so
  // this leaves the private working copy untouched.
  run("git", [`--work-tree=${work}`, "checkout", "HEAD", "--", "."], { cwd: root });
  // Leave out private paths (paused features); only the temporary copy is touched.
  for (const p of listFile(".public-exclude")) {
    if (p.includes("..") || path.isAbsolute(p)) throw new Error(`Bad path in .public-exclude: ${p}`);
    rmSync(path.join(work, p), { recursive: true, force: true });
  }

  // Safety scan before anything leaves this machine.
  const bad = [/eyJhbGciOi[A-Za-z0-9_-]{20,}/, /sb_secret_[A-Za-z0-9]/, /sk_live_[A-Za-z0-9]/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (f === ".git") return [];
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const file of walk(work)) {
    if (statSync(file).size > 2_000_000) continue;
    const text = readFileSync(file, "utf8");
    const hit = bad.find((re) => re.test(text));
    if (hit) throw new Error(`Refusing to publish: ${path.relative(work, file)} matches ${hit}`);
  }

  // Private words (place names etc.) that must never appear in the public code.
  // The list is kept in .public-blocklist, one per line, which is never committed.
  const blocked = listFile(".public-blocklist");
  for (const file of walk(work)) {
    if (statSync(file).size > 2_000_000) continue;
    const text = readFileSync(file, "utf8").toLowerCase();
    const word = blocked.find((w) => text.includes(w.toLowerCase()));
    if (word) throw new Error(`Refusing to publish: ${path.relative(work, file)} contains a word on the private blocklist`);
  }

  const id = run("gh", ["api", "user", "--jq", ".id"]);
  const author = ["-c", "user.name=Full Transparency", "-c", `user.email=${id}+contestday@users.noreply.github.com`];
  run("git", ["add", "-A"], { cwd: work });
  const changed = run("git", ["status", "--porcelain"], { cwd: work });
  if (!changed) {
    console.log("Public copy already up to date.");
  } else {
    run("git", [...author, "commit", "--quiet", "-m", `Snapshot of the deployed code (${new Date().toISOString().slice(0, 10)})`], { cwd: work });
    run("git", ["push", "--quiet", ...(replaceHistory ? ["--force"] : []), "origin", "HEAD:main"], { cwd: work });
    console.log(`Published snapshot of ${sha} to https://github.com/${PUBLIC_REPO}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
