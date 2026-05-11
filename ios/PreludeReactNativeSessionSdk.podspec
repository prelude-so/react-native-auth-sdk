require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PreludeReactNativeSessionSdk'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = <<-DESC
    #{package['description']} Ships as an Expo module; the JS surface is
    exposed via the `@prelude.so/react-native-session-sdk` npm package.
  DESC
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/prelude-so/react-native-session-sdk.git', tag: "v#{s.version}" }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # PreludeSession is vendored at install time by
  # `scripts/postinstall.js` (driven by `apple_session_sdk_tag` in
  # `package.json`) into `ios/sdk/PreludeSession/`.
  #
  # Source globs are kept narrow — only the bridge module at the pod
  # root and the vendored `sdk/PreludeSession/` tree. Earlier we used
  # `**/*.swift`, which dragged in `sdk/tmp/.../Tests/*.swift`
  # (XCTest imports → broken app build) when the postinstall left a
  # `tmp/` directory behind on a partial failure.
  s.source_files = [
    '*.swift',
    'sdk/PreludeSession/**/*.swift',
  ]

  # `Signals/PreludeSignalsAdapter.swift` imports the edge `Prelude`
  # SDK, which this pod doesn't vendor. The signals dispatcher
  # protocol stays in scope; only the adapter is excluded.
  s.exclude_files = [
    'sdk/PreludeSession/Signals/PreludeSignalsAdapter.swift',
    # Defence in depth — should never match given the narrowed
    # `source_files` above, but blocks anything dropped under these
    # directories from sneaking into the build.
    'sdk/**/Tests/**/*.swift',
    'sdk/tmp/**/*.swift',
  ]

  s.resource_bundles = {
    'PreludeReactNativeSessionSdk_privacy' => [
      'PrivacyInfo.xcprivacy',
    ],
  }

end
