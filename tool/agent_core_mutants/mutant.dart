/// One change to one guard of the app core, or of what opens its screens.
/// [find] must occur exactly once in [file] (a path under `lib/`).
final class Mutant {
  const Mutant(this.name, this.find, this.replace, {this.equivalent})
    : file = '';

  const Mutant._(
    this.file,
    this.name,
    this.find,
    this.replace,
    this.equivalent,
  );

  final String file;
  final String name;
  final String find;
  final String replace;

  /// Why the mutant changes nothing a test can see; set only for one that is
  /// expected to survive.
  final String? equivalent;

  Mutant inFile(String path) => Mutant._(path, name, find, replace, equivalent);
}

/// The mutants of one file under `lib/agent/`, written once per file.
List<Mutant> mutantsOf(String file, List<Mutant> mutants) =>
    appMutantsOf('agent/$file', mutants);

/// The mutants of one file elsewhere under `lib/`.
List<Mutant> appMutantsOf(String file, List<Mutant> mutants) => [
  for (final mutant in mutants) mutant.inFile(file),
];
