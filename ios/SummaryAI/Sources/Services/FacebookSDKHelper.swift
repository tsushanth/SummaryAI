import Foundation
import AppTrackingTransparency
import FacebookCore

final class FacebookSDKHelper {
    static let shared = FacebookSDKHelper()

    private init() {}

    /// Configure Facebook SDK — call at app launch.
    /// Requires FacebookAppID, FacebookClientToken, FacebookDisplayName in Info.plist.
    func initialize() {
        ApplicationDelegate.shared.application(
            UIApplication.shared,
            didFinishLaunchingWithOptions: nil
        )
    }

    func requestTrackingPermission() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            ATTrackingManager.requestTrackingAuthorization { status in
                Settings.shared.isAdvertiserTrackingEnabled = (status == .authorized)
            }
        }
    }

    func logSubscription(price: Double, currency: String, productId: String) {
        let params: [AppEvents.ParameterName: Any] = [
            .contentID: productId,
            .currency: currency,
            .numItems: 1
        ]
        AppEvents.shared.logPurchase(amount: price, currency: currency, parameters: params)
        AppEvents.shared.logEvent(.subscribe, parameters: params)
    }

    func setAdvertiserTracking(enabled: Bool) {
        Settings.shared.isAdvertiserTrackingEnabled = enabled
    }

    func logTrialStarted(productId: String) {
        let params: [AppEvents.ParameterName: Any] = [
            .contentID: productId,
            .currency: "USD",
            .numItems: 1
        ]
        AppEvents.shared.logEvent(.startTrial, parameters: params)
    }
}
