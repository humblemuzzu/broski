/// Utilities for converting technical errors into human-readable messages.
///
/// Used across the app to ensure users never see raw exception text,
/// stack traces, or internal error codes.
library;

import 'dart:async' show TimeoutException;

/// Strips wrapper text from exceptions and returns a clean, user-facing message.
///
/// Handles common patterns:
/// - `Exception: Bridge error: Access denied` → `Access denied`
/// - `TimeoutException: Bridge response timeout: cc_sessions` → timeout message
/// - `StateError: BridgeService disposed...` → connection message
///
/// For unknown errors, returns the cleaned string (no "Exception:" prefix).
String humanizeError(Object error) {
  // Timeout errors — always the same user-facing message
  if (error is TimeoutException) {
    return 'Request timed out. Check your connection and try again.';
  }

  final raw = error.toString();

  if (raw.contains('TimeoutException') || raw.contains('timeout')) {
    return 'Request timed out. Check your connection and try again.';
  }

  // Connection/disposal errors
  if (raw.contains('disposed') || raw.contains('Connection closed')) {
    return 'Connection lost. Reconnecting…';
  }

  // Strip Dart exception wrappers: "Exception: Bridge error: actual message"
  var message = raw;

  // Remove "Exception: " prefix
  if (message.startsWith('Exception: ')) {
    message = message.substring('Exception: '.length);
  }
  // Remove "StateError: " prefix
  if (message.startsWith('StateError: ')) {
    message = message.substring('StateError: '.length);
  }
  // Remove "FormatException: " prefix
  if (message.startsWith('FormatException: ')) {
    message = message.substring('FormatException: '.length);
  }
  // Remove "Bridge error: " prefix
  if (message.startsWith('Bridge error: ')) {
    message = message.substring('Bridge error: '.length);
  }
  // Remove "Bridge response mismatch: ..." — internal protocol issue
  if (message.startsWith('Bridge response mismatch')) {
    return 'Unexpected response from bridge. Try again.';
  }

  // Map known bridge error messages to human text
  message = _mapKnownBridgeError(message);

  // Final cleanup: trim, ensure not empty
  message = message.trim();
  if (message.isEmpty) {
    return 'Something went wrong. Please try again.';
  }

  return message;
}

/// Maps known bridge error strings to user-friendly messages.
String _mapKnownBridgeError(String message) {
  final lower = message.toLowerCase();

  if (lower == 'request failed') {
    return 'Request failed. Please try again.';
  }
  if (lower == 'access denied') {
    return 'Access denied. The bridge can\'t access this path.';
  }
  if (lower == 'missing cwd') {
    return 'No project folder selected. Open a project first.';
  }
  if (lower.contains('license_required') || lower.contains('license required')) {
    return 'Subscription required. Subscribe to Pro in Settings.';
  }
  if (lower.contains('license_expired') || lower.contains('license expired')) {
    return 'Your subscription has expired. Renew in Settings.';
  }
  if (lower.contains('rate_limited') || lower.contains('rate limited')) {
    return 'Too many requests. Wait a moment and try again.';
  }
  if (lower.contains('invalid session') || lower.contains('invalid_session')) {
    return 'Session expired. Sign out and sign in again.';
  }
  if (lower.contains('cloud_auth') || lower.contains('cloud auth')) {
    return 'Authentication failed. Try signing out and back in.';
  }

  return message;
}

/// Converts internal error codes into human-readable labels for display
/// in chat error bubbles and status indicators.
///
/// These codes come from the bridge (`cc_error`, `turn_failed`, etc.)
/// and are stored in `ChatMessage.error`.
String humanErrorLabel(String? code) {
  if (code == null || code.isEmpty) return 'Error';

  return switch (code) {
    // Claude Code
    'cc_error' => 'Claude Code Error',
    'cc_auth_missing' => 'Authentication Required',

    // Codex
    'codex_error' => 'Codex Error',
    'turn_failed' => 'Response Failed',
    'model_cap' => 'Rate Limited',
    'server_overloaded' => 'Server Overloaded',
    'context_window_exceeded' => 'Context Window Exceeded',
    'usage_limit_exceeded' => 'Usage Limit Exceeded',
    'http_connection_failed' => 'Connection Failed',
    'response_stream_disconnected' => 'Stream Disconnected',
    'response_too_many_failed_attempts' => 'Too Many Retries',
    'unauthorized' => 'Unauthorized',
    'sandbox_error' => 'Sandbox Error',
    'thread_rollback_failed' => 'Rollback Failed',
    'app_server_crashed' => 'Agent Crashed',

    // OpenCode
    'AbortError' => 'Cancelled',
    'TypeError' => 'Internal Error',
    'Error' => 'Error',

    // Bridge-level
    'LICENSE_REQUIRED' => 'Subscription Required',
    'LICENSE_EXPIRED' => 'Subscription Expired',
    'INVALID_SESSION' => 'Session Expired',
    'RATE_LIMITED' => 'Rate Limited',
    'CLOUD_AUTH_REQUIRED' => 'Sign-in Required',
    'CLOUD_AUTH_FAILED' => 'Authentication Failed',
    'CLOUD_AUTH_UNAVAILABLE' => 'Auth Unavailable',

    // Informational (not real errors — see message_bubble.dart)
    'context_compacted' => 'Context Compacted',

    // Fallback: clean up snake_case/SCREAMING_CASE into Title Case
    _ => _prettifyCode(code),
  };
}

/// Whether an error code represents an informational event, not a real error.
/// These should be rendered with neutral/info styling, not red error styling.
bool isInfoCode(String? code) {
  return switch (code) {
    'context_compacted' => true,
    _ => false,
  };
}

/// Converts `snake_case` or `SCREAMING_CASE` to `Title Case`.
String _prettifyCode(String code) {
  final words = code.split('_').where((w) => w.isNotEmpty).map((w) {
    if (w.length == 1) return w.toUpperCase();
    return w[0].toUpperCase() + w.substring(1).toLowerCase();
  });
  final result = words.join(' ');
  return result.isEmpty ? 'Error' : result;
}
