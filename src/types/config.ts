import { EndpointJson } from "./endpoint";

/**
 * Snapshot of the `PreludeSessionClient` constructor args. Sent
 * alongside every call so the native plugin can lazily construct
 * the underlying client on first use without an explicit init step.
 *
 * `signalsKeyOverride` carries the optional Prelude signals SDK key
 * supplied at runtime — the native side falls back to the platform
 * manifest (`PreludeSDKKey` in `Info.plist` on iOS, `<meta-data
 * android:name="so.prelude.sdk_key">` in `AndroidManifest.xml` on
 * Android) when `null`.
 */
export interface ConfigJson {
  endpoint: EndpointJson;
  hostOverride: string | null;
  timeoutSeconds: number;
  allowInsecureTLS: boolean;
  signalsKeyOverride: string | null;
}
