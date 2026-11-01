part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Permission / approval / question handlers (Wave 4).
/// Includes CC elicitation via backend_event.
/// Extracted from runtime_chat_ingest.dart.
extension _RuntimePermissionHandler on ChatSessionNotifier {
  // ---------------------------------------------------------------------------
  // Permission requested
  // ---------------------------------------------------------------------------

  void _handleRuntimePermissionRequested(
    RuntimePermissionRequestedEvent event,
  ) {
    final request = event.request;
    final requestId = request.requestId ?? '';
    if (requestId.isEmpty) return;

    // Dedup: skip if we already have a pending permission with this requestId
    if (state.permissions.any((p) => p.id == requestId)) return;

    // Determine session ID
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

    // AskUserQuestion: special permission that becomes a QuestionRequest
    if (request.kind == 'AskUserQuestion') {
      _handleCcAskUserQuestion(event, sessionId);
      return;
    }

    // Build standard PermissionRequest
    final metadata = <String, dynamic>{};
    if (request.metadata != null) {
      metadata.addAll(request.metadata!);
    }

    final permission = PermissionRequest(
      id: requestId,
      sessionId: sessionId,
      title: request.title ?? 'Permission required',
      permission: request.kind,
      metadata: metadata,
    );

    state = state.copyWith(permissions: [permission, ...state.permissions]);
  }

  // ---------------------------------------------------------------------------
  // CC AskUserQuestion → QuestionRequest
  // ---------------------------------------------------------------------------

  void _handleCcAskUserQuestion(
    RuntimePermissionRequestedEvent event,
    String sessionId,
  ) {
    final request = event.request;
    final metadata = request.metadata ?? <String, dynamic>{};

    final input = metadata['input'];
    final inputMap = input is Map<String, dynamic>
        ? input
        : input is Map
        ? input.cast<String, dynamic>()
        : <String, dynamic>{};

    final rawQuestions = inputMap['questions'];
    final parsedQuestions = <QuestionInfo>[];

    if (rawQuestions is List) {
      for (final q in rawQuestions) {
        final raw = q is Map<String, dynamic>
            ? q
            : q is Map
            ? q.cast<String, dynamic>()
            : null;
        if (raw == null) continue;

        final questionText = (raw['question'] as String?)?.trim() ?? '';
        if (questionText.isEmpty) continue;

        final rawOptions = raw['options'];
        final options = <QuestionOption>[];
        if (rawOptions is List) {
          for (final o in rawOptions) {
            final optionMap = o is Map<String, dynamic>
                ? o
                : o is Map
                ? o.cast<String, dynamic>()
                : null;
            if (optionMap == null) continue;
            options.add(
              QuestionOption(
                label: optionMap['label'] as String? ?? '',
                description: optionMap['description'] as String? ?? '',
              ),
            );
          }
        }

        final header = (raw['header'] as String?)?.trim() ?? '';
        parsedQuestions.add(
          QuestionInfo(
            question: questionText,
            header: header.isNotEmpty ? header : questionText,
            options: options,
            multiple: raw['multiSelect'] == true || raw['multiple'] == true,
            custom: raw['custom'] as bool? ?? true,
          ),
        );
      }
    }

    // Dedup: skip if we already have a pending question with this requestId
    if (state.pendingQuestion?.id == (request.requestId ?? '')) return;

    if (parsedQuestions.isNotEmpty) {
      state = state.copyWith(
        pendingQuestion: QuestionRequest(
          id: request.requestId ?? '',
          sessionId: sessionId,
          questions: parsedQuestions,
        ),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // CC elicitation via backend_event (NOT permission_requested)
  // ---------------------------------------------------------------------------

  void _handleCcElicitationRequestBackend(
    String sessionId,
    Map<String, dynamic> payload,
    int timestampMs,
  ) {
    final mcpServerName = payload['mcpServerName'] as String? ?? '';
    final url = payload['url'] as String?;
    final message = payload['message'] as String? ?? '';
    final requestId = (payload['requestId'] as String? ?? '').isNotEmpty
        ? payload['requestId'] as String
        : 'cc-elicitation-$timestampMs';
    final mode = payload['mode'] as String?;
    final elicitationId = payload['elicitationId'] as String?;

    final title = mcpServerName.isNotEmpty
        ? 'MCP auth: $mcpServerName'
        : 'MCP authentication required';
    final command = url ?? message;

    final permissionRequest = PermissionRequest(
      id: requestId,
      sessionId: sessionId,
      title: title,
      permission: 'mcp_auth',
      command: command,
      metadata: {
        'tool': 'mcp_elicitation',
        'input': {
          'message': message,
          if (mode != null) 'mode': mode,
          if (url != null) 'url': url,
          if (elicitationId != null) 'elicitationId': elicitationId,
          if (payload['requestedSchema'] != null)
            'requestedSchema': payload['requestedSchema'],
        },
        'description': message,
        'ccElicitationRequestId': requestId,
        'ccElicitationMode': mode,
        if (url != null) 'ccElicitationUrl': url,
        'ccElicitationServer': mcpServerName,
      },
    );

    state = state.copyWith(
      permissions: [permissionRequest, ...state.permissions],
    );

    _addMessage(
      ChatMessage(
        id: 'cc-elicitation-$requestId',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: DateTime.fromMillisecondsSinceEpoch(timestampMs),
        text: message,
        variant: 'cc-elicitation-request',
      ),
    );
  }

  void _handleCcElicitationCompleteBackend(
    String sessionId,
    Map<String, dynamic> payload,
    int timestampMs,
  ) {
    final mcpServerName = payload['mcpServerName'] as String? ?? '';
    final serverName = mcpServerName.isNotEmpty ? mcpServerName : 'MCP server';
    final elicitationId = payload['elicitationId'] as String? ?? '';

    final remainingPermissions = state.permissions.where((permission) {
      final metadata = permission.metadata;
      final rawInput = metadata['input'];
      final pendingServer = metadata['ccElicitationServer'] as String?;
      String? pendingElicitationId;
      if (rawInput is Map<String, dynamic>) {
        pendingElicitationId = rawInput['elicitationId'] as String?;
      } else if (rawInput is Map) {
        final value = rawInput['elicitationId'];
        pendingElicitationId = value is String ? value : null;
      }

      if (elicitationId.isNotEmpty && pendingElicitationId == elicitationId) {
        return false;
      }
      if (elicitationId.isEmpty &&
          mcpServerName.isNotEmpty &&
          pendingServer == mcpServerName) {
        return false;
      }
      return true;
    }).toList();

    if (remainingPermissions.length != state.permissions.length) {
      state = state.copyWith(permissions: remainingPermissions);
    }

    _addMessage(
      ChatMessage(
        id: 'cc-elicitation-complete-$timestampMs',
        sessionId: state.ccSessionId ?? sessionId,
        role: MessageRole.system,
        createdAt: DateTime.fromMillisecondsSinceEpoch(timestampMs),
        text: '✅ $serverName authentication completed',
        variant: 'cc-elicitation-complete',
      ),
    );
  }
}
