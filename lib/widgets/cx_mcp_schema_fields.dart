import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';

/// Renders form fields from a JSON Schema `properties` map.
///
/// Manages its own text controllers and boolean state.
/// Call [collectValues] to get the current form values.
class CxMcpSchemaFields extends StatefulWidget {
  const CxMcpSchemaFields({
    super.key,
    required this.properties,
    this.requiredFields = const {},
  });

  /// JSON Schema `properties` map: `{ fieldName: { type, title, description, default } }`.
  final Map<String, dynamic> properties;

  /// Set of field names that are required.
  final Set<String> requiredFields;

  @override
  State<CxMcpSchemaFields> createState() => CxMcpSchemaFieldsState();
}

class CxMcpSchemaFieldsState extends State<CxMcpSchemaFields> {
  final Map<String, TextEditingController> _textControllers = {};
  final Map<String, bool> _boolValues = {};

  @override
  void initState() {
    super.initState();
    for (final entry in widget.properties.entries) {
      final prop = entry.value as Map<String, dynamic>? ?? {};
      final type = prop['type'] as String? ?? 'string';
      if (type == 'boolean') {
        _boolValues[entry.key] = (prop['default'] as bool?) ?? false;
      } else {
        _textControllers[entry.key] = TextEditingController(
          text: prop['default']?.toString() ?? '',
        );
      }
    }
  }

  @override
  void dispose() {
    for (final c in _textControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Collects current field values as a map, coercing types per schema.
  Map<String, dynamic> collectValues() {
    final values = <String, dynamic>{};
    for (final entry in widget.properties.entries) {
      final prop = entry.value as Map<String, dynamic>? ?? {};
      final type = prop['type'] as String? ?? 'string';
      if (type == 'boolean') {
        values[entry.key] = _boolValues[entry.key] ?? false;
      } else if (type == 'number' || type == 'integer') {
        final text = _textControllers[entry.key]?.text ?? '';
        values[entry.key] = num.tryParse(text) ?? text;
      } else {
        values[entry.key] = _textControllers[entry.key]?.text ?? '';
      }
    }
    return values;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: widget.properties.entries.map((entry) {
        final prop = entry.value as Map<String, dynamic>? ?? {};
        final type = prop['type'] as String? ?? 'string';
        final label = prop['title'] as String? ?? _humanize(entry.key);
        final description = prop['description'] as String?;
        final isRequired = widget.requiredFields.contains(entry.key);

        if (type == 'boolean') {
          return _buildBoolField(theme, entry.key, label, description);
        }
        return _buildTextField(
          theme,
          entry.key,
          label,
          description,
          type,
          isRequired: isRequired,
        );
      }).toList(),
    );
  }

  Widget _buildTextField(
    OpenCodeTheme theme,
    String key,
    String label,
    String? description,
    String type, {
    bool isRequired = false,
  }) {
    final isNumeric = type == 'number' || type == 'integer';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(label, style: AppTypography.label(color: theme.text)),
              if (isRequired) ...[
                const SizedBox(width: 4),
                Text('*', style: AppTypography.label(color: theme.error)),
              ],
            ],
          ),
          if (description != null) ...[
            const SizedBox(height: 2),
            Text(
              description,
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ],
          const SizedBox(height: 6),
          TextFormField(
            controller: _textControllers[key],
            keyboardType: isNumeric ? TextInputType.number : TextInputType.text,
            style: AppTypography.bodySmall(color: theme.text),
            decoration: InputDecoration(
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
              filled: true,
              fillColor: theme.bgRaised,
              border: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.primary),
              ),
            ),
            validator: isRequired
                ? (value) =>
                      (value == null || value.isEmpty) ? 'Required' : null
                : null,
          ),
        ],
      ),
    );
  }

  Widget _buildBoolField(
    OpenCodeTheme theme,
    String key,
    String label,
    String? description,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          GestureDetector(
            onTap: () =>
                setState(() => _boolValues[key] = !(_boolValues[key] ?? false)),
            child: Row(
              children: [
                SizedBox(
                  width: 20,
                  height: 20,
                  child: Checkbox(
                    value: _boolValues[key] ?? false,
                    onChanged: (v) =>
                        setState(() => _boolValues[key] = v ?? false),
                    activeColor: theme.primary,
                    side: BorderSide(color: theme.border),
                  ),
                ),
                const SizedBox(width: 8),
                Text(label, style: AppTypography.label(color: theme.text)),
              ],
            ),
          ),
          if (description != null) ...[
            Padding(
              padding: const EdgeInsets.only(left: 28, top: 2),
              child: Text(
                description,
                style: AppTypography.caption(color: theme.textMuted),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _humanize(String key) {
    final spaced = key.replaceAll(RegExp(r'[_\-]'), ' ');
    if (spaced.isEmpty) return key;
    return spaced[0].toUpperCase() + spaced.substring(1);
  }
}
