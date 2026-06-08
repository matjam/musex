/// <reference types="vite/client" />
import type { MusexApi } from "../../shared/ipc-contract";

declare global {
  interface Window {
    musex: MusexApi;
  }
}
