// swift-tools-version: 6.2
// BroskiCore: the shared Rust core for the iOS app and its notification service extension.
// Run scripts/build-ios-core.sh first; it writes BroskiCoreFFI.xcframework and Sources/BroskiCore/Generated.

import PackageDescription

let package = Package(
    name: "BroskiCore",
    platforms: [.iOS(.v26), .macOS(.v15)],
    products: [
        .library(name: "BroskiCore", targets: ["BroskiCore"]),
    ],
    targets: [
        .binaryTarget(name: "BroskiCoreFFI", path: "BroskiCoreFFI.xcframework"),
        .target(name: "BroskiCore", dependencies: ["BroskiCoreFFI"]),
        .testTarget(name: "BroskiCoreTests", dependencies: ["BroskiCore"]),
    ]
)
