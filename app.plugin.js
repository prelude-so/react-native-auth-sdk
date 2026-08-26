// Expo config plugin: Android setup for social (OAuth) login.
//
//   ["@prelude.so/react-native-auth-sdk", { "scheme": "myapp" }]
//
// Declares the redirect activity's intent-filter and adds the
// androidx.browser dependency its Custom Tab needs. iOS needs nothing —
// the system web session captures its own callback. Apps that skip
// social skip the plugin and pull none of it.
//
// `scheme` must match the `redirectUri` passed to `loginWithOAuth` /
// `initiateOAuthLogin` — `myapp://oauth-callback` means `myapp`. One
// entry registers one scheme.

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
} = require("expo/config-plugins");

const pkg = require("./package.json");

const REDIRECT_ACTIVITY = "so.prelude.android.auth.social.OAuthRedirectActivity";
const BROWSER = `androidx.browser:browser:${pkg.so_prelude.android_browser_version}`;
// Android matches `android:scheme` case-sensitively and lowercases the
// incoming URI, so an upper-case scheme silently never matches.
const VALID_SCHEME = /^[a-z][a-z0-9+.-]*$/;

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

// The native SDK references androidx.browser `compileOnly`, so the
// runtime copy comes from the app.
const withBrowserDependency = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("androidx.browser:browser")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /^dependencies\s*\{/m,
        (match) => `${match}\n    implementation("${BROWSER}")`,
      );
    }
    return cfg;
  });

const withPreludeAuth = (config, props) => {
  const scheme = props?.scheme;
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
  return withBrowserDependency(withRedirectIntentFilter(config, scheme));
};

module.exports = createRunOncePlugin(withPreludeAuth, pkg.name, pkg.version);
