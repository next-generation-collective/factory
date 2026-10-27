// Copies the factory into the Claude Code plugin, so the plugin runs it from its own files
// and updates with every push to GitHub, without waiting for npm. CI fails if the copy is stale.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "plugin", "server");
rmSync(server, { recursive: true, force: true });
for (const part of ["bin", "lib", "template", "package.json", "LICENSE"]) {
  cpSync(join(root, "cli", part), join(server, part), { recursive: true });
}
const version = JSON.parse(readFileSync(join(root, "cli", "package.json"), "utf8")).version;
const manifest = join(root, "plugin", ".claude-plugin", "plugin.json");
const plugin = JSON.parse(readFileSync(manifest, "utf8"));
plugin.version = version;
writeFileSync(manifest, `${JSON.stringify(plugin, null, 2)}\n`);
// The marketplace lists the same version, so Claude Code offers the update.
const listing = join(root, ".claude-plugin", "marketplace.json");
const marketplace = JSON.parse(readFileSync(listing, "utf8"));
for (const entry of marketplace.plugins) if (entry.name === plugin.name) entry.version = version;
writeFileSync(listing, `${JSON.stringify(marketplace, null, 2)}\n`);
console.log(`plugin/server synced with cli ${version}`);
