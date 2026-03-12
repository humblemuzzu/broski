import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/cx_mcp_schema_fields.dart';

/// Shows the MCP elicitation sheet for structured input or URL auth.
///
/// Returns a response map with 'action' key, or null if cancelled.
/// - Form mode: `{ 'action': 'submit', 'data': { ...formValues } }`
/// - URL mode: `{ 'action': 'completed' }`
/// - Cancel: `{ 'action': 'cancel' }` or null
Future<Map<String, dynamic>?> showCxMcpElicitationSheet({
  required BuildContext context,
  required String serverName,
  required String mode,
  Map<String, dynamic>? schema,
  String? message,
  String? url,
}) async {
  return await showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _CxMcpElicitationContent(
      serverName: serverName,
      mode: mode,
      schema: schema,
      message: message,
      url: url,
    ),
  );
}

class _CxMcpElicitationContent extends StatefulWidget {
  const _CxMcpElicitationContent({
    required this.serverName,
    required this.mode,
    this.schema,
    this.message,
    this.url,
  });

  final String serverName;
  final String mode;
  final Map<String, dynamic>? schema;
  final String? message;
  final String? url;

  @override
  State<_CxMcpElicitationContent> createState() =>
      _CxMcpElicitationContentState();
}

class _CxMcpElicitationContentState extends State<_CxMcpElicitationContent> {
  final _formKey = GlobalKey<FormState>();
  final _fieldsKey = GlobalKey<CxMcpSchemaFieldsState>();
  bool _urlOpened = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.75,
      ),
      decoration: BoxDecoration(
        color: theme.bgSheet,
        borderRadius: Radii.sheetTop,
      ),
      padding: EdgeInsets.only(bottom: bottomPadding),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle bar
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 8, bottom: 4),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          // Title
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(AppIcons.webhook, size: 20, color: theme.info),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.serverName,
                    style: AppTypography.labelLarge(color: theme.text),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: theme.border),
          // Content
          Flexible(
            child: SingleChildScrollView(
              padding: Insets.screenH,
              child: widget.mode == 'url'
                  ? _buildUrlMode(theme)
                  : _buildFormMode(theme),
            ),
          ),
        ],
      ),
    );
  }

  // ── URL mode ──────────────────────────────────────────────────────────────

  Widget _buildUrlMode(OpenCodeTheme theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 12),
        if (widget.message != null && widget.message!.isNotEmpty) ...[
          Text(
            widget.message!,
            style: AppTypography.bodySmall(color: theme.text),
          ),
          const SizedBox(height: 16),
        ],
        if (widget.url != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.bgRaised,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.border),
            ),
            child: Row(
              children: [
                Icon(AppIcons.openExternal, size: 14, color: theme.info),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.url!,
                    style: AppTypography.codeSmall(color: theme.info),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _launchUrl,
              icon: Icon(
                _urlOpened ? AppIcons.checkCircle : AppIcons.openExternal,
                size: 16,
              ),
              label: Text(_urlOpened ? 'Opened in Browser' : 'Open Browser'),
              style: FilledButton.styleFrom(
                backgroundColor: theme.info,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
        const SizedBox(height: 12),
        _buildButtonRow(
          theme,
          onSubmit: () {
            Navigator.pop(context, {'action': 'completed'});
          },
          submitLabel: 'Done',
        ),
        const SizedBox(height: 8),
      ],
    );
  }

  Future<void> _launchUrl() async {
    if (widget.url == null) return;
    final uri = Uri.tryParse(widget.url!);
    if (uri == null) return;
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (launched && mounted) {
      setState(() => _urlOpened = true);
    }
  }

  // ── Form mode ─────────────────────────────────────────────────────────────

  Widget _buildFormMode(OpenCodeTheme theme) {
    final properties =
        widget.schema?['properties'] as Map<String, dynamic>? ?? {};
    final requiredFields =
        (widget.schema?['required'] as List<dynamic>?)
            ?.cast<String>()
            .toSet() ??
        <String>{};

    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          if (widget.message != null && widget.message!.isNotEmpty) ...[
            Text(
              widget.message!,
              style: AppTypography.bodySmall(color: theme.text),
            ),
            const SizedBox(height: 12),
          ],
          CxMcpSchemaFields(
            key: _fieldsKey,
            properties: properties,
            requiredFields: requiredFields,
          ),
          const SizedBox(height: 16),
          _buildButtonRow(theme, onSubmit: _submitForm, submitLabel: 'Submit'),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  void _submitForm() {
    if (_formKey.currentState?.validate() ?? false) {
      final values = _fieldsKey.currentState?.collectValues() ?? {};
      Navigator.pop(context, {'action': 'submit', 'data': values});
    }
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  Widget _buildButtonRow(
    OpenCodeTheme theme, {
    required VoidCallback onSubmit,
    required String submitLabel,
  }) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: () => Navigator.pop(context, {'action': 'cancel'}),
            style: OutlinedButton.styleFrom(
              foregroundColor: theme.text,
              side: BorderSide(color: theme.border),
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
            child: const Text('Cancel'),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: FilledButton(
            onPressed: onSubmit,
            style: FilledButton.styleFrom(
              backgroundColor: theme.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
            child: Text(submitLabel),
          ),
        ),
      ],
    );
  }
}
