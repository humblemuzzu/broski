/// Metadata keys for a Pi `!` shell-command card in the transcript.
abstract final class PiBashCardKeys {
  static const marker = 'piBashCommand';
  static const command = 'command';
  static const excludeFromContext = 'excludeFromContext';
  static const status = 'status';
  static const output = 'output';
  static const exitCode = 'exitCode';
  static const cancelled = 'cancelled';
  static const truncated = 'truncated';
  static const error = 'error';
}

abstract final class PiBashStatus {
  static const running = 'running';
  static const finished = 'finished';
}

bool isPiBashCard(Map<String, dynamic> metadata) =>
    metadata[PiBashCardKeys.marker] == true;

Map<String, dynamic> piBashRunningMetadata({
  required String command,
  required bool excludeFromContext,
}) => {
  PiBashCardKeys.marker: true,
  PiBashCardKeys.command: command,
  PiBashCardKeys.excludeFromContext: excludeFromContext,
  PiBashCardKeys.status: PiBashStatus.running,
};

Map<String, dynamic> piBashFinishedMetadata({
  required String command,
  required bool excludeFromContext,
  required String output,
  int? exitCode,
  bool cancelled = false,
  bool truncated = false,
  String? error,
}) => {
  ...piBashRunningMetadata(
    command: command,
    excludeFromContext: excludeFromContext,
  ),
  PiBashCardKeys.status: PiBashStatus.finished,
  PiBashCardKeys.output: output,
  if (exitCode != null) PiBashCardKeys.exitCode: exitCode,
  PiBashCardKeys.cancelled: cancelled,
  PiBashCardKeys.truncated: truncated,
  if (error != null) PiBashCardKeys.error: error,
};

/// Maps a `bashExecution` transcript entry from the bridge to card metadata.
Map<String, dynamic> piBashTranscriptMetadata(Map<String, dynamic> item) =>
    piBashFinishedMetadata(
      command: item['command'] as String? ?? '',
      excludeFromContext: item['excludeFromContext'] as bool? ?? false,
      output: item['output'] as String? ?? '',
      exitCode: (item['exitCode'] as num?)?.toInt(),
      cancelled: item['cancelled'] as bool? ?? false,
      truncated: item['truncated'] as bool? ?? false,
    );

/// Render-ready view of a `!` command card.
///
/// While running, [output] is the live streamed buffer passed to
/// [PiBashCardState.fromMetadata]; once finished it is the result output.
class PiBashCardState {
  const PiBashCardState({
    required this.command,
    required this.excludeFromContext,
    required this.isRunning,
    required this.output,
    this.exitCode,
    this.cancelled = false,
    this.truncated = false,
    this.error,
  });

  factory PiBashCardState.fromMetadata(
    Map<String, dynamic> metadata, {
    String liveOutput = '',
  }) {
    final isRunning = metadata[PiBashCardKeys.status] != PiBashStatus.finished;
    return PiBashCardState(
      command: metadata[PiBashCardKeys.command] as String? ?? '',
      excludeFromContext:
          metadata[PiBashCardKeys.excludeFromContext] as bool? ?? false,
      isRunning: isRunning,
      output: isRunning
          ? liveOutput
          : metadata[PiBashCardKeys.output] as String? ?? liveOutput,
      exitCode: (metadata[PiBashCardKeys.exitCode] as num?)?.toInt(),
      cancelled: metadata[PiBashCardKeys.cancelled] as bool? ?? false,
      truncated: metadata[PiBashCardKeys.truncated] as bool? ?? false,
      error: metadata[PiBashCardKeys.error] as String?,
    );
  }

  final String command;
  final bool excludeFromContext;
  final bool isRunning;
  final String output;
  final int? exitCode;
  final bool cancelled;
  final bool truncated;
  final String? error;

  bool get hasOutput => output.trim().isNotEmpty;

  bool get isSuccess =>
      !isRunning && !cancelled && error == null && exitCode == 0;
}
