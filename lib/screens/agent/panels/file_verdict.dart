import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/config_inputs.dart';

/// How a call that read, wrote or deleted a file ended, in the words the
/// editor acts on: each refusal the contract names for a file is its own case
/// (`editable-file.ts`), so none is told as a generic failure.
sealed class FileVerdict {
  const FileVerdict();
}

/// The backend did it and answered with the file as it is now.
final class FileDone extends FileVerdict {
  const FileDone(this.file);

  final EditableFile file;
}

/// A call that did not do what was asked, with the bridge's own words.
sealed class FileRefusal extends FileVerdict {
  const FileRefusal(this.message);

  final String message;
}

/// The file changed since it was read (`stale`).
final class FileStale extends FileRefusal {
  const FileStale(super.message);
}

/// The text is not a valid file of its format (`invalid_input`).
final class FileInvalid extends FileRefusal {
  const FileInvalid(super.message);
}

/// The backend may not change this file (`unsupported`).
final class FileLocked extends FileRefusal {
  const FileLocked(super.message);
}

/// The file is not known (`not_found`).
final class FileMissing extends FileRefusal {
  const FileMissing(super.message);
}

/// Anything else: the bridge refused for another reason, or was not reached.
final class FileFailed extends FileRefusal {
  const FileFailed(super.message);
}

FileVerdict fileVerdictOf(Outcome<BackendOpResult> outcome) =>
    switch (outcome) {
      Done(:final value) => switch (fileOf(value)) {
        final file? => FileDone(file),
        null => const FileFailed('The Mac answered with something else.'),
      },
      Refused(:final rejection) => switch (rejection.code) {
        RejectionCode.stale => FileStale(rejection.message),
        RejectionCode.invalidInput => FileInvalid(rejection.message),
        RejectionCode.unsupported => FileLocked(rejection.message),
        RejectionCode.notFound => FileMissing(rejection.message),
        _ => FileFailed(rejection.message),
      },
      Unreached(:final failure) => FileFailed(failure.message),
    };
