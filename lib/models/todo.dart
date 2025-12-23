/// Todo status for task tracking
enum TodoStatus {
  pending,
  inProgress,
  completed,
  cancelled;

  static TodoStatus fromString(String s) {
    switch (s) {
      case 'in_progress':
        return TodoStatus.inProgress;
      case 'completed':
        return TodoStatus.completed;
      case 'cancelled':
        return TodoStatus.cancelled;
      default:
        return TodoStatus.pending;
    }
  }

  String get displayName {
    switch (this) {
      case TodoStatus.pending:
        return 'Pending';
      case TodoStatus.inProgress:
        return 'In Progress';
      case TodoStatus.completed:
        return 'Completed';
      case TodoStatus.cancelled:
        return 'Cancelled';
    }
  }
}

/// Todo priority level
enum TodoPriority {
  high,
  medium,
  low;

  static TodoPriority fromString(String p) {
    switch (p) {
      case 'high':
        return TodoPriority.high;
      case 'low':
        return TodoPriority.low;
      default:
        return TodoPriority.medium;
    }
  }

  String get displayName {
    switch (this) {
      case TodoPriority.high:
        return 'High';
      case TodoPriority.medium:
        return 'Medium';
      case TodoPriority.low:
        return 'Low';
    }
  }
}

/// A todo item from OpenCode's plan/task tracking system
class Todo {
  final String id;
  final String content;
  final TodoStatus status;
  final TodoPriority priority;

  const Todo({
    required this.id,
    required this.content,
    required this.status,
    required this.priority,
  });

  factory Todo.fromJson(Map<String, dynamic> json) {
    return Todo(
      id: json['id'] as String? ?? '',
      content: json['content'] as String? ?? '',
      status: TodoStatus.fromString(json['status'] as String? ?? 'pending'),
      priority: TodoPriority.fromString(
        json['priority'] as String? ?? 'medium',
      ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'content': content,
      'status': status.name,
      'priority': priority.name,
    };
  }

  Todo copyWith({
    String? id,
    String? content,
    TodoStatus? status,
    TodoPriority? priority,
  }) {
    return Todo(
      id: id ?? this.id,
      content: content ?? this.content,
      status: status ?? this.status,
      priority: priority ?? this.priority,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Todo &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          content == other.content &&
          status == other.status &&
          priority == other.priority;

  @override
  int get hashCode =>
      id.hashCode ^ content.hashCode ^ status.hashCode ^ priority.hashCode;

  @override
  String toString() =>
      'Todo(id: $id, content: $content, status: $status, priority: $priority)';
}
