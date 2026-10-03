/*
 * Platform — where Locus goes next.
 * ---------------------------------------------------------------------------
 * The honest map of the later phases: the platforms the shell can be promoted
 * to, the integration surface each needs, and the model-routing table that says
 * which class of AI request goes on-device, to a local server, or to the cloud.
 * Routing preferences persist; nothing is dispatched (no model is wired up).
 */

import { useSyncExternalStore } from "react";
import {
  PLATFORM_TARGETS,
  ROUTE_CLASS_META,
  getRouting,
  setRoute,
  subscribe as subscribeRouting,
  type RouteClass,
  type RouteTarget,
} from "@/core/platform";
import { Section, FutureNote } from "@/components/ui";
import "./platform.css";

const TARGETS: RouteTarget[] = ["none", "on-device", "local-server", "cloud"];
const TARGET_LABEL: Record<RouteTarget, string> = {
  none: "None",
  "on-device": "On-device",
  "local-server": "Local server",
  cloud: "Cloud",
};

export default function Platform() {
  const routing = useSyncExternalStore(subscribeRouting, getRouting);

  return (
    <div className="platform">
      <Section title="Target platforms">
        <ul className="platform__targets">
          {PLATFORM_TARGETS.map((t) => (
            <li key={t.id} className="platform__target panel">
              <div className="platform__target-head">
                <span className="platform__target-name">{t.name}</span>
                <span
                  className={`platform__pill mono platform__pill--${t.status}`}
                >
                  {t.status}
                </span>
              </div>
              <p className="faint platform__target-detail">{t.detail}</p>
              <div className="platform__integration">
                {t.integration.map((i) => (
                  <span key={i} className="chip">{i}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Model routing">
        <p className="muted platform__routing-intro">
          Which class of AI request goes where. Saved locally; inert until a model or
          server is connected.
        </p>
        <table className="platform__routing">
          <thead>
            <tr>
              <th>Request class</th>
              <th>Route to</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ROUTE_CLASS_META) as RouteClass[]).map((cls) => (
              <tr key={cls}>
                <td>
                  <span className="platform__route-name">{cls}</span>
                  <span className="faint platform__route-desc">{ROUTE_CLASS_META[cls]}</span>
                </td>
                <td>
                  <select
                    className="field platform__route-select"
                    value={routing[cls]}
                    onChange={(e) => setRoute(cls, e.target.value as RouteTarget)}
                    aria-label={`Route ${cls} to`}
                  >
                    {TARGETS.map((t) => (
                      <option key={t} value={t}>{TARGET_LABEL[t]}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Later phases">
        <FutureNote
          items={[
            "Desktop wrapper (Tauri/Electron) with native filesystem and notifications",
            "Android launcher mode via Trusted Web Activity, then a ROM direction",
            "AI Server Studio: route heavy inference to a private local server",
            "Local model execution and Linux-base integration",
          ]}
        />
      </Section>
    </div>
  );
}
