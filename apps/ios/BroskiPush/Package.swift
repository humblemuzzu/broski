// swift-tools-version: 6.2
// BroskiPush: minimal push-opening Rust library for the iOS notification service extension.
// Run scripts/build-ios-core.sh first; it writes BroskiPushFFI.xcframework and Sources/BroskiPush/Generated.

import PackageDescription

let package = Package(
    name: "BroskiPush",
    platforms: [.iOS(.v26), .macOS(.v15)],
    products: [
        .library(name: "BroskiPush", targets: ["BroskiPush"]),
    ],
    targets: [
        .binaryTarget(name: "BroskiPushFFI", path: "BroskiPushFFI.xcframework"),
        .target(name: "BroskiPush", dependencies: ["BroskiPushFFI"]),
    ]
)
