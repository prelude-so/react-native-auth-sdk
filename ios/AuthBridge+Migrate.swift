// Legacy-token migration.

import Foundation

extension AuthBridge {
    func migrate(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let user = try await client.migrate(decodeMigrateOptions(options))
        return Codec.encode(user: user)
    }
}
