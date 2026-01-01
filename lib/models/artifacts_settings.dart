class ArtifactsEnrichmentConfig {
  const ArtifactsEnrichmentConfig({
    required this.provider,
    required this.followSelectedAgent,
    required this.enabled,
    required this.batchSize,
    required this.maxCharsPerArtifact,
    required this.hiddenCwd,
  });

  final String provider; // 'off' | 'claude-code' | 'opencode'
  final bool followSelectedAgent;
  final bool enabled;
  final int batchSize;
  final int maxCharsPerArtifact;
  final String hiddenCwd;

  factory ArtifactsEnrichmentConfig.fromJson(Map<String, dynamic> json) {
    return ArtifactsEnrichmentConfig(
      provider: json['provider'] as String? ?? 'off',
      followSelectedAgent: json['followSelectedAgent'] as bool? ?? true,
      enabled: json['enabled'] as bool? ?? false,
      batchSize: (json['batchSize'] as num?)?.toInt() ?? 5,
      maxCharsPerArtifact: (json['maxCharsPerArtifact'] as num?)?.toInt() ?? 6000,
      hiddenCwd: json['hiddenCwd'] as String? ?? '/tmp/broski-enrichment',
    );
  }

  Map<String, dynamic> toJson() => {
    'provider': provider,
    'followSelectedAgent': followSelectedAgent,
    'enabled': enabled,
    'batchSize': batchSize,
    'maxCharsPerArtifact': maxCharsPerArtifact,
    'hiddenCwd': hiddenCwd,
  };
}

class ArtifactsConfig {
  const ArtifactsConfig({
    required this.indexingEnabled,
    required this.maxContentChars,
    required this.enrichment,
  });

  final bool indexingEnabled;
  final int maxContentChars;
  final ArtifactsEnrichmentConfig enrichment;

  factory ArtifactsConfig.fromJson(Map<String, dynamic> json) {
    return ArtifactsConfig(
      indexingEnabled: json['indexingEnabled'] as bool? ?? true,
      maxContentChars: (json['maxContentChars'] as num?)?.toInt() ?? 250000,
      enrichment: ArtifactsEnrichmentConfig.fromJson(
        json['enrichment'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }

  Map<String, dynamic> toJson() => {
    'indexingEnabled': indexingEnabled,
    'maxContentChars': maxContentChars,
    'enrichment': enrichment.toJson(),
  };
}

class ArtifactsStats {
  const ArtifactsStats({
    required this.dbPath,
    required this.dbSizeBytes,
    required this.totalArtifacts,
    required this.starredArtifacts,
    required this.backends,
    required this.updatedAt,
  });

  final String dbPath;
  final int dbSizeBytes;
  final int totalArtifacts;
  final int starredArtifacts;
  final Map<String, int> backends;
  final int updatedAt;

  factory ArtifactsStats.fromJson(Map<String, dynamic> json) {
    final raw = json['backends'] as Map<String, dynamic>? ?? const {};
    final backends = <String, int>{};
    for (final entry in raw.entries) {
      backends[entry.key] = (entry.value as num?)?.toInt() ?? 0;
    }
    return ArtifactsStats(
      dbPath: json['dbPath'] as String? ?? '',
      dbSizeBytes: (json['dbSizeBytes'] as num?)?.toInt() ?? 0,
      totalArtifacts: (json['totalArtifacts'] as num?)?.toInt() ?? 0,
      starredArtifacts: (json['starredArtifacts'] as num?)?.toInt() ?? 0,
      backends: backends,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
    );
  }
}
