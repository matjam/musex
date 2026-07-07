import Foundation

// The background-download engine. Owns ONE background URLSession (id
// `net.stupendous.musex.downloads`) plus a JSON-persisted backlog of job
// descriptors, and keeps exactly one URLSession task in flight (concurrency 1 —
// politeness alongside live streaming), refilling from the backlog inside the
// delegate. Because the session is a background session with
// sessionSendsLaunchEvents, the whole backlog drains while the app is
// suspended or killed; results that land while JS is away are buffered in the
// same persisted state and handed over via reattach().
//
// Integrity policy (matches the JS engine / spec): for Original jobs the
// catalog expectedBytes is a TRUNCATION GUARD only — a delivery smaller than
// it fails (retry per backoff); equal-or-larger is accepted with a logged
// warning, and the DELIVERED size is what onComplete reports (JS persists it
// as the authoritative record value).
final class BackgroundDownloadManager: NSObject {
  static let shared = BackgroundDownloadManager()
  static let sessionIdentifier = "net.stupendous.musex.downloads"

  private static let maxOriginalRetries = 5
  private static let progressThrottleSec: TimeInterval = 1.0
  /// Per-step HLS retry policy: 404 means "Plex hasn't transcoded that segment
  /// yet" — re-enqueue the SAME step 3s later, up to 60 attempts (mirrors the
  /// JS engine's 60x700ms policy at background-session pacing).
  private static let hlsRetryDelaySec: TimeInterval = 3.0
  private static let maxHlsStepAttempts = 60

  // MARK: - Persisted state

  /// A TransferJob as submitted from JS (see core `transfer-job.ts`).
  struct SubmittedJob: Decodable {
    let key: String
    let mode: String // "original" | "hls"
    let url: String
    let headers: [String: String]
    let destPath: String
    let expectedBytes: Int64?
    let stopUrl: String?
  }

  struct HlsJobState: Codable {
    /// "master" | "media" | "segment" — what the job's current download task is fetching.
    var phase: String
    var mediaUrl: String?
    var segmentUrls: [String]
    /// Next segment to fetch; segments < nextIndex are already appended to `.part`.
    var nextIndex: Int
    /// Bytes appended to `.part` so far (used to truncate a torn append on resume).
    var bytes: Int64
    /// 404/5xx retry attempts for the CURRENT step (reset when a step lands).
    var attempts: Int
  }

  struct JobDescriptor: Codable {
    let key: String
    let mode: String
    let url: String
    let headers: [String: String]
    let destPath: String
    let expectedBytes: Int64?
    let stopUrl: String?
    var retries: Int
    var resumeDataB64: String?
    var hls: HlsJobState?

    init(from j: SubmittedJob) {
      key = j.key
      mode = j.mode
      url = j.url
      headers = j.headers
      destPath = j.destPath
      expectedBytes = j.expectedBytes
      stopUrl = j.stopUrl
      retries = 0
      resumeDataB64 = nil
      hls = nil
    }
  }

  struct CompletedResult: Codable {
    let key: String
    let bytes: Int64
  }

  struct FailedResult: Codable {
    let key: String
    let message: String
  }

  /// Backlog + results-since-last-reattach, rewritten to backlog.json after
  /// every mutation (single small JSON file — cheap at this scale).
  struct PersistedState: Codable {
    var jobs: [JobDescriptor] = []
    var completed: [CompletedResult] = []
    var failed: [FailedResult] = []
  }

  // MARK: - State (all touched only on `queue`)

  /// Serial queue that owns all mutable state; it is also the underlying queue
  /// of the session's delegate OperationQueue, so delegate callbacks and API
  /// calls are mutually serialized.
  private let queue = DispatchQueue(label: "net.stupendous.musex.downloads.state")
  private var state = PersistedState()
  private var started = false
  /// Live URLSession tasks by job key. Guarded by `tasksLoaded`: until the
  /// initial getAllTasks() sweep lands we must not start anything, or a job
  /// already running from a previous launch would be started twice.
  private var activeTasks: [String: URLSessionTask] = [:]
  private var tasksLoaded = false
  private var lastProgressEmit: [String: TimeInterval] = [:]
  private var backgroundCompletionHandler: (() -> Void)?

  /// Set by the module (JS alive) to forward events; nil while JS is away —
  /// results still land in the persisted buffer for reattach().
  var emitter: ((_ name: String, _ body: [String: Any?]) -> Void)?

  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
    config.sessionSendsLaunchEvents = true
    config.isDiscretionary = false
    let opQueue = OperationQueue()
    opQueue.maxConcurrentOperationCount = 1
    opQueue.underlyingQueue = queue
    return URLSession(configuration: config, delegate: self, delegateQueue: opQueue)
  }()

  // MARK: - Lifecycle

  /// Idempotent boot: load persisted state, recreate the background session,
  /// sweep its live tasks, then start filling. Called from the module's
  /// OnCreate (JS launch) and the AppDelegate subscriber (background relaunch).
  func ensureStarted() {
    queue.async { self.ensureStartedLocked() }
  }

  private func ensureStartedLocked() {
    if started { return }
    started = true
    loadState()
    // Recreating the session re-attaches its live background tasks; the sweep
    // below maps them back onto backlog keys before anything new starts.
    session.getAllTasks { tasks in
      // Runs on the delegate queue, whose underlying queue is `self.queue`.
      for task in tasks {
        guard let key = task.taskDescription else { continue }
        if task.state == .running || task.state == .suspended {
          self.activeTasks[key] = task
        }
      }
      self.tasksLoaded = true
      self.fill()
    }
  }

  func setBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
    queue.async { self.backgroundCompletionHandler = handler }
  }

  // MARK: - JS API (module calls)

  func submit(_ jobsJson: String, completion: @escaping (Error?) -> Void) {
    queue.async {
      self.ensureStartedLocked()
      do {
        let incoming = try JSONDecoder().decode([SubmittedJob].self, from: Data(jobsJson.utf8))
        for j in incoming {
          // Idempotent per key: a resubmit after a JS relaunch must silently
          // reattach to the job already in the backlog, not error or duplicate.
          if self.state.jobs.contains(where: { $0.key == j.key }) { continue }
          self.state.jobs.append(JobDescriptor(from: j))
        }
        self.persist()
        self.fill()
        completion(nil)
      } catch {
        completion(error)
      }
    }
  }

  func cancel(_ keys: [String], completion: @escaping () -> Void) {
    queue.async {
      self.ensureStartedLocked()
      let drop = Set(keys)
      let dropped = self.state.jobs.filter { drop.contains($0.key) }
      self.state.jobs.removeAll { drop.contains($0.key) }
      for key in keys {
        if let task = self.activeTasks.removeValue(forKey: key) { task.cancel() }
        self.lastProgressEmit.removeValue(forKey: key)
      }
      for job in dropped {
        try? FileManager.default.removeItem(atPath: job.destPath + ".part")
      }
      self.persist()
      self.fill()
      completion()
    }
  }

  /// Snapshot for JS bootstrap: keys still in the backlog (genuinely in
  /// flight natively) plus results buffered while JS was away. Clears the
  /// results buffer — JS folds them into its index exactly once.
  func reattach(completion: @escaping (String) -> Void) {
    queue.async {
      self.ensureStartedLocked()
      let snapshot: [String: Any] = [
        "active": self.state.jobs.map { $0.key },
        "completed": self.state.completed.map { ["key": $0.key, "bytes": Int($0.bytes)] },
        "failed": self.state.failed.map { ["key": $0.key, "message": $0.message] },
      ]
      self.state.completed = []
      self.state.failed = []
      self.persist()
      let json = (try? JSONSerialization.data(withJSONObject: snapshot))
        .flatMap { String(data: $0, encoding: .utf8) }
      completion(json ?? #"{"active":[],"completed":[],"failed":[]}"#)
    }
  }

  // MARK: - Backlog fill (concurrency 1)

  private func fill() {
    guard tasksLoaded else { return }
    guard activeTasks.isEmpty else { return } // one task at a time
    guard let idx = state.jobs.firstIndex(where: { activeTasks[$0.key] == nil }) else {
      return
    }
    if state.jobs[idx].mode == "original" {
      startOriginal(state.jobs[idx])
    } else {
      startHls(idx)
    }
  }

  private func startOriginal(_ job: JobDescriptor) {
    let task: URLSessionDownloadTask
    if let b64 = job.resumeDataB64, let data = Data(base64Encoded: b64) {
      task = session.downloadTask(withResumeData: data)
    } else {
      guard let url = URL(string: job.url) else {
        failTerminal(job.key, "invalid url")
        return
      }
      var req = URLRequest(url: url)
      for (k, v) in job.headers { req.setValue(v, forHTTPHeaderField: k) }
      task = session.downloadTask(with: req)
    }
    task.taskDescription = job.key
    if job.retries > 0 {
      task.earliestBeginDate = Date().addingTimeInterval(Self.backoff(retries: job.retries))
    }
    activeTasks[job.key] = task
    task.resume()
  }

  /// Exponential backoff for Original retries: min(2^retries * 5, 300) seconds.
  private static func backoff(retries: Int) -> TimeInterval {
    return min(pow(2.0, Double(retries)) * 5.0, 300.0)
  }

  // MARK: - Job completion paths

  private func jobIndex(_ key: String) -> Int? {
    return state.jobs.firstIndex(where: { $0.key == key })
  }

  private func completeJob(_ key: String, bytes: Int64) {
    state.jobs.removeAll { $0.key == key }
    state.completed.append(CompletedResult(key: key, bytes: bytes))
    persist()
    lastProgressEmit.removeValue(forKey: key)
    emitter?("onComplete", ["key": key, "bytes": Int(bytes)])
    fill()
  }

  private func failTerminal(_ key: String, _ message: String) {
    if let i = jobIndex(key) {
      let job = state.jobs[i]
      try? FileManager.default.removeItem(atPath: job.destPath + ".part")
    }
    state.jobs.removeAll { $0.key == key }
    state.failed.append(FailedResult(key: key, message: message))
    persist()
    lastProgressEmit.removeValue(forKey: key)
    emitter?("onError", ["key": key, "message": message, "terminal": true])
    fill()
  }

  /// Original failure: persist resumeData when available, retry with
  /// earliestBeginDate backoff up to maxOriginalRetries, then give up.
  /// Non-terminal errors are surfaced with terminal:false so JS keeps the
  /// record "downloading".
  private func retryOrFailOriginal(_ key: String, _ message: String, resumeData: Data?) {
    guard let i = jobIndex(key) else { return }
    state.jobs[i].retries += 1
    if state.jobs[i].retries > Self.maxOriginalRetries {
      failTerminal(key, message)
      return
    }
    state.jobs[i].resumeDataB64 = resumeData?.base64EncodedString()
    persist()
    emitter?("onError", ["key": key, "message": message, "terminal": false])
    // Re-create the task now with its earliestBeginDate in the future — it
    // occupies the single slot, so the background session runs the retry even
    // if the app is suspended by then.
    startOriginal(state.jobs[i])
  }

  private func handleOriginalFinished(_ key: String, jobIdx: Int, location: URL, status: Int) {
    let job = state.jobs[jobIdx]
    if status >= 400 {
      // The "download" is an error body — never commit it.
      if status >= 500 || status == 429 {
        retryOrFailOriginal(key, "http \(status)", resumeData: nil)
      } else {
        failTerminal(key, "http \(status)")
      }
      return
    }
    let attrs = try? FileManager.default.attributesOfItem(atPath: location.path)
    let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    if let expected = job.expectedBytes, size < expected {
      // Truncation guard: under-delivery vs the catalog is a failed transfer.
      retryOrFailOriginal(key, "truncated: got \(size) want \(expected)", resumeData: nil)
      return
    }
    if job.expectedBytes == nil && size <= 0 {
      retryOrFailOriginal(key, "empty download", resumeData: nil)
      return
    }
    if let expected = job.expectedBytes, size != expected {
      NSLog(
        "[musex downloads] size differs from Plex catalog (got %lld, want %lld), accepting delivered file: %@",
        size, expected, key)
    }
    do {
      try moveIntoPlace(from: location, toPath: job.destPath)
    } catch {
      // Disk-level failure — retrying won't produce a different disk.
      failTerminal(key, "move failed: \(error.localizedDescription)")
      return
    }
    completeJob(key, bytes: size)
  }

  private func moveIntoPlace(from location: URL, toPath destPath: String) throws {
    let fm = FileManager.default
    let parent = (destPath as NSString).deletingLastPathComponent
    try fm.createDirectory(atPath: parent, withIntermediateDirectories: true)
    if fm.fileExists(atPath: destPath) {
      try fm.removeItem(atPath: destPath)
    }
    try fm.moveItem(at: location, to: URL(fileURLWithPath: destPath))
  }

  // MARK: - HLS (AAC) chaining

  // An HLS job runs as a delegate-driven chain on the SAME background session:
  // download the master playlist, then the media playlist, then segments ONE
  // AT A TIME, each appended to `destPath + ".part"` in the delegate — no
  // long-running loop, so the chain survives suspension and kill (phase +
  // nextIndex + appended-bytes are persisted per step; the `.part` file holds
  // segments < nextIndex, torn appends are truncated away on the next append).

  private func startHls(_ jobIdx: Int) {
    if state.jobs[jobIdx].hls == nil {
      state.jobs[jobIdx].hls = HlsJobState(
        phase: "master", mediaUrl: nil, segmentUrls: [], nextIndex: 0, bytes: 0, attempts: 0)
      persist()
    }
    enqueueCurrentHlsStep(jobIdx, delayed: false)
  }

  /// Starts a download task for whatever the job's persisted phase points at.
  private func enqueueCurrentHlsStep(_ jobIdx: Int, delayed: Bool) {
    let job = state.jobs[jobIdx]
    guard let hls = job.hls else {
      failTerminal(job.key, "hls state missing")
      return
    }
    let urlString: String
    switch hls.phase {
    case "master":
      urlString = job.url
    case "media":
      guard let mediaUrl = hls.mediaUrl else {
        failTerminal(job.key, "hls media url missing")
        return
      }
      urlString = mediaUrl
    default: // "segment"
      guard hls.nextIndex < hls.segmentUrls.count else {
        // Defensive: all segments already appended (e.g. killed between the
        // last append and finalize) — finish up.
        finalizeHls(job.key, jobIdx: jobIdx)
        return
      }
      urlString = hls.segmentUrls[hls.nextIndex]
    }
    guard let url = URL(string: urlString) else {
      failTerminal(job.key, "invalid hls url")
      return
    }
    var req = URLRequest(url: url)
    for (k, v) in job.headers { req.setValue(v, forHTTPHeaderField: k) }
    let task = session.downloadTask(with: req)
    task.taskDescription = job.key
    if delayed {
      task.earliestBeginDate = Date().addingTimeInterval(Self.hlsRetryDelaySec)
    }
    activeTasks[job.key] = task
    task.resume()
  }

  /// 404/5xx/transport hiccup: re-enqueue the SAME step with a short delay,
  /// bounded; past the cap the job is terminal. No event per retry — JS keeps
  /// the record "downloading" precisely because nothing terminal arrives.
  private func retryOrFailHlsStep(_ key: String, jobIdx: Int, _ message: String) {
    guard state.jobs[jobIdx].hls != nil else {
      failTerminal(key, message)
      return
    }
    state.jobs[jobIdx].hls!.attempts += 1
    if state.jobs[jobIdx].hls!.attempts > Self.maxHlsStepAttempts {
      failTerminal(key, message)
      return
    }
    persist()
    enqueueCurrentHlsStep(jobIdx, delayed: true)
  }

  private func handleHlsFinished(_ key: String, jobIdx: Int, location: URL, status: Int) {
    if status == 404 || status >= 500 {
      retryOrFailHlsStep(key, jobIdx: jobIdx, "hls http \(status)")
      return
    }
    if status >= 400 {
      failTerminal(key, "hls http \(status)")
      return
    }
    let phase = state.jobs[jobIdx].hls?.phase ?? "master"
    switch phase {
    case "master":
      guard let text = try? String(contentsOf: location, encoding: .utf8) else {
        retryOrFailHlsStep(key, jobIdx: jobIdx, "unreadable master playlist")
        return
      }
      let job = state.jobs[jobIdx]
      if let variant = Self.parseHlsMaster(text) {
        guard let resolved = URL(string: variant, relativeTo: URL(string: job.url))?.absoluteString
        else {
          failTerminal(key, "invalid variant uri")
          return
        }
        state.jobs[jobIdx].hls = HlsJobState(
          phase: "media", mediaUrl: resolved, segmentUrls: [], nextIndex: 0, bytes: 0, attempts: 0)
        persist()
        enqueueCurrentHlsStep(jobIdx, delayed: false)
      } else {
        // No #EXT-X-STREAM-INF — the response is already a media playlist.
        beginSegments(key, jobIdx: jobIdx, mediaText: text, baseUrl: job.url)
      }
    case "media":
      guard let text = try? String(contentsOf: location, encoding: .utf8) else {
        retryOrFailHlsStep(key, jobIdx: jobIdx, "unreadable media playlist")
        return
      }
      let base = state.jobs[jobIdx].hls?.mediaUrl ?? state.jobs[jobIdx].url
      beginSegments(key, jobIdx: jobIdx, mediaText: text, baseUrl: base)
    default: // "segment"
      guard let data = try? Data(contentsOf: location), !data.isEmpty else {
        // Empty body = Plex not ready (mirrors the JS engine's empty-bytes retry).
        retryOrFailHlsStep(key, jobIdx: jobIdx, "empty segment")
        return
      }
      appendSegment(key, jobIdx: jobIdx, data: data)
    }
  }

  private func beginSegments(_ key: String, jobIdx: Int, mediaText: String, baseUrl: String) {
    let (segments, ended) = Self.parseHlsMedia(mediaText)
    if !ended {
      failTerminal(key, "incomplete playlist (no ENDLIST)")
      return
    }
    if segments.isEmpty {
      failTerminal(key, "no segments")
      return
    }
    let base = URL(string: baseUrl)
    let resolved = segments.compactMap { URL(string: $0, relativeTo: base)?.absoluteString }
    guard resolved.count == segments.count else {
      failTerminal(key, "invalid segment uri")
      return
    }
    // Fresh chain: any leftover partial from an aborted earlier attempt goes.
    try? FileManager.default.removeItem(atPath: state.jobs[jobIdx].destPath + ".part")
    state.jobs[jobIdx].hls = HlsJobState(
      phase: "segment", mediaUrl: baseUrl, segmentUrls: resolved, nextIndex: 0, bytes: 0,
      attempts: 0)
    persist()
    enqueueCurrentHlsStep(jobIdx, delayed: false)
  }

  private func appendSegment(_ key: String, jobIdx: Int, data: Data) {
    let job = state.jobs[jobIdx]
    guard let hls = job.hls else {
      failTerminal(key, "hls state missing")
      return
    }
    do {
      try appendToPart(job.destPath + ".part", data: data, knownBytes: hls.bytes)
    } catch {
      // Disk-level failure — retrying won't produce a different disk.
      failTerminal(key, "part write failed: \(error.localizedDescription)")
      return
    }
    state.jobs[jobIdx].hls!.bytes += Int64(data.count)
    state.jobs[jobIdx].hls!.nextIndex += 1
    state.jobs[jobIdx].hls!.attempts = 0
    persist()
    let updated = state.jobs[jobIdx].hls!
    emitProgress(
      key,
      [
        "key": key,
        "bytes": Int(updated.bytes),
        "segmentsDone": updated.nextIndex,
        "segmentsTotal": updated.segmentUrls.count,
      ])
    if updated.nextIndex >= updated.segmentUrls.count {
      finalizeHls(key, jobIdx: jobIdx)
    } else {
      enqueueCurrentHlsStep(jobIdx, delayed: false)
    }
  }

  private func finalizeHls(_ key: String, jobIdx: Int) {
    let job = state.jobs[jobIdx]
    let bytes = job.hls?.bytes ?? 0
    do {
      try moveIntoPlace(
        from: URL(fileURLWithPath: job.destPath + ".part"), toPath: job.destPath)
    } catch {
      failTerminal(key, "commit failed: \(error.localizedDescription)")
      return
    }
    fireStopUrl(job)
    completeJob(key, bytes: bytes)
  }

  /// Best-effort Plex transcode-session stop — a plain data task on a separate
  /// default session (it only matters while the server session lingers; a
  /// failure is logged, never surfaced).
  private static let stopUrlSession = URLSession(configuration: .ephemeral)

  private func fireStopUrl(_ job: JobDescriptor) {
    guard let stopUrl = job.stopUrl, let url = URL(string: stopUrl) else { return }
    Self.stopUrlSession.dataTask(with: url) { _, _, error in
      if let error = error {
        NSLog("[musex downloads] hls stop-session failed: %@", error.localizedDescription)
      }
    }.resume()
  }

  /// Appends segment bytes to the `.part` file, truncating to the persisted
  /// byte count first so a torn append from a kill mid-write is discarded
  /// (that segment's index was never advanced, so it re-downloads cleanly).
  private func appendToPart(_ partPath: String, data: Data, knownBytes: Int64) throws {
    let fm = FileManager.default
    if !fm.fileExists(atPath: partPath) {
      let parent = (partPath as NSString).deletingLastPathComponent
      try fm.createDirectory(atPath: parent, withIntermediateDirectories: true)
      fm.createFile(atPath: partPath, contents: nil)
    }
    guard let fh = FileHandle(forWritingAtPath: partPath) else {
      throw NSError(
        domain: "BackgroundDownloads", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "cannot open \(partPath)"])
    }
    defer { try? fh.close() }
    try fh.truncate(atOffset: UInt64(knownBytes))
    try fh.seekToEnd()
    try fh.write(contentsOf: data)
  }

  // MARK: - HLS playlist parsing (Swift port of core transcode-url.ts rules)

  /// First non-comment, non-blank line after a `#EXT-X-STREAM-INF` tag, or nil
  /// if the text is already a media playlist.
  static func parseHlsMaster(_ text: String) -> String? {
    var takeNext = false
    for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if takeNext {
        if !line.isEmpty && !line.hasPrefix("#") { return line }
        continue
      }
      if line.hasPrefix("#EXT-X-STREAM-INF") { takeNext = true }
    }
    return nil
  }

  /// Segments = non-comment lines; ended = `#EXT-X-ENDLIST` present.
  static func parseHlsMedia(_ text: String) -> (segments: [String], ended: Bool) {
    var segments: [String] = []
    var ended = false
    for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.isEmpty { continue }
      if line == "#EXT-X-ENDLIST" {
        ended = true
      } else if !line.hasPrefix("#") {
        segments.append(line)
      }
    }
    return (segments, ended)
  }

  // MARK: - Progress

  private func emitProgress(_ key: String, _ body: [String: Any?]) {
    let now = Date().timeIntervalSince1970
    if now - (lastProgressEmit[key] ?? 0) < Self.progressThrottleSec { return }
    lastProgressEmit[key] = now
    emitter?("onProgress", body)
  }

  // MARK: - Persistence

  private var stateFileURL: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("musex-downloads/backlog.json")
  }

  private func loadState() {
    guard let data = try? Data(contentsOf: stateFileURL) else { return }
    if let loaded = try? JSONDecoder().decode(PersistedState.self, from: data) {
      state = loaded
    }
  }

  private func persist() {
    do {
      let dir = stateFileURL.deletingLastPathComponent()
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let data = try JSONEncoder().encode(state)
      try data.write(to: stateFileURL, options: .atomic)
    } catch {
      NSLog("[musex downloads] backlog persist failed: %@", error.localizedDescription)
    }
  }
}

// MARK: - URLSession delegates

extension BackgroundDownloadManager: URLSessionDownloadDelegate {
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let key = downloadTask.taskDescription, let i = jobIndex(key) else { return }
    activeTasks.removeValue(forKey: key)
    let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
    if state.jobs[i].mode == "original" {
      handleOriginalFinished(key, jobIdx: i, location: location, status: status)
    } else {
      handleHlsFinished(key, jobIdx: i, location: location, status: status)
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    guard let key = downloadTask.taskDescription, let i = jobIndex(key) else { return }
    guard state.jobs[i].mode == "original" else { return } // HLS progress = per-segment appends
    emitProgress(key, ["key": key, "bytes": Int(totalBytesWritten)])
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let key = task.taskDescription else { return }
    guard let error = error else {
      // Success path already handled in didFinishDownloadingTo.
      activeTasks.removeValue(forKey: key)
      return
    }
    activeTasks.removeValue(forKey: key)
    let nsError = error as NSError
    if nsError.code == NSURLErrorCancelled && nsError.domain == NSURLErrorDomain {
      // Deliberate cancel — backlog already updated by cancel().
      fill()
      return
    }
    guard let i = jobIndex(key) else {
      fill()
      return
    }
    if state.jobs[i].mode == "original" {
      let resumeData = nsError.userInfo[NSURLSessionDownloadTaskResumeData] as? Data
      retryOrFailOriginal(key, error.localizedDescription, resumeData: resumeData)
    } else {
      // Transport hiccup mid-chain (e.g. airplane mode) — same bounded
      // retry-the-current-step policy as an HTTP 5xx.
      retryOrFailHlsStep(key, jobIdx: i, error.localizedDescription)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    // All queued delegate messages for the background relaunch are delivered —
    // tell the system we're done (on the main queue, per the docs).
    let handler = backgroundCompletionHandler
    backgroundCompletionHandler = nil
    if let handler = handler {
      DispatchQueue.main.async { handler() }
    }
  }
}
