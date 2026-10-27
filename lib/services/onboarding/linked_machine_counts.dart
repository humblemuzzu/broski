/// One backend's answer to "what is on this machine": its project paths, how
/// many sessions it reported and how many agents, or the reason it failed.
final class BackendRead {
  const BackendRead({
    required this.name,
    this.projectPaths = const <String>[],
    this.sessions = 0,
    this.agents = 0,
    this.failure,
  });

  final String name;
  final List<String> projectPaths;
  final int sessions;
  final int agents;
  final String? failure;

  bool get failed => failure != null;
}

/// What the "connected" screen counted, and what it could not read.
///
/// A backend that failed is named in [failures] and adds nothing: the card shows
/// the reason, so a zero is never read as "this machine has nothing".
final class LinkedMachineCounts {
  const LinkedMachineCounts({
    required this.projects,
    required this.sessions,
    required this.agents,
    required this.failures,
  });

  static const empty = LinkedMachineCounts(
    projects: 0,
    sessions: 0,
    agents: 0,
    failures: <String>[],
  );

  final int projects;
  final int sessions;
  final int agents;
  final List<String> failures;

  /// Paths are deduplicated across backends; counts add up.
  factory LinkedMachineCounts.combine(Iterable<BackendRead> reads) {
    final paths = <String>{};
    var sessions = 0;
    var agents = 0;
    final failures = <String>[];
    for (final read in reads) {
      final failure = read.failure;
      if (failure != null) {
        failures.add('${read.name}: $failure');
        continue;
      }
      paths.addAll(read.projectPaths);
      sessions += read.sessions;
      agents += read.agents;
    }
    return LinkedMachineCounts(
      projects: paths.length,
      sessions: sessions,
      agents: agents,
      failures: List.unmodifiable(failures),
    );
  }
}
