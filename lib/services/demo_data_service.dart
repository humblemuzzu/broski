/// Demo data service for App Store review mode.
/// Provides sample sessions, messages, and diffs to demonstrate app functionality
/// without requiring an actual bridge connection.
library;

import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';

/// Service that provides demo/sample data for App Store reviewers.
/// This allows reviewers to experience the full app functionality
/// without needing to run the bridge server on their Mac.
class DemoDataService {
  DemoDataService._();
  static final instance = DemoDataService._();

  // Demo project paths
  static const _demoProjectPath = '/Users/demo/Projects/my-app';
  static const _demoProjectPath2 = '/Users/demo/Projects/api-server';

  /// Sample projects for demo mode
  List<ProjectSummary> get demoProjects => [
    ProjectSummary(
      id: 'demo-project-1',
      name: 'my-app',
      path: _demoProjectPath,
      lastOpened: DateTime.now()
          .subtract(const Duration(hours: 2))
          .millisecondsSinceEpoch,
    ),
    ProjectSummary(
      id: 'demo-project-2',
      name: 'api-server',
      path: _demoProjectPath2,
      lastOpened: DateTime.now()
          .subtract(const Duration(days: 1))
          .millisecondsSinceEpoch,
    ),
  ];

  /// Sample sessions for demo mode
  List<SessionSummary> get demoSessions {
    final now = DateTime.now();
    return [
      SessionSummary(
        id: 'demo-session-1',
        title: 'Add dark mode toggle to settings',
        projectID: 'demo-project-1',
        directory: _demoProjectPath,
        time: SessionTime(
          created: now
              .subtract(const Duration(hours: 1))
              .millisecondsSinceEpoch,
          updated: now
              .subtract(const Duration(minutes: 5))
              .millisecondsSinceEpoch,
        ),
        summary: const SessionSummaryStats(
          additions: 127,
          deletions: 23,
          files: 5,
        ),
      ),
      SessionSummary(
        id: 'demo-session-2',
        title: 'Fix authentication bug in login flow',
        projectID: 'demo-project-1',
        directory: _demoProjectPath,
        time: SessionTime(
          created: now
              .subtract(const Duration(hours: 3))
              .millisecondsSinceEpoch,
          updated: now
              .subtract(const Duration(hours: 2))
              .millisecondsSinceEpoch,
        ),
        summary: const SessionSummaryStats(
          additions: 45,
          deletions: 12,
          files: 3,
        ),
      ),
      SessionSummary(
        id: 'demo-session-3',
        title: 'Implement user profile API endpoints',
        projectID: 'demo-project-2',
        directory: _demoProjectPath2,
        time: SessionTime(
          created: now.subtract(const Duration(days: 1)).millisecondsSinceEpoch,
          updated: now
              .subtract(const Duration(hours: 20))
              .millisecondsSinceEpoch,
        ),
        summary: const SessionSummaryStats(
          additions: 312,
          deletions: 0,
          files: 8,
        ),
      ),
      SessionSummary(
        id: 'demo-session-4',
        title: 'Refactor database queries for performance',
        projectID: 'demo-project-2',
        directory: _demoProjectPath2,
        time: SessionTime(
          created: now.subtract(const Duration(days: 2)).millisecondsSinceEpoch,
          updated: now.subtract(const Duration(days: 2)).millisecondsSinceEpoch,
        ),
        summary: const SessionSummaryStats(
          additions: 89,
          deletions: 156,
          files: 4,
        ),
      ),
    ];
  }

  /// Sample messages for a demo session
  List<ChatMessage> getDemoMessages(String sessionId) {
    switch (sessionId) {
      case 'demo-session-1':
        return _darkModeSessionMessages;
      case 'demo-session-2':
        return _authBugSessionMessages;
      case 'demo-session-3':
        return _apiEndpointsSessionMessages;
      default:
        return _defaultDemoMessages(sessionId);
    }
  }

  /// Demo messages for dark mode session
  List<ChatMessage> get _darkModeSessionMessages {
    final now = DateTime.now();
    return [
      ChatMessage(
        id: 'msg-1',
        sessionId: 'demo-session-1',
        role: MessageRole.user,
        createdAt: now.subtract(const Duration(hours: 1)),
        text:
            'Add a dark mode toggle to the settings screen. It should persist '
            'the user preference and apply the theme immediately.',
      ),
      ChatMessage(
        id: 'msg-2',
        sessionId: 'demo-session-1',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(minutes: 58)),
        text:
            "I'll add a dark mode toggle to your settings screen. Let me first look at the current implementation to understand how themes are managed.",
        toolCalls: [
          const ToolCall(
            callId: 'call-1',
            partId: 'part-1',
            name: 'Read',
            status: 'completed',
            title: 'Reading lib/theme/theme_provider.dart',
            input: {'filePath': 'lib/theme/theme_provider.dart'},
            output: '// Theme provider implementation...',
          ),
        ],
      ),
      ChatMessage(
        id: 'msg-3',
        sessionId: 'demo-session-1',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(minutes: 55)),
        text:
            "I can see you're using Riverpod for state management. I'll create a dark mode provider and add a toggle switch to the settings screen.",
        toolCalls: [
          const ToolCall(
            callId: 'call-2',
            partId: 'part-2',
            name: 'Edit',
            status: 'completed',
            title: 'Editing lib/providers/theme_provider.dart',
            input: {
              'filePath': 'lib/providers/theme_provider.dart',
              'oldString': '// Theme state',
              'newString': '// Dark mode state\nfinal isDarkModeProvider = ...',
            },
          ),
          const ToolCall(
            callId: 'call-3',
            partId: 'part-3',
            name: 'Edit',
            status: 'completed',
            title: 'Editing lib/screens/settings_screen.dart',
            input: {'filePath': 'lib/screens/settings_screen.dart'},
          ),
        ],
        diffs: [
          const DiffEntry(
            file: 'lib/providers/theme_provider.dart',
            before: '''final themeProvider = StateProvider<ThemeMode>((ref) {
  return ThemeMode.system;
});''',
            after: '''final themeProvider = StateProvider<ThemeMode>((ref) {
  return ThemeMode.system;
});

final isDarkModeProvider = StateProvider<bool>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return prefs.getBool('isDarkMode') ?? false;
});

void toggleDarkMode(WidgetRef ref) {
  final current = ref.read(isDarkModeProvider);
  ref.read(isDarkModeProvider.notifier).state = !current;
  ref.read(sharedPreferencesProvider).setBool('isDarkMode', !current);
}''',
            additions: 12,
            deletions: 0,
          ),
          const DiffEntry(
            file: 'lib/screens/settings_screen.dart',
            before: '''ListTile(
  leading: Icon(Icons.info_outline),
  title: Text('About'),
  onTap: () => _showAboutDialog(context),
),''',
            after: '''SwitchListTile(
  secondary: Icon(Icons.dark_mode),
  title: Text('Dark Mode'),
  subtitle: Text('Use dark theme throughout the app'),
  value: ref.watch(isDarkModeProvider),
  onChanged: (_) => toggleDarkMode(ref),
),
ListTile(
  leading: Icon(Icons.info_outline),
  title: Text('About'),
  onTap: () => _showAboutDialog(context),
),''',
            additions: 8,
            deletions: 0,
          ),
        ],
      ),
      ChatMessage(
        id: 'msg-4',
        sessionId: 'demo-session-1',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(minutes: 50)),
        text:
            "Done! I've added a dark mode toggle to the settings screen. The preference is persisted using SharedPreferences, so it will be remembered across app restarts. The theme changes are applied immediately when the toggle is switched.\n\n"
            "Here's what I did:\n"
            "1. Created an `isDarkModeProvider` that reads/writes to SharedPreferences\n"
            "2. Added a `SwitchListTile` to the settings screen\n"
            "3. The theme updates instantly when toggled\n\n"
            "Would you like me to also add a system theme option, or is the manual toggle sufficient?",
      ),
      ChatMessage(
        id: 'msg-5',
        sessionId: 'demo-session-1',
        role: MessageRole.user,
        createdAt: now.subtract(const Duration(minutes: 45)),
        text: 'That looks great! Can you also add a "Follow System" option?',
      ),
      ChatMessage(
        id: 'msg-6',
        sessionId: 'demo-session-1',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(minutes: 40)),
        text:
            "Of course! I'll add a \"Follow System\" option that respects the device's appearance settings.",
        toolCalls: [
          const ToolCall(
            callId: 'call-4',
            partId: 'part-4',
            name: 'Edit',
            status: 'completed',
            title: 'Editing lib/screens/settings_screen.dart',
            input: {'filePath': 'lib/screens/settings_screen.dart'},
          ),
        ],
      ),
    ];
  }

  /// Demo messages for auth bug fix session
  List<ChatMessage> get _authBugSessionMessages {
    final now = DateTime.now();
    return [
      ChatMessage(
        id: 'msg-auth-1',
        sessionId: 'demo-session-2',
        role: MessageRole.user,
        createdAt: now.subtract(const Duration(hours: 3)),
        text:
            'Users are getting logged out randomly. Can you investigate the authentication flow and fix any issues?',
      ),
      ChatMessage(
        id: 'msg-auth-2',
        sessionId: 'demo-session-2',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(hours: 2, minutes: 55)),
        text:
            "I'll investigate the authentication flow. Let me start by looking at the auth service and token refresh logic.",
        toolCalls: [
          const ToolCall(
            callId: 'call-auth-1',
            partId: 'part-auth-1',
            name: 'Read',
            status: 'completed',
            title: 'Reading lib/services/auth_service.dart',
            input: {'filePath': 'lib/services/auth_service.dart'},
          ),
          const ToolCall(
            callId: 'call-auth-2',
            partId: 'part-auth-2',
            name: 'Glob',
            status: 'completed',
            title: 'Finding auth-related files',
            input: {'pattern': '**/auth*.dart'},
          ),
        ],
      ),
      ChatMessage(
        id: 'msg-auth-3',
        sessionId: 'demo-session-2',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(hours: 2, minutes: 45)),
        text:
            "I found the issue! The token refresh logic has a race condition. When the token expires, multiple API calls might try to refresh simultaneously, causing some to fail. I'll fix this by implementing a mutex-style lock.",
        toolCalls: [
          const ToolCall(
            callId: 'call-auth-3',
            partId: 'part-auth-3',
            name: 'Edit',
            status: 'completed',
            title: 'Fixing race condition in auth_service.dart',
            input: {'filePath': 'lib/services/auth_service.dart'},
          ),
        ],
        diffs: [
          const DiffEntry(
            file: 'lib/services/auth_service.dart',
            before: '''Future<String> getValidToken() async {
  if (_isTokenExpired()) {
    await _refreshToken();
  }
  return _accessToken;
}''',
            after: '''// Mutex to prevent concurrent token refresh
Completer<void>? _refreshCompleter;

Future<String> getValidToken() async {
  if (_isTokenExpired()) {
    // If already refreshing, wait for it
    if (_refreshCompleter != null) {
      await _refreshCompleter!.future;
    } else {
      _refreshCompleter = Completer<void>();
      try {
        await _refreshToken();
        _refreshCompleter!.complete();
      } catch (e) {
        _refreshCompleter!.completeError(e);
        rethrow;
      } finally {
        _refreshCompleter = null;
      }
    }
  }
  return _accessToken;
}''',
            additions: 18,
            deletions: 5,
          ),
        ],
      ),
      ChatMessage(
        id: 'msg-auth-4',
        sessionId: 'demo-session-2',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(hours: 2, minutes: 30)),
        text:
            "I've fixed the race condition in the authentication service. The token refresh now uses a `Completer` to ensure only one refresh happens at a time, and other callers wait for it to complete.\n\n"
            "This should prevent the random logouts you were experiencing. Would you like me to also add some logging to help debug any future auth issues?",
      ),
    ];
  }

  /// Demo messages for API endpoints session
  List<ChatMessage> get _apiEndpointsSessionMessages {
    final now = DateTime.now();
    return [
      ChatMessage(
        id: 'msg-api-1',
        sessionId: 'demo-session-3',
        role: MessageRole.user,
        createdAt: now.subtract(const Duration(days: 1)),
        text:
            'Create RESTful API endpoints for user profiles. Include GET, POST, PUT, and DELETE operations with proper validation.',
      ),
      ChatMessage(
        id: 'msg-api-2',
        sessionId: 'demo-session-3',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(hours: 23, minutes: 55)),
        text:
            "I'll create a complete set of RESTful API endpoints for user profiles. Let me first check your existing API structure.",
        toolCalls: [
          const ToolCall(
            callId: 'call-api-1',
            partId: 'part-api-1',
            name: 'Glob',
            status: 'completed',
            title: 'Finding existing API routes',
            input: {'pattern': 'src/routes/**/*.ts'},
          ),
          const ToolCall(
            callId: 'call-api-2',
            partId: 'part-api-2',
            name: 'Read',
            status: 'completed',
            title: 'Reading src/routes/index.ts',
            input: {'filePath': 'src/routes/index.ts'},
          ),
        ],
      ),
      ChatMessage(
        id: 'msg-api-3',
        sessionId: 'demo-session-3',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(hours: 23, minutes: 40)),
        text:
            "I see you're using Express with TypeScript. I'll create the user profile endpoints following your existing patterns.",
        toolCalls: [
          const ToolCall(
            callId: 'call-api-3',
            partId: 'part-api-3',
            name: 'Write',
            status: 'completed',
            title: 'Creating src/routes/users/profile.ts',
            input: {'filePath': 'src/routes/users/profile.ts'},
          ),
          const ToolCall(
            callId: 'call-api-4',
            partId: 'part-api-4',
            name: 'Write',
            status: 'completed',
            title: 'Creating src/validators/profile.ts',
            input: {'filePath': 'src/validators/profile.ts'},
          ),
          const ToolCall(
            callId: 'call-api-5',
            partId: 'part-api-5',
            name: 'Edit',
            status: 'completed',
            title: 'Updating src/routes/index.ts',
            input: {'filePath': 'src/routes/index.ts'},
          ),
        ],
      ),
      ChatMessage(
        id: 'msg-api-4',
        sessionId: 'demo-session-3',
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(hours: 23, minutes: 20)),
        text:
            "I've created the user profile API endpoints with:\n\n"
            "- `GET /api/users/:id/profile` - Get user profile\n"
            "- `POST /api/users/:id/profile` - Create profile\n"
            "- `PUT /api/users/:id/profile` - Update profile\n"
            "- `DELETE /api/users/:id/profile` - Delete profile\n\n"
            "All endpoints include:\n"
            "- Input validation using Zod schemas\n"
            "- Proper error handling\n"
            "- Authentication middleware\n"
            "- TypeScript types for request/response\n\n"
            "Would you like me to add unit tests for these endpoints?",
      ),
    ];
  }

  /// Default demo messages for any session
  List<ChatMessage> _defaultDemoMessages(String sessionId) {
    final now = DateTime.now();
    return [
      ChatMessage(
        id: 'msg-default-1',
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: now.subtract(const Duration(hours: 1)),
        text: 'Help me with this coding task.',
      ),
      ChatMessage(
        id: 'msg-default-2',
        sessionId: sessionId,
        role: MessageRole.assistant,
        createdAt: now.subtract(const Duration(minutes: 55)),
        text:
            "I'd be happy to help! This is a demo session showing how Broski works with AI coding agents.\n\n"
            "In a real session, I would:\n"
            "- Read and analyze your code\n"
            "- Make intelligent edits\n"
            "- Run tests and commands\n"
            "- Show you diffs of changes\n\n"
            "Connect to your Mac to start a real coding session!",
      ),
    ];
  }

  /// Check if a session ID is a demo session
  bool isDemoSession(String sessionId) {
    return sessionId.startsWith('demo-session-');
  }

  /// Check if a project ID is a demo project
  bool isDemoProject(String projectId) {
    return projectId.startsWith('demo-project-');
  }
}
