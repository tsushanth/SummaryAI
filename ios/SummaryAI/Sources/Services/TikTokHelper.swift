import Foundation
import TikTokBusinessSDK

/// TikTok Business SDK integration for install attribution and event tracking.
final class TikTokHelper {
    static let shared = TikTokHelper()

    private let appId = "7610335763062292498"

    private init() {}

    /// Call once at app launch.
    func initialize() {
        guard let config = TikTokConfig(appId: appId, tiktokAppId: appId) else {
            print("[TikTok] Failed to create config")
            return
        }
        config.setLogLevel(TikTokLogLevelInfo)
        TikTokBusiness.initializeSdk(config)
        print("[TikTok] SDK initialized with appId: \(appId)")
    }

    /// Track a custom event.
    func trackEvent(_ name: String, properties: [String: Any] = [:]) {
        let event = TikTokBaseEvent(eventName: name)
        for (key, value) in properties {
            event.addProperty(withKey: key, value: value)
        }
        TikTokBusiness.trackTTEvent(event)
    }
}
