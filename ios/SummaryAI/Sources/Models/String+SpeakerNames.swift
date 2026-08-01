import Foundation

extension String {
    /// Replaces "Speaker N" tokens (case-insensitive, with one or more spaces)
    /// with the custom name from the map. The map is keyed by the index as a
    /// string — same convention the server uses. Unmatched indices are left
    /// unchanged so partially-named transcripts still display sensibly.
    func applyingSpeakerNames(_ names: [String: String]?) -> String {
        guard let names, !names.isEmpty else { return self }
        let pattern = #"\bSpeaker\s+(\d+)\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return self
        }
        let ns = self as NSString
        let matches = regex.matches(in: self, range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return self }
        var result = ""
        var cursor = 0
        for m in matches {
            let full = m.range
            if full.location > cursor {
                result += ns.substring(with: NSRange(location: cursor, length: full.location - cursor))
            }
            let idxStr = ns.substring(with: m.range(at: 1))
            let custom = names[idxStr]?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let custom, !custom.isEmpty {
                result += custom
            } else {
                result += ns.substring(with: full)
            }
            cursor = full.location + full.length
        }
        if cursor < ns.length {
            result += ns.substring(from: cursor)
        }
        return result
    }
}
