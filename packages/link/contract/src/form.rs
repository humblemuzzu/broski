//! What a form shows and starts with, read from its field specs the way the bridge's answer check
//! (`field-check.ts`' `fieldIsActive`) reads them, so a field the phone hides is one the bridge would
//! refuse an answer for.

use std::collections::HashMap;

use crate::{
    BooleanValue, ChoicesValue, ConditionOperator, FieldCondition, FormFieldSpec, FormScalar,
    FormValue, NumberValue, TextValue,
};

/// Whether `field` is shown, and so answered, given the answers so far: it is not hidden and every
/// one of its `when` conditions holds. A condition on an unanswered field holds for neither
/// operator; `eq` against a multiselect's choices means "includes".
pub fn form_field_shown(field: &FormFieldSpec, values: &HashMap<String, FormValue>) -> bool {
    let (hidden, when) = match field {
        FormFieldSpec::String(field) => (field.hidden, &field.when),
        FormFieldSpec::Number(field) => (field.hidden, &field.when),
        FormFieldSpec::Integer(field) => (field.hidden, &field.when),
        FormFieldSpec::Boolean(field) => (field.hidden, &field.when),
        FormFieldSpec::Multiselect(field) => (field.hidden, &field.when),
    };
    !hidden
        && when
            .iter()
            .all(|condition| holds(condition, values.get(&condition.key)))
}

fn holds(condition: &FieldCondition, answer: Option<&FormValue>) -> bool {
    let Some(answer) = answer else {
        return false;
    };
    let matches = match (answer, &condition.value) {
        (FormValue::Choices(choices), FormScalar::Text(expected)) => {
            choices.values.contains(&expected.value)
        }
        (FormValue::Text(answer), FormScalar::Text(expected)) => answer.value == expected.value,
        (FormValue::Number(answer), FormScalar::Number(expected)) => answer.value == expected.value,
        (FormValue::Boolean(answer), FormScalar::Boolean(expected)) => {
            answer.value == expected.value
        }
        _ => false,
    };
    match condition.op {
        ConditionOperator::Eq => matches,
        ConditionOperator::Neq => !matches,
    }
}

/// The value a field starts with: its default, so an untouched field answers what the backend
/// would assume; `None` when it has none.
pub fn form_field_default(field: &FormFieldSpec) -> Option<FormValue> {
    match field {
        FormFieldSpec::String(field) => field
            .default_value
            .clone()
            .map(|value| FormValue::Text(TextValue { value })),
        FormFieldSpec::Number(field) => field
            .default_value
            .map(|value| FormValue::Number(NumberValue { value })),
        FormFieldSpec::Integer(field) => field.default_value.map(|value| {
            FormValue::Number(NumberValue {
                value: value as f64,
            })
        }),
        FormFieldSpec::Boolean(field) => field
            .default_value
            .map(|value| FormValue::Boolean(BooleanValue { value })),
        FormFieldSpec::Multiselect(field) => field
            .default_value
            .clone()
            .map(|values| FormValue::Choices(ChoicesValue { values })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BooleanField, IntegerField, MultiselectField, NumberField, StringField};

    fn string_field(key: &str, when: Vec<FieldCondition>) -> FormFieldSpec {
        FormFieldSpec::String(StringField {
            key: key.to_owned(),
            title: None,
            description: None,
            required: false,
            hidden: false,
            when,
            format: None,
            min_length: None,
            max_length: None,
            pattern: None,
            placeholder: None,
            default_value: None,
            options: Vec::new(),
            allow_custom: false,
        })
    }

    fn condition(key: &str, op: ConditionOperator, value: FormScalar) -> FieldCondition {
        FieldCondition {
            key: key.to_owned(),
            op,
            value,
        }
    }

    fn text(value: &str) -> FormScalar {
        FormScalar::Text(TextValue {
            value: value.to_owned(),
        })
    }

    fn answers(values: &[(&str, FormValue)]) -> HashMap<String, FormValue> {
        values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect()
    }

    fn typed(value: &str) -> FormValue {
        FormValue::Text(TextValue {
            value: value.to_owned(),
        })
    }

    #[test]
    fn a_field_without_conditions_shows_unless_it_is_hidden() {
        assert!(form_field_shown(
            &string_field("a", Vec::new()),
            &answers(&[])
        ));
        let FormFieldSpec::String(mut hidden) = string_field("a", Vec::new()) else {
            unreachable!()
        };
        hidden.hidden = true;
        assert!(!form_field_shown(
            &FormFieldSpec::String(hidden),
            &answers(&[])
        ));
    }

    #[test]
    fn a_condition_on_an_unanswered_field_holds_for_neither_operator() {
        for op in [ConditionOperator::Eq, ConditionOperator::Neq] {
            let field = string_field("b", vec![condition("a", op, text("x"))]);
            assert!(!form_field_shown(&field, &answers(&[])));
        }
    }

    #[test]
    fn eq_and_neq_compare_an_answer_of_the_same_kind() {
        let eq = string_field("b", vec![condition("a", ConditionOperator::Eq, text("x"))]);
        let neq = string_field("b", vec![condition("a", ConditionOperator::Neq, text("x"))]);
        let same = answers(&[("a", typed("x"))]);
        let other = answers(&[("a", typed("y"))]);
        assert!(form_field_shown(&eq, &same) && !form_field_shown(&neq, &same));
        assert!(!form_field_shown(&eq, &other) && form_field_shown(&neq, &other));
        let number = answers(&[("a", FormValue::Number(NumberValue { value: 1.0 }))]);
        assert!(
            !form_field_shown(&eq, &number),
            "a number never equals text"
        );
        assert!(form_field_shown(&neq, &number));
    }

    #[test]
    fn eq_against_choices_means_includes() {
        let field = string_field("b", vec![condition("a", ConditionOperator::Eq, text("x"))]);
        let choices = |values: &[&str]| {
            answers(&[(
                "a",
                FormValue::Choices(ChoicesValue {
                    values: values.iter().map(|value| (*value).to_owned()).collect(),
                }),
            )])
        };
        assert!(form_field_shown(&field, &choices(&["w", "x"])));
        assert!(!form_field_shown(&field, &choices(&["w"])));
        let numeric = string_field(
            "b",
            vec![condition(
                "a",
                ConditionOperator::Eq,
                FormScalar::Number(NumberValue { value: 1.0 }),
            )],
        );
        assert!(!form_field_shown(&numeric, &choices(&["1"])));
    }

    #[test]
    fn every_condition_must_hold() {
        let field = string_field(
            "c",
            vec![
                condition("a", ConditionOperator::Eq, text("x")),
                condition(
                    "b",
                    ConditionOperator::Eq,
                    FormScalar::Boolean(BooleanValue { value: true }),
                ),
            ],
        );
        let both = answers(&[
            ("a", typed("x")),
            ("b", FormValue::Boolean(BooleanValue { value: true })),
        ]);
        let one = answers(&[("a", typed("x"))]);
        assert!(form_field_shown(&field, &both));
        assert!(!form_field_shown(&field, &one));
    }

    #[test]
    fn each_kind_of_field_starts_from_its_default() {
        let number = FormFieldSpec::Number(NumberField {
            key: "n".to_owned(),
            title: None,
            description: None,
            required: false,
            hidden: false,
            when: Vec::new(),
            minimum: None,
            maximum: None,
            default_value: Some(1.5),
        });
        let integer = FormFieldSpec::Integer(IntegerField {
            key: "i".to_owned(),
            title: None,
            description: None,
            required: false,
            hidden: false,
            when: Vec::new(),
            minimum: None,
            maximum: None,
            default_value: Some(3),
        });
        let boolean = FormFieldSpec::Boolean(BooleanField {
            key: "b".to_owned(),
            title: None,
            description: None,
            required: false,
            hidden: false,
            when: Vec::new(),
            default_value: Some(false),
        });
        let multi = FormFieldSpec::Multiselect(MultiselectField {
            key: "m".to_owned(),
            title: None,
            description: None,
            required: false,
            hidden: false,
            when: Vec::new(),
            options: Vec::new(),
            min_items: None,
            max_items: None,
            allow_custom: false,
            default_value: Some(vec!["a".to_owned()]),
        });
        assert_eq!(form_field_default(&string_field("s", Vec::new())), None);
        assert_eq!(
            form_field_default(&number),
            Some(FormValue::Number(NumberValue { value: 1.5 }))
        );
        assert_eq!(
            form_field_default(&integer),
            Some(FormValue::Number(NumberValue { value: 3.0 }))
        );
        assert_eq!(
            form_field_default(&boolean),
            Some(FormValue::Boolean(BooleanValue { value: false }))
        );
        assert_eq!(
            form_field_default(&multi),
            Some(FormValue::Choices(ChoicesValue {
                values: vec!["a".to_owned()]
            }))
        );
    }
}
