part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Permission / approval / question handlers (Wave 4).
/// Includes CC elicitation via backend_event.
/// Extracted from runtime_chat_ingest.dart.
extension _RuntimePermissionHandler on ChatSessionNotifier {
  // ---------------------------------------------------------------------------
  // Permission requested (unified across agents)
  // ---------------------------------------------------------------------------

  void _handleRuntimePermissionRequested(
    RuntimePermissionRequestedEvent event,
  ) {
    final request = event.request;
    final requestId = request.requestId ?? '';
    if (requestId.isEmpty) return;

    // Determine session ID
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

    // CC AskUserQuestion: special permission that becomes a QuestionRequest
    if (event.backend == AgentType.claudeCode &&
        request.kind == 'AskUserQuestion') {
      _handleCcAskUserQuestion(event, sessionId);
      return;
    }

    // Build standard PermissionRequest
    final metadata = <String, dynamic>{};
    if (request.metadata != null) {
      metadata.addAll(request.metadata!);
    }

    // For CX, extract structured approval data from metadata
    String? command;
    String title = request.title ?? 'Permission required';
    if (event.backend == AgentType.codex) {
      command = _extractCxApprovalCommand(metadata);
      // Use buildCodexApprovalTitle for CX approval requests
      final method = metadata['method']?.toString() ?? request.kind ?? '';
      if (method.contains('requestApproval')) {
        title = buildCodexApprovalTitle(
          method: method,
          reason: metadata['reason'],
          grantRoot: metadata['grantRoot'],
          networkApprovalContext: metadata['networkApprovalContext'],
        );
      }
    }

    // For OC, extract additional fields
    ToolReference? tool;
    List<String> patterns = const [];
    List<String> always = const [];
    if (event.backend == AgentType.opencode) {
      final toolData = metadata['tool'] as Map<String, dynamic>?;
      tool = toolData != null ? ToolReference.fromJson(toolData) : null;
      patterns = (metadata['patterns'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [];
      always = (metadata['always'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [];
      command ??= metadata['metadata'] is Map<String, dynamic>
          ? (metadata['metadata'] as Map<String, dynamic>)['command']
              as String?
          : null;
    }

    final permission = PermissionRequest(
      id: requestId,
      sessionId: sessionId,
      title: title,
      command: command,
      permission: event.backend == AgentType.opencode
          ? metadata['permission'] as String?
          : request.kind,
      patterns: patterns,
      always: always,
      tool: tool,
      metadata: event.backend == AgentType.opencode
          ? (metadata['metadata'] as Map<String, dynamic>? ?? metadata)
          : metadata,
    );

    state = state.copyWith(permissions: [permission, ...state.permissions]);
  }

  String? _extractCxApprovalCommand(Map<String, dynamic> metadata) {
    final cachedItem = metadata['cachedItem'];
    if (cachedItem is Map<String, dynamic>) {
      if (cachedItem['type'] == 'commandExecution') {
        return cachedItem['command'] as String?;
      }
    }
    return metadata['command'] as String? ??
        metadata['approvalCommand'] as String?;
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
  // User input requested (CX + OC)
  // ---------------------------------------------------------------------------

  void _handleRuntimeUserInputRequested(
    RuntimeUserInputRequestedEvent event,
  ) {
    final request = event.request;
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

    if (event.backend == AgentType.codex) {
      // CX user input → set cxPendingUserInput
      final requestId = request.requestId ?? '';
      if (requestId.isEmpty) return;
      final metadata = request.metadata ?? <String, dynamic>{};
      final cxRequest = CodexUserInputRequest.fromJson(
        requestId,
        sessionId,
        metadata,
      );
      state = state.copyWith(cxPendingUserInput: cxRequest);
      return;
    }

    if (event.backend == AgentType.opencode) {
      // OC question → set pendingQuestion
      _handleOcQuestionFromRuntime(event, sessionId);
      return;
    }
  }

  void _handleOcQuestionFromRuntime(
    RuntimeUserInputRequestedEvent event,
    String sessionId,
  ) {
    final request = event.request;
    final requestId = request.requestId ?? '';
    if (requestId.isEmpty) return;

    final metadata = request.metadata ?? <String, dynamic>{};

    // Build QuestionRequest from the OC question data in metadata
    final questionRequest = QuestionRequest.fromJson({
      'id': requestId,
      'sessionID': sessionId,
      ...metadata,
    });

    // Check for duplicates
    if (state.pendingQuestion?.id == requestId) return;

    state = state.copyWith(pendingQuestion: questionRequest);
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

    _addMessage(ChatMessage(
      id: 'cc-elicitation-$requestId',
      sessionId: sessionId,
      role: MessageRole.system,
      createdAt: DateTime.fromMillisecondsSinceEpoch(timestampMs),
      text: message,
      variant: 'cc-elicitation-request',
    ));
  }

  void _handleCcElicitationCompleteBackend(
    String sessionId,
    Map<String, dynamic> payload,
    int timestampMs,
  ) {
    final mcpServerName = payload['mcpServerName'] as String? ?? '';
    final serverName =
        mcpServerName.isNotEmpty ? mcpServerName : 'MCP server';
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

      if (elicitationId.isNotEmpty &&
          pendingElicitationId == elicitationId) {
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

    _addMessage(ChatMessage(
      id: 'cc-elicitation-complete-$timestampMs',
      sessionId: state.ccSessionId ?? sessionId,
      role: MessageRole.system,
      createdAt: DateTime.fromMillisecondsSinceEpoch(timestampMs),
      text: '✅ $serverName authentication completed',
      variant: 'cc-elicitation-complete',
    ));
  }
}
