// Post-install: vendor the PreludeSession Swift sources into
// `ios/sdk/PreludeSession/` so the podspec can compile them
// into the bridge. Tag is pinned by `so_prelude.apple_session_sdk_tag`
// in `package.json`.
//
// Mirrors the Flutter session SDK's vendoring step. Unlike the
// signals SDK, PreludeSession ships as plain Swift sources (no
// XCFramework), so a single zip download is enough.
//
// Override the source location with `APPLE_SESSION_SDK_LOCATION`
// (HTTPS URL or local path) when iterating on PreludeSession and
// the bridge in lockstep without cutting an apple-session-sdk
// release between every change.

const fs = require("fs");
const child_process = require("node:child_process");
const path = require("path");
const { Readable } = require("stream");
const { finished } = require("stream/promises");

async function main() {
  const packagePath = path.resolve(__dirname, "../package.json");
  const sdkPath = path.resolve(__dirname, "../ios/sdk");

  if (fs.existsSync(sdkPath)) {
    fs.rmSync(sdkPath, { recursive: true });
  }
  fs.mkdirSync(sdkPath);

  const packageFile = require(packagePath);
  const tag = packageFile.so_prelude.apple_session_sdk_tag;
  // apple-session-sdk releases are tagged `vX.Y.Z` — keep parity
  // with the Flutter session SDK's podspec.
  const sources =
    process.env.APPLE_SESSION_SDK_LOCATION ||
    `https://github.com/prelude-so/apple-session-sdk/archive/refs/tags/v${tag}.zip`;

  // Soft-fail when the apple-session-sdk release isn't reachable yet
  // (e.g. during early scaffolding before the first tag is cut). A
  // hard throw would abort `npm install` for every consumer of this
  // package, including the bundled demo app — which only needs the
  // bridge stubs to build, not PreludeSession itself. The cocoapods
  // build will fail later if real sources are required, with a
  // far clearer error.
  try {
    if (sources.startsWith("http")) {
      await fromUrl(sources, sdkPath, tag);
    } else {
      fromLocal(sources, sdkPath);
    }
  } catch (e) {
    logWarning(
      `Skipping Apple Session SDK vendoring: ${e.message}\n` +
        `iOS builds will fail to link PreludeSession symbols until ` +
        `this succeeds. Re-run npm install on a network that can ` +
        `reach github.com, or set APPLE_SESSION_SDK_LOCATION to a ` +
        `local checkout.`,
    );
    writePlaceholder(sdkPath);
    return;
  }

  logSuccess("The Prelude Apple Session SDK has been configured.");
}

/**
 * Drop a marker so the next install knows the directory is empty
 * by design (not by a half-completed extract). The podspec globs
 * `**\/*.swift` so an empty PreludeSession dir is harmless.
 */
function writePlaceholder(dest) {
  const dir = path.join(dest, "PreludeSession");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "PLACEHOLDER.md"),
    "PreludeSession sources are not vendored. The bridge stubs " +
      "compile without them; wire up the real sources by setting " +
      "`APPLE_SESSION_SDK_LOCATION` or cutting an apple-session-sdk " +
      "release matching the tag in package.json.\n",
  );
}

async function fromUrl(url, dest, tag) {
  logMessage(`Downloading the Prelude Apple Session SDK ${tag}.`);
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
    const preludeSessionSrc = `${dest}/tmp/${unzippedDir}/Sources/PreludeSession`;
    if (!fs.existsSync(preludeSessionSrc)) {
      throw new Error(
        `Extracted archive does not contain Sources/PreludeSession/ at ${preludeSessionSrc}.`,
      );
    }
    fs.renameSync(preludeSessionSrc, `${dest}/PreludeSession`);
  } finally {
    fs.rmSync(`${dest}/tmp`, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

function fromLocal(localPath, dest) {
  const preludeSessionSrc = path.join(localPath, "Sources", "PreludeSession");
  if (!fs.existsSync(preludeSessionSrc)) {
    throw new Error(
      `APPLE_SESSION_SDK_LOCATION=${localPath} does not look like a ` +
        `PreludeSession Swift package (missing Sources/PreludeSession/).`,
    );
  }
  fs.cpSync(preludeSessionSrc, `${dest}/PreludeSession`, { recursive: true });
}

const downloadFile = async (url, fileName) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download Apple Session SDK from ${url}: ${res.statusText}`,
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
