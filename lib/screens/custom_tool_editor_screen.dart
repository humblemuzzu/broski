import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../providers/claude_code_provider.dart';
import '../theme/opencode_theme.dart';

class CustomToolEditorScreen extends ConsumerStatefulWidget {
  final ClaudeCodeCustomTool? tool;

  const CustomToolEditorScreen({super.key, this.tool});

  @override
  ConsumerState<CustomToolEditorScreen> createState() =>
      _CustomToolEditorScreenState();
}

class _CustomToolEditorScreenState
    extends ConsumerState<CustomToolEditorScreen> {
  late final _nameController = TextEditingController();
  late final _descriptionController = TextEditingController();
  late CustomToolHandlerType _handlerType;
  late List<CustomToolParameter> _parameters;
  late bool _enabled;

  // HTTP handler
  late final _urlController = TextEditingController();
  late HttpMethod _httpMethod;
  late final _headersController = TextEditingController();
  late final _bodyTemplateController = TextEditingController();

  // Script handler
  late final _commandController = TextEditingController();
  late final _argsController = TextEditingController();
  late final _cwdController = TextEditingController();
  late final _timeoutController = TextEditingController();

  bool _isSaving = false;
  bool _isTesting = false;
  String? _testResult;
  bool _testSuccess = false;

  bool get _isEditing => widget.tool != null;

  @override
  void initState() {
    super.initState();
    _initializeForm();
  }

  void _initializeForm() {
    final tool = widget.tool;
    if (tool != null) {
      _nameController.text = tool.name;
      _descriptionController.text = tool.description;
      _handlerType = tool.handler;
      _parameters = List.from(tool.parameters);
      _enabled = tool.enabled;

      if (tool.handler == CustomToolHandlerType.http &&
          tool.httpConfig != null) {
        _urlController.text = tool.httpConfig!.url;
        _httpMethod = tool.httpConfig!.method;
        _headersController.text =
            tool.httpConfig!.headers?.entries
                .map((e) => '${e.key}: ${e.value}')
                .join('\n') ??
            '';
        _bodyTemplateController.text = tool.httpConfig!.bodyTemplate ?? '';
      } else if (tool.handler == CustomToolHandlerType.script &&
          tool.scriptConfig != null) {
        _commandController.text = tool.scriptConfig!.command;
        _argsController.text = tool.scriptConfig!.args?.join(' ') ?? '';
        _cwdController.text = tool.scriptConfig!.cwd ?? '';
        _timeoutController.text = tool.scriptConfig!.timeout?.toString() ?? '';
      }
    } else {
      _handlerType = CustomToolHandlerType.http;
      _parameters = [];
      _enabled = true;
      _httpMethod = HttpMethod.get;
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _urlController.dispose();
    _headersController.dispose();
    _bodyTemplateController.dispose();
    _commandController.dispose();
    _argsController.dispose();
    _cwdController.dispose();
    _timeoutController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        backgroundColor: theme.colorScheme.surface,
        title: Text(_isEditing ? 'Edit Tool' : 'New Tool'),
        actions: [
          if (_isEditing)
            TextButton(
              onPressed: _isTesting ? null : _testTool,
              child: _isTesting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Test'),
            ),
          TextButton(
            onPressed: _isSaving ? null : _saveTool,
            child: _isSaving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Save'),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Basic Info Section
            _SectionHeader(title: 'Basic Info'),
            const SizedBox(height: 12),
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Tool Name',
                hintText: 'e.g., get_weather',
                helperText:
                    'Alphanumeric and underscores only. Will appear as mcp__broski-custom-tools__<name>',
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: 'Description',
                hintText: 'Describe what this tool does...',
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 16),
            SwitchListTile(
              title: const Text('Enabled'),
              subtitle: const Text('Tool is available for Claude to use'),
              value: _enabled,
              onChanged: (value) => setState(() => _enabled = value),
              contentPadding: EdgeInsets.zero,
            ),
            const SizedBox(height: 24),

            // Handler Type Section
            _SectionHeader(title: 'Handler Type'),
            const SizedBox(height: 12),
            SegmentedButton<CustomToolHandlerType>(
              segments:
                  const [
                    CustomToolHandlerType.http,
                    CustomToolHandlerType.script,
                  ].map((type) {
                    return ButtonSegment(
                      value: type,
                      label: Text(type.displayName),
                      icon: Icon(
                        type == CustomToolHandlerType.http
                            ? Icons.http_rounded
                            : Icons.terminal_rounded,
                      ),
                    );
                  }).toList(),
              selected: {_handlerType},
              onSelectionChanged: (selected) {
                setState(() => _handlerType = selected.first);
              },
            ),
            const SizedBox(height: 8),
            Text(
              _handlerType.description,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(height: 24),

            // Handler Config Section
            if (_handlerType == CustomToolHandlerType.http)
              _HttpConfigSection(
                urlController: _urlController,
                method: _httpMethod,
                onMethodChanged: (method) =>
                    setState(() => _httpMethod = method),
                headersController: _headersController,
                bodyTemplateController: _bodyTemplateController,
              )
            else if (_handlerType == CustomToolHandlerType.script)
              _ScriptConfigSection(
                commandController: _commandController,
                argsController: _argsController,
                cwdController: _cwdController,
                timeoutController: _timeoutController,
              )
            else
              const SizedBox.shrink(),

            const SizedBox(height: 24),

            // Parameters Section
            _SectionHeader(
              title: 'Parameters',
              action: IconButton(
                icon: const Icon(Icons.add_circle_outline_rounded),
                onPressed: _addParameter,
                tooltip: 'Add Parameter',
              ),
            ),
            const SizedBox(height: 12),
            if (_parameters.isEmpty)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(
                    alpha: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: theme.colorScheme.outline.withValues(alpha: 0.2),
                  ),
                ),
                child: Center(
                  child: Text(
                    'No parameters defined.\nParameters let you pass values to your tool.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                  ),
                ),
              )
            else
              Column(
                children: _parameters.asMap().entries.map((entry) {
                  return _ParameterCard(
                    parameter: entry.value,
                    onEdit: () => _editParameter(entry.key),
                    onDelete: () => _deleteParameter(entry.key),
                  );
                }).toList(),
              ),

            // Test Result
            if (_testResult != null) ...[
              const SizedBox(height: 24),
              _SectionHeader(title: 'Test Result'),
              const SizedBox(height: 12),
              Builder(builder: (context) {
              final ocTheme = OpenCodeTheme.of(context);
              final statusColor = _testSuccess ? ocTheme.success : ocTheme.error;
              return Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: statusColor.withValues(alpha: 0.3),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          _testSuccess
                              ? Icons.check_circle_rounded
                              : Icons.error_rounded,
                          color: statusColor,
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _testSuccess ? 'Success' : 'Failed',
                          style: theme.textTheme.titleSmall?.copyWith(
                            color: statusColor,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _testResult!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ),
              );
              }),
            ],

            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }

  ClaudeCodeCustomTool _buildTool() {
    final dynamic handlerConfig;
    if (_handlerType == CustomToolHandlerType.http) {
      // Parse headers
      final headers = <String, String>{};
      for (final line in _headersController.text.split('\n')) {
        final parts = line.split(':');
        if (parts.length >= 2) {
          final key = parts[0].trim();
          final value = parts.sublist(1).join(':').trim();
          if (key.isNotEmpty) {
            headers[key] = value;
          }
        }
      }

      handlerConfig = HttpHandlerConfig(
        url: _urlController.text.trim(),
        method: _httpMethod,
        headers: headers.isEmpty ? null : headers,
        bodyTemplate: _bodyTemplateController.text.trim().isEmpty
            ? null
            : _bodyTemplateController.text.trim(),
      );
    } else {
      // Parse args
      final args = _argsController.text.trim().isEmpty
          ? null
          : _argsController.text.trim().split(' ');

      handlerConfig = ScriptHandlerConfig(
        command: _commandController.text.trim(),
        args: args,
        cwd: _cwdController.text.trim().isEmpty
            ? null
            : _cwdController.text.trim(),
        timeout: _timeoutController.text.trim().isEmpty
            ? null
            : int.tryParse(_timeoutController.text.trim()),
      );
    }

    return ClaudeCodeCustomTool(
      id: widget.tool?.id ?? '',
      name: _nameController.text.trim(),
      description: _descriptionController.text.trim(),
      parameters: _parameters,
      handler: _handlerType,
      handlerConfig: handlerConfig,
      enabled: _enabled,
      createdAt: widget.tool?.createdAt ?? 0,
      updatedAt: 0,
    );
  }

  Future<void> _saveTool() async {
    final tool = _buildTool();
    final errors = tool.validate();

    if (errors.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(errors.join('\n')),
          behavior: SnackBarBehavior.floating,
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
      return;
    }

    setState(() => _isSaving = true);

    try {
      final saved = await ref
          .read(ccCustomToolsProvider.notifier)
          .saveTool(tool);

      if (saved != null && mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _isEditing
                  ? 'Tool updated successfully'
                  : 'Tool created successfully',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to save tool'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  Future<void> _testTool() async {
    final tool = _buildTool();
    final errors = tool.validate();

    if (errors.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(errors.join('\n')),
          behavior: SnackBarBehavior.floating,
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
      return;
    }

    setState(() {
      _isTesting = true;
      _testResult = null;
    });

    try {
      // Build test args from parameters with default values
      final testArgs = <String, dynamic>{};
      for (final param in _parameters) {
        if (param.defaultValue != null) {
          testArgs[param.name] = param.defaultValue;
        } else if (param.required) {
          // Use placeholder values for required params without defaults
          switch (param.type) {
            case CustomToolParameterType.string:
              testArgs[param.name] = 'test';
              break;
            case CustomToolParameterType.number:
              testArgs[param.name] = 0;
              break;
            case CustomToolParameterType.boolean:
              testArgs[param.name] = false;
              break;
            case CustomToolParameterType.array:
              testArgs[param.name] = [];
              break;
            case CustomToolParameterType.object:
              testArgs[param.name] = {};
              break;
          }
        }
      }

      final result = await ref
          .read(ccCustomToolsProvider.notifier)
          .testTool(tool, testArgs);

      setState(() {
        _testSuccess = result.success;
        _testResult = result.success
            ? (result.result ?? 'Success')
            : (result.error ?? 'Unknown error');
      });
    } finally {
      if (mounted) {
        setState(() => _isTesting = false);
      }
    }
  }

  void _addParameter() {
    _showParameterDialog(null, null);
  }

  void _editParameter(int index) {
    _showParameterDialog(index, _parameters[index]);
  }

  void _deleteParameter(int index) {
    setState(() {
      _parameters.removeAt(index);
    });
  }

  void _showParameterDialog(int? index, CustomToolParameter? existing) {
    final nameController = TextEditingController(text: existing?.name ?? '');
    final descController = TextEditingController(
      text: existing?.description ?? '',
    );
    var type = existing?.type ?? CustomToolParameterType.string;
    var required = existing?.required ?? false;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(existing != null ? 'Edit Parameter' : 'Add Parameter'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Name',
                    hintText: 'e.g., location',
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: descController,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    hintText: 'What this parameter is for',
                  ),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<CustomToolParameterType>(
                  value: type,
                  decoration: const InputDecoration(labelText: 'Type'),
                  items: CustomToolParameterType.values.map((t) {
                    return DropdownMenuItem(
                      value: t,
                      child: Text(t.displayName),
                    );
                  }).toList(),
                  onChanged: (value) {
                    if (value != null) {
                      setDialogState(() => type = value);
                    }
                  },
                ),
                const SizedBox(height: 16),
                SwitchListTile(
                  title: const Text('Required'),
                  value: required,
                  onChanged: (value) {
                    setDialogState(() => required = value);
                  },
                  contentPadding: EdgeInsets.zero,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                if (nameController.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Parameter name is required'),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                  return;
                }

                final param = CustomToolParameter(
                  name: nameController.text.trim(),
                  type: type,
                  description: descController.text.trim().isEmpty
                      ? null
                      : descController.text.trim(),
                  required: required,
                );

                setState(() {
                  if (index != null) {
                    _parameters[index] = param;
                  } else {
                    _parameters.add(param);
                  }
                });

                Navigator.pop(context);
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final Widget? action;

  const _SectionHeader({required this.title, this.action});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        Text(
          title,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w600,
            color: theme.colorScheme.primary,
          ),
        ),
        if (action != null) ...[const Spacer(), action!],
      ],
    );
  }
}

class _HttpConfigSection extends StatelessWidget {
  final TextEditingController urlController;
  final HttpMethod method;
  final void Function(HttpMethod) onMethodChanged;
  final TextEditingController headersController;
  final TextEditingController bodyTemplateController;

  const _HttpConfigSection({
    required this.urlController,
    required this.method,
    required this.onMethodChanged,
    required this.headersController,
    required this.bodyTemplateController,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(title: 'HTTP Configuration'),
        const SizedBox(height: 12),
        Row(
          children: [
            SizedBox(
              width: 120,
              child: DropdownButtonFormField<HttpMethod>(
                value: method,
                decoration: const InputDecoration(labelText: 'Method'),
                items: HttpMethod.values.map((m) {
                  return DropdownMenuItem(value: m, child: Text(m.displayName));
                }).toList(),
                onChanged: (value) {
                  if (value != null) {
                    onMethodChanged(value);
                  }
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: urlController,
                decoration: const InputDecoration(
                  labelText: 'URL',
                  hintText: 'https://api.example.com/{{param}}',
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: headersController,
          decoration: const InputDecoration(
            labelText: 'Headers (one per line)',
            hintText:
                'Authorization: Bearer xxx\nContent-Type: application/json',
          ),
          maxLines: 3,
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: bodyTemplateController,
          decoration: const InputDecoration(
            labelText: 'Body Template (JSON)',
            hintText: '{"query": "{{searchQuery}}"}',
            helperText: 'Use {{paramName}} for parameter placeholders',
          ),
          maxLines: 4,
        ),
      ],
    );
  }
}

class _ScriptConfigSection extends StatelessWidget {
  final TextEditingController commandController;
  final TextEditingController argsController;
  final TextEditingController cwdController;
  final TextEditingController timeoutController;

  const _ScriptConfigSection({
    required this.commandController,
    required this.argsController,
    required this.cwdController,
    required this.timeoutController,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(title: 'Script Configuration'),
        const SizedBox(height: 12),
        TextFormField(
          controller: commandController,
          decoration: const InputDecoration(
            labelText: 'Command',
            hintText: '/path/to/script.sh or command',
            helperText: 'Use {{paramName}} for parameter placeholders',
          ),
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: argsController,
          decoration: const InputDecoration(
            labelText: 'Arguments (space separated)',
            hintText: '--flag {{value}}',
          ),
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: cwdController,
          decoration: const InputDecoration(
            labelText: 'Working Directory (optional)',
            hintText: '/path/to/dir',
          ),
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: timeoutController,
          decoration: const InputDecoration(
            labelText: 'Timeout (ms, optional)',
            hintText: '30000',
          ),
          keyboardType: TextInputType.number,
        ),
      ],
    );
  }
}

class _ParameterCard extends StatelessWidget {
  final CustomToolParameter parameter;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ParameterCard({
    required this.parameter,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: theme.colorScheme.primaryContainer.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              parameter.type.displayName[0].toUpperCase(),
              style: TextStyle(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        title: Row(
          children: [
            Text(
              parameter.name,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            if (parameter.required) ...[
              const SizedBox(width: 4),
              Text(
                '*',
                style: TextStyle(
                  color: theme.colorScheme.error,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ],
        ),
        subtitle: Text(
          parameter.description ?? parameter.type.displayName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: onEdit,
              visualDensity: VisualDensity.compact,
            ),
            IconButton(
              icon: Icon(
                Icons.delete_outline_rounded,
                size: 20,
                color: theme.colorScheme.error,
              ),
              onPressed: onDelete,
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
      ),
    );
  }
}
