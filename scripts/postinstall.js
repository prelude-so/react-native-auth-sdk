// Post-install: vendor the PreludeAuth Swift sources into
// `ios/sdk/` so the podspec can compile them into the bridge. Tag
// is pinned by `so_prelude.apple_auth_sdk_tag` in `package.json`.
//
// Two trees are vendored: the core `PreludeAuth` product and the
// `PreludeAuthSocial` product (OAuth web login). CocoaPods merges
// every vendored tree into one pod module, so the social tree's
// `import PreludeAuth` lines are stripped post-vendor — the types
// are already in scope.
//
// PreludeAuth ships as plain Swift sources (no XCFramework),
// so a single zip download is enough.
//
// Override the source location with `APPLE_AUTH_SDK_LOCATION`
// (HTTPS URL or local path) when iterating on PreludeAuth and
// the bridge in lockstep without cutting an apple-auth-sdk
// release between every change.

const fs = require("fs");
const child_process = require("node:child_process");
const path = require("path");
const { Readable } = require("stream");
const { finished } = require("stream/promises");

// Swift products vendored from the apple-auth-sdk archive, in
// `Sources/<name>` order. `PreludeAuth` is the core product;
// `PreludeAuthSocial` adds the OAuth web-login surface.
const VENDORED_PRODUCTS = ["PreludeAuth", "PreludeAuthSocial"];

// Trees whose `import <Module>` of a sibling Prelude product must be
// stripped: upstream they are separate SwiftPM modules, but the pod
// merges them into one module so the import won't resolve.
const SIBLING_IMPORTS = { PreludeAuthSocial: ["PreludeAuth"] };

async function main() {
  const packagePath = path.resolve(__dirname, "../package.json");
  const sdkPath = path.resolve(__dirname, "../ios/sdk");

  if (fs.existsSync(sdkPath)) {
    fs.rmSync(sdkPath, { recursive: true });
  }
  fs.mkdirSync(sdkPath);

  const packageFile = require(packagePath);
  const tag = packageFile.so_prelude.apple_auth_sdk_tag;
  // Monorepo dev affordance: when this package is consumed from its
  // in-repo source (a `file:` dep symlinks node_modules back here),
  // the sibling apple-auth-sdk checkout sits four levels up. Use it
  // so a plain `npm install` vendors the OAuth sources without an env
  // override. A published install resolves `__dirname` inside the
  // consumer's node_modules, where this path never exists, so it
  // falls through to the tagged GitHub archive.
  const monorepoLocal = path.resolve(__dirname, "../../../../apple/PreludeAuth");
  // apple-auth-sdk releases are tagged `vX.Y.Z`.
  const sources =
    process.env.APPLE_AUTH_SDK_LOCATION ||
    (fs.existsSync(path.join(monorepoLocal, "Sources", "PreludeAuth"))
      ? monorepoLocal
      : `https://github.com/prelude-so/apple-auth-sdk/archive/refs/tags/v${tag}.zip`);

  // Soft-fail when the apple-auth-sdk release isn't reachable yet
  // (e.g. during early scaffolding before the first tag is cut). A
  // hard throw would abort `npm install` for every consumer of this
  // package, including the bundled demo app — which only needs the
  // bridge stubs to build, not PreludeAuth itself. The cocoapods
  // build will fail later if real sources are required, with a
  // far clearer error.
  try {
    if (sources.startsWith("http")) {
      await fromUrl(sources, sdkPath, tag);
    } else {
      fromLocal(sources, sdkPath);
    }
    stripSiblingImports(sdkPath);
  } catch (e) {
    logWarning(
      `Skipping Apple Auth SDK vendoring: ${e.message}\n` +
        `iOS builds will fail to link PreludeAuth symbols until ` +
        `this succeeds. Re-run npm install on a network that can ` +
        `reach github.com, or set APPLE_AUTH_SDK_LOCATION to a ` +
        `local checkout.`,
    );
    writePlaceholder(sdkPath);
    return;
  }

  logSuccess("The Prelude Apple Auth SDK has been configured.");
}

/**
 * Drop a marker so the next install knows the directory is empty
 * by design (not by a half-completed extract). The podspec globs
 * `**\/*.swift` so an empty tree is harmless.
 */
function writePlaceholder(dest) {
  // A failed vendor can leave a partial tree (one product moved, the
  // next missing). Reset so the marker means "empty by design".
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of VENDORED_PRODUCTS) {
    const dir = path.join(dest, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "PLACEHOLDER.md"),
      `${name} sources are not vendored. The bridge stubs compile ` +
        "without them; wire up the real sources by setting " +
        "`APPLE_AUTH_SDK_LOCATION` or cutting an apple-auth-sdk " +
        "release matching the tag in package.json.\n",
    );
  }
}

async function fromUrl(url, dest, tag) {
  logMessage(`Downloading the Prelude Apple Auth SDK ${tag}.`);
  const zipPath = `${dest}/${tag}.zip`;
  // try/finally so a failure mid-extract still cleans up the staging
  // tmp/ dir. Otherwise the leftover tree (including Tests/*.swift)
  // gets swept into the build by the podspec's source_files glob and
  // breaks compilation with `Unable to resolve module 'XCTest'`.
  try {
    await downloadFile(url, zipPath);
    await unzip(zipPath, `${dest}/tmp`);
    fs.rmSync(zipPath, { force: true });
    const unzippedDir = fs.readdirSync(`${dest}/tmp`)[0];
    vendorProducts(`${dest}/tmp/${unzippedDir}/Sources`, dest);
  } finally {
    fs.rmSync(`${dest}/tmp`, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

function fromLocal(localPath, dest) {
  vendorProducts(path.join(localPath, "Sources"), dest, { copy: true });
}

/**
 * Move (or copy, for a local checkout we mustn't mutate) each
 * vendored product out of `sourcesDir` into `dest`. Every product is
 * required — a missing one means the archive / checkout is wrong, so
 * fail loudly rather than ship a half-linked pod.
 */
function vendorProducts(sourcesDir, dest, { copy = false } = {}) {
  for (const name of VENDORED_PRODUCTS) {
    const src = path.join(sourcesDir, name);
    if (!fs.existsSync(src)) {
      throw new Error(`Source tree does not contain Sources/${name}/ at ${src}.`);
    }
    const target = path.join(dest, name);
    if (copy) {
      fs.cpSync(src, target, { recursive: true });
    } else {
      fs.renameSync(src, target);
    }
  }
}

/**
 * Strip `import <SiblingModule>` lines from each tree listed in
 * `SIBLING_IMPORTS`. Idempotent: a tree already stripped is left
 * unchanged.
 */
function stripSiblingImports(dest) {
  for (const [name, modules] of Object.entries(SIBLING_IMPORTS)) {
    const dir = path.join(dest, name);
    if (!fs.existsSync(dir)) continue;
    const pattern = new RegExp(
      `^[ \\t]*import[ \\t]+(?:${modules.join("|")})[ \\t]*\\r?\\n`,
      "gm",
    );
    for (const file of swiftFiles(dir)) {
      const text = fs.readFileSync(file, "utf8");
      const patched = text.replace(pattern, "");
      if (patched !== text) fs.writeFileSync(file, patched);
    }
  }
}

// Iterative DFS so a pathologically deep tree can't overflow the
// stack. `withFileTypes` reports symlinks as non-directories, so
// symlinked subtrees are skipped and can't cycle.
function swiftFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".swift")) out.push(full);
    }
  }
  return out;
}

const downloadFile = async (url, fileName) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download Apple Auth SDK from ${url}: ${res.statusText}`,
    );
  }
  fs.rmSync(fileName, { force: true });
  const fileStream = fs.createWriteStream(fileName, { flags: "wx" });
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
};

async function unzip(fileName, destination) {
  await new Promise((resolve, reject) => {
    const p = child_process.spawn(
      "unzip",
      ["-q", fileName, "-d", destination],
      { stdio: "inherit" },
    );
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)),
    );
  });
}

function logMessage(msg) {
  console.log(msg);
}

function logSuccess(msg) {
  console.log(`\x1b[32m ${msg} \x1b[0m`);
}

function logWarning(msg) {
  console.warn(`\x1b[33m ${msg} \x1b[0m`);
}

(async () => {
  await main();
})();
