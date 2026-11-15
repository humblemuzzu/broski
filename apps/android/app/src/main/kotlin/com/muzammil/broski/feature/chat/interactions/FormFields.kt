package com.muzammil.broski.feature.chat.interactions

import uniffi.broski_contract.FormFieldSpec

val FormFieldSpec.key: String
    get() = when (this) {
        is FormFieldSpec.String -> v1.key
        is FormFieldSpec.Number -> v1.key
        is FormFieldSpec.Integer -> v1.key
        is FormFieldSpec.Boolean -> v1.key
        is FormFieldSpec.Multiselect -> v1.key
    }

val FormFieldSpec.title: String?
    get() = when (this) {
        is FormFieldSpec.String -> v1.title
        is FormFieldSpec.Number -> v1.title
        is FormFieldSpec.Integer -> v1.title
        is FormFieldSpec.Boolean -> v1.title
        is FormFieldSpec.Multiselect -> v1.title
    }

val FormFieldSpec.description: String?
    get() = when (this) {
        is FormFieldSpec.String -> v1.description
        is FormFieldSpec.Number -> v1.description
        is FormFieldSpec.Integer -> v1.description
        is FormFieldSpec.Boolean -> v1.description
        is FormFieldSpec.Multiselect -> v1.description
    }

val FormFieldSpec.required: Boolean
    get() = when (this) {
        is FormFieldSpec.String -> v1.required
        is FormFieldSpec.Number -> v1.required
        is FormFieldSpec.Integer -> v1.required
        is FormFieldSpec.Boolean -> v1.required
        is FormFieldSpec.Multiselect -> v1.required
    }

