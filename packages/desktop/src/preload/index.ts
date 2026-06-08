import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("musex", {
  ping: () => "pong",
});
