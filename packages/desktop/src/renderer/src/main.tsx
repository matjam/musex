import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App(): React.JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <h1>musex</h1>
      <p>Desktop shell is alive. Bridge says: {window.musex.ping()}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
