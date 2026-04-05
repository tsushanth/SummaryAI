import XCTest

@MainActor
class ScreenshotTests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        setupSnapshot(app)
        app.launch()
    }

    func testScreenshots() {
        sleep(3)
        snapshot("01_Recordings")

        app.tabBars.buttons["Calendar"].tap()
        sleep(1)
        snapshot("02_Calendar")

        app.tabBars.buttons["Record"].tap()
        sleep(1)
        snapshot("03_Record")

        app.tabBars.buttons["Phone"].tap()
        sleep(1)
        snapshot("04_Phone")

        app.tabBars.buttons["Settings"].tap()
        sleep(1)
        snapshot("05_Settings")
    }
}
