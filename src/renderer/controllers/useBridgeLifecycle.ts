import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeEvent, DesktopTask } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { useTaskStore } from "../store/taskStore";
import { applyTaskEvent } from "../taskState";
import { classifyError, classifyStatusEvent, extractStderr, type FailureKind } from "../failureKind";
import { errorMessage } from "../utils/values";

export interface BridgeLifecycleDeps {
  /**
   * False keeps the bridge idle — an update gate has nothing to connect to
   * yet. The subscription is not even registered (R-A-01).
   */
  readonly enabled: boolean;
  /**
   * While settings are still loading the listener is registered but the
   * handshake is not attempted: settings carry the provider configuration and
   * connecting without them is connecting to the wrong thing (R-A-02).
   */
  readonly settingsLoading: boolean;
  readonly recordError: (text: string, kind: FailureKind, details?: string) => void;
  readonly clearError: () => void;
  /** Reconnected: whatever this page caches from the desktop is now stale. */
  readonly onReconnected: () => void;
  /** The transport died. Not a task failure — see the note on bridge.exited. */
  readonly onTransportLost: () => void;
  /** A run reached a terminal state. Notifications and billing hang off this. */
  readonly onTaskSettled: (event: BridgeEvent, task: DesktopTask | undefined) => void;
}

export interface BridgeLifecycleController {
  /** Bumped on every transport outage; consumers reset what they cached. */
  readonly interruptionKey: number;
  /** Re-runs the handshake. The error banner's retry button. */
  readonly retry: () => void;
}

function stringOrUndef(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The connection to the desktop: the event subscription, the handshake, and
 * what each kind of bridge failure means.
 *
 * The one rule worth restating here, because it is the easiest to lose: a
 * stopped bridge is a transport outage, not a task failure. Native OfficeCLI
 * Runtime tasks outlive the stdio process and are reattached after reconnect,
 * so nothing about any individual run may be concluded from the transport
 * dying — authoritative task/status or later task events decide that
 * (R-A-05).
 *
 * Task events are reduced and nothing more. Treating an event as evidence that
 * the newest optimistic submission had just been assigned that id is only true
 * when exactly one submission is in flight; with two, the older run's event
 * adopts the newer run's prompt, parent and conversation, merging both into one
 * lineage (R-C-03).
 */
export function useBridgeLifecycle({
  enabled,
  settingsLoading,
  recordError,
  clearError,
  onReconnected,
  onTransportLost,
  onTaskSettled,
}: BridgeLifecycleDeps): BridgeLifecycleController {
  const api = useDesktopApi();
  const { update } = useTaskStore();
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [interruptionKey, setInterruptionKey] = useState(0);
  // Several client exits in one interruption window must not start duplicate
  // bridge instances (R-A-06).
  const recoveryPendingRef = useRef(false);

  // The callbacks are read through a ref rather than depended on. They are
  // rebuilt on most renders — `onTransportLost` closes over the recent-files
  // handle, which is a fresh object every time — and a subscription effect that
  // depends on them tears down and re-runs the handshake on every render, which
  // is a second Initialize per render rather than one per connection attempt.
  const callbacks = useRef({ recordError, clearError, onReconnected, onTransportLost, onTaskSettled });
  callbacks.current = { recordError, clearError, onReconnected, onTransportLost, onTaskSettled };

  const retry = useCallback(() => {
    callbacks.current.clearError();
    setConnectAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const off = api.onBridgeEvent((event: BridgeEvent) => {
      const { recordError: report, clearError: clear, onReconnected: reconnected, onTransportLost: lost, onTaskSettled: settled } = callbacks.current;
      // Reconnection in progress is not reported: only success and giving up
      // have visible consequences (R-A-03).
      if (event.type === "bridge.reconnecting") return;

      if (event.type === "bridge.reconnected") {
        recoveryPendingRef.current = false;
        clear();
        reconnected();
        return;
      }
      if (event.type === "bridge.unconfigured") {
        recoveryPendingRef.current = false;
        const message = String(event.payload?.message || "OfficeCLI binary is not configured");
        report(message, "setup", stringOrUndef(event.payload?.stderr));
        return;
      }
      if (event.type === "bridge.reconnect_exhausted") {
        recoveryPendingRef.current = false;
        const message = String(event.payload?.message || "Bridge reconnection failed. Please retry manually.");
        const stderr = stringOrUndef(event.payload?.stderr);
        report(message, classifyStatusEvent(event.payload?.kind, message, stderr), stderr);
        return;
      }
      if (event.type === "bridge.exited") {
        lost();
        setInterruptionKey((current) => current + 1);
        // A manually stopped bridge disables the Go client's reconnect timer,
        // so trigger the normal Initialize path once to recreate the child.
        if (!recoveryPendingRef.current) {
          recoveryPendingRef.current = true;
          setConnectAttempt((current) => current + 1);
        }
        return;
      }

      let settledTask: DesktopTask | undefined;
      update((current) => {
        const next = applyTaskEvent(current, event);
        if (event.task_id) settledTask = next.tasks[event.task_id];
        return next;
      });
      if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
        settled(event, settledTask);
      }
    });

    if (settingsLoading) return off;

    // The handshake result used to be written into a state nobody rendered, so
    // an officecli too old for this app failed silently here and loudly later.
    // Surface it through the same error banner as everything else.
    api
      .initialize()
      .then(() => api.getCapabilities())
      .catch((error) => {
        const text = errorMessage(error);
        callbacks.current.recordError(text, classifyError(text), extractStderr(text));
      });
    return off;
  }, [api, connectAttempt, enabled, settingsLoading, update]);

  return { interruptionKey, retry };
}
