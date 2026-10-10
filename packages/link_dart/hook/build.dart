import 'package:broski_link/src/cargo_build.dart';
import 'package:hooks/hooks.dart';

const _crate = (
  path: '../link/ffi',
  libraryName: 'broski_link_ffi',
  assetName: 'src/bindings.dart',
);

void main(List<String> args) async {
  await build(args, (input, output) async {
    await buildRustLibrary(input: input, output: output, crate: _crate);
  });
}
