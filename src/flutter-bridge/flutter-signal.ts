import { signal, WritableSignal } from '@angular/core';

export interface BridgedSignal<T> extends WritableSignal<T> {
  readonly key: string;
  /**
   * Internal setter invoked when Dart/Flutter mutates the signal so we update
   * Angular's zoneless reactive graph without echoing back to Flutter.
   */
  setFromFlutter(value: T): void;
}

type SignalBroadcastFn = (key: string, value: any) => void;

class FlutterSignalRegistry {
  private _signals = new Map<string, BridgedSignal<any>>();
  private _broadcasters = new Set<SignalBroadcastFn>();

  registerBroadcaster(fn: SignalBroadcastFn): () => void {
    this._broadcasters.add(fn);
    return () => this._broadcasters.delete(fn);
  }

  createOrGet<T>(key: string, initialValue: T): BridgedSignal<T> {
    const existing = this._signals.get(key);
    if (existing) {
      return existing as BridgedSignal<T>;
    }

    const baseSignal = signal<T>(initialValue);
    const originalSet = baseSignal.set.bind(baseSignal);
    const originalUpdate = baseSignal.update.bind(baseSignal);

    const bridged = baseSignal as unknown as BridgedSignal<T>;
    Object.defineProperty(bridged, 'key', {
      value: key,
      writable: false,
      enumerable: true,
    });

    bridged.set = (newValue: T) => {
      originalSet(newValue);
      this.broadcastToFlutter(key, newValue);
    };

    bridged.update = (updateFn: (value: T) => T) => {
      const next = updateFn(baseSignal());
      originalUpdate(() => next);
      this.broadcastToFlutter(key, next);
    };

    bridged.setFromFlutter = (incomingValue: T) => {
      originalSet(incomingValue);
    };

    this._signals.set(key, bridged);
    return bridged;
  }

  applyFromFlutter(key: string, value: any): void {
    const sig = this._signals.get(key);
    if (sig) {
      sig.setFromFlutter(value);
    } else {
      // Auto-register if Flutter created a signal first
      this.createOrGet(key, value);
    }
  }

  broadcastToFlutter(key: string, value: any): void {
    for (const fn of this._broadcasters) {
      try {
        fn(key, value);
      } catch (err) {
        console.error('[FlutterSignalRegistry] Broadcast error:', err);
      }
    }
  }

  getSnapshot(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [key, sig] of this._signals.entries()) {
      out[key] = sig();
    }
    return out;
  }
}

export const flutterSignalRegistry = new FlutterSignalRegistry();

/**
 * Creates an Angular 22 zoneless WritableSignal<T> that automatically synchronizes
 * two-way with Flutter's `BridgedSignal<T>` (`ValueNotifier<T>`).
 */
export function flutterSignal<T>(key: string, initialValue: T): BridgedSignal<T> {
  return flutterSignalRegistry.createOrGet<T>(key, initialValue);
}
