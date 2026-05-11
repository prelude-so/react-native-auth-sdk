// Password login + compliancy + change-password.

import Foundation

extension SessionBridge {
    func loginWithPassword(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let user = try await client.loginWithPassword(
            decodeLoginWithPasswordOptions(options)
        )
        return Codec.encode(user: user)
    }

    func passwordCompliancy(
        handle: String, configRaw: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        return Codec.encode(compliancy: try await client.passwordCompliancy())
    }

    func changePassword(
        handle: String, configRaw: [String: Any], newPassword: String
    ) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.changePassword(RedactedString(newPassword))
    }
}
