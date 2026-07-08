import AVFoundation
import CoreMedia
import Foundation
import UIKit

// The background-download engine. Owns ONE background URLSession (id
// `net.stupendous.musex.downloads`) plus a JSON-persisted backlog of job
// descriptors, and keeps exactly one URLSession task in flight (concurrency 1 —
// politeness alongside live streaming), refilling from the backlog inside the
// delegate. Because the session is a background session with
// sessionSendsLaunchEvents, the whole backlog drains while the app is
// suspended or killed; results that land while JS is away are buffered in the
// same persisted state and handed over via reattach().
//
// "convert" jobs (AAC storage quality, off-cellular) download the ORIGINAL
// file exactly like "original" — but into `destPath + ".orig"` — then join a
// persisted conversion backlog drained serially by an on-device
// AVAssetReader→AVAssetWriter AAC pipeline (each conversion wrapped in a
// beginBackgroundTask so a wake window finishes the in-flight one). Success
// commits the m4a to destPath, deletes the .orig, and reports the M4A size
// (delivered-size-authoritative). The record stays "downloading" until the
// conversion completes; a relaunch resumes conversion from the kept .orig
// without re-downloading.
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
    let mode: String // "original" | "hls" | "convert"
    let url: String
    let headers: [String: String]
    let destPath: String
    let expectedBytes: Int64?
    let stopUrl: String?
    /// convert only — the on-device AAC target bitrate.
    let targetBitrateKbps: Int?
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
    /// convert only — the on-device AAC target bitrate. Optional so state
    /// files persisted before the field existed still decode.
    let targetBitrateKbps: Int?
    /// convert only — failed conversion attempts (retry once, then terminal).
    /// Optional for the same persisted-state back-compat reason.
    var conversionAttempts: Int?

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
      targetBitrateKbps = j.targetBitrateKbps
      conversionAttempts = nil
    }
  }

  struct CompletedResult: Codable {
    let key: String
    let bytes: Int64
    /// Convert jobs only — the artifact is the on-device AAC m4a, and this is
    /// its ACTUAL target bitrate (from the JobDescriptor), so JS patches the
    /// record's media meta from truth instead of guessing. Optionals so state
    /// files persisted before the fields existed still decode.
    let converted: Bool?
    let bitrateKbps: Int?
  }

  struct FailedResult: Codable {
    let key: String
    let message: String
  }

  /// Backlog + results-since-last-reattach, rewritten to backlog.json after
  /// every mutation (single small JSON file — cheap at this scale).
  /// Custom decode: every field is decodeIfPresent so a state file persisted
  /// by an older build (no `pendingConversions` key) still loads instead of
  /// silently resetting the whole backlog.
  struct PersistedState: Codable {
    var jobs: [JobDescriptor] = []
    var completed: [CompletedResult] = []
    var failed: [FailedResult] = []
    /// Keys downloaded to `.orig`, awaiting on-device AAC conversion (FIFO).
    var pendingConversions: [String] = []

    init() {}

    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      jobs = try c.decodeIfPresent([JobDescriptor].self, forKey: .jobs) ?? []
      completed = try c.decodeIfPresent([CompletedResult].self, forKey: .completed) ?? []
      failed = try c.decodeIfPresent([FailedResult].self, forKey: .failed) ?? []
      pendingConversions = try c.decodeIfPresent([String].self, forKey: .pendingConversions) ?? []
    }
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
  /// Keys whose active task is parked on a future `earliestBeginDate` (retry
  /// backoff). fill() may start the next backlog job while EVERY active task
  /// is waiting — otherwise one job's minutes-long backoff head-of-line
  /// blocks the whole queue.
  private var waitingKeys: Set<String> = []
  /// Segment-phase jobs restored from disk on a cold relaunch: Plex may have
  /// re-transcoded with different segment boundaries since, so the persisted
  /// segment list must be revalidated against a fresh media playlist before
  /// the chain continues. In-memory only (a warm resume never needs it).
  private var revalidateKeys: Set<String> = []
  /// Key whose AAC conversion is currently running (in-memory — a kill mid-
  /// conversion leaves the key in the persisted pendingConversions, so the
  /// next launch re-converts from the kept `.orig`). Serial: one at a time.
  private var convertingKey: String?
  /// Invalidation token for the running conversion pump: each conversion
  /// captures the current value at start, and cancel() of the converting key
  /// bumps it — the stale pump's finishConversion then no-ops instead of
  /// stalling the queue or committing into a resubmitted key's job.
  private var conversionGeneration = 0
  private var backgroundCompletionHandler: (() -> Void)?

  /// Set by the module (JS alive) to forward events; nil while JS is away —
  /// results still land in the persisted buffer for reattach(). Confined to
  /// `queue` (set via setEmitter) so it never races the delegate callbacks.
  private var emitter: ((_ name: String, _ body: [String: Any?]) -> Void)?

  func setEmitter(_ emitter: ((_ name: String, _ body: [String: Any?]) -> Void)?) {
    queue.async { self.emitter = emitter }
  }

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
    // Cold-start conversion recovery: a convert job whose `.orig` fully
    // landed resumes at the conversion stage — never re-downloads.
    recoverConversions()
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
      self.drainConversions()
    }
  }

  func setBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
    queue.async {
      // Never drop a previously stashed handler — the ExpoAppDelegate
      // aggregates handlers across subscribers and only fires the system
      // callback once EVERY handed-out handler has been called; overwriting
      // one silently would leave the aggregate unbalanced forever.
      if let previous = self.backgroundCompletionHandler {
        DispatchQueue.main.async { previous() }
      }
      self.backgroundCompletionHandler = handler
    }
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
      var terminated = Set(dropped.map { $0.key })
      for key in keys {
        if let task = self.activeTasks.removeValue(forKey: key) {
          task.cancel()
          terminated.insert(key)
        }
        self.lastProgressEmit.removeValue(forKey: key)
        self.waitingKeys.remove(key)
      }
      for job in dropped {
        try? FileManager.default.removeItem(atPath: job.destPath + ".part")
        if job.mode == "convert" {
          try? FileManager.default.removeItem(atPath: job.destPath + ".orig")
          try? FileManager.default.removeItem(atPath: job.destPath + ".m4a.tmp")
        }
      }
      // Cancelled keys leave the conversion backlog too. If one is converting
      // RIGHT NOW, invalidate the running pump: bump the generation (its
      // finishConversion sees the mismatch and no-ops) and free the slot so
      // the rest of the backlog proceeds instead of stalling behind it.
      self.state.pendingConversions.removeAll { drop.contains($0) }
      if let converting = self.convertingKey, drop.contains(converting) {
        self.conversionGeneration += 1
        self.convertingKey = nil
      }
      // Invariant JS relies on: every submitted key eventually gets exactly
      // one terminal event — an explicit cancel IS that event. No double
      // emit from the delegate: a cancelled task's didCompleteWithError
      // arrives as NSURLErrorCancelled (swallowed there), and its job is
      // already gone from the backlog anyway.
      for key in terminated {
        if let emitter = self.emitter {
          emitter("onError", ["key": key, "message": "cancelled", "terminal": true])
        } else {
          self.state.failed.append(FailedResult(key: key, message: "cancelled"))
        }
      }
      self.trimResultBuffers()
      self.persist()
      self.fill()
      self.drainConversions()
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
        "completed": self.state.completed.map { c -> [String: Any] in
          var entry: [String: Any] = ["key": c.key, "bytes": Int(c.bytes)]
          // Convert jobs carry the artifact truth (see CompletedResult).
          if c.converted == true {
            entry["converted"] = true
            if let b = c.bitrateKbps { entry["bitrateKbps"] = b }
          }
          return entry
        },
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
    // Steady-state cap is 1 task at a time, but a task parked on a future
    // earliestBeginDate (retry backoff, up to minutes) must not head-of-line
    // block the rest of the backlog: when every active task is backoff-
    // waiting, start the next job. If a delayed retry then fires mid-transfer
    // we briefly run 2 tasks — an accepted tradeoff: suspend-survivable
    // backoff via earliestBeginDate is worth the rare brief overlap.
    guard activeTasks.keys.allSatisfy({ waitingKeys.contains($0) }) else { return }
    // A job pending conversion is downloaded — its slot is free for the next
    // download while the conversion queue drains it.
    guard
      let idx = state.jobs.firstIndex(where: {
        activeTasks[$0.key] == nil && !state.pendingConversions.contains($0.key)
      })
    else {
      return
    }
    if state.jobs[idx].mode == "hls" {
      startHls(idx)
    } else {
      startOriginal(state.jobs[idx])  // "original" and "convert" download alike
    }
  }

  /// Size of the file at `path`, or nil when absent/unreadable.
  private func fileSize(_ path: String) -> Int64? {
    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    return (attrs?[.size] as? NSNumber)?.int64Value
  }

  /// Cold-relaunch short-circuit: a task that finished while the app was dead
  /// can be absent from getAllTasks(), so fill() would restart the job from
  /// zero — and the identity guard then discards the finished file when its
  /// late delegate event finally arrives. If the dest already holds a
  /// complete file, the job is done. Returns true when it completed the job.
  private func completeIfAlreadyCommitted(_ job: JobDescriptor) -> Bool {
    // A live `.part` means the transfer is genuinely mid-flight — any dest
    // file would be a stale leftover, not a commit.
    if FileManager.default.fileExists(atPath: job.destPath + ".part") { return false }
    if job.mode == "convert" {
      // A convert job's dest is the CONVERTED m4a (smaller than the catalog
      // original, so no expectedBytes comparison): committed = the .orig is
      // gone (deleted right after the m4a move) and a non-empty dest exists.
      // A present .orig means the conversion stage owns the job.
      if FileManager.default.fileExists(atPath: job.destPath + ".orig") { return false }
      guard let size = fileSize(job.destPath), size > 0 else { return false }
      state.pendingConversions.removeAll { $0 == job.key }
      completeJob(job.key, bytes: size, converted: true, bitrateKbps: job.targetBitrateKbps)
      return true
    }
    guard let size = fileSize(job.destPath) else { return false }
    let complete = job.expectedBytes.map { size >= $0 } ?? (size > 0)
    guard complete else { return false }
    if job.mode == "hls" { fireStopUrl(job) }
    completeJob(job.key, bytes: size)
    return true
  }

  private func startOriginal(_ job: JobDescriptor) {
    if completeIfAlreadyCommitted(job) { return }
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
      // Routing rule (JS `transferModeFor`): on-device conversion is the
      // off-cellular path — a WiFi→cellular flip mid-queue must PAUSE these
      // original downloads until WiFi returns, not trickle them over data.
      if job.mode == "convert" { req.allowsCellularAccess = false }
      task = session.downloadTask(with: req)
    }
    task.taskDescription = job.key
    if job.retries > 0 {
      task.earliestBeginDate = Date().addingTimeInterval(Self.backoff(retries: job.retries))
      waitingKeys.insert(job.key)
    } else {
      waitingKeys.remove(job.key)
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

  /// Cap on each persisted results buffer; oldest entries drop past it. Only
  /// results that land while NO emitter is attached are buffered at all —
  /// live events go straight to JS and must not ALSO be buffered, or a JS
  /// reload without a native teardown would fold them a second time (and the
  /// buffer would grow without bound while JS is healthy).
  private static let maxBufferedResults = 500

  private func trimResultBuffers() {
    if state.completed.count > Self.maxBufferedResults {
      state.completed.removeFirst(state.completed.count - Self.maxBufferedResults)
    }
    if state.failed.count > Self.maxBufferedResults {
      state.failed.removeFirst(state.failed.count - Self.maxBufferedResults)
    }
  }

  /// `converted`/`bitrateKbps` are set ONLY for convert jobs whose dest is the
  /// on-device AAC m4a — the event/snapshot carries the artifact truth so JS
  /// never has to guess the record's media meta.
  private func completeJob(
    _ key: String, bytes: Int64, converted: Bool = false, bitrateKbps: Int? = nil
  ) {
    state.jobs.removeAll { $0.key == key }
    lastProgressEmit.removeValue(forKey: key)
    waitingKeys.remove(key)
    if let emitter = emitter {
      persist()
      var body: [String: Any?] = ["key": key, "bytes": Int(bytes)]
      if converted {
        body["converted"] = true
        body["bitrateKbps"] = bitrateKbps
      }
      emitter("onComplete", body)
    } else {
      state.completed.append(
        CompletedResult(
          key: key, bytes: bytes, converted: converted ? true : nil, bitrateKbps: bitrateKbps))
      trimResultBuffers()
      persist()
    }
    fill()
  }

  private func failTerminal(_ key: String, _ message: String) {
    if let i = jobIndex(key) {
      let job = state.jobs[i]
      try? FileManager.default.removeItem(atPath: job.destPath + ".part")
      if job.mode == "convert" {
        try? FileManager.default.removeItem(atPath: job.destPath + ".orig")
        try? FileManager.default.removeItem(atPath: job.destPath + ".m4a.tmp")
      }
    }
    state.jobs.removeAll { $0.key == key }
    state.pendingConversions.removeAll { $0 == key }
    lastProgressEmit.removeValue(forKey: key)
    waitingKeys.remove(key)
    if let emitter = emitter {
      persist()
      emitter("onError", ["key": key, "message": message, "terminal": true])
    } else {
      state.failed.append(FailedResult(key: key, message: message))
      trimResultBuffers()
      persist()
    }
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
    // A convert job's download lands at `.orig`; the conversion queue owns it
    // from here (the job is NOT complete — the record stays "downloading").
    let target = job.mode == "convert" ? job.destPath + ".orig" : job.destPath
    do {
      try moveIntoPlace(from: location, toPath: target)
    } catch {
      // Disk-level failure — retrying won't produce a different disk.
      failTerminal(key, "move failed: \(error.localizedDescription)")
      return
    }
    if job.mode == "convert" {
      enqueueConversion(key)
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

  // MARK: - On-device AAC conversion queue

  // A "convert" job's second stage: `.orig` → AAC-LC in `.m4a.tmp` → dest.
  // The backlog (`state.pendingConversions`) is persisted and drained serially
  // on `queue`; the actual decode/encode pump runs off-queue and calls back.
  // Every conversion is wrapped in a beginBackgroundTask so the ~30s wake
  // window a completed background download produces can finish the in-flight
  // one; leftovers drain on the next execution (foreground or wake).

  /// Downloaded-`.orig` → conversion backlog. Fills the next download slot
  /// immediately (downloads and the one conversion run in parallel).
  private func enqueueConversion(_ key: String) {
    if !state.pendingConversions.contains(key) {
      state.pendingConversions.append(key)
    }
    persist()
    fill()
    drainConversions()
  }

  /// Cold-start resume: a convert job whose `.orig` fully landed (vs the
  /// truncation guard) goes straight to the conversion backlog — never
  /// re-downloaded. A short `.orig` is deleted; fill() restarts its download.
  private func recoverConversions() {
    var changed = false
    for job in state.jobs where job.mode == "convert" {
      if state.pendingConversions.contains(job.key) { continue }
      guard let size = fileSize(job.destPath + ".orig") else { continue }
      let complete = job.expectedBytes.map { size >= $0 } ?? (size > 0)
      if complete {
        state.pendingConversions.append(job.key)
        changed = true
      } else {
        try? FileManager.default.removeItem(atPath: job.destPath + ".orig")
      }
    }
    if changed { persist() }
  }

  /// Serial drain: start the next pending conversion if none is running.
  /// Runs on `queue`; the pump itself is off-queue and re-enters through
  /// finishConversion. Safe to call from anywhere state-mutating.
  private func drainConversions() {
    guard convertingKey == nil else { return }
    // Prune entries whose job vanished (cancelled while we weren't looking).
    let pruned = state.pendingConversions.filter { jobIndex($0) != nil }
    if pruned.count != state.pendingConversions.count {
      state.pendingConversions = pruned
      persist()
    }
    guard let key = state.pendingConversions.first, let i = jobIndex(key) else { return }
    let job = state.jobs[i]
    let origPath = job.destPath + ".orig"
    let tmpPath = job.destPath + ".m4a.tmp"
    let fm = FileManager.default
    if !fm.fileExists(atPath: origPath) {
      if let size = fileSize(job.destPath), size > 0 {
        // Killed between the m4a move (which deletes .orig) and the backlog
        // persist — the artifact is already committed.
        state.pendingConversions.removeAll { $0 == key }
        completeJob(key, bytes: size, converted: true, bitrateKbps: job.targetBitrateKbps)
      } else {
        // Nothing to convert and nothing committed — hand the job back to
        // the download stage (fill() restarts it now that it's not pending).
        state.pendingConversions.removeAll { $0 == key }
        persist()
        fill()
      }
      drainConversions()
      return
    }
    convertingKey = key
    // Captured by this pump; cancel() of `key` bumps the manager's counter so
    // the pump's finishConversion knows it has been invalidated.
    let generation = conversionGeneration
    // Wake-window insurance: ask for background time for THIS conversion.
    // Ended exactly once on every exit (finishConversion's defer + the
    // expiration handler share the once-guarded box).
    let endWakeTask = Self.beginWakeTask("musex-aac-convert")
    // 256 fallback is unreachable in practice — JS always sets the bitrate on
    // convert jobs; guard so a hand-rolled descriptor can't crash the encode.
    let bitrateKbps = job.targetBitrateKbps ?? 256
    Task.detached(priority: .utility) { [weak self] in
      do {
        let bytes = try await Self.convertToAacM4a(
          src: URL(fileURLWithPath: origPath),
          dst: URL(fileURLWithPath: tmpPath),
          bitrateKbps: bitrateKbps)
        self?.queue.async {
          self?.finishConversion(
            key, generation: generation, tmpPath: tmpPath, bytes: bytes, error: nil,
            endWakeTask: endWakeTask)
        }
      } catch {
        self?.queue.async {
          self?.finishConversion(
            key, generation: generation, tmpPath: tmpPath, bytes: 0, error: error,
            endWakeTask: endWakeTask)
        }
      }
    }
  }

  /// Terminal step of one conversion, back on `queue`. Success commits the
  /// m4a and reports ITS size (delivered-size-authoritative); failure retries
  /// once, then fails terminally (failTerminal cleans .orig/.m4a.tmp).
  private func finishConversion(
    _ key: String, generation: Int, tmpPath: String, bytes: Int64, error: Error?,
    endWakeTask: @escaping () -> Void
  ) {
    defer { endWakeTask() }
    guard generation == conversionGeneration else {
      // Stale pump: cancel() invalidated this conversion (bumped the
      // generation, cleared convertingKey, kept the queue draining). The key
      // may have been resubmitted since — touching jobs/pending/records or
      // emitting here would cross-contaminate the new life of the key. Only
      // remove our own output (the pump may have recreated the .m4a.tmp
      // after cancel()'s delete).
      try? FileManager.default.removeItem(atPath: tmpPath)
      return
    }
    convertingKey = nil
    guard let i = jobIndex(key), state.pendingConversions.contains(key) else {
      // Job vanished without a cancel-of-converting-key (defensive): nothing
      // to commit — keep draining.
      drainConversions()
      return
    }
    let job = state.jobs[i]
    let fm = FileManager.default
    var failure = error.map { $0.localizedDescription }
    if failure == nil {
      if bytes > 0, fileSize(job.destPath + ".m4a.tmp") == bytes {
        do {
          try moveIntoPlace(from: URL(fileURLWithPath: job.destPath + ".m4a.tmp"),
                            toPath: job.destPath)
          try? fm.removeItem(atPath: job.destPath + ".orig")
          state.pendingConversions.removeAll { $0 == key }
          completeJob(key, bytes: bytes, converted: true, bitrateKbps: job.targetBitrateKbps)
          drainConversions()
          return
        } catch {
          // Disk-level failure — retrying won't produce a different disk.
          failTerminal(key, "conversion move failed: \(error.localizedDescription)")
          drainConversions()
          return
        }
      }
      failure = "empty conversion output"
    }
    let attempts = (job.conversionAttempts ?? 0) + 1
    state.jobs[i].conversionAttempts = attempts
    if attempts > 1 {
      failTerminal(key, "conversion failed: \(failure ?? "unknown")")
    } else {
      try? fm.removeItem(atPath: job.destPath + ".m4a.tmp")
      NSLog(
        "[musex downloads] conversion failed (attempt %d), retrying: %@", attempts,
        failure ?? "unknown")
      persist()
    }
    drainConversions()
  }

  /// beginBackgroundTask with a once-only end shared by the expiration
  /// handler and the normal exit — the pair MUST balance exactly. Thread-safe
  /// (UIKit documents begin/endBackgroundTask as callable from any thread;
  /// both are NS_SWIFT_NONISOLATED in the SDK).
  private static func beginWakeTask(_ name: String) -> () -> Void {
    let box = WakeTaskBox()
    let id = UIApplication.shared.beginBackgroundTask(withName: name) { box.end() }
    box.setId(id)
    return { box.end() }
  }

  private final class WakeTaskBox {
    private let lock = NSLock()
    private var id: UIBackgroundTaskIdentifier = .invalid
    private var ended = false
    /// end() arrived before setId (expiration racing the begin call's return).
    private var endedEarly = false

    func setId(_ newId: UIBackgroundTaskIdentifier) {
      lock.lock()
      id = newId
      let endNow = endedEarly && !ended
      if endNow { ended = true }
      lock.unlock()
      if endNow, newId != .invalid {
        UIApplication.shared.endBackgroundTask(newId)
      }
    }

    func end() {
      lock.lock()
      if id == .invalid, !ended {
        endedEarly = true
        lock.unlock()
        return
      }
      let endNow = !ended
      ended = true
      let taskId = id
      lock.unlock()
      if endNow, taskId != .invalid {
        UIApplication.shared.endBackgroundTask(taskId)
      }
    }
  }

  // MARK: - AAC encode (AVAssetReader → AVAssetWriter)

  private static func conversionError(_ message: String) -> NSError {
    return NSError(
      domain: "BackgroundDownloads", code: 2,
      userInfo: [NSLocalizedDescriptionKey: message])
  }

  /// Reference box for the pump's mutable done-flag: the
  /// requestMediaDataWhenReady block is @Sendable (NS_SWIFT_SENDABLE in the
  /// SDK), which forbids captured `var` mutation; the serial pump queue is
  /// what actually orders accesses.
  private final class PumpState {
    var done = false
  }

  /// Decode the downloaded original to LPCM and re-encode as AAC-LC in an
  /// .m4a at the requested bitrate, honoring the user's bitrate setting —
  /// which is exactly what AVAssetExportSession's AppleM4A preset ignores, so
  /// this is the AVAssetReader→AVAssetWriter pipeline: a track output
  /// decoding to LPCM (resampled/downmixed decoder-side to the capped output
  /// shape) feeds an AAC-encoding writer input. Returns the m4a's size.
  static func convertToAacM4a(src: URL, dst: URL, bitrateKbps: Int) async throws -> Int64 {
    let asset = AVURLAsset(url: src)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
      throw conversionError("no audio track")
    }
    // Source rate/channels bound the output settings: the AAC-LC encoder
    // takes at most 48 kHz / stereo here. Hi-res and multichannel originals
    // are resampled/downmixed by the READER's decoder — the writer input's
    // append REJECTS buffers whose rate/channels differ from its pinned
    // settings, so the LPCM handed to it must already be at the capped shape.
    let asbd = try await track.load(.formatDescriptions).first
      .flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
    let srcRate = asbd.map { $0.mSampleRate } ?? 0
    let srcChannels = asbd.map { Int($0.mChannelsPerFrame) } ?? 2
    let outRate = min(srcRate > 0 ? srcRate : 44100, 48000)
    let outChannels = min(max(srcChannels, 1), 2)

    let reader = try AVAssetReader(asset: asset)
    // Full LPCM spec (not just the format id): the decoder resamples/downmixes
    // to exactly what the AAC writer input accepts.
    let readerOutput = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: outRate,
        AVNumberOfChannelsKey: outChannels,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ])
    guard reader.canAdd(readerOutput) else { throw conversionError("cannot add reader output") }
    reader.add(readerOutput)

    // A stale .tmp from an aborted earlier attempt would fail AVAssetWriter's init.
    try? FileManager.default.removeItem(at: dst)
    let writer = try AVAssetWriter(outputURL: dst, fileType: .m4a)
    let input = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: outRate,
        AVNumberOfChannelsKey: outChannels,
        AVEncoderBitRateKey: bitrateKbps * 1000,
      ])
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else {
      throw conversionError("cannot add writer input")
    }
    writer.add(input)

    guard reader.startReading() else {
      throw reader.error ?? conversionError("reader failed to start")
    }
    guard writer.startWriting() else {
      reader.cancelReading()
      throw writer.error ?? conversionError("writer failed to start")
    }
    writer.startSession(atSourceTime: .zero)

    // The async pump: AVFoundation invokes the block on `pumpQueue` whenever
    // the input can take more; the serial queue plus the done-flag guarantee
    // the continuation resumes exactly once, with markAsFinished on every
    // path so the callbacks stop.
    let pumpQueue = DispatchQueue(label: "net.stupendous.musex.downloads.convert")
    do {
      try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
        let pump = PumpState()
        input.requestMediaDataWhenReady(on: pumpQueue) {
          if pump.done { return }
          while input.isReadyForMoreMediaData {
            if let sample = readerOutput.copyNextSampleBuffer() {
              if !input.append(sample) {
                pump.done = true
                reader.cancelReading()
                input.markAsFinished()
                cont.resume(throwing: writer.error ?? conversionError("append failed"))
                return
              }
            } else {
              pump.done = true
              input.markAsFinished()
              if reader.status == .failed {
                cont.resume(throwing: reader.error ?? conversionError("read failed"))
              } else {
                cont.resume(returning: ())
              }
              return
            }
          }
        }
      }
    } catch {
      if writer.status == .writing { writer.cancelWriting() }
      throw error
    }
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      writer.finishWriting {
        if writer.status == .completed {
          cont.resume(returning: ())
        } else {
          cont.resume(throwing: writer.error ?? conversionError("finish failed"))
        }
      }
    }
    let attrs = try? FileManager.default.attributesOfItem(atPath: dst.path)
    let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    guard size > 0 else { throw conversionError("empty output") }
    return size
  }

  // MARK: - HLS (AAC) chaining

  // An HLS job runs as a delegate-driven chain on the SAME background session:
  // download the master playlist, then the media playlist, then segments ONE
  // AT A TIME, each appended to `destPath + ".part"` in the delegate — no
  // long-running loop, so the chain survives suspension and kill (phase +
  // nextIndex + appended-bytes are persisted per step; the `.part` file holds
  // segments < nextIndex, torn appends are truncated away on the next append).

  private func startHls(_ jobIdx: Int) {
    if completeIfAlreadyCommitted(state.jobs[jobIdx]) { return }
    if state.jobs[jobIdx].hls == nil {
      state.jobs[jobIdx].hls = HlsJobState(
        phase: "master", mediaUrl: nil, segmentUrls: [], nextIndex: 0, bytes: 0, attempts: 0)
      persist()
    } else if revalidateKeys.contains(state.jobs[jobIdx].key),
      state.jobs[jobIdx].hls!.phase == "segment"
    {
      // Cold-relaunch resume of a segment-phase job: the persisted segment
      // list may be stale (Plex re-transcodes with different boundaries).
      // Re-fetch the media playlist and compare before continuing.
      revalidateKeys.remove(state.jobs[jobIdx].key)
      guard state.jobs[jobIdx].hls!.mediaUrl != nil else {
        // No media URL to revalidate against — restart the chain outright.
        resetHlsJob(state.jobs[jobIdx].key, jobIdx: jobIdx)
        return
      }
      state.jobs[jobIdx].hls!.phase = "revalidate"
      state.jobs[jobIdx].hls!.attempts = 0
      persist()
    }
    revalidateKeys.remove(state.jobs[jobIdx].key)
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
    case "media", "revalidate":
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
      waitingKeys.insert(job.key)
    } else {
      waitingKeys.remove(job.key)
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
    let phase = state.jobs[jobIdx].hls?.phase ?? "master"
    if phase == "segment" {
      // 404 = "Plex hasn't transcoded that segment yet" — bounded retry.
      if status == 404 || status >= 500 {
        retryOrFailHlsStep(key, jobIdx: jobIdx, "hls http \(status)")
        return
      }
      if status >= 400 {
        failTerminal(key, "hls http \(status)")
        return
      }
    } else if phase == "revalidate", status >= 400 {
      // Revalidation hit a dead/stale transcode session — the persisted
      // segment list can't be verified, so restart the chain from scratch.
      resetHlsJob(key, jobIdx: jobIdx)
      return
    } else if status >= 400 {
      // Playlist (master/media) fetches fail fast on ANY non-ok response —
      // matches the JS engine; the retry policy above is for SEGMENTS only.
      failTerminal(key, "hls \(phase) http \(status)")
      return
    }
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
    case "revalidate":
      // Cold-relaunch resume: compare a fresh media playlist against the
      // persisted segment list. Identical → the chain is still valid,
      // continue at nextIndex; different (Plex re-transcoded with new
      // boundaries) → the `.part` is useless, restart from the fresh list.
      guard let text = try? String(contentsOf: location, encoding: .utf8) else {
        retryOrFailHlsStep(key, jobIdx: jobIdx, "unreadable media playlist")
        return
      }
      let job = state.jobs[jobIdx]
      let baseUrl = job.hls?.mediaUrl ?? job.url
      let (segments, ended) = Self.parseHlsMedia(text)
      let resolved = segments.compactMap {
        URL(string: $0, relativeTo: URL(string: baseUrl))?.absoluteString
      }
      if ended, resolved.count == segments.count, resolved == (job.hls?.segmentUrls ?? []) {
        state.jobs[jobIdx].hls!.phase = "segment"
        state.jobs[jobIdx].hls!.attempts = 0
        persist()
        enqueueCurrentHlsStep(jobIdx, delayed: false)
      } else {
        // beginSegments deletes the stale .part and starts at index 0 from
        // the fresh playlist (the current server truth).
        beginSegments(key, jobIdx: jobIdx, mediaText: text, baseUrl: baseUrl)
      }
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

  /// Discard the partial and restart the chain from the playlist phase — used
  /// when the `.part` file can't be trusted (torn/short after power loss) or
  /// Plex re-transcoded with different segment boundaries. Restarting at
  /// "master" re-fetches start.m3u8, which (re)creates the transcode session.
  private func resetHlsJob(_ key: String, jobIdx: Int) {
    try? FileManager.default.removeItem(atPath: state.jobs[jobIdx].destPath + ".part")
    state.jobs[jobIdx].hls = HlsJobState(
      phase: "master", mediaUrl: nil, segmentUrls: [], nextIndex: 0, bytes: 0, attempts: 0)
    persist()
    enqueueCurrentHlsStep(jobIdx, delayed: false)
  }

  private func appendSegment(_ key: String, jobIdx: Int, data: Data) {
    let job = state.jobs[jobIdx]
    guard let hls = job.hls else {
      failTerminal(key, "hls state missing")
      return
    }
    // Torn-write guard: if the `.part` on disk is SHORTER than the persisted
    // byte count (power loss between append and fsync), appendToPart's
    // truncate(atOffset:) would ZERO-EXTEND it — silently zero-corrupted AAC
    // that finalizes green. Reset and restart the chain instead. (The
    // too-LONG case — a torn append — is safe: the truncate discards it.)
    if hls.bytes > 0 {
      let attrs = try? FileManager.default.attributesOfItem(atPath: job.destPath + ".part")
      let actual = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
      if actual < hls.bytes {
        resetHlsJob(key, jobIdx: jobIdx)
        return
      }
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
    let fm = FileManager.default
    if !fm.fileExists(atPath: job.destPath + ".part") && fm.fileExists(atPath: job.destPath) {
      // Killed between the move and the backlog persist — already committed.
      // Still fire the (best-effort) transcode-session stop: the kill happened
      // before it ran, and a lingering server session is the same leak the
      // normal path prevents.
      fireStopUrl(job)
      completeJob(key, bytes: bytes)
      return
    }
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
  ///
  /// Lines are trimmed with `.whitespacesAndNewlines` (matches the JS
  /// engine's `String.trim()`): a CRLF playlist is RFC-8216-legal, and
  /// `.whitespaces` alone would leave a trailing `\r` on every line — tag
  /// matches like `#EXT-X-ENDLIST` would never hit and URIs would carry `\r`.
  static func parseHlsMaster(_ text: String) -> String? {
    var takeNext = false
    for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      if takeNext {
        if !line.isEmpty && !line.hasPrefix("#") { return line }
        continue
      }
      if line.hasPrefix("#EXT-X-STREAM-INF") { takeNext = true }
    }
    return nil
  }

  /// Segments = non-comment lines; ended = `#EXT-X-ENDLIST` present.
  /// See parseHlsMaster for why trimming must include newlines (CRLF playlists).
  static func parseHlsMedia(_ text: String) -> (segments: [String], ended: Bool) {
    var segments: [String] = []
    var ended = false
    for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
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
      // Segment-phase jobs restored from disk must revalidate their persisted
      // segment list against a fresh media playlist before continuing (Plex
      // may have re-transcoded with different boundaries while we were dead).
      revalidateKeys = Set(state.jobs.filter { $0.hls?.phase == "segment" }.map { $0.key })
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
    // Identity-guarded removal: only unregister if WE are the registered task.
    // A stale callback must never wipe a successor task's registration (a
    // scheduled retry / the next HLS segment reuses the same key).
    if activeTasks[key] === downloadTask {
      activeTasks.removeValue(forKey: key)
      waitingKeys.remove(key)
    } else if activeTasks[key] != nil {
      return // superseded — a newer task owns this key
    }
    let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
    if state.jobs[i].mode == "hls" {
      handleHlsFinished(key, jobIdx: i, location: location, status: status)
    } else {
      // "original" and "convert" share the single-GET download path.
      handleOriginalFinished(key, jobIdx: i, location: location, status: status)
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    guard let key = downloadTask.taskDescription, let i = jobIndex(key) else { return }
    // Bytes are flowing — a backoff-parked task that fired is waiting no more
    // (fill() goes back to refusing new starts until it finishes).
    waitingKeys.remove(key)
    guard state.jobs[i].mode != "hls" else { return } // HLS progress = per-segment appends
    emitProgress(key, ["key": key, "bytes": Int(totalBytesWritten)])
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let key = task.taskDescription else { return }
    // Identity-guarded removal (see didFinishDownloadingTo): the trailing
    // didComplete after a success/retry must not wipe a successor task's
    // registration under the same key.
    if activeTasks[key] === task {
      activeTasks.removeValue(forKey: key)
      waitingKeys.remove(key)
    } else if activeTasks[key] != nil {
      return // superseded — a newer task owns this key
    }
    guard let error = error else {
      // Success path already handled in didFinishDownloadingTo.
      return
    }
    let nsError = error as NSError
    if nsError.code == NSURLErrorCancelled && nsError.domain == NSURLErrorDomain {
      // Deliberate cancel — backlog already updated AND the terminal
      // "cancelled" event already emitted by cancel(); emitting here would
      // be a second terminal event for the same key.
      fill()
      return
    }
    guard let i = jobIndex(key) else {
      fill()
      return
    }
    if state.jobs[i].mode == "hls" {
      // Transport hiccup mid-chain (e.g. airplane mode) — same bounded
      // retry-the-current-step policy as an HTTP 5xx.
      retryOrFailHlsStep(key, jobIdx: i, error.localizedDescription)
    } else {
      // "original" and "convert" share the resumeData/backoff retry path.
      let resumeData = nsError.userInfo[NSURLSessionDownloadTaskResumeData] as? Data
      retryOrFailOriginal(key, error.localizedDescription, resumeData: resumeData)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    // This wake window is conversion time: kick an async drain — it takes its
    // OWN beginBackgroundTask, so the system completion handler below is
    // never held hostage on a conversion (at most the in-flight one keeps
    // running under that task; leftovers wait for the next execution).
    drainConversions()
    // All queued delegate messages for the background relaunch are delivered —
    // tell the system we're done (on the main queue, per the docs).
    let handler = backgroundCompletionHandler
    backgroundCompletionHandler = nil
    if let handler = handler {
      DispatchQueue.main.async { handler() }
    }
  }
}
