class QuestionOption {
  final String label;
  final String description;

  const QuestionOption({required this.label, required this.description});

  factory QuestionOption.fromJson(Map<String, dynamic> json) {
    return QuestionOption(
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }
}

class QuestionInfo {
  final String question;
  final String header; // max 30 chars in OpenCode
  final List<QuestionOption> options;
  final bool multiple;

  /// Whether the user may type a custom answer (default: true).
  /// When false, only the provided options are allowed.
  final bool custom;

  const QuestionInfo({
    required this.question,
    required this.header,
    required this.options,
    required this.multiple,
    this.custom = true,
  });

  factory QuestionInfo.fromJson(Map<String, dynamic> json) {
    final options =
        (json['options'] as List<dynamic>?)
            ?.whereType<Map<String, dynamic>>()
            .map(QuestionOption.fromJson)
            .toList() ??
        const <QuestionOption>[];
    return QuestionInfo(
      question: json['question'] as String? ?? '',
      header: json['header'] as String? ?? '',
      options: options,
      multiple: json['multiple'] == true,
      custom: json['custom'] as bool? ?? true,
    );
  }
}

class QuestionToolRef {
  final String messageId;
  final String callId;

  const QuestionToolRef({required this.messageId, required this.callId});

  factory QuestionToolRef.fromJson(Map<String, dynamic> json) {
    return QuestionToolRef(
      messageId:
          (json['messageID'] as String?) ??
          (json['messageId'] as String?) ??
          (json['message_id'] as String?) ??
          '',
      callId:
          (json['callID'] as String?) ??
          (json['callId'] as String?) ??
          (json['call_id'] as String?) ??
          '',
    );
  }
}

class QuestionRequest {
  final String id;
  final String sessionId;
  final List<QuestionInfo> questions;
  final QuestionToolRef? tool;

  const QuestionRequest({
    required this.id,
    required this.sessionId,
    required this.questions,
    this.tool,
  });

  factory QuestionRequest.fromJson(Map<String, dynamic> json) {
    final questions =
        (json['questions'] as List<dynamic>?)
            ?.whereType<Map<String, dynamic>>()
            .map(QuestionInfo.fromJson)
            .toList() ??
        const <QuestionInfo>[];
    final toolJson = json['tool'];
    return QuestionRequest(
      id: json['id'] as String? ?? '',
      sessionId:
          (json['sessionID'] as String?) ??
          (json['sessionId'] as String?) ??
          '',
      questions: questions,
      tool: toolJson is Map<String, dynamic>
          ? QuestionToolRef.fromJson(toolJson)
          : null,
    );
  }
}

// ============================================================================
// CODEX REQUEST_USER_INPUT (SDK v0.87.0+)
// ============================================================================

/// A question option for Codex request_user_input
class CodexQuestionOption {
  final String label;
  final String description;

  const CodexQuestionOption({required this.label, required this.description});

  factory CodexQuestionOption.fromJson(Map<String, dynamic> json) {
    return CodexQuestionOption(
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }
}

/// A single question in a Codex request_user_input event
class CodexQuestion {
  final String id;
  final String header;
  final String question;
  final List<CodexQuestionOption> options;

  const CodexQuestion({
    required this.id,
    required this.header,
    required this.question,
    required this.options,
  });

  factory CodexQuestion.fromJson(Map<String, dynamic> json) {
    final options =
        (json['options'] as List<dynamic>?)
            ?.whereType<Map<String, dynamic>>()
            .map(CodexQuestionOption.fromJson)
            .toList() ??
        const <CodexQuestionOption>[];
    return CodexQuestion(
      id: json['id'] as String? ?? '',
      header: json['header'] as String? ?? '',
      question: json['question'] as String? ?? '',
      options: options,
    );
  }
}

/// A Codex request_user_input request from the agent
class CodexUserInputRequest {
  final String requestId; // The JSON-RPC request ID to respond to
  final String callId; // Tool call ID
  final String turnId; // Turn this belongs to
  final String threadId; // Thread ID
  final List<CodexQuestion> questions;

  const CodexUserInputRequest({
    required this.requestId,
    required this.callId,
    required this.turnId,
    required this.threadId,
    required this.questions,
  });

  factory CodexUserInputRequest.fromJson(
    String requestId,
    String threadId,
    Map<String, dynamic> params,
  ) {
    final questions =
        (params['questions'] as List<dynamic>?)
            ?.whereType<Map<String, dynamic>>()
            .map(CodexQuestion.fromJson)
            .toList() ??
        const <CodexQuestion>[];
    return CodexUserInputRequest(
      requestId: requestId,
      threadId: threadId,
      callId: params['callId'] as String? ?? params['call_id'] as String? ?? '',
      turnId: params['turnId'] as String? ?? params['turn_id'] as String? ?? '',
      questions: questions,
    );
  }
}
