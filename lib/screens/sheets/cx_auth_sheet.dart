import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../providers/service_providers.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Codex authentication sheet. Extracted from chat_screen.dart.
void showCodexAuthSheet(BuildContext context, WidgetRef ref) {
  final theme = OpenCodeTheme.of(context);
  final apiKeyController = TextEditingController();
  String? loginId;
  String? authUrl;
  DetailSheet.show(
    context: context,
    title: 'Authentication',
    initialSize: 0.5,
    child: StatefulBuilder(
      builder: (context, setSheetState) {
        Future<void> startChatgptLogin() async {
          final bridge = ref.read(bridgeServiceProvider);
          final res = await bridge.cxLoginStartChatgpt();
          loginId = res['loginId']?.toString();
          authUrl = res['authUrl']?.toString();
          setSheetState(() {});
        }

        Future<void> cancelLogin() async {
          final id = loginId;
          if (id == null || id.isEmpty) return;
          final bridge = ref.read(bridgeServiceProvider);
          await bridge.cxLoginCancel(id);
          setSheetState(() {
            loginId = null;
            authUrl = null;
          });
        }

        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(height: Spacing.sm),
              Padding(
                padding: Insets.screenH,
                child: FutureBuilder<Map<String, dynamic>>(
                  future: ref.read(bridgeServiceProvider).cxAccountRead(),
                  builder: (context, snapshot) {
                    final loading =
                        snapshot.connectionState == ConnectionState.waiting;
                    if (loading) {
                      return const Padding(
                        padding: Insets.screenV,
                        child: Center(child: CircularProgressIndicator()),
                      );
                    }
                    if (snapshot.hasError) {
                      return Text(
                        'Failed to read account: ${humanizeError(snapshot.error ?? "Unknown error")}',
                        style: TextStyle(
                          color: theme.textMuted,
                          fontSize: 12,
                        ),
                      );
                    }
                    final account = snapshot.data?['account'];
                    final requires =
                        snapshot.data?['requiresOpenaiAuth'] == true;
                    return Container(
                      padding: Insets.cardSm,
                      decoration: BoxDecoration(
                        color: theme.background,
                        borderRadius: Radii.brMd,
                        border: Border.all(
                          color: theme.borderSubtle.withValues(alpha: 0.25),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Status',
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            account == null
                                ? (requires
                                      ? 'Not logged in (OpenAI auth required)'
                                      : 'Not logged in (auth not required)')
                                : 'Logged in: ${account['type'] ?? account['authMode'] ?? ''}',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              SizedBox(height: Spacing.md),
              Padding(
                padding: Insets.screenH,
                child: FutureBuilder<Map<String, dynamic>>(
                  future: ref.read(bridgeServiceProvider).cxRateLimitsRead(),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const SizedBox.shrink();
                    }
                    if (snapshot.hasError) {
                      return const SizedBox.shrink();
                    }
                    final limits = snapshot.data?['rateLimits'];
                    if (limits is! Map) return const SizedBox.shrink();
                    final primary = limits['primary'];
                    if (primary is! Map) return const SizedBox.shrink();
                    // #14: Show limit_name if present
                    final limitName =
                        limits['limitName'] as String? ??
                        limits['limit_name'] as String?;
                    final label = limitName != null && limitName.isNotEmpty
                        ? '$limitName: ${primary['usedPercent'] ?? 0}% used'
                        : 'Rate limits: ${primary['usedPercent'] ?? 0}% used';
                    final resetsAt = primary['resetsAt'];
                    final resetsStr = resetsAt != null
                        ? ', resets at $resetsAt'
                        : '';
                    return Padding(
                      padding: Insets.bottomMd,
                      child: Text(
                        '$label$resetsStr',
                        style: TextStyle(
                          color: theme.textMuted,
                          fontSize: 12,
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 6),
              Padding(
                padding: Insets.screenH,
                child: Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        onPressed: startChatgptLogin,
                        child: const Text('Login (ChatGPT)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () async {
                          await ref.read(bridgeServiceProvider).cxLogout();
                          if (!context.mounted) return;
                          Navigator.pop(context);
                        },
                        child: const Text('Logout'),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(height: Spacing.md),
              Padding(
                padding: Insets.screenH,
                child: TextField(
                  controller: apiKeyController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'API key (optional)',
                    hintText: 'sk-...',
                  ),
                ),
              ),
              SizedBox(height: Spacing.sm),
              Padding(
                padding: Insets.screenH,
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () async {
                          final key = apiKeyController.text.trim();
                          if (key.isEmpty) return;
                          await ref
                              .read(bridgeServiceProvider)
                              .cxLoginStartApiKey(key);
                          if (!context.mounted) return;
                          Navigator.pop(context);
                        },
                        child: const Text('Login (API key)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextButton(
                        onPressed: cancelLogin,
                        child: const Text('Cancel login'),
                      ),
                    ),
                  ],
                ),
              ),
              if (authUrl != null && authUrl!.isNotEmpty) ...[
                SizedBox(height: Spacing.md),
                Padding(
                  padding: Insets.screenH,
                  child: Text(
                    'ChatGPT login URL (open on the host machine running Broski Bridge):',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: Insets.screenH,
                  child: SelectableText(
                    authUrl!,
                    style: AppTypography.codeSmall(color: theme.text),
                  ),
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: Insets.screenH,
                  child: Row(
                    children: [
                      TextButton(
                        onPressed: () async {
                          final uri = Uri.tryParse(authUrl!);
                          if (uri == null) return;
                          await launchUrl(
                            uri,
                            mode: LaunchMode.externalApplication,
                          );
                        },
                        child: const Text('Open'),
                      ),
                      SizedBox(width: Spacing.sm),
                      TextButton(
                        onPressed: () async {
                          await Clipboard.setData(
                            ClipboardData(text: authUrl!),
                          );
                        },
                        child: const Text('Copy'),
                      ),
                    ],
                  ),
                ),
              ],
              SizedBox(height: Spacing.lg),
            ],
          ),
        );
      },
    ),
  ).whenComplete(apiKeyController.dispose);
}
