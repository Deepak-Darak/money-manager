import { useEffect, useMemo, useRef, useState } from "react";
import type { AppDataSnapshot } from "../types/finance";

interface Props {
  snapshot: AppDataSnapshot;
  onImportSnapshot: (snapshot: AppDataSnapshot) => void;
}

interface GoogleJwtPayload {
  email?: string;
  name?: string;
}

function decodeJwtPayload(token: string): GoogleJwtPayload {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    return JSON.parse(json) as GoogleJwtPayload;
  } catch {
    return {};
  }
}

export default function CloudSyncPanel({ snapshot, onImportSnapshot }: Props) {
  const [clientId, setClientId] = useState(() => window.localStorage.getItem("mm-google-client-id") ?? "");
  const [endpoint, setEndpoint] = useState(() => window.localStorage.getItem("mm-sheets-endpoint") ?? "");
  const [idToken, setIdToken] = useState(() => window.localStorage.getItem("mm-google-id-token") ?? "");
  const [status, setStatus] = useState("Disconnected");
  const [isSyncing, setIsSyncing] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const signInRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoPush = useRef(false);

  const profile = useMemo(() => (idToken ? decodeJwtPayload(idToken) : {}), [idToken]);

  useEffect(() => {
    window.localStorage.setItem("mm-google-client-id", clientId);
  }, [clientId]);

  useEffect(() => {
    window.localStorage.setItem("mm-sheets-endpoint", endpoint);
  }, [endpoint]);

  useEffect(() => {
    if (idToken) {
      window.localStorage.setItem("mm-google-id-token", idToken);
    } else {
      window.localStorage.removeItem("mm-google-id-token");
    }
  }, [idToken]);

  useEffect(() => {
    const scriptId = "google-identity-services";
    if (window.google?.accounts?.id) {
      setGisReady(true);
      return;
    }

    if (document.getElementById(scriptId)) {
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGisReady(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!gisReady || !clientId || !signInRef.current || !window.google?.accounts?.id) {
      return;
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (!response.credential) {
          setStatus("Google login failed.");
          return;
        }
        setIdToken(response.credential);
        setStatus("Google login successful.");
      }
    });

    signInRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(signInRef.current, {
      theme: "outline",
      size: "medium",
      shape: "pill",
      text: "signin_with"
    });
  }, [clientId, gisReady]);

  async function callEndpoint(action: "push" | "pull") {
    if (!endpoint || !idToken) {
      throw new Error("Configure endpoint and sign in first.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        action,
        idToken,
        payload: snapshot
      })
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      ok: boolean;
      data?: AppDataSnapshot;
      message?: string;
    };

    if (!json.ok) {
      throw new Error(json.message || "Sync API rejected the request.");
    }

    return json;
  }

  async function pushToCloud() {
    try {
      setIsSyncing(true);
      setStatus("Syncing to Google Sheets...");
      await callEndpoint("push");
      setStatus("Synced to Google Sheets.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function pullFromCloud() {
    try {
      setIsSyncing(true);
      setStatus("Pulling from Google Sheets...");
      const result = await callEndpoint("pull");
      if (result.data) {
        skipNextAutoPush.current = true;
        onImportSnapshot(result.data);
      }
      setStatus("Data loaded from Google Sheets.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pull failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  useEffect(() => {
    if (!endpoint || !idToken) {
      return;
    }

    if (skipNextAutoPush.current) {
      skipNextAutoPush.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void pushToCloud();
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [snapshot, endpoint, idToken]);

  return (
    <section className="panel cloud-sync-panel">
      <div className="panel-header-row">
        <h2>Cloud Sync</h2>
        <span>{profile.email ?? "Not signed in"}</span>
      </div>

      <div className="cloud-sync-grid">
        <label>
          Google OAuth Client ID
          <input
            type="text"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Paste your Google Client ID"
          />
        </label>

        <label>
          Google Apps Script Web App URL
          <input
            type="url"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
          />
        </label>
      </div>

      <div className="cloud-actions-row">
        {!idToken ? (
          <div ref={signInRef} />
        ) : (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setIdToken("");
              setStatus("Signed out.");
            }}
          >
            Sign Out
          </button>
        )}

        <button type="button" className="ghost-btn" disabled={!idToken || isSyncing} onClick={() => void pullFromCloud()}>
          Pull from Sheets
        </button>
        <button type="button" className="primary-btn cloud-btn" disabled={!idToken || isSyncing} onClick={() => void pushToCloud()}>
          Push to Sheets
        </button>
      </div>

      <p className="cloud-status">{status}</p>
      {profile.name ? <p className="cloud-user">Signed in as {profile.name}</p> : null}
    </section>
  );
}
