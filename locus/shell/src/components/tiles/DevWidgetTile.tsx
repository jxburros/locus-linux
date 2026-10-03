/*
 * DevWidgetTile — renders an installed Dev Core widget artifact on the
 * desktop. Mirrors AppTile's honest missing-target states (spec §22): no
 * artifact bound, artifact missing, or not installed all say so instead of
 * showing a blank or broken frame. The only channel out of the sandboxed
 * iframe is a manifest-gated, permission-checked, read-only RPC
 * (handleWidgetRpc); this component is the one side allowed to answer it —
 * the artifact itself never touches a Core directly.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TileProps } from "./registry";
import {
  getArtifact,
  subscribeArtifacts,
  buildWidgetSrcdoc,
  handleWidgetRpc,
  type DevArtifact,
} from "@/core/cores/dev";

function randomToken(): string {
  return `wtok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function DevWidgetTile({ tile, size }: TileProps) {
  const artifactId = (tile.settings?.artifactId as string | undefined) ?? undefined;
  const [artifact, setArtifact] = useState<DevArtifact | undefined>(() =>
    artifactId ? getArtifact(artifactId) : undefined,
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeIdentity = artifact?.codeHash ?? String(artifact?.version ?? "");
  // A fresh token per mounted iframe (re-derived whenever the installed code
  // changes) so a superseded iframe's in-flight requests can never be
  // mistaken for the current one's.
  const token = useMemo(randomToken, [artifactId, codeIdentity]);

  useEffect(() => {
    if (!artifactId) return;
    setArtifact(getArtifact(artifactId));
    return subscribeArtifacts(() => setArtifact(getArtifact(artifactId)));
  }, [artifactId]);

  useEffect(() => {
    if (!artifactId || !artifact || artifact.status !== "installed") return;
    const boundArtifactId = artifactId;
    function onMessage(e: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow || e.source !== iframe.contentWindow) return;
      const d = e.data as { token?: string; seq?: number; kind?: string; type?: string } | null;
      if (!d || d.token !== token || d.type !== "locus-widget-rpc") return;
      const seq = d.seq;
      const kind = String(d.kind ?? "");
      handleWidgetRpc(boundArtifactId, kind)
        .catch(() => ({ ok: false as const, reason: "Request failed" }))
        .then((res) => {
          iframe.contentWindow?.postMessage({ token, seq, ...res }, "*");
        });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [artifact, artifactId, token]);

  if (!artifactId) {
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="muted">No artifact is bound to this widget.</span>
        <span className="faint tilec__hint">Bind one from the Dev app.</span>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="muted">This widget's artifact is unavailable.</span>
        <span className="faint tilec__hint">Remove the tile or place it again from the Dev app.</span>
      </div>
    );
  }

  if (artifact.status !== "installed") {
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="muted">“{artifact.manifest.name}” is not installed.</span>
        <span className="faint tilec__hint">Install it from the Dev app to run this widget.</span>
      </div>
    );
  }

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono" aria-hidden>▧</span>
        <span className="faint">{artifact.manifest.name}</span>
      </div>
    );
  }

  return (
    <div className="tilec devwidgettile">
      <iframe
        // Reload whenever the installed code changes, so a stale iframe
        // never keeps running superseded code.
        key={codeIdentity}
        ref={iframeRef}
        className="devwidgettile__frame"
        sandbox="allow-scripts"
        title={artifact.manifest.name}
        srcDoc={buildWidgetSrcdoc(artifact, token)}
      />
    </div>
  );
}
