// Expo config plugin: native setup for social (OAuth) login and
// passkeys. Each feature is opt-in through its own prop, so apps that
// skip one pull none of its wiring.
//
//   ["@prelude.so/react-native-auth-sdk", {
//     "scheme": "myapp",                     // social login
//     "passkeyDomain": "auth.example.com"    // passkeys
//   }]
//
// `scheme` declares the OAuth redirect activity's intent-filter and
// adds the androidx.browser dependency its Custom Tab needs. It must
// match the `redirectUri` passed to `loginWithOAuth` /
// `initiateOAuthLogin` — `myapp://oauth-callback` means `myapp`. iOS
// needs nothing for social login.
//
// `passkeyDomain` is the relying-party host that serves
// `/.well-known/apple-app-site-association` and
// `/.well-known/assetlinks.json`. iOS gets the `webcredentials:`
// associated domain; Android gets the Credential Manager dependencies
// and the Digital Asset Links statement.

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withEntitlementsPlist,
  withStringsXml,
} = require("expo/config-plugins");

const pkg = require("./package.json");

const REDIRECT_ACTIVITY = "so.prelude.android.auth.social.OAuthRedirectActivity";
const BROWSER = `androidx.browser:browser:${pkg.so_prelude.android_browser_version}`;
const CREDENTIALS = `androidx.credentials:credentials:${pkg.so_prelude.android_credentials_version}`;
// Backs the Credential Manager below API 34.
const CREDENTIALS_PLAY_SERVICES = `androidx.credentials:credentials-play-services-auth:${pkg.so_prelude.android_credentials_version}`;
const ASSET_STATEMENTS = "asset_statements";
const ASSOCIATED_DOMAINS = "com.apple.developer.associated-domains";

// Android matches `android:scheme` case-sensitively and lowercases the
// incoming URI, so an upper-case scheme silently never matches.
const VALID_SCHEME = /^[a-z][a-z0-9+.-]*$/;
// A bare host, optionally with a port — no scheme, path, or wildcard.
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

const withRedirectIntentFilter = (config, scheme) =>
  withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults,
    );
    application.activity = application.activity ?? [];

    let activity = application.activity.find(
      (a) => a.$?.["android:name"] === REDIRECT_ACTIVITY,
    );
    if (!activity) {
      // Name only. The native SDK's manifest declares this activity
      // with its behavioral attributes; repeating any of them here
      // collides at manifest-merge time.
      activity = { $: { "android:name": REDIRECT_ACTIVITY } };
      application.activity.push(activity);
    }
    activity["intent-filter"] = [
      {
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
          { $: { "android:name": "android.intent.category.BROWSABLE" } },
        ],
        data: [{ $: { "android:scheme": scheme } }],
      },
    ];
    return cfg;
  });

// The native SDK references these `compileOnly`, so the runtime copy
// comes from the app.
const withAppDependencies = (config, coordinates) =>
  withAppBuildGradle(config, (cfg) => {
    const missing = coordinates.filter(
      (c) => !cfg.modResults.contents.includes(c.slice(0, c.lastIndexOf(":") + 1)),
    );
    if (missing.length > 0) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /^dependencies\s*\{/m,
        (match) =>
          [match, ...missing.map((c) => `    implementation("${c}")`)].join("\n"),
      );
    }
    return cfg;
  });

const withAssetStatements = (config, domain) => {
  config = withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [
        AndroidConfig.Resources.buildResourceItem({
          name: ASSET_STATEMENTS,
          value: `[{\\"include\\":\\"https://${domain}/.well-known/assetlinks.json\\"}]`,
          translatable: false,
        }),
      ],
      cfg.modResults,
    );
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults),
      ASSET_STATEMENTS,
      `@string/${ASSET_STATEMENTS}`,
      "resource",
    );
    return cfg;
  });
};

const withWebCredentials = (config, domain) =>
  withEntitlementsPlist(config, (cfg) => {
    const entry = `webcredentials:${domain}`;
    const domains = cfg.modResults[ASSOCIATED_DOMAINS] ?? [];
    if (!domains.includes(entry)) {
      cfg.modResults[ASSOCIATED_DOMAINS] = [...domains, entry];
    }
    return cfg;
  });

const withSocial = (config, scheme) => {
  if (typeof scheme !== "string" || !VALID_SCHEME.test(scheme)) {
    throw new Error(
      `${pkg.name}: "scheme" must be a lower-case URL scheme with no "://", ` +
        `e.g. { "scheme": "myapp" } for redirectUri "myapp://oauth-callback".`,
    );
  }
  if ([config.scheme].flat().includes(scheme)) {
    throw new Error(
      `${pkg.name}: "${scheme}" is already the app's own scheme. Pick a ` +
        `distinct one, or both activities match the callback.`,
    );
  }
  return withAppDependencies(withRedirectIntentFilter(config, scheme), [BROWSER]);
};

const withPasskeys = (config, domain) => {
  if (typeof domain !== "string" || !VALID_DOMAIN.test(domain)) {
    throw new Error(
      `${pkg.name}: "passkeyDomain" must be a bare host such as ` +
        `"auth.example.com" — no scheme or path.`,
    );
  }
  config = withWebCredentials(config, domain);
  config = withAssetStatements(config, domain);
  return withAppDependencies(config, [CREDENTIALS, CREDENTIALS_PLAY_SERVICES]);
};

const withPreludeAuth = (config, props) => {
  const { scheme, passkeyDomain } = props ?? {};
  if (scheme === undefined && passkeyDomain === undefined) {
    throw new Error(
      `${pkg.name}: pass "scheme" (social login), "passkeyDomain" ` +
        `(passkeys), or both.`,
    );
  }
  if (scheme !== undefined) config = withSocial(config, scheme);
  if (passkeyDomain !== undefined) config = withPasskeys(config, passkeyDomain);
  return config;
};

module.exports = createRunOncePlugin(withPreludeAuth, pkg.name, pkg.version);
