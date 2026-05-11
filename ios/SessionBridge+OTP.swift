// OTP login flow.

import Foundation

extension SessionBridge {
    func startOTPLogin(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.startOTPLogin(decodeStartOTPLoginOptions(options))
    }

    func resendOTP(handle: String, configRaw: [String: Any]) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.resendOTP()
    }

    func checkOTP(
        handle: String, configRaw: [String: Any], code: String
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        return Codec.encode(user: try await client.checkOTP(code))
    }
}
