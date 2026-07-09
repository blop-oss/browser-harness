import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTempDir(parent = tmpdir()) {
  const dir = await mkdtemp(join(parent, "blop-test-"));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export async function writeSpec(dir: string, name: string, source: string) {
  const path = join(dir, name);
  await writeFile(path, source);
  return path;
}
