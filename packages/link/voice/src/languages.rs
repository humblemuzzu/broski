/// A language the person may pin; `formats` when xAI writes its numbers, units and code the
/// written way (`format=true`), which needs the language named.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictationLanguage {
    pub code: String,
    pub name: String,
    pub formats: bool,
}

/// xAI's list for `grok-voice-transcribe-2.0` (docs.x.ai, Speech to Text, "Supported Languages").
const LANGUAGES: [(&str, &str); 38] = [
    ("ar", "Arabic"),
    ("bs", "Bosnian"),
    ("bg", "Bulgarian"),
    ("yue", "Cantonese"),
    ("ca", "Catalan"),
    ("zh", "Chinese (Mandarin)"),
    ("hr", "Croatian"),
    ("cs", "Czech"),
    ("da", "Danish"),
    ("nl", "Dutch"),
    ("en", "English"),
    ("fil", "Filipino"),
    ("fi", "Finnish"),
    ("fr", "French"),
    ("de", "German"),
    ("el", "Greek"),
    ("hi", "Hindi"),
    ("hu", "Hungarian"),
    ("id", "Indonesian"),
    ("it", "Italian"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("mk", "Macedonian"),
    ("ms", "Malay"),
    ("nb", "Norwegian (Bokmål)"),
    ("fa", "Persian"),
    ("pl", "Polish"),
    ("pt", "Portuguese"),
    ("ro", "Romanian"),
    ("ru", "Russian"),
    ("sk", "Slovak"),
    ("es", "Spanish"),
    ("sv", "Swedish"),
    ("th", "Thai"),
    ("tr", "Turkish"),
    ("uk", "Ukrainian"),
    ("ur", "Urdu"),
    ("vi", "Vietnamese"),
];

const FORMATTED: [&str; 11] = [
    "ar", "zh", "en", "fr", "de", "ja", "pt", "ru", "es", "sv", "vi",
];

/// Every language, by name.
pub fn dictation_languages() -> Vec<DictationLanguage> {
    LANGUAGES
        .iter()
        .map(|(code, name)| DictationLanguage {
            code: (*code).to_owned(),
            name: (*name).to_owned(),
            formats: FORMATTED.contains(code),
        })
        .collect()
}

pub(crate) fn formats(code: &str) -> bool {
    FORMATTED.contains(&code)
}

pub(crate) fn known(code: &str) -> bool {
    LANGUAGES.iter().any(|(known, _)| *known == code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_is_sorted_and_marks_the_formatted_languages() {
        let languages = dictation_languages();
        assert_eq!(languages.len(), 38);
        assert!(languages.windows(2).all(|pair| pair[0].name < pair[1].name));
        let formatted: Vec<&str> = languages
            .iter()
            .filter(|l| l.formats)
            .map(|l| l.code.as_str())
            .collect();
        assert_eq!(formatted.len(), FORMATTED.len());
        assert!(languages.iter().any(|l| l.code == "en" && l.formats));
        assert!(languages.iter().any(|l| l.code == "hi" && !l.formats));
    }
}
