// Passkey login, registration, and management. Every ceremony runs
// on the native side; JS only sees the resulting user or credential.

import Foundation

extension AuthBridge {
    func loginWithPasskey(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let user = try await client.loginWithPasskey(decodePasskeyLoginOptions(options))
        return Codec.encode(user: user)
    }

    func registerPasskey(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let result = try await client.registerPasskey(decodeRegisterPasskeyOptions(options))
        return Codec.encode(registration: result)
    }

    func listPasskeys(
        handle: String, configRaw: [String: Any]
    ) async throws -> [[String: Any]] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        return try await client.listPasskeys().map { Codec.encode(credential: $0) }
    }

    func renamePasskey(
        handle: String, configRaw: [String: Any], credentialID: String, nickname: String
    ) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.renamePasskey(credentialID, nickname: nickname)
    }

    func deletePasskey(
        handle: String, configRaw: [String: Any], credentialID: String
    ) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.deletePasskey(credentialID)
    }
}
