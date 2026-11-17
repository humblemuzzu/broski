import BroskiCore
import SwiftUI

/// A text file as numbered monospaced lines that wrap, coloured by the language its name says.
struct FileTextView: View {
    let file: TextFile
    let path: String
    var line: Int?

    var body: some View {
        CodeFileView(text: file.text, language: languageForPath(path: path), line: line)
    }
}
