import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/artifact.dart';
import '../services/bridge_service.dart';
import 'service_providers.dart';

class ArtifactsState {
  const ArtifactsState({
    this.query = '',
    this.filters = const ArtifactSearchFilters(),
    this.results = const [],
    this.total = 0,
    this.isSearching = false,
    this.error,
  });

  final String query;
  final ArtifactSearchFilters filters;
  final List<ArtifactSummary> results;
  final int total;
  final bool isSearching;
  final String? error;

  ArtifactsState copyWith({
    String? query,
    ArtifactSearchFilters? filters,
    List<ArtifactSummary>? results,
    int? total,
    bool? isSearching,
    String? error,
  }) {
    return ArtifactsState(
      query: query ?? this.query,
      filters: filters ?? this.filters,
      results: results ?? this.results,
      total: total ?? this.total,
      isSearching: isSearching ?? this.isSearching,
      error: error,
    );
  }
}

class ArtifactsNotifier extends StateNotifier<ArtifactsState> {
  ArtifactsNotifier(this._bridge) : super(const ArtifactsState());

  final BridgeService _bridge;
  Timer? _debounce;
  int _searchToken = 0;

  void setQuery(String query) {
    _debounce?.cancel();
    state = state.copyWith(query: query, isSearching: true, error: null);

    final token = ++_searchToken;
    final debounceMs = query.trim().isEmpty ? 60 : 160;

    _debounce = Timer(Duration(milliseconds: debounceMs), () async {
      await _runSearch(token: token);
    });
  }

  void setBackend(String? backend) {
    final next = ArtifactSearchFilters(
      backend: backend,
      projectPath: state.filters.projectPath,
      language: state.filters.language,
      fileType: state.filters.fileType,
      starred: state.filters.starred,
    );
    state = state.copyWith(filters: next, isSearching: true, error: null);
    final token = ++_searchToken;
    _debounce?.cancel();
    unawaited(_runSearch(token: token));
  }

  void setProjectPath(String? projectPath) {
    final next = ArtifactSearchFilters(
      backend: state.filters.backend,
      projectPath: projectPath,
      language: state.filters.language,
      fileType: state.filters.fileType,
      starred: state.filters.starred,
    );
    state = state.copyWith(filters: next, isSearching: true, error: null);
    final token = ++_searchToken;
    _debounce?.cancel();
    unawaited(_runSearch(token: token));
  }

  void setStarredOnly(bool? starredOnly) {
    final next = ArtifactSearchFilters(
      backend: state.filters.backend,
      projectPath: state.filters.projectPath,
      language: state.filters.language,
      fileType: state.filters.fileType,
      starred: starredOnly,
    );
    state = state.copyWith(filters: next, isSearching: true, error: null);
    final token = ++_searchToken;
    _debounce?.cancel();
    unawaited(_runSearch(token: token));
  }

  Future<void> refresh() async {
    final token = ++_searchToken;
    _debounce?.cancel();
    state = state.copyWith(isSearching: true, error: null);
    await _runSearch(token: token);
  }

  Future<void> _runSearch({required int token}) async {
    try {
      final result = await _bridge.searchArtifacts(
        text: state.query.trim().isEmpty ? null : state.query.trim(),
        filters: state.filters,
      );
      if (token != _searchToken) return;
      state = state.copyWith(
        results: result.artifacts,
        total: result.total,
        isSearching: false,
        error: null,
      );
    } catch (e) {
      if (token != _searchToken) return;
      state = state.copyWith(
        results: const [],
        total: 0,
        isSearching: false,
        error: e.toString(),
      );
    }
  }

  Future<void> toggleStar(ArtifactSummary artifact) async {
    final ok = await _bridge.updateArtifact(
      id: artifact.id,
      starred: !artifact.starred,
    );
    if (!ok) return;

    state = state.copyWith(
      results: [
        for (final item in state.results)
          if (item.id == artifact.id)
            item.copyWith(starred: !item.starred)
          else
            item,
      ],
    );
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }
}

final artifactsProvider =
    StateNotifierProvider<ArtifactsNotifier, ArtifactsState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ArtifactsNotifier(bridge);
    });
