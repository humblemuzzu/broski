/// App/connector from the Codex marketplace.
///
/// Matches SDK type: `AppInfo` from `v2/AppInfo.ts`
class CodexAppInfo {
  final String id;
  final String name;
  final String? description;
  final String? logoUrl;
  final String? logoUrlDark;
  final String? distributionChannel;
  final String? installUrl;
  final bool isAccessible;
  final bool isEnabled; // #12: SDK AppInfo.is_enabled (defaults true)

  const CodexAppInfo({
    required this.id,
    required this.name,
    this.description,
    this.logoUrl,
    this.logoUrlDark,
    this.distributionChannel,
    this.installUrl,
    this.isAccessible = true,
    this.isEnabled = true,
  });

  factory CodexAppInfo.fromJson(Map<String, dynamic> json) {
    return CodexAppInfo(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      logoUrl: json['logoUrl'] as String?,
      logoUrlDark: json['logoUrlDark'] as String?,
      distributionChannel: json['distributionChannel'] as String?,
      installUrl: json['installUrl'] as String?,
      isAccessible: json['isAccessible'] as bool? ?? true,
      isEnabled: json['isEnabled'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    if (description != null) 'description': description,
    if (logoUrl != null) 'logoUrl': logoUrl,
    if (logoUrlDark != null) 'logoUrlDark': logoUrlDark,
    if (distributionChannel != null) 'distributionChannel': distributionChannel,
    if (installUrl != null) 'installUrl': installUrl,
    'isAccessible': isAccessible,
    'isEnabled': isEnabled,
  };
}
