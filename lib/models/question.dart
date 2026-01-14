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
  final String header; // max 12 chars in OpenCode
  final List<QuestionOption> options;
  final bool multiple;

  const QuestionInfo({
    required this.question,
    required this.header,
    required this.options,
    required this.multiple,
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

