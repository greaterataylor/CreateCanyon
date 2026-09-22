/** Deployment gate, not a substitute for dependency scanning or a security review. */
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export function supportedNextVersion(version) {
  // Only the tested major line is permitted. No ranges, prereleases or assumed future majors.
  const match = /^(16)\.(\d+)\.(\d+)$/.exec(version ?? '');
  return !!match && (Number(match[2]) > 3 || (Number(match[2]) === 3 && Number(match[3]) >= 6));
}
export async function releaseProblems(directory = root, env = process.env) {
  const errors = [];
  const versions = new Set();
  for (const group of ['apps', 'packages']) {
    for (const entry of await readdir(path.join(directory, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filename = path.join(directory, group, entry.name, 'package.json');
      let manifest;
      try { manifest = JSON.parse(await readFile(filename, 'utf8')); } catch { continue; }
      const version = manifest.dependencies?.next;
      if (!version) continue;
      versions.add(version);
      if (!supportedNextVersion(version)) errors.push(`${group}/${entry.name}: Next.js ${version} is below the approved minimum 16.3.6. Read docs/SECURITY.md and the complete upstream advisory first.`);
    }
  }
  if (versions.size !== 1) errors.push('Every Next.js consumer must pin the same reviewed exact version.');
  try { await access(path.join(directory, 'pnpm-lock.yaml')); }
  catch { errors.push('No pnpm-lock.yaml. Generate and review a real lockfile, then install with --frozen-lockfile.'); }
  if (env.RELEASE_REVIEW_APPROVED !== 'true') errors.push('RELEASE_REVIEW_APPROVED=true must be set only after the documented launch checklist and dependency advisory review are complete.');
  return errors;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const errors = await releaseProblems();
  if (errors.length) { console.error('PUBLIC RELEASE BLOCKED\n' + errors.map(e => ' - ' + e).join('\n')); process.exitCode = 1; }
  else console.log('Static release prerequisites passed. This does NOT certify production readiness or security.');
}
