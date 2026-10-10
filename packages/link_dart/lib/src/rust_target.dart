import 'dart:io';

import 'package:broski_link/src/rust_tools.dart';
import 'package:code_assets/code_assets.dart';
import 'package:path/path.dart' as p;

/// The Rust target triple that produces a library for [code].
String rustTripleFor(CodeConfig code) {
  return switch ((code.targetOS, code.targetArchitecture)) {
    (OS.iOS, Architecture.arm64) =>
      code.iOS.targetSdk == IOSSdk.iPhoneSimulator
          ? 'aarch64-apple-ios-sim'
          : 'aarch64-apple-ios',
    (OS.iOS, Architecture.x64) => 'x86_64-apple-ios',
    (OS.macOS, Architecture.arm64) => 'aarch64-apple-darwin',
    (OS.android, Architecture.arm64) => 'aarch64-linux-android',
    (OS.android, Architecture.arm) => 'armv7-linux-androideabi',
    (OS.android, Architecture.x64) => 'x86_64-linux-android',
    _ => throw UnsupportedError(
      'broski_link has no Rust target for ${code.targetOS.name} '
      '${code.targetArchitecture.name}. Supported: iOS arm64/x64 (device and '
      'simulator), macOS arm64, Android arm64-v8a/armeabi-v7a/x86_64.',
    ),
  };
}

/// Throws with the command that fixes it when rustup lacks [triple]'s std.
Future<void> requireRustTargetInstalled(String triple) async {
  final rustup = resolveRustTool('rustup');
  if (rustup == null) {
    return;
  }
  final result = await Process.run(rustup, ['target', 'list', '--installed']);
  final installed = (result.stdout as String).split('\n').map((l) => l.trim());
  if (result.exitCode == 0 && !installed.contains(triple)) {
    throw StateError(
      'The Rust target `$triple` is not installed.\n'
      'Run: rustup target add $triple',
    );
  }
}

/// Cargo environment overrides needed to link for [code]; empty for Apple OSes,
/// where rustc locates the SDK itself.
Map<String, String> rustLinkerEnvironment(CodeConfig code) {
  if (code.targetOS != OS.android) {
    return const <String, String>{};
  }
  final triple = rustTripleFor(code);
  final clang = code.cCompiler?.compiler;
  if (clang == null) {
    throw StateError(
      'No Android NDK toolchain was provided for $triple. Install the NDK '
      '(sdkmanager "ndk;<version>") and build again.',
    );
  }
  final linker = p.join(
    p.dirname(clang.toFilePath()),
    '${_ndkTriple(triple)}${code.android.targetNdkApi}-clang',
  );
  if (!File(linker).existsSync()) {
    throw StateError(
      'Android NDK linker `$linker` does not exist. The NDK provided by the '
      'SDK is missing the $triple clang wrapper.',
    );
  }
  return {
    'CARGO_TARGET_${triple.toUpperCase().replaceAll('-', '_')}_LINKER': linker,
  };
}

String _ndkTriple(String rustTriple) => switch (rustTriple) {
  'armv7-linux-androideabi' => 'armv7a-linux-androideabi',
  _ => rustTriple,
};
