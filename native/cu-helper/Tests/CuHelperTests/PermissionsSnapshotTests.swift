import XCTest
@testable import echoflow_code_computer_use

final class PermissionsSnapshotTests: XCTestCase {
    func testSnapshotNeverUpgradesAnAuthoritativeScreenRecordingDenial() {
        let snapshot = Permissions.snapshot(
            accessibility: true,
            screenRecordingPreflight: false
        )

        XCTAssertEqual(snapshot["accessibility"]?.asBool, true)
        XCTAssertEqual(snapshot["screenRecording"]?.asBool, false)
    }

    func testSnapshotCarriesBothAuthoritativeGrants() {
        let snapshot = Permissions.snapshot(
            accessibility: true,
            screenRecordingPreflight: true
        )

        XCTAssertEqual(snapshot["accessibility"]?.asBool, true)
        XCTAssertEqual(snapshot["screenRecording"]?.asBool, true)
    }
}
