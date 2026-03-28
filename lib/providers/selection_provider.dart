import 'package:broski/models/project.dart';
import 'package:broski/models/session.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Represents a selected model with provider and model IDs
class SelectedModel {
  const SelectedModel({required this.providerID, required this.modelID});

  final String providerID;
  final String modelID;

  /// Parse from "providerID/modelID" format
  factory SelectedModel.fromString(String modelString) {
    final parts = modelString.split('/');
    if (parts.length >= 2) {
      return SelectedModel(
        providerID: parts[0],
        modelID: parts.sublist(1).join('/'),
      );
    }
    return SelectedModel(providerID: 'anthropic', modelID: modelString);
  }

  String get displayString => '$providerID/$modelID';

  @override
  String toString() => displayString;
}

class SelectionState {
  const SelectionState({this.project, this.session, this.model});

  final ProjectSummary? project;
  final SessionSummary? session;
  final SelectedModel? model;

  SelectionState copyWith({
    ProjectSummary? project,
    SessionSummary? session,
    SelectedModel? model,
    bool clearModel = false,
  }) {
    return SelectionState(
      project: project ?? this.project,
      session: session ?? this.session,
      model: clearModel ? null : (model ?? this.model),
    );
  }
}

class SelectionNotifier extends StateNotifier<SelectionState> {
  SelectionNotifier() : super(const SelectionState());

  void selectProject(ProjectSummary project) {
    // Keep model selection when changing projects
    state = SelectionState(project: project, session: null, model: state.model);
  }

  void selectSession(SessionSummary session) {
    state = state.copyWith(session: session);
  }

  void selectModel(SelectedModel model) {
    state = state.copyWith(model: model);
  }

  void selectModelFromString(String modelString) {
    state = state.copyWith(model: SelectedModel.fromString(modelString));
  }

  void clear() {
    state = const SelectionState();
  }

  /// Clear project + session, but keep model selection.
  void clearProject() {
    state = SelectionState(model: state.model);
  }
}

final selectionProvider =
    StateNotifierProvider<SelectionNotifier, SelectionState>((ref) {
      return SelectionNotifier();
    });
