import 'dart:async';

import 'package:broski/models/file_attachment.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class FileSearchState {
  const FileSearchState({
    this.query = '',
    this.results = const [],
    this.isSearching = false,
    this.selectedIndex = 0,
  });

  final String query;
  final List<String> results;
  final bool isSearching;
  final int selectedIndex;

  FileSearchState copyWith({
    String? query,
    List<String>? results,
    bool? isSearching,
    int? selectedIndex,
  }) {
    return FileSearchState(
      query: query ?? this.query,
      results: results ?? this.results,
      isSearching: isSearching ?? this.isSearching,
      selectedIndex: selectedIndex ?? this.selectedIndex,
    );
  }
}

class FileSearchNotifier extends StateNotifier<FileSearchState> {
  FileSearchNotifier(this._bridge) : super(const FileSearchState());

  final BridgeService _bridge;
  Timer? _debounce;
  String? _projectPath;

  void setProjectPath(String? projectPath) {
    _projectPath = projectPath;
  }

  void search(String query) {
    _debounce?.cancel();

    state = state.copyWith(query: query, isSearching: true, selectedIndex: 0);

    // Shorter debounce for empty query (initial @ trigger) for snappy UX
    final debounceMs = query.isEmpty ? 50 : 150;

    _debounce = Timer(Duration(milliseconds: debounceMs), () async {
      try {
        final results = await _bridge.searchFilesAndDirs(
          query,
          projectPath: _projectPath,
        );
        if (state.query == query) {
          state = state.copyWith(results: results, isSearching: false);
        }
      } catch (_) {
        if (state.query == query) {
          state = state.copyWith(results: [], isSearching: false);
        }
      }
    });
  }

  void selectNext() {
    if (state.results.isEmpty) return;
    final next = (state.selectedIndex + 1) % state.results.length;
    state = state.copyWith(selectedIndex: next);
  }

  void selectPrevious() {
    if (state.results.isEmpty) return;
    final prev = state.selectedIndex == 0
        ? state.results.length - 1
        : state.selectedIndex - 1;
    state = state.copyWith(selectedIndex: prev);
  }

  FileAttachment? getSelectedAttachment() {
    if (state.results.isEmpty) return null;
    if (state.selectedIndex >= state.results.length) return null;
    final path = state.results[state.selectedIndex];
    return FileAttachment.fromPath(path);
  }

  void clear() {
    _debounce?.cancel();
    state = const FileSearchState();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }
}

final fileSearchProvider =
    StateNotifierProvider<FileSearchNotifier, FileSearchState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return FileSearchNotifier(bridge);
    });
