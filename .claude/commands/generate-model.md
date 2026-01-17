---
description: Generate a new Dart model class with JSON serialization
allowed-tools: Write, Read
argument-hint: <ModelName> <field1:type> <field2:type> ...
---

# Generate Model

Create a new Dart model class with:
- Immutable fields
- `fromJson` factory constructor
- `toJson` method
- `copyWith` method
- `==` operator and `hashCode`

## Example

Input: `User name:String email:String age:int?`

Output: Creates `lib/models/user.dart` with full model class.

$ARGUMENTS
