import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    let hasRefreshed = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hasRefreshed) {
        return;
      }
      hasRefreshed = true;
      window.location.reload();
    });

    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      // Check periodically and whenever the app comes back to foreground.
      const updateCheckMs = 60 * 1000;
      const updateInterval = window.setInterval(() => {
        void registration.update();
      }, updateCheckMs);

      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          void registration.update();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", () => {
        window.clearInterval(updateInterval);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }, { once: true });

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) {
          return;
        }

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      void registration.update();
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
