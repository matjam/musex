/// <reference types="vite/client" />

interface MusexApi {
  ping: () => string;
}
declare global {
  interface Window {
    musex: MusexApi;
  }
}

export {};
