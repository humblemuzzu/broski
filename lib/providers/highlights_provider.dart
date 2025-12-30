import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/highlight_color.dart';
import 'service_providers.dart';

/// State for highlighted items (projects and sessions)
class HighlightsState {
  const HighlightsState({
    this.highlightedProjects = const {},
    this.highlightedSessions = const {},
    this.color = HighlightColor.amber,
    this.isLoading = true,
  });

  final Set<String> highlightedProjects;
  final Set<String> highlightedSessions;
  final HighlightColor color;
  final bool isLoading;

  HighlightsState copyWith({
    Set<String>? highlightedProjects,
    Set<String>? highlightedSessions,
    HighlightColor? color,
    bool? isLoading,
  }) {
    return HighlightsState(
      highlightedProjects: highlightedProjects ?? this.highlightedProjects,
      highlightedSessions: highlightedSessions ?? this.highlightedSessions,
      color: color ?? this.color,
      isLoading: isLoading ?? this.isLoading,
    );
  }

  bool isProjectHighlighted(String projectId) =>
      highlightedProjects.contains(projectId);

  bool isSessionHighlighted(String sessionId) =>
      highlightedSessions.contains(sessionId);
}

class HighlightsNotifier extends StateNotifier<HighlightsState> {
  HighlightsNotifier(this._ref) : super(const HighlightsState()) {
    _load();
  }

  final Ref _ref;

  Future<void> _load() async {
    final storage = _ref.read(storageServiceProvider);

    final projects = await storage.getHighlightedProjects();
    final sessions = await storage.getHighlightedSessions();
    final color = await storage.getHighlightColor();

    state = HighlightsState(
      highlightedProjects: projects,
      highlightedSessions: sessions,
      color: color,
      isLoading: false,
    );
  }

  /// Toggle highlight for a project
  Future<void> toggleProject(String projectId) async {
    final current = Set<String>.from(state.highlightedProjects);
    if (current.contains(projectId)) {
      current.remove(projectId);
    } else {
      current.add(projectId);
    }

    state = state.copyWith(highlightedProjects: current);

    final storage = _ref.read(storageServiceProvider);
    await storage.saveHighlightedProjects(current);
  }

  /// Toggle highlight for a session
  Future<void> toggleSession(String sessionId) async {
    final current = Set<String>.from(state.highlightedSessions);
    if (current.contains(sessionId)) {
      current.remove(sessionId);
    } else {
      current.add(sessionId);
    }

    state = state.copyWith(highlightedSessions: current);

    final storage = _ref.read(storageServiceProvider);
    await storage.saveHighlightedSessions(current);
  }

  /// Set the highlight color
  Future<void> setColor(HighlightColor color) async {
    state = state.copyWith(color: color);

    final storage = _ref.read(storageServiceProvider);
    await storage.saveHighlightColor(color);
  }

  /// Clear all highlights
  Future<void> clearAll() async {
    state = state.copyWith(highlightedProjects: {}, highlightedSessions: {});

    final storage = _ref.read(storageServiceProvider);
    await storage.saveHighlightedProjects({});
    await storage.saveHighlightedSessions({});
  }
}

final highlightsProvider =
    StateNotifierProvider<HighlightsNotifier, HighlightsState>((ref) {
      return HighlightsNotifier(ref);
    });

/// Convenience provider to check if a project is highlighted
final isProjectHighlightedProvider = Provider.family<bool, String>((
  ref,
  projectId,
) {
  return ref.watch(highlightsProvider).isProjectHighlighted(projectId);
});

/// Convenience provider to check if a session is highlighted
final isSessionHighlightedProvider = Provider.family<bool, String>((
  ref,
  sessionId,
) {
  return ref.watch(highlightsProvider).isSessionHighlighted(sessionId);
});

/// Convenience provider to get the current highlight color
final highlightColorProvider = Provider<HighlightColor>((ref) {
  return ref.watch(highlightsProvider).color;
});
