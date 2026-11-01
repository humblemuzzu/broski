// Subscription usage models for tracking AI coding service limits.
// Based on data from the Claude OAuth API.

class UsageWindow {
  final double usedPercent; // 0-100
  final DateTime? resetsAt;
  final Duration windowDuration;

  const UsageWindow({
    required this.usedPercent,
    this.resetsAt,
    required this.windowDuration,
  });

  factory UsageWindow.fromJson(Map<String, dynamic> json) {
    return UsageWindow(
      usedPercent: (json['usedPercent'] as num?)?.toDouble() ?? 0,
      resetsAt: json['resetsAt'] != null
          ? DateTime.fromMillisecondsSinceEpoch(
              (json['resetsAt'] as num).toInt() * 1000,
            )
          : null,
      windowDuration: Duration(
        seconds: (json['windowSeconds'] as num?)?.toInt() ?? 0,
      ),
    );
  }

  /// Get remaining percent (100 - used)
  double get remainingPercent => 100 - usedPercent;

  /// Get time until reset as a human-readable string
  String get resetTimeString {
    if (resetsAt == null) return 'Unknown';

    final now = DateTime.now();
    final diff = resetsAt!.difference(now);

    if (diff.isNegative) return 'Now';

    if (diff.inDays > 0) {
      final hours = diff.inHours % 24;
      return '${diff.inDays}d ${hours}h';
    }

    if (diff.inHours > 0) {
      final minutes = diff.inMinutes % 60;
      return '${diff.inHours}h ${minutes}m';
    }

    return '${diff.inMinutes}m';
  }

  /// Get reset time as a formatted date string
  String get resetDateString {
    if (resetsAt == null) return 'Unknown';

    final weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    final weekday = weekdays[resetsAt!.weekday - 1];

    final hour = resetsAt!.hour;
    final minute = resetsAt!.minute;
    final amPm = hour >= 12 ? 'PM' : 'AM';
    final hour12 = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour);

    return 'Resets $weekday $hour12:${minute.toString().padLeft(2, '0')} $amPm';
  }
}

class ExtraUsage {
  final bool isEnabled;
  final double? monthlyLimit;
  final double? usedCredits;
  final double? utilization; // 0-100
  final String currency;
  final DateTime? resetsAt;

  const ExtraUsage({
    required this.isEnabled,
    this.monthlyLimit,
    this.usedCredits,
    this.utilization,
    this.currency = 'USD',
    this.resetsAt,
  });

  factory ExtraUsage.fromJson(Map<String, dynamic> json) {
    return ExtraUsage(
      isEnabled: json['isEnabled'] as bool? ?? false,
      monthlyLimit: (json['monthlyLimit'] as num?)?.toDouble(),
      usedCredits: (json['usedCredits'] as num?)?.toDouble(),
      utilization: (json['utilization'] as num?)?.toDouble(),
      currency: json['currency'] as String? ?? 'USD',
      resetsAt: json['resetsAt'] != null
          ? DateTime.fromMillisecondsSinceEpoch(
              (json['resetsAt'] as num).toInt() * 1000,
            )
          : null,
    );
  }

  /// Format spent amount as currency string
  String get spentString {
    if (usedCredits == null) return '\$0.00';
    return '\$${usedCredits!.toStringAsFixed(2)}';
  }

  /// Format monthly limit as currency string
  String get limitString {
    if (monthlyLimit == null) return 'Unlimited';
    return '\$${monthlyLimit!.toStringAsFixed(0)}';
  }

  /// Get reset month name
  String get resetMonthString {
    if (resetsAt == null) {
      // Default to first of next month
      final now = DateTime.now();
      final nextMonth = DateTime(now.year, now.month + 1, 1);
      final months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      return 'Resets ${months[nextMonth.month - 1]} ${nextMonth.day}';
    }

    final months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return 'Resets ${months[resetsAt!.month - 1]} ${resetsAt!.day}';
  }
}

class Credits {
  final bool hasCredits;
  final bool unlimited;
  final double? balance;

  const Credits({
    required this.hasCredits,
    required this.unlimited,
    this.balance,
  });

  factory Credits.fromJson(Map<String, dynamic> json) {
    return Credits(
      hasCredits: json['hasCredits'] as bool? ?? false,
      unlimited: json['unlimited'] as bool? ?? false,
      balance: (json['balance'] as num?)?.toDouble(),
    );
  }

  /// Format balance as currency string
  String get balanceString {
    if (unlimited) return 'Unlimited';
    if (balance == null) return '\$0.00';
    return '\$${balance!.toStringAsFixed(2)}';
  }
}

class ProviderUsage {
  final String providerId; // 'claude'
  final String providerName;
  final String? plan;
  final UsageWindow? sessionWindow; // 5-hour window
  final UsageWindow? weeklyWindow; // 7-day all models
  final UsageWindow? weeklyOpusWindow; // 7-day Opus only
  final UsageWindow? weeklySonnetWindow; // 7-day Sonnet only
  final ExtraUsage? extraUsage;
  final Credits? credits;
  final String source; // 'oauth', 'api-key', 'none'
  final DateTime fetchedAt;
  final String? error;

  const ProviderUsage({
    required this.providerId,
    required this.providerName,
    this.plan,
    this.sessionWindow,
    this.weeklyWindow,
    this.weeklyOpusWindow,
    this.weeklySonnetWindow,
    this.extraUsage,
    this.credits,
    required this.source,
    required this.fetchedAt,
    this.error,
  });

  factory ProviderUsage.fromJson(Map<String, dynamic> json) {
    return ProviderUsage(
      providerId: json['providerId'] as String,
      providerName: json['providerName'] as String,
      plan: json['plan'] as String?,
      sessionWindow: json['sessionWindow'] != null
          ? UsageWindow.fromJson(json['sessionWindow'] as Map<String, dynamic>)
          : null,
      weeklyWindow: json['weeklyWindow'] != null
          ? UsageWindow.fromJson(json['weeklyWindow'] as Map<String, dynamic>)
          : null,
      weeklyOpusWindow: json['weeklyOpusWindow'] != null
          ? UsageWindow.fromJson(
              json['weeklyOpusWindow'] as Map<String, dynamic>,
            )
          : null,
      weeklySonnetWindow: json['weeklySonnetWindow'] != null
          ? UsageWindow.fromJson(
              json['weeklySonnetWindow'] as Map<String, dynamic>,
            )
          : null,
      extraUsage: json['extraUsage'] != null
          ? ExtraUsage.fromJson(json['extraUsage'] as Map<String, dynamic>)
          : null,
      credits: json['credits'] != null
          ? Credits.fromJson(json['credits'] as Map<String, dynamic>)
          : null,
      source: json['source'] as String? ?? 'unknown',
      fetchedAt: DateTime.fromMillisecondsSinceEpoch(
        (json['fetchedAt'] as num).toInt(),
      ),
      error: json['error'] as String?,
    );
  }

  /// Whether this provider is configured and working
  bool get isConfigured => error == null && source != 'none';

  /// Whether this provider has any usage data
  bool get hasUsageData =>
      sessionWindow != null ||
      weeklyWindow != null ||
      extraUsage != null ||
      credits != null;

  /// Get relative time since fetch
  String get fetchedAgoString {
    final now = DateTime.now();
    final diff = now.difference(fetchedAt);

    if (diff.inSeconds < 5) return 'just now';
    if (diff.inSeconds < 60) return '${diff.inSeconds}s ago';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    return '${diff.inHours}h ago';
  }
}

class SubscriptionUsage {
  final List<ProviderUsage> providers;
  final DateTime fetchedAt;

  const SubscriptionUsage({required this.providers, required this.fetchedAt});

  factory SubscriptionUsage.fromJson(Map<String, dynamic> json) {
    final providersList = json['providers'] as List<dynamic>? ?? [];
    return SubscriptionUsage(
      providers: providersList
          .map((p) => ProviderUsage.fromJson(p as Map<String, dynamic>))
          .toList(),
      fetchedAt: DateTime.fromMillisecondsSinceEpoch(
        (json['fetchedAt'] as num).toInt(),
      ),
    );
  }

  /// Get Claude provider usage (if available)
  ProviderUsage? get claude =>
      providers.where((p) => p.providerId == 'claude').firstOrNull;

  /// Get OpenAI provider usage (if available)

  /// Get relative time since fetch
  String get fetchedAgoString {
    final now = DateTime.now();
    final diff = now.difference(fetchedAt);

    if (diff.inSeconds < 5) return 'just now';
    if (diff.inSeconds < 60) return '${diff.inSeconds}s ago';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    return '${diff.inHours}h ago';
  }
}
