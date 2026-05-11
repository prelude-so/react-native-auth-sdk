// Refresh / logout / invalidate, list/revoke sessions, and the
// cached read-only session getters.

import Foundation

extension SessionBridge {
    // MARK: - Refresh / logout / invalidate

    func refresh(handle: String, configRaw: [String: Any]) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        return Codec.encode(user: try await client.refresh())
    }

    func logout(handle: String, configRaw: [String: Any]) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.logout()
    }

    func invalidateSession(handle: String, configRaw: [String: Any]) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.invalidateSession()
    }

    // MARK: - List / revoke sessions

    func listSessions(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let response = try await client.listSessions(decodeListSessionsOptions(options))
        return Codec.encode(listSessions: response)
    }

    func revokeSessions(
        handle: String, configRaw: [String: Any], target: [String: Any]
    ) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        try await client.revokeSessions(decodeRevokeTarget(target))
    }

    // MARK: - Cached readers

    func getProfile(handle: String, configRaw: [String: Any]) async throws -> [String: Any]? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        guard let profile = await client.profile else { return nil }
        return Codec.encode(profile: profile)
    }

    func getSessionID(handle: String, configRaw: [String: Any]) async throws -> String? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        return await client.sessionID
    }

    func getAccessToken(handle: String, configRaw: [String: Any]) async throws -> String? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        return await client.accessToken
    }

    func getAccessTokenExpiresAt(
        handle: String, configRaw: [String: Any]
    ) async throws -> Int? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        guard let date = await client.accessTokenExpiresAt else { return nil }
        return Int(date.timeIntervalSince1970)
    }
}
