import { type StorageQuality, TRANSCODE_BITRATES } from "@musex/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.storage-quality";

// iOS defaults to AAC 256: a whole-library sync to a phone in lossless would be
// hundreds of GB, so the on-device default is the space-efficient transcode. A
// user can still switch to Original in Settings; that persisted choice wins.
const DEFAULT_STORAGE_QUALITY: StorageQuality = {
  mode: "aac",
  bitrateKbps: 256,
};

/** Validate and clamp a raw storage-quality object.
 *  - mode must be "original" or "aac"; falls back to the default ("aac")
 *  - bitrateKbps must be in TRANSCODE_BITRATES; falls back to 256
 */
function validate(raw: unknown): StorageQuality {
  if (!raw || typeof raw !== "object") return DEFAULT_STORAGE_QUALITY;
  const obj = raw as Record<string, unknown>;
  const mode =
    obj.mode === "original" || obj.mode === "aac"
      ? (obj.mode as "original" | "aac")
      : DEFAULT_STORAGE_QUALITY.mode;
  const bitrateKbps = (TRANSCODE_BITRATES as readonly number[]).includes(Number(obj.bitrateKbps))
    ? Number(obj.bitrateKbps)
    : DEFAULT_STORAGE_QUALITY.bitrateKbps;
  return { mode, bitrateKbps };
}

export async function loadStorageQuality(): Promise<StorageQuality> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? validate(JSON.parse(raw) as unknown) : DEFAULT_STORAGE_QUALITY;
  } catch {
    return DEFAULT_STORAGE_QUALITY;
  }
}

export async function saveStorageQuality(quality: StorageQuality): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(quality));
  } catch (err) {
    console.warn("[downloads] storage-quality save failed", err);
  }
}
