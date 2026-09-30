// Validate the actual installers referenced by electron-updater metadata.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const yaml = require("js-yaml");
const { version } = require("../package.json");

const platform = process.argv[2];
const targets = {
  mac: {
    metadata: "latest-mac.yml",
    required: [`VigilCLI-${version}-arm64.dmg`, `VigilCLI-${version}-arm64.dmg.blockmap`],
  },
  win: {
    metadata: "latest.yml",
    required: [`VigilCLI-Setup-${version}.exe`, `VigilCLI-Setup-${version}.exe.blockmap`],
  },
  linux: {
    metadata: "latest-linux.yml",
    required: [`VigilCLI-${version}.AppImage`, `vigil-cli_${version}_amd64.deb`],
  },
};

async function main() {
  const target = targets[platform];
  if (!target) throw new Error(`Unknown platform: ${platform}`);
  const dir = path.resolve(__dirname, "../dist");
  for (const name of [...target.required, target.metadata]) {
    if (!fs.statSync(path.join(dir, name)).isFile() || fs.statSync(path.join(dir, name)).size === 0) {
      throw new Error(`Missing or empty release artifact: ${name}`);
    }
  }
  const info = yaml.load(fs.readFileSync(path.join(dir, target.metadata), "utf8"));
  if (info.version !== version || !Array.isArray(info.files) || info.files.length === 0) {
    throw new Error(`Invalid release metadata: ${target.metadata}`);
  }
  for (const file of info.files) {
    if (typeof file.url !== "string" || path.basename(file.url) !== file.url) {
      throw new Error(`Unsafe artifact path in ${target.metadata}`);
    }
    const artifact = path.join(dir, file.url);
    const size = fs.statSync(artifact).size;
    if (size === 0 || (file.size !== undefined && file.size !== size)) {
      throw new Error(`Artifact size mismatch: ${file.url}`);
    }
    const hash = crypto.createHash("sha512");
    for await (const chunk of fs.createReadStream(artifact)) hash.update(chunk);
    if (hash.digest("base64") !== file.sha512) {
      throw new Error(`Artifact checksum mismatch: ${file.url}`);
    }
  }
  const installer = target.required[0];
  if (!info.files.some(file => file.url === installer)) {
    throw new Error(`${target.metadata} does not reference ${installer}`);
  }
  console.log(`Verified ${platform} ${version}: installers, metadata and SHA-512 checksums`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
