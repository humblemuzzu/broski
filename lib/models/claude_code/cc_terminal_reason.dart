/// Terminal reason for why a Claude Code session stopped.
/// SDK 0.2.92: Added to SDKResultSuccess and SDKResultError.
enum ClaudeCodeTerminalReason {
  blockingLimit,
  rapidRefillBreaker,
  promptTooLong,
  imageError,
  modelError,
  abortedStreaming,
  abortedTools,
  stopHookPrevented,
  hookStopped,
  toolDeferred,
  maxTurns,
  completed;

  String get wireValue {
    switch (this) {
      case ClaudeCodeTerminalReason.blockingLimit:
        return 'blocking_limit';
      case ClaudeCodeTerminalReason.rapidRefillBreaker:
        return 'rapid_refill_breaker';
      case ClaudeCodeTerminalReason.promptTooLong:
        return 'prompt_too_long';
      case ClaudeCodeTerminalReason.imageError:
        return 'image_error';
      case ClaudeCodeTerminalReason.modelError:
        return 'model_error';
      case ClaudeCodeTerminalReason.abortedStreaming:
        return 'aborted_streaming';
      case ClaudeCodeTerminalReason.abortedTools:
        return 'aborted_tools';
      case ClaudeCodeTerminalReason.stopHookPrevented:
        return 'stop_hook_prevented';
      case ClaudeCodeTerminalReason.hookStopped:
        return 'hook_stopped';
      case ClaudeCodeTerminalReason.toolDeferred:
        return 'tool_deferred';
      case ClaudeCodeTerminalReason.maxTurns:
        return 'max_turns';
      case ClaudeCodeTerminalReason.completed:
        return 'completed';
    }
  }

  static ClaudeCodeTerminalReason fromWireValue(String value) {
    switch (value) {
      case 'blocking_limit':
        return ClaudeCodeTerminalReason.blockingLimit;
      case 'rapid_refill_breaker':
        return ClaudeCodeTerminalReason.rapidRefillBreaker;
      case 'prompt_too_long':
        return ClaudeCodeTerminalReason.promptTooLong;
      case 'image_error':
        return ClaudeCodeTerminalReason.imageError;
      case 'model_error':
        return ClaudeCodeTerminalReason.modelError;
      case 'aborted_streaming':
        return ClaudeCodeTerminalReason.abortedStreaming;
      case 'aborted_tools':
        return ClaudeCodeTerminalReason.abortedTools;
      case 'stop_hook_prevented':
        return ClaudeCodeTerminalReason.stopHookPrevented;
      case 'hook_stopped':
        return ClaudeCodeTerminalReason.hookStopped;
      case 'tool_deferred':
        return ClaudeCodeTerminalReason.toolDeferred;
      case 'max_turns':
        return ClaudeCodeTerminalReason.maxTurns;
      case 'completed':
        return ClaudeCodeTerminalReason.completed;
      default:
        return ClaudeCodeTerminalReason.completed;
    }
  }

  String get displayName {
    switch (this) {
      case ClaudeCodeTerminalReason.blockingLimit:
        return 'Rate limit reached';
      case ClaudeCodeTerminalReason.rapidRefillBreaker:
        return 'Rapid refill breaker tripped';
      case ClaudeCodeTerminalReason.promptTooLong:
        return 'Prompt too long for context';
      case ClaudeCodeTerminalReason.imageError:
        return 'Image processing error';
      case ClaudeCodeTerminalReason.modelError:
        return 'Model error';
      case ClaudeCodeTerminalReason.abortedStreaming:
        return 'Aborted during streaming';
      case ClaudeCodeTerminalReason.abortedTools:
        return 'Aborted during tool execution';
      case ClaudeCodeTerminalReason.stopHookPrevented:
        return 'Stop prevented by hook';
      case ClaudeCodeTerminalReason.hookStopped:
        return 'Stopped by hook';
      case ClaudeCodeTerminalReason.toolDeferred:
        return 'Tool deferred — resume to continue';
      case ClaudeCodeTerminalReason.maxTurns:
        return 'Maximum turns reached';
      case ClaudeCodeTerminalReason.completed:
        return 'Completed';
    }
  }

  /// Icon prefix for display.
  String get icon {
    switch (this) {
      case ClaudeCodeTerminalReason.blockingLimit:
      case ClaudeCodeTerminalReason.rapidRefillBreaker:
        return '⛔';
      case ClaudeCodeTerminalReason.promptTooLong:
      case ClaudeCodeTerminalReason.imageError:
      case ClaudeCodeTerminalReason.modelError:
      case ClaudeCodeTerminalReason.maxTurns:
        return '⚠️';
      case ClaudeCodeTerminalReason.abortedStreaming:
      case ClaudeCodeTerminalReason.abortedTools:
        return '🛑';
      case ClaudeCodeTerminalReason.stopHookPrevented:
      case ClaudeCodeTerminalReason.hookStopped:
        return '🚫';
      case ClaudeCodeTerminalReason.toolDeferred:
        return '⏸️';
      case ClaudeCodeTerminalReason.completed:
        return '✅';
    }
  }
}
