import 'dart:convert';

class ArtifactSummary {
  const ArtifactSummary({
    required this.id,
    required this.backend,
    required this.sessionId,
    required this.toolUseId,
    required this.projectPath,
    required this.tool,
    required this.operation,
    required this.filePath,
    required this.filename,
    required this.directory,
    required this.extension,
    required this.language,
    required this.fileType,
    required this.additions,
    required this.deletions,
    required this.linesChanged,
    required this.sizeBytes,
    required this.createdAt,
    required this.starred,
    this.messageId,
    this.gitBranch,
    this.summary,
    this.smartTags,
    this.userTags,
    this.notes,
  });

  final String id;
  final String backend; // 'opencode' | 'claude-code'
  final String sessionId;
  final String? messageId;
  final String toolUseId;
  final String projectPath;
  final String? gitBranch;

  final String tool;
  final String operation; // 'create' | 'edit'

  final String filePath;
  final String filename;
  final String directory;
  final String extension;
  final String language;
  final String fileType;

  final int additions;
  final int deletions;
  final int linesChanged;
  final int sizeBytes;
  final int createdAt;

  final String? summary;
  final List<String>? smartTags;

  final List<String>? userTags;
  final bool starred;
  final String? notes;

  ArtifactSummary copyWith({
    String? id,
    String? backend,
    String? sessionId,
    String? messageId,
    String? toolUseId,
    String? projectPath,
    String? gitBranch,
    String? tool,
    String? operation,
    String? filePath,
    String? filename,
    String? directory,
    String? extension,
    String? language,
    String? fileType,
    int? additions,
    int? deletions,
    int? linesChanged,
    int? sizeBytes,
    int? createdAt,
    String? summary,
    List<String>? smartTags,
    List<String>? userTags,
    bool? starred,
    String? notes,
  }) {
    return ArtifactSummary(
      id: id ?? this.id,
      backend: backend ?? this.backend,
      sessionId: sessionId ?? this.sessionId,
      messageId: messageId ?? this.messageId,
      toolUseId: toolUseId ?? this.toolUseId,
      projectPath: projectPath ?? this.projectPath,
      gitBranch: gitBranch ?? this.gitBranch,
      tool: tool ?? this.tool,
      operation: operation ?? this.operation,
      filePath: filePath ?? this.filePath,
      filename: filename ?? this.filename,
      directory: directory ?? this.directory,
      extension: extension ?? this.extension,
      language: language ?? this.language,
      fileType: fileType ?? this.fileType,
      additions: additions ?? this.additions,
      deletions: deletions ?? this.deletions,
      linesChanged: linesChanged ?? this.linesChanged,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      createdAt: createdAt ?? this.createdAt,
      summary: summary ?? this.summary,
      smartTags: smartTags ?? this.smartTags,
      userTags: userTags ?? this.userTags,
      starred: starred ?? this.starred,
      notes: notes ?? this.notes,
    );
  }

  factory ArtifactSummary.fromJson(Map<String, dynamic> json) {
    return ArtifactSummary(
      id: json['id'] as String? ?? '',
      backend: json['backend'] as String? ?? '',
      sessionId: json['sessionId'] as String? ?? '',
      messageId: json['messageId'] as String?,
      toolUseId: json['toolUseId'] as String? ?? '',
      projectPath: json['projectPath'] as String? ?? '',
      gitBranch: json['gitBranch'] as String?,
      tool: json['tool'] as String? ?? '',
      operation: json['operation'] as String? ?? '',
      filePath: json['filePath'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
      directory: json['directory'] as String? ?? '',
      extension: json['extension'] as String? ?? '',
      language: json['language'] as String? ?? '',
      fileType: json['fileType'] as String? ?? '',
      additions: (json['additions'] as num?)?.toInt() ?? 0,
      deletions: (json['deletions'] as num?)?.toInt() ?? 0,
      linesChanged: (json['linesChanged'] as num?)?.toInt() ?? 0,
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      summary: json['summary'] as String?,
      smartTags: (json['smartTags'] as List?)?.whereType<String>().toList(),
      userTags: (json['userTags'] as List?)?.whereType<String>().toList(),
      starred: json['starred'] as bool? ?? false,
      notes: json['notes'] as String?,
    );
  }
}

class Artifact extends ArtifactSummary {
  const Artifact({
    required super.id,
    required super.backend,
    required super.sessionId,
    required super.toolUseId,
    required super.projectPath,
    required super.tool,
    required super.operation,
    required super.filePath,
    required super.filename,
    required super.directory,
    required super.extension,
    required super.language,
    required super.fileType,
    required super.additions,
    required super.deletions,
    required super.linesChanged,
    required super.sizeBytes,
    required super.createdAt,
    required super.starred,
    super.messageId,
    super.gitBranch,
    super.summary,
    super.smartTags,
    super.userTags,
    super.notes,
    this.toolInput = const {},
    this.toolOutput,
    this.contentBefore,
    this.contentAfter,
    this.unifiedDiff,
  });

  final Map<String, dynamic> toolInput;
  final String? toolOutput;
  final String? contentBefore;
  final String? contentAfter;
  final String? unifiedDiff;

  Artifact copyWith({
    String? id,
    String? backend,
    String? sessionId,
    String? messageId,
    String? toolUseId,
    String? projectPath,
    String? gitBranch,
    String? tool,
    String? operation,
    String? filePath,
    String? filename,
    String? directory,
    String? extension,
    String? language,
    String? fileType,
    int? additions,
    int? deletions,
    int? linesChanged,
    int? sizeBytes,
    int? createdAt,
    String? summary,
    List<String>? smartTags,
    List<String>? userTags,
    bool? starred,
    String? notes,
    Map<String, dynamic>? toolInput,
    String? toolOutput,
    String? contentBefore,
    String? contentAfter,
    String? unifiedDiff,
  }) {
    return Artifact(
      id: id ?? this.id,
      backend: backend ?? this.backend,
      sessionId: sessionId ?? this.sessionId,
      messageId: messageId ?? this.messageId,
      toolUseId: toolUseId ?? this.toolUseId,
      projectPath: projectPath ?? this.projectPath,
      gitBranch: gitBranch ?? this.gitBranch,
      tool: tool ?? this.tool,
      operation: operation ?? this.operation,
      filePath: filePath ?? this.filePath,
      filename: filename ?? this.filename,
      directory: directory ?? this.directory,
      extension: extension ?? this.extension,
      language: language ?? this.language,
      fileType: fileType ?? this.fileType,
      additions: additions ?? this.additions,
      deletions: deletions ?? this.deletions,
      linesChanged: linesChanged ?? this.linesChanged,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      createdAt: createdAt ?? this.createdAt,
      summary: summary ?? this.summary,
      smartTags: smartTags ?? this.smartTags,
      userTags: userTags ?? this.userTags,
      starred: starred ?? this.starred,
      notes: notes ?? this.notes,
      toolInput: toolInput ?? this.toolInput,
      toolOutput: toolOutput ?? this.toolOutput,
      contentBefore: contentBefore ?? this.contentBefore,
      contentAfter: contentAfter ?? this.contentAfter,
      unifiedDiff: unifiedDiff ?? this.unifiedDiff,
    );
  }

  factory Artifact.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> toolInput = const {};
    final raw = json['toolInput'];
    if (raw is Map<String, dynamic>) {
      toolInput = raw;
    } else if (raw is String) {
      try {
        final parsed = jsonDecode(raw);
        if (parsed is Map<String, dynamic>) toolInput = parsed;
      } catch (_) {}
    }

    return Artifact(
      id: json['id'] as String? ?? '',
      backend: json['backend'] as String? ?? '',
      sessionId: json['sessionId'] as String? ?? '',
      messageId: json['messageId'] as String?,
      toolUseId: json['toolUseId'] as String? ?? '',
      projectPath: json['projectPath'] as String? ?? '',
      gitBranch: json['gitBranch'] as String?,
      tool: json['tool'] as String? ?? '',
      operation: json['operation'] as String? ?? '',
      filePath: json['filePath'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
      directory: json['directory'] as String? ?? '',
      extension: json['extension'] as String? ?? '',
      language: json['language'] as String? ?? '',
      fileType: json['fileType'] as String? ?? '',
      additions: (json['additions'] as num?)?.toInt() ?? 0,
      deletions: (json['deletions'] as num?)?.toInt() ?? 0,
      linesChanged: (json['linesChanged'] as num?)?.toInt() ?? 0,
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      summary: json['summary'] as String?,
      smartTags: (json['smartTags'] as List?)?.whereType<String>().toList(),
      userTags: (json['userTags'] as List?)?.whereType<String>().toList(),
      starred: json['starred'] as bool? ?? false,
      notes: json['notes'] as String?,
      toolInput: toolInput,
      toolOutput: json['toolOutput'] as String?,
      contentBefore: json['contentBefore'] as String?,
      contentAfter: json['contentAfter'] as String?,
      unifiedDiff: json['unifiedDiff'] as String?,
    );
  }
}

class ArtifactSearchFilters {
  const ArtifactSearchFilters({
    this.backend,
    this.projectPath,
    this.language,
    this.fileType,
    this.starred,
  });

  final String? backend; // 'opencode' | 'claude-code'
  final String? projectPath;
  final String? language;
  final String? fileType;
  final bool? starred;

  Map<String, dynamic> toJson() => {
    if (backend != null) 'backend': backend,
    if (projectPath != null) 'projectPath': projectPath,
    if (language != null) 'language': language,
    if (fileType != null) 'fileType': fileType,
    if (starred != null) 'starred': starred,
  };
}

class ArtifactSearchResult {
  const ArtifactSearchResult({
    required this.artifacts,
    required this.total,
    required this.query,
  });

  final List<ArtifactSummary> artifacts;
  final int total;
  final Map<String, dynamic> query;

  factory ArtifactSearchResult.fromJson(Map<String, dynamic> json) {
    final items = (json['artifacts'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(ArtifactSummary.fromJson)
        .toList();
    return ArtifactSearchResult(
      artifacts: items,
      total: (json['total'] as num?)?.toInt() ?? 0,
      query: json['query'] as Map<String, dynamic>? ?? const {},
    );
  }
}
