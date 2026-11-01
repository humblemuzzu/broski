/// Shared formatting utilities used across the app.
///
/// Replaces duplicated _formatTokens(), _getModelName(), and magic constants
/// that were copy-pasted across chat_screen.dart and various action content
/// widgets.
library;

/// Default context window size used across all agents when not specified.
const int kDefaultContextWindow = 200000;

/// Format a token count for display (e.g., 1500 → "1.5K", 2000000 → "2.0M").
String formatTokens(int count) {
  if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}M';
  if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}K';
  return count.toString();
}

/// Format a context window size for display (e.g., 200000 → "200K").
String formatContextWindow(int windowSize) {
  if (windowSize >= 1000000) {
    return '${(windowSize / 1000000).toStringAsFixed(0)}M';
  }
  if (windowSize >= 1000) return '${(windowSize / 1000).toStringAsFixed(0)}K';
  return windowSize.toString();
}

/// Returns a short display name for a model string.
///
/// Handles all agent model formats:
/// - Claude Code: "claude-sonnet-4-..." → "Sonnet", "claude-opus-..." → "Opus"
/// - OpenAI: "o3-..." → "o3", "gpt-4o-..." → "GPT-4o"
/// - Pi/Generic: "provider/model-name" → "model-name" (truncated)
///
/// [fallback] is returned when model is null/empty. Defaults to "Unknown".
/// [maxLength] truncation length for unrecognized models.
String getModelDisplayName(
  String? model, {
  String fallback = 'Unknown',
  int maxLength = 20,
}) {
  if (model == null || model.isEmpty) return fallback;
  final m = model.toLowerCase();

  // Claude Code tier names
  if (m.contains('opus')) return 'Opus';
  if (m.contains('sonnet')) return 'Sonnet';
  if (m.contains('haiku')) return 'Haiku';

  // OpenAI model families — gpt-4o before gpt-4 so the more specific match wins
  if (m.contains('o3')) return 'o3';
  if (m.contains('o1')) return 'o1';
  if (m.contains('gpt-4o')) return 'GPT-4o';
  if (m.contains('gpt-4')) return 'GPT-4';

  // Provider/model format (e.g., "anthropic/claude-sonnet-4")
  final parts = model.split('/');
  final name = parts.length > 1 ? parts.last : model;

  // Truncate long names
  if (name.length > maxLength) return '${name.substring(0, maxLength - 3)}...';
  return name;
}
