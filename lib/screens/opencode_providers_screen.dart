import 'package:broski/models/provider.dart';
import 'package:broski/providers/opencode_providers_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/sheets/oc_auth_prompts_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/opencode/provider_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class OpenCodeProvidersScreen extends ConsumerStatefulWidget {
  const OpenCodeProvidersScreen({super.key});

  @override
  ConsumerState<OpenCodeProvidersScreen> createState() =>
      _OpenCodeProvidersScreenState();
}

class _OpenCodeProvidersScreenState
    extends ConsumerState<OpenCodeProvidersScreen> {
  final Set<String> _expanded = {};
  bool _actionInProgress = false;

  String? get _projectPath => ref.read(selectionProvider).project?.path;

  void _invalidate() =>
      ref.invalidate(ocProvidersDisplayProvider(_projectPath));

  // ── Set API Key ──────────────────────────────────────────────────────────

  Future<void> _showSetApiKeyDialog(OcProviderDisplay provider) async {
    final oc = OpenCodeTheme.of(context);
    final keyController = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Set API Key — ${provider.details.name}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Enter the API key for ${provider.details.name}.',
              style: TextStyle(color: oc.textMuted, fontSize: 13),
            ),
            const SizedBox(height: Spacing.md),
            TextField(
              controller: keyController,
              obscureText: true,
              decoration: const InputDecoration(
                hintText: 'sk-...',
                border: OutlineInputBorder(),
              ),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, keyController.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (result == null || result.isEmpty || !mounted) return;

    setState(() => _actionInProgress = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.authSet(provider.details.id, {
        'token': result,
      }, projectPath: _projectPath);
      if (!mounted) return;
      if (ok) {
        showSuccess(context, 'API key saved');
      } else {
        showError(context, 'Failed to save API key');
      }
      if (ok) _invalidate();
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed: ${humanizeError(e)}');
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  // ── Remove Auth ──────────────────────────────────────────────────────────

  Future<void> _removeAuth(OcProviderDisplay provider) async {
    final oc = OpenCodeTheme.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Remove Auth — ${provider.details.name}'),
        content: Text(
          'Remove the saved credentials for ${provider.details.name}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: oc.error),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _actionInProgress = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.authRemove(
        provider.details.id,
        projectPath: _projectPath,
      );
      if (!mounted) return;
      if (ok) {
        showSuccess(context, 'Credentials removed');
      } else {
        showError(context, 'Failed to remove');
      }
      if (ok) _invalidate();
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed: ${humanizeError(e)}');
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  // ── OAuth Flow ───────────────────────────────────────────────────────────

  Future<void> _startOAuth(OcProviderDisplay provider, int methodIndex) async {
    // If this auth method has prompts, collect inputs first
    final authMethod = provider.authMethods[methodIndex];
    Map<String, String>? inputs;
    if (authMethod.hasPrompts) {
      inputs = await showAuthPromptsDialog(
        context: context,
        providerName: provider.details.name,
        prompts: authMethod.prompts,
      );
      if (inputs == null || !mounted) return; // user cancelled
    }

    setState(() => _actionInProgress = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final authResult = await bridge.providerOauthAuthorize(
        providerId: provider.details.id,
        method: methodIndex,
        projectPath: _projectPath,
        inputs: inputs,
      );
      if (!mounted) return;
      if (authResult == null) {
        showError(context, 'Failed to start OAuth');
        return;
      }

      if (authResult.requiresCode) {
        await _oauthCodeFlow(provider, methodIndex, authResult);
      } else {
        showInfo(context, 'Authenticating on your computer…');
        final ok = await bridge.providerOauthCallback(
          providerId: provider.details.id,
          method: methodIndex,
          projectPath: _projectPath,
        );
        if (!mounted) return;
        if (ok) {
          showSuccess(context, 'Authenticated');
        } else {
          showError(context, 'Auth failed');
        }
        if (ok) _invalidate();
      }
    } catch (e) {
      if (!mounted) return;
      showError(context, 'OAuth failed: ${humanizeError(e)}');
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  Future<void> _oauthCodeFlow(
    OcProviderDisplay provider,
    int methodIndex,
    ProviderAuthAuthorization authResult,
  ) async {
    final oc = OpenCodeTheme.of(context);
    final code = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final codeCtrl = TextEditingController();
        return AlertDialog(
          title: Text('Authenticate ${provider.details.name}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (authResult.instructions.isNotEmpty)
                Padding(
                  padding: Insets.bottomMd,
                  child: Text(
                    authResult.instructions,
                    style: TextStyle(color: oc.textMuted, fontSize: 13),
                  ),
                ),
              const Text('Open this URL in your browser:'),
              const SizedBox(height: 8),
              SelectableText(
                authResult.url,
                style: TextStyle(fontSize: 12, color: oc.primary),
              ),
              const SizedBox(height: 16),
              const Text('Then paste the authorization code:'),
              const SizedBox(height: 8),
              TextField(
                controller: codeCtrl,
                decoration: const InputDecoration(
                  hintText: 'Authorization code',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, codeCtrl.text.trim()),
              child: const Text('Submit'),
            ),
          ],
        );
      },
    );
    if (code == null || code.isEmpty || !mounted) return;

    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.providerOauthCallback(
      providerId: provider.details.id,
      method: methodIndex,
      code: code,
      projectPath: _projectPath,
    );
    if (!mounted) return;
    if (ok) {
      showSuccess(context, 'Authenticated');
    } else {
      showError(context, 'Auth failed');
    }
    if (ok) _invalidate();
  }

  // ── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final providersAsync = ref.watch(ocProvidersDisplayProvider(_projectPath));

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('Providers', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          if (_actionInProgress)
            Padding(
              padding: const EdgeInsets.only(right: 14),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: oc.primary,
                ),
              ),
            )
          else
            IconButton(
              icon: const Icon(AppIcons.refresh),
              onPressed: _invalidate,
              tooltip: 'Refresh',
            ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: providersAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Padding(
              padding: Insets.cardLg,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(humanizeError(e), style: TextStyle(color: oc.error)),
                  const SizedBox(height: Spacing.md),
                  ElevatedButton(
                    onPressed: _invalidate,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
          data: (providers) => providers.isEmpty
              ? Center(
                  child: Text(
                    'No providers found',
                    style: TextStyle(color: oc.textMuted),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  itemCount: providers.length,
                  itemBuilder: (_, i) => ProviderCard(
                    provider: providers[i],
                    expanded: _expanded.contains(providers[i].details.id),
                    onToggleExpand: () => setState(() {
                      final id = providers[i].details.id;
                      _expanded.contains(id)
                          ? _expanded.remove(id)
                          : _expanded.add(id);
                    }),
                    onSetApiKey: () => _showSetApiKeyDialog(providers[i]),
                    onRemoveAuth: () => _removeAuth(providers[i]),
                    onOAuth: (idx) => _startOAuth(providers[i], idx),
                  ),
                ),
        ),
      ),
    );
  }
}
