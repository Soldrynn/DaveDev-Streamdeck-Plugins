import { rm } from "node:fs/promises";

for (const path of [
  "com.davedev.fivedeck.sdPlugin/bin",
  "com.davedev.fivedeck.sdPlugin/LICENSE",
  "com.davedev.fivedeck.sdPlugin/NOTICE",
  "com.davedev.fivedeck.sdPlugin/THIRD_PARTY_NOTICES.md",
  "dist"
]) {
  await rm(path, { recursive: true, force: true });
}
