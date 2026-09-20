import XCTest
@testable import echoflow_code_computer_use

final class TargetRoutingPolicyTests: XCTestCase {
    func testExplicitTargetAlwaysWinsOverCoordinateOwner() throws {
        XCTAssertEqual(try TargetRoutingPolicy.pid(explicit: 42, coordinateOwner: 99), 42)
    }

    func testMissingExplicitTargetFailsClosed() {
        XCTAssertThrowsError(try TargetRoutingPolicy.pid(explicit: nil, coordinateOwner: 99)) {
            XCTAssertEqual(($0 as? CUError)?.code, "no_target")
        }
    }
}
