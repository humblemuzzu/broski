import 'dart:io';

import 'package:broski_link/src/rust_target.dart';
import 'package:broski_link/src/rust_tools.dart';
import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';
import 'package:path/path.dart' as p;

/// A Rust crate to compile, and the Dart file whose `@Native` declarations
/// resolve that crate's symbols.
typedef RustCrate = ({String path, String libraryName, String assetName});

/// Builds [crate] for the target described by [input] and emits its cdylib.
Future<void> buildRustLibrary({
  required BuildInput input,
  required BuildOutputBuilder output,
  required RustCrate crate,
}) async {
  if (!input.config.buildCodeAssets) {
    return;
  }
  final code = input.config.code;
  final triple = rustTripleFor(code);
  await requireRustTargetInstalled(triple);

  final crateDirectory = p.normalize(
    p.join(Directory.fromUri(input.packageRoot).path, crate.path),
  );
  final targetDirectory = p.join(input.outputDirectory.toFilePath(), 'cargo');
  await _runCargo(
    crateDirectory: crateDirectory,
    targetDirectory: targetDirectory,
    triple: triple,
    code: code,
  );

  final library = File(
    p.join(
      targetDirectory,
      triple,
      'release',
      code.targetOS.libraryFileName(crate.libraryName, DynamicLoadingBundled()),
    ),
  );
  if (!library.existsSync()) {
    throw StateError(
      'cargo did not produce ${library.path} for $triple. Does '
      '${crate.path}/Cargo.toml declare crate-type = ["staticlib", "cdylib"]?',
    );
  }

  output.dependencies.addAll(_crateFiles(crateDirectory));
  output.assets.code.add(
    CodeAsset(
      package: input.packageName,
      name: crate.assetName,
      linkMode: DynamicLoadingBundled(),
      file: library.uri,
    ),
  );
}

/// Compiles [crateDirectory] for [triple] into [targetDirectory].
Future<void> _runCargo({
  required String crateDirectory,
  required String targetDirectory,
  required String triple,
  required CodeConfig code,
}) async {
  final cargo = resolveRustTool('cargo');
  if (cargo == null) {
    throw StateError(
      'cargo was not found on PATH or in ~/.cargo/bin. Install Rust with '
      'https://rustup.rs and retry.',
    );
  }
  final result = await Process.run(
    cargo,
    [
      'build',
      '--release',
      '--target',
      triple,
      '--target-dir',
      targetDirectory,
      '--manifest-path',
      p.join(crateDirectory, 'Cargo.toml'),
    ],
    workingDirectory: crateDirectory,
    environment: rustLinkerEnvironment(code),
  );
  if (result.exitCode != 0) {
    throw StateError(
      'cargo build --target $triple failed (exit ${result.exitCode}):\n'
      '${result.stdout}${result.stderr}',
    );
  }
}

/// Every file cargo reads while building [crateDirectory], so the hook is
/// re-run when one of them changes. `target/` is cargo's own output.
List<Uri> _crateFiles(String crateDirectory) {
  final files = <Uri>[];
  for (final entity in Directory(crateDirectory).listSync()) {
    if (entity is Directory) {
      if (p.basename(entity.path) != 'target') {
        files.addAll(
          entity.listSync(recursive: true).whereType<File>().map((f) => f.uri),
        );
      }
    } else {
      files.add(entity.uri);
    }
  }
  return files;
}
