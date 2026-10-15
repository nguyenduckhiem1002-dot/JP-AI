// On-device Japanese speech recognition with Apple's SpeechAnalyzer (macOS 26+).
// Usage: apple-asr <audio file> [locale]
// Prints JSON to stdout: {"results": [{"words": [{"text", "start", "end"}]}]}
// One result per finalized utterance; one word per attributed run (start/end -1 if untimed).
import AVFoundation
import Foundation
import Speech

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write("apple-asr: \(message)\n".data(using: .utf8)!)
  exit(code)
}

@main struct AppleASR {
  static func main() async {
    let args = CommandLine.arguments
    guard args.count >= 2 else { fail("usage: apple-asr <audio file> [locale]", code: 2) }
    let localeId = args.count >= 3 ? args[2] : "ja-JP"

    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else {
      fail("locale \(localeId) not supported", code: 3)
    }

    do {
      let transcriber = SpeechTranscriber(
        locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
      // First run downloads the on-device model for this language
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await request.downloadAndInstall()
      }

      let analyzer = SpeechAnalyzer(modules: [transcriber])
      let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[1]))

      let collect = Task { () -> [[String: Any]] in
        var results: [[String: Any]] = []
        for try await result in transcriber.results {
          let words: [[String: Any]] = result.text.runs.map { run in
            let text = String(result.text[run.range].characters)
            guard let range = run.audioTimeRange else { return ["text": text, "start": -1, "end": -1] }
            return ["text": text, "start": range.start.seconds, "end": range.end.seconds]
          }
          results.append(["words": words])
        }
        return results
      }

      if let last = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: last)
      } else {
        await analyzer.cancelAndFinishNow()
      }

      let data = try JSONSerialization.data(withJSONObject: ["results": try await collect.value])
      FileHandle.standardOutput.write(data)
    } catch {
      fail("\(error)")
    }
  }
}
