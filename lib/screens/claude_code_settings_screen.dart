import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'claude_code_sandbox_screen.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';

class ClaudeCodeSettingsScreen extends ConsumerStatefulWidget {
  const ClaudeCodeSettingsScreen({super.key});
  @override
  ConsumerState<ClaudeCodeSettingsScreen> createState() =>
      _ClaudeCodeSettingsScreenState();
}

class _ClaudeCodeSettingsScreenState
    extends ConsumerState<ClaudeCodeSettingsScreen> {
  bool _loading = true;
  String? _error;
  ClaudeCodeConfig? _config;
  List<ClaudeCodeSupportedModel> _supportedModels = const [];
  ClaudeCodeAccountInfo? _accountInfo;
  // SDK v2.1.6: Search functionality in /config
  final _searchController = TextEditingController();
  String _searchQuery = '';
  static const _languages = <String>[
    'english',
    'japanese',
    'spanish',
    'french',
    'german',
    'chinese',
    'korean',
  ];
  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.toLowerCase());
    });
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// Check if a setting matches the search query
  bool _matches(String label) {
    if (_searchQuery.isEmpty) return true;
    return label.toLowerCase().contains(_searchQuery);
  }

  /// Build a setting card with consistent styling
  Widget _buildSettingCard({
    required OpenCodeTheme oc,
    required String title,
    required Widget child,
  }) {
    return Padding(
      padding: Insets.bottomMd,
      child: Card(
        color: oc.backgroundPanel,
        shape: RoundedRectangleBorder(
          borderRadius: Radii.brLg,
          side: BorderSide(color: oc.borderSubtle.withValues(alpha: 0.2)),
        ),
        child: Padding(
          padding: Insets.cardMd,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(color: oc.text, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              child,
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    if (cwd == null || cwd.isEmpty) {
      setState(() {
        _config = null;
        _loading = false;
      });
      return;
    }
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final cfg = await bridge.ccGetConfig(cwd: cwd);
      List<ClaudeCodeSupportedModel> models = const [];
      ClaudeCodeAccountInfo? accountInfo;
      try {
        models = await bridge.ccGetSupportedModels(cwd: cwd);
      } catch (_) {
        models = const [];
      }
      try {
        accountInfo = await bridge.ccGetAccountInfo(cwd: cwd);
      } catch (_) {
        accountInfo = null;
      }
      if (!mounted) return;
      setState(() {
        _config = cfg;
        _supportedModels = models;
        _accountInfo = accountInfo;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  Future<void> _update(ClaudeCodeConfig next) async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    if (cwd == null || cwd.isEmpty) return;
    setState(() {
      _config = next;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final updated = await bridge.ccSetConfig(next, cwd: cwd);
      if (!mounted) return;
      setState(() => _config = updated);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = humanizeError(e));
    }
  }

  Future<void> _showAddToolDialog(
    ClaudeCodeConfig cfg, {
    required bool isAllowed,
  }) async {
    final controller = TextEditingController();
    final presets = <String>[
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'Bash',
      'Bash(npm *)',
      'Bash(git *)',
      'Bash(*)',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'Task',
      'TodoRead',
      'TodoWrite',
      'NotebookEdit',
      'mcp__*',
    ];
    final oc = OpenCodeTheme.of(context);
    final result = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isAllowed ? 'Add Allowed Tool' : 'Add Disallowed Tool'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: controller,
                decoration: const InputDecoration(
                  hintText: 'e.g. Bash(npm *)',
                  labelText: 'Tool name or pattern',
                ),
                autofocus: true,
              ),
              SizedBox(height: Spacing.md),
              Text('Presets:', style: AppTypography.label(color: oc.textMuted)),
              const SizedBox(height: 6),
              SizedBox(
                height: 200,
                child: SingleChildScrollView(
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: presets.map((p) {
                      return ActionChip(
                        label: Text(p, style: const TextStyle(fontSize: 11)),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => Navigator.pop(ctx, p),
                      );
                    }).toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result == null || result.isEmpty) return;
    if (isAllowed) {
      if (!cfg.allowedTools.contains(result)) {
        final next = [...cfg.allowedTools, result];
        await _update(cfg.copyWith(allowedTools: next));
      }
    } else {
      if (!cfg.disallowedTools.contains(result)) {
        final next = [...cfg.disallowedTools, result];
        await _update(cfg.copyWith(disallowedTools: next));
      }
    }
  }

  Future<String?> _showTextValueDialog({
    required String title,
    String? initialValue,
    String? hintText,
    bool multiline = false,
    bool allowClear = false,
  }) async {
    final controller = TextEditingController(text: initialValue ?? '');
    final result = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: multiline ? 3 : 1,
          maxLines: multiline ? 8 : 1,
          decoration: InputDecoration(hintText: hintText),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Cancel'),
          ),
          if (allowClear)
            TextButton(
              onPressed: () => Navigator.pop(ctx, ''),
              child: const Text('Clear'),
            ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  // ── Thinking Mode radio tiles ──────────────────────────────────────────
  List<Widget> _buildThinkingModeRadios(
    ClaudeCodeConfig? cfg,
    OpenCodeTheme oc,
    ClaudeCodeSupportedModel? selectedModel,
  ) {
    if (cfg == null) return [];
    final current = cfg.thinking;
    // Determine which radio is selected
    final String selected;
    if (current == null) {
      selected = 'default'; // No thinking config = use SDK default
    } else if (current is ClaudeCodeThinkingAdaptive) {
      selected = 'adaptive';
    } else if (current is ClaudeCodeThinkingEnabled) {
      selected = 'enabled';
    } else {
      selected = 'disabled';
    }

    final adaptiveSupported = selectedModel?.supportsAdaptiveThinking != false;

    return [
      RadioListTile<String>(
        contentPadding: EdgeInsets.zero,
        dense: true,
        title: const Text('Default'),
        subtitle: Text(
          'Use SDK default (adaptive on Opus 4.6+)',
          style: AppTypography.label(color: oc.textMuted),
        ),
        value: 'default',
        groupValue: selected,
        onChanged: (_) => _update(cfg.copyWith(clearThinking: true)),
      ),
      RadioListTile<String>(
        contentPadding: EdgeInsets.zero,
        dense: true,
        title: const Text('Adaptive'),
        subtitle: Text(
          adaptiveSupported
              ? 'Claude decides when and how much to think'
              : 'Selected model does not report adaptive thinking support',
          style: AppTypography.label(color: oc.textMuted),
        ),
        value: 'adaptive',
        groupValue: selected,
        onChanged: adaptiveSupported
            ? (_) => _update(
                cfg.copyWith(thinking: const ClaudeCodeThinkingAdaptive()),
              )
            : null,
      ),
      RadioListTile<String>(
        contentPadding: EdgeInsets.zero,
        dense: true,
        title: const Text('Enabled (fixed budget)'),
        subtitle: Text(
          current is ClaudeCodeThinkingEnabled
              ? '${current.budgetTokens} tokens'
              : 'Set a fixed thinking token budget',
          style: AppTypography.label(color: oc.textMuted),
        ),
        value: 'enabled',
        groupValue: selected,
        onChanged: (_) async {
          // Show dialog for budget tokens
          final currentBudget = current is ClaudeCodeThinkingEnabled
              ? current.budgetTokens
              : 16384;
          final controller = TextEditingController(
            text: currentBudget.toString(),
          );
          final result = await showDialog<int?>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('Thinking budget (tokens)'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: controller,
                    keyboardType: TextInputType.number,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'e.g. 16384',
                      labelText: 'Max thinking tokens',
                    ),
                  ),
                  SizedBox(height: Spacing.sm),
                  Text(
                    'Common values: 4096 (quick), 16384 (balanced), 65536 (deep)',
                    style: AppTypography.label(color: oc.textMuted),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, null),
                  child: const Text('Cancel'),
                ),
                TextButton(
                  onPressed: () {
                    final parsed = int.tryParse(controller.text.trim());
                    Navigator.pop(ctx, parsed ?? 16384);
                  },
                  child: const Text('Save'),
                ),
              ],
            ),
          );
          controller.dispose();
          if (result == null) return;
          await _update(
            cfg.copyWith(
              thinking: ClaudeCodeThinkingEnabled(budgetTokens: result),
            ),
          );
        },
      ),
      RadioListTile<String>(
        contentPadding: EdgeInsets.zero,
        dense: true,
        title: const Text('Disabled'),
        subtitle: Text(
          'No extended thinking',
          style: AppTypography.label(color: oc.textMuted),
        ),
        value: 'disabled',
        groupValue: selected,
        onChanged: (_) =>
            _update(cfg.copyWith(thinking: const ClaudeCodeThinkingDisabled())),
      ),
    ];
  }

  String _modelLabel(ClaudeCodeSupportedModel model) {
    final capabilities = <String>[];
    if (model.supportsEffort == true) capabilities.add('Effort');
    if (model.supportsAdaptiveThinking == true) capabilities.add('Adaptive');
    if (capabilities.isEmpty) return model.displayName;
    return '${model.displayName} (${capabilities.join(', ')})';
  }

  // ── Effort chip helper ────────────────────────────────────────────────
  Widget _effortChip(
    ClaudeCodeConfig? cfg,
    OpenCodeTheme oc,
    ClaudeCodeEffort? value,
    String label, {
    bool enabled = true,
  }) {
    final isSelected = cfg?.effort == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: cfg == null || !enabled
          ? null
          : (_) async {
              if (value == null) {
                await _update(cfg.copyWith(clearEffort: true));
              } else {
                await _update(cfg.copyWith(effort: value));
              }
            },
      selectedColor: oc.accent.withValues(alpha: 0.2),
      labelStyle: TextStyle(
        color: !enabled ? oc.textMuted : (isSelected ? oc.accent : oc.text),
        fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
        fontSize: 13,
      ),
      visualDensity: VisualDensity.compact,
    );
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final selection = ref.watch(selectionProvider);
    final cwd = selection.project?.path;
    final hasProject = cwd != null && cwd.isNotEmpty;
    final cfg = _config;
    final languageValue = (cfg?.language ?? '').trim();
    final hasKnownLanguage = _languages.contains(languageValue);
    final dropdownLanguage = languageValue.isEmpty
        ? null
        : (hasKnownLanguage ? languageValue : 'custom');
    final release = (cfg?.releaseChannel ?? '').trim();
    final releaseValue = (release == 'stable' || release == 'latest')
        ? release
        : null;
    final selectedModelValue = cfg?.model ?? 'default';
    ClaudeCodeSupportedModel? selectedModel;
    for (final model in _supportedModels) {
      if (model.value == selectedModelValue) {
        selectedModel = model;
        break;
      }
    }
    final supportsEffort = selectedModel?.supportsEffort != false;
    final supportedEfforts =
        selectedModel?.supportedEffortLevels
            ?.map(ClaudeCodeEffort.fromWireValue)
            .whereType<ClaudeCodeEffort>()
            .toList() ??
        ClaudeCodeEffort.values;
    final systemPrompt = cfg?.systemPrompt ?? const ClaudeCodeSystemPrompt();
    final systemPromptMode = systemPrompt.isEmpty
        ? 'none'
        : (systemPrompt.preset != null ? 'preset' : 'custom');
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: const Text('Claude Code settings'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(AppIcons.refresh),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SafeArea(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : !hasProject
              ? Center(
                  child: Padding(
                    padding: Insets.card,
                    child: Text(
                      'Select a project to edit Claude Code settings.',
                      style: TextStyle(color: oc.textMuted),
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  padding: Insets.card,
                  children: [
                    if (_error != null) ...[
                      Container(
                        padding: Insets.cardSm,
                        decoration: BoxDecoration(
                          color: oc.error.withValues(alpha: 0.12),
                          borderRadius: Radii.brMd,
                          border: Border.all(
                            color: oc.error.withValues(alpha: 0.35),
                          ),
                        ),
                        child: Text(
                          _error!,
                          style: AppTypography.label(color: oc.text),
                        ),
                      ),
                      SizedBox(height: Spacing.md),
                    ],
                    // SDK v2.1.6: Search functionality in /config
                    TextField(
                      controller: _searchController,
                      decoration: InputDecoration(
                        hintText: 'Search settings...',
                        hintStyle: TextStyle(color: oc.textMuted),
                        prefixIcon: Icon(AppIcons.search, color: oc.textMuted),
                        suffixIcon: _searchQuery.isNotEmpty
                            ? IconButton(
                                icon: Icon(AppIcons.close, color: oc.textMuted),
                                onPressed: () => _searchController.clear(),
                              )
                            : null,
                        filled: true,
                        fillColor: oc.backgroundPanel,
                        border: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                      ),
                      style: TextStyle(color: oc.text),
                    ),
                    SizedBox(height: Spacing.md),
                    Text(
                      'Broski-managed settings (applied when sessions run through the bridge).',
                      style: AppTypography.label(color: oc.textMuted),
                    ),
                    const SizedBox(height: 14),
                    // Permission Mode (SDK v2.0.43)
                    if (_matches('permission mode security'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Permission Mode',
                        child:
                            DropdownButtonFormField<ClaudeCodePermissionMode>(
                              // ignore: deprecated_member_use
                              value:
                                  cfg?.permissionMode ??
                                  ClaudeCodePermissionMode.defaultMode,
                              decoration: const InputDecoration(
                                labelText: 'How Claude handles permissions',
                              ),
                              items: ClaudeCodePermissionMode.values.map((m) {
                                return DropdownMenuItem(
                                  value: m,
                                  child: Text(m.displayName),
                                );
                              }).toList(),
                              onChanged: cfg == null
                                  ? null
                                  : (value) async {
                                      if (value != null) {
                                        await _update(
                                          cfg.copyWith(permissionMode: value),
                                        );
                                      }
                                    },
                            ),
                      ),
                    // Model override
                    if (_matches('model sonnet opus haiku dynamic'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Model',
                        child: DropdownButtonFormField<String?>(
                          // ignore: deprecated_member_use
                          value: cfg?.model,
                          decoration: const InputDecoration(
                            labelText: 'Default model',
                          ),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('Default'),
                            ),
                            ...(_supportedModels.isNotEmpty
                                    ? _supportedModels
                                    : const <ClaudeCodeSupportedModel>[
                                        ClaudeCodeSupportedModel(
                                          value: 'sonnet',
                                          displayName: 'Claude Sonnet',
                                          description: '',
                                        ),
                                        ClaudeCodeSupportedModel(
                                          value: 'opus',
                                          displayName: 'Claude Opus',
                                          description: '',
                                        ),
                                        ClaudeCodeSupportedModel(
                                          value: 'haiku',
                                          displayName: 'Claude Haiku',
                                          description: '',
                                        ),
                                      ])
                                .map(
                                  (model) => DropdownMenuItem<String?>(
                                    value: model.value,
                                    child: Text(_modelLabel(model)),
                                  ),
                                ),
                          ],
                          onChanged: cfg == null
                              ? null
                              : (value) async {
                                  await _update(cfg.copyWith(model: value));
                                },
                        ),
                      ),
                    if (_matches(
                      'system prompt append preset custom instructions',
                    ))
                      _buildSettingCard(
                        oc: oc,
                        title: 'System Prompt',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            DropdownButtonFormField<String>(
                              // ignore: deprecated_member_use
                              value: systemPromptMode,
                              decoration: const InputDecoration(
                                labelText: 'Prompt mode',
                              ),
                              items: const [
                                DropdownMenuItem(
                                  value: 'none',
                                  child: Text('None'),
                                ),
                                DropdownMenuItem(
                                  value: 'preset',
                                  child: Text('Claude Code preset'),
                                ),
                                DropdownMenuItem(
                                  value: 'custom',
                                  child: Text('Custom prompt'),
                                ),
                              ],
                              onChanged: cfg == null
                                  ? null
                                  : (value) async {
                                      if (value == null) return;
                                      if (value == 'none') {
                                        await _update(
                                          cfg.copyWith(
                                            systemPrompt:
                                                const ClaudeCodeSystemPrompt(),
                                          ),
                                        );
                                        return;
                                      }
                                      if (value == 'preset') {
                                        final existingAppend =
                                            cfg.systemPrompt?.preset != null
                                            ? cfg.systemPrompt?.append
                                            : null;
                                        await _update(
                                          cfg.copyWith(
                                            systemPrompt:
                                                ClaudeCodeSystemPrompt(
                                                  preset: 'claude_code',
                                                  append: existingAppend,
                                                ),
                                          ),
                                        );
                                        return;
                                      }
                                      final customValue =
                                          await _showTextValueDialog(
                                            title: 'Custom system prompt',
                                            initialValue:
                                                cfg.systemPrompt?.text ?? '',
                                            hintText:
                                                'Provide default instructions for Claude.',
                                            multiline: true,
                                          );
                                      if (customValue == null) return;
                                      final trimmed = customValue.trim();
                                      await _update(
                                        cfg.copyWith(
                                          systemPrompt: trimmed.isEmpty
                                              ? const ClaudeCodeSystemPrompt()
                                              : ClaudeCodeSystemPrompt(
                                                  text: trimmed,
                                                ),
                                        ),
                                      );
                                    },
                            ),
                            if (systemPromptMode == 'preset') ...[
                              SizedBox(height: Spacing.sm),
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: const Text('Additional instructions'),
                                subtitle: Text(
                                  (systemPrompt.append ?? '').trim().isEmpty
                                      ? 'None'
                                      : systemPrompt.append!,
                                ),
                                trailing: const Icon(AppIcons.edit, size: 18),
                                onTap: cfg == null
                                    ? null
                                    : () async {
                                        final appendValue = await _showTextValueDialog(
                                          title:
                                              'Preset additional instructions',
                                          initialValue:
                                              systemPrompt.append ?? '',
                                          hintText:
                                              'Optional extra instruction text.',
                                          multiline: true,
                                          allowClear: true,
                                        );
                                        if (appendValue == null) return;
                                        final trimmed = appendValue.trim();
                                        await _update(
                                          cfg.copyWith(
                                            systemPrompt:
                                                ClaudeCodeSystemPrompt(
                                                  preset: 'claude_code',
                                                  append: trimmed.isEmpty
                                                      ? null
                                                      : trimmed,
                                                ),
                                          ),
                                        );
                                      },
                              ),
                            ],
                            if (systemPromptMode == 'custom') ...[
                              SizedBox(height: Spacing.sm),
                              Text(
                                (systemPrompt.text ?? '').trim().isEmpty
                                    ? 'No custom prompt configured.'
                                    : systemPrompt.text!,
                                maxLines: 5,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: oc.textMuted,
                                  fontSize: 12,
                                  height: 1.4,
                                ),
                              ),
                              SizedBox(height: Spacing.sm),
                              OutlinedButton.icon(
                                onPressed: cfg == null
                                    ? null
                                    : () async {
                                        final customValue =
                                            await _showTextValueDialog(
                                              title: 'Custom system prompt',
                                              initialValue:
                                                  systemPrompt.text ?? '',
                                              hintText:
                                                  'Provide default instructions for Claude.',
                                              multiline: true,
                                              allowClear: true,
                                            );
                                        if (customValue == null) return;
                                        final trimmed = customValue.trim();
                                        await _update(
                                          cfg.copyWith(
                                            systemPrompt: trimmed.isEmpty
                                                ? const ClaudeCodeSystemPrompt()
                                                : ClaudeCodeSystemPrompt(
                                                    text: trimmed,
                                                  ),
                                          ),
                                        );
                                      },
                                icon: const Icon(AppIcons.edit, size: 16),
                                label: const Text('Edit custom prompt'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    // Thinking Mode (SDK 0.2.42+)
                    if (_matches(
                      'thinking mode adaptive enabled disabled reasoning',
                    ))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Thinking Mode',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Controls Claude\'s reasoning behavior. Adaptive lets Claude decide; Enabled sets a fixed token budget; Disabled turns off extended thinking.',
                              style: AppTypography.label(color: oc.textMuted),
                            ),
                            SizedBox(height: Spacing.sm),
                            ..._buildThinkingModeRadios(cfg, oc, selectedModel),
                          ],
                        ),
                      ),
                    // Effort Level (SDK 0.2.42+)
                    if (_matches(
                      'effort level low medium high max reasoning depth',
                    ))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Effort',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Controls how much effort Claude puts into responses. Works with adaptive thinking to guide reasoning depth.',
                              style: AppTypography.label(color: oc.textMuted),
                            ),
                            SizedBox(height: Spacing.sm),
                            if (!supportsEffort)
                              Text(
                                'Selected model does not report effort support.',
                                style: AppTypography.label(color: oc.textMuted),
                              ),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                _effortChip(
                                  cfg,
                                  oc,
                                  null,
                                  'Default',
                                  enabled: supportsEffort,
                                ),
                                ...supportedEfforts.map(
                                  (e) => _effortChip(
                                    cfg,
                                    oc,
                                    e,
                                    e.displayName,
                                    enabled: supportsEffort,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    if (_matches('prompt suggestions next prompt suggestion'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Prompt Suggestions',
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: cfg?.promptSuggestions ?? false,
                          title: const Text('Enable prompt suggestions'),
                          subtitle: const Text(
                            'Claude suggests a likely next prompt after each completed turn.',
                          ),
                          onChanged: cfg == null
                              ? null
                              : (enabled) async {
                                  await _update(
                                    cfg.copyWith(promptSuggestions: enabled),
                                  );
                                },
                        ),
                      ),
                    if (_matches('claude ai mcp servers managed mcp'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Claude.ai MCP Servers',
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: cfg?.enableClaudeAiMcpServers ?? true,
                          title: const Text('Enable Claude.ai managed MCP servers'),
                          subtitle: const Text(
                            'Disable to opt out of Claude.ai-provided MCP servers for this workspace.',
                          ),
                          onChanged: cfg == null
                              ? null
                              : (enabled) async {
                                  await _update(
                                    cfg.copyWith(
                                      enableClaudeAiMcpServers: enabled,
                                    ),
                                  );
                                },
                        ),
                      ),
                    if (_matches('1m context beta'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Context Window',
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: (cfg?.betas ?? const <String>[]).contains(
                            'context-1m-2025-08-07',
                          ),
                          title: const Text('Enable 1M context beta'),
                          subtitle: const Text(
                            'Adds beta header context-1m-2025-08-07 for supported models.',
                          ),
                          onChanged: cfg == null
                              ? null
                              : (enabled) async {
                                  final betas = <String>{
                                    ...(cfg.betas ?? const <String>[]),
                                  };
                                  if (enabled) {
                                    betas.add('context-1m-2025-08-07');
                                  } else {
                                    betas.remove('context-1m-2025-08-07');
                                  }
                                  await _update(
                                    cfg.copyWith(betas: betas.toList()),
                                  );
                                },
                        ),
                      ),
                    if (_matches('budget max budget usd'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Budget',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Max budget (USD)'),
                          subtitle: Text(
                            cfg?.maxBudgetUsd == null || cfg!.maxBudgetUsd! <= 0
                                ? 'No limit'
                                : '\$${cfg.maxBudgetUsd!.toStringAsFixed(2)} per turn',
                          ),
                          trailing: const Icon(AppIcons.edit, size: 18),
                          onTap: cfg == null
                              ? null
                              : () async {
                                  final controller = TextEditingController(
                                    text: cfg.maxBudgetUsd?.toString() ?? '',
                                  );
                                  final value = await showDialog<double?>(
                                    context: context,
                                    builder: (ctx) => AlertDialog(
                                      title: const Text('Max budget (USD)'),
                                      content: TextField(
                                        controller: controller,
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        decoration: const InputDecoration(
                                          hintText: 'e.g. 10.0',
                                        ),
                                      ),
                                      actions: [
                                        TextButton(
                                          onPressed: () =>
                                              Navigator.pop(ctx, null),
                                          child: const Text('Clear'),
                                        ),
                                        TextButton(
                                          onPressed: () {
                                            final parsed = double.tryParse(
                                              controller.text.trim(),
                                            );
                                            Navigator.pop(ctx, parsed);
                                          },
                                          child: const Text('Save'),
                                        ),
                                      ],
                                    ),
                                  );
                                  controller.dispose();
                                  await _update(
                                    cfg.copyWith(
                                      maxBudgetUsd: value != null && value > 0
                                          ? value
                                          : 0,
                                    ),
                                  );
                                },
                        ),
                      ),
                    if (_matches('turn max turns'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Turn Limit',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Max turns'),
                          subtitle: Text(
                            cfg?.maxTurns == null || cfg!.maxTurns! <= 0
                                ? 'No limit'
                                : '${cfg.maxTurns} turns',
                          ),
                          trailing: const Icon(AppIcons.edit, size: 18),
                          onTap: cfg == null
                              ? null
                              : () async {
                                  final controller = TextEditingController(
                                    text: cfg.maxTurns?.toString() ?? '',
                                  );
                                  final value = await showDialog<int?>(
                                    context: context,
                                    builder: (ctx) => AlertDialog(
                                      title: const Text('Max turns'),
                                      content: TextField(
                                        controller: controller,
                                        keyboardType: TextInputType.number,
                                        decoration: const InputDecoration(
                                          hintText: 'e.g. 25',
                                        ),
                                      ),
                                      actions: [
                                        TextButton(
                                          onPressed: () =>
                                              Navigator.pop(ctx, null),
                                          child: const Text('Clear'),
                                        ),
                                        TextButton(
                                          onPressed: () {
                                            final parsed = int.tryParse(
                                              controller.text.trim(),
                                            );
                                            Navigator.pop(ctx, parsed);
                                          },
                                          child: const Text('Save'),
                                        ),
                                      ],
                                    ),
                                  );
                                  controller.dispose();
                                  await _update(
                                    cfg.copyWith(
                                      maxTurns: value != null && value > 0
                                          ? value
                                          : 0,
                                    ),
                                  );
                                },
                        ),
                      ),
                    if (_matches('agent teams teammate taskcompleted'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Agent Teams',
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: cfg?.enableAgentTeams ?? false,
                          title: const Text('Enable experimental agent teams'),
                          subtitle: const Text(
                            'Allows Claude to delegate work across teammate agents.',
                          ),
                          onChanged: cfg == null
                              ? null
                              : (enabled) async {
                                  await _update(
                                    cfg.copyWith(enableAgentTeams: enabled),
                                  );
                                },
                        ),
                      ),
                    if (_matches('sandbox security excluded commands'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Sandbox',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            AppIcons.security,
                            color: (cfg?.sandbox?.enabled ?? false)
                                ? oc.accent
                                : oc.textMuted,
                            size: 22,
                          ),
                          title: Text(
                            (cfg?.sandbox?.enabled ?? false)
                                ? 'Sandbox enabled'
                                : 'Sandbox disabled',
                            style: TextStyle(color: oc.text),
                          ),
                          subtitle: Text(
                            'Configure sandbox mode, network, excluded commands.',
                            style: AppTypography.label(color: oc.textMuted),
                          ),
                          trailing: Icon(
                            AppIcons.chevronRight,
                            color: oc.textMuted,
                          ),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const ClaudeCodeSandboxScreen(),
                              ),
                            ).then((_) => _load());
                          },
                        ),
                      ),
                    if (_matches('account usage organization token source'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Account',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _accountInfo?.email ?? 'Unknown account',
                              style: TextStyle(
                                color: oc.text,
                                fontWeight: FontWeight.w600,
                                fontSize: 13,
                              ),
                            ),
                            SizedBox(height: Spacing.xs),
                            Text(
                              [
                                if ((_accountInfo?.organization ?? '')
                                    .trim()
                                    .isNotEmpty)
                                  'Org: ${_accountInfo!.organization}',
                                if ((_accountInfo?.subscriptionType ?? '')
                                    .trim()
                                    .isNotEmpty)
                                  'Plan: ${_accountInfo!.subscriptionType}',
                                if ((_accountInfo?.apiKeySource ?? '')
                                    .trim()
                                    .isNotEmpty)
                                  'Key source: ${_accountInfo!.apiKeySource}',
                              ].join(' • '),
                              style: AppTypography.label(color: oc.textMuted),
                            ),
                          ],
                        ),
                      ),
                    // Allowed Tools (SDK v2.1.0 wildcards)
                    if (_matches('allowed tools permissions bash wildcard'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Allowed Tools',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Tools Claude is allowed to use. Supports wildcards like Bash(npm *)',
                              style: AppTypography.label(color: oc.textMuted),
                            ),
                            SizedBox(height: Spacing.sm),
                            if (cfg != null && cfg.allowedTools.isNotEmpty)
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: cfg.allowedTools.map((tool) {
                                  return Chip(
                                    label: Text(
                                      tool,
                                      style: const TextStyle(fontSize: 12),
                                    ),
                                    deleteIcon: const Icon(
                                      AppIcons.close,
                                      size: 16,
                                    ),
                                    onDeleted: () {
                                      final next = List<String>.from(
                                        cfg.allowedTools,
                                      )..remove(tool);
                                      _update(cfg.copyWith(allowedTools: next));
                                    },
                                    materialTapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                    visualDensity: VisualDensity.compact,
                                  );
                                }).toList(),
                              ),
                            SizedBox(height: Spacing.sm),
                            OutlinedButton.icon(
                              icon: const Icon(AppIcons.add, size: 16),
                              label: const Text('Add Tool'),
                              onPressed: cfg == null
                                  ? null
                                  : () => _showAddToolDialog(
                                      cfg,
                                      isAllowed: true,
                                    ),
                            ),
                          ],
                        ),
                      ),
                    // Disallowed Tools (SDK v2.0.30)
                    if (_matches('disallowed blocked tools'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Disallowed Tools',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Tools Claude cannot use. Use Task(AgentName) to disable agents.',
                              style: AppTypography.label(color: oc.textMuted),
                            ),
                            SizedBox(height: Spacing.sm),
                            if (cfg != null && cfg.disallowedTools.isNotEmpty)
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: cfg.disallowedTools.map((tool) {
                                  return Chip(
                                    label: Text(
                                      tool,
                                      style: const TextStyle(fontSize: 12),
                                    ),
                                    deleteIcon: const Icon(
                                      AppIcons.close,
                                      size: 16,
                                    ),
                                    onDeleted: () {
                                      final next = List<String>.from(
                                        cfg.disallowedTools,
                                      )..remove(tool);
                                      _update(
                                        cfg.copyWith(disallowedTools: next),
                                      );
                                    },
                                    materialTapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                    visualDensity: VisualDensity.compact,
                                  );
                                }).toList(),
                              ),
                            SizedBox(height: Spacing.sm),
                            OutlinedButton.icon(
                              icon: const Icon(AppIcons.add, size: 16),
                              label: const Text('Add Tool'),
                              onPressed: cfg == null
                                  ? null
                                  : () => _showAddToolDialog(
                                      cfg,
                                      isAllowed: false,
                                    ),
                            ),
                          ],
                        ),
                      ),
                    // Language setting
                    if (_matches('language response'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Language',
                        child: DropdownButtonFormField<String?>(
                          // ignore: deprecated_member_use
                          value: dropdownLanguage,
                          decoration: const InputDecoration(
                            labelText: 'Response language',
                          ),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('Auto'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'english',
                              child: Text('English'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'japanese',
                              child: Text('Japanese'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'spanish',
                              child: Text('Spanish'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'french',
                              child: Text('French'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'german',
                              child: Text('German'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'chinese',
                              child: Text('Chinese'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'korean',
                              child: Text('Korean'),
                            ),
                            const DropdownMenuItem<String?>(
                              value: 'custom',
                              child: Text('Custom…'),
                            ),
                          ],
                          onChanged: cfg == null
                              ? null
                              : (value) async {
                                  if (value == null) {
                                    await _update(cfg.copyWith(language: null));
                                    return;
                                  }
                                  if (value == 'custom') {
                                    final controller = TextEditingController(
                                      text: languageValue,
                                    );
                                    final res = await showDialog<String?>(
                                      context: context,
                                      builder: (ctx) => AlertDialog(
                                        title: const Text('Custom language'),
                                        content: TextField(
                                          controller: controller,
                                          decoration: const InputDecoration(
                                            hintText: 'e.g. japanese',
                                          ),
                                        ),
                                        actions: [
                                          TextButton(
                                            onPressed: () =>
                                                Navigator.pop(ctx, null),
                                            child: const Text('Cancel'),
                                          ),
                                          TextButton(
                                            onPressed: () => Navigator.pop(
                                              ctx,
                                              controller.text.trim(),
                                            ),
                                            child: const Text('Save'),
                                          ),
                                        ],
                                      ),
                                    );
                                    controller.dispose();
                                    if (res == null) return;
                                    final nextLang = res.trim();
                                    await _update(
                                      cfg.copyWith(
                                        language: nextLang.isEmpty
                                            ? null
                                            : nextLang,
                                      ),
                                    );
                                    return;
                                  }
                                  await _update(cfg.copyWith(language: value));
                                },
                        ),
                      ),
                    // Release channel setting
                    if (_matches('release channel update stable latest'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'Release channel',
                        child: DropdownButtonFormField<String?>(
                          // ignore: deprecated_member_use
                          value: releaseValue,
                          decoration: const InputDecoration(
                            labelText: 'Update track',
                          ),
                          items: const [
                            DropdownMenuItem<String?>(
                              value: null,
                              child: Text('Default'),
                            ),
                            DropdownMenuItem<String?>(
                              value: 'stable',
                              child: Text('Stable'),
                            ),
                            DropdownMenuItem<String?>(
                              value: 'latest',
                              child: Text('Latest'),
                            ),
                          ],
                          onChanged: cfg == null
                              ? null
                              : (value) async {
                                  await _update(
                                    cfg.copyWith(releaseChannel: value),
                                  );
                                },
                        ),
                      ),
                    // Respect gitignore setting
                    if (_matches('gitignore ignore files respect'))
                      _buildSettingCard(
                        oc: oc,
                        title: 'File filtering',
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: cfg?.respectGitignore ?? true,
                          title: const Text('Respect .gitignore'),
                          subtitle: const Text(
                            'Hide ignored files in @-mention file picker',
                          ),
                          onChanged: cfg == null
                              ? null
                              : (value) async {
                                  await _update(
                                    cfg.copyWith(respectGitignore: value),
                                  );
                                },
                        ),
                      ),
                    // No results message
                    if (_searchQuery.isNotEmpty &&
                        !_matches('permission mode security') &&
                        !_matches('model sonnet opus haiku dynamic') &&
                        !_matches(
                          'system prompt append preset custom instructions',
                        ) &&
                        !_matches(
                          'thinking mode adaptive enabled disabled reasoning',
                        ) &&
                        !_matches(
                          'effort level low medium high max reasoning depth',
                        ) &&
                        !_matches(
                          'prompt suggestions next prompt suggestion',
                        ) &&
                        !_matches('1m context beta') &&
                        !_matches('budget max budget usd') &&
                        !_matches('turn max turns') &&
                        !_matches('agent teams teammate taskcompleted') &&
                        !_matches('sandbox security excluded commands') &&
                        !_matches('account usage organization token source') &&
                        !_matches('allowed tools permissions bash wildcard') &&
                        !_matches('disallowed blocked tools') &&
                        !_matches('language response') &&
                        !_matches('release channel update stable latest') &&
                        !_matches('gitignore ignore files respect'))
                      Padding(
                        padding: Insets.cardLg,
                        child: Text(
                          'No settings match "$_searchQuery"',
                          style: TextStyle(color: oc.textMuted),
                          textAlign: TextAlign.center,
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}
