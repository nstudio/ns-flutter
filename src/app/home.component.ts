import {
  ChangeDetectorRef,
  Component,
  NO_ERRORS_SCHEMA,
  OnInit,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { Page } from '@nativescript/core';
import { NativeScriptCommonModule } from '@nativescript/angular';
import {
  SharedMemoryBridge,
  SharedMemorySlot,
  flutterSignal,
  NativeRuntimeProxy,
  broadcastToFlutter,
  animateEmbeddedUIKitControls,
} from '../flutter-bridge';

export interface MemorySlotDisplay {
  index: string;
  name: string;
  value: string;
  origin: 'NS -> Dart' | 'Dart -> NS' | 'UIKit -> Both';
}

@Component({
  selector: 'ns-home',
  standalone: true,
  imports: [NativeScriptCommonModule],
  schemas: [NO_ERRORS_SCHEMA],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly _page = inject(Page);
  private readonly _cdr = inject(ChangeDetectorRef);

  readonly shm = SharedMemoryBridge.instance;

  // ---------------------------------------------------------------------------
  // Cross-Runtime Reactive Signals (Synced with Flutter ValueNotifiers)
  // ---------------------------------------------------------------------------
  readonly morphMode = flutterSignal<number>('morphMode', 0);
  readonly fieldEnergy = flutterSignal<number>('fieldEnergy', 72);
  readonly showNativeIsland = flutterSignal<boolean>('showNativeIsland', true);
  readonly gravityLock = flutterSignal<boolean>('gravityLock', false);
  readonly nativeViewTaps = flutterSignal<number>('nativeViewTaps', 0);
  readonly embeddedUIViewPointer = flutterSignal<string>('embeddedUIViewPointer', '0x0');
  readonly isolateMetrics = flutterSignal<string>('isolateMetrics', 'Ready');
  readonly lastBridgeEvent = flutterSignal<string>(
    'lastBridgeEvent',
    'NativeScript 9.1 + Flutter 3.41 · Zero-Copy FFI Online'
  );

  // ---------------------------------------------------------------------------
  // Local Angular Signals (30Hz Zero-Copy C-Heap Telemetry)
  // ---------------------------------------------------------------------------
  readonly activeDeckTab = signal<number>(0);
  readonly pointerHex = signal<string>(this.shm.pointerHex);
  readonly ffiVerified = signal<boolean>(false);
  readonly flutterFps = signal<number>(60);
  readonly frameTimeUs = signal<number>(12);
  readonly kineticEnergy = signal<string>('0.0');
  readonly isolateMops = signal<string>('0');
  readonly isolateMs = signal<string>('0.0');
  readonly syncTicks = signal<string>('0');
  readonly touchCoords = signal<string>('0.50,0.50');

  readonly orbitalSpeedPct = signal<number>(115);
  readonly particleCount = signal<number>(140);
  readonly memoryTable = signal<MemorySlotDisplay[]>([]);
  readonly tourRunning = signal<boolean>(false);

  readonly gpuName = signal<string>('Apple Metal GPU');
  readonly deviceSummary = signal<string>('iOS · Unified Memory');

  readonly morphModes = [
    { id: 0, label: 'Harmonic' },
    { id: 1, label: 'Lorenz 3D' },
    { id: 2, label: 'Vector' },
  ];

  private _telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private _tourTimers: Array<ReturnType<typeof setTimeout>> = [];
  private _locusAnimTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this._page.actionBarHidden = true;
    this._updateMemorySlots();
  }

  rowOf(index: number): number {
    return Math.floor(index / 2);
  }

  ngOnInit(): void {
    const profile = NativeRuntimeProxy.getDeviceProfile();
    this.gpuName.set(profile.gpuName);
    this.deviceSummary.set(
      `${profile.osVersion} · ${profile.cpuCores} Cores · ${profile.physicalMemoryGB}`
    );

    // Poll the Zero-Copy Float32Array at 30Hz (direct array index reads, 0 bridge calls)
    this._telemetryTimer = setInterval(() => {
      this._refreshZeroCopyTelemetry();
    }, 33);

    // Automatically start the choreographed showcase tour once FFI & PlatformView settle
    this._tourTimers.push(
      setTimeout(() => {
        this.startShowcaseTour();
      }, 1200)
    );
  }

  ngOnDestroy(): void {
    if (this._telemetryTimer) {
      clearInterval(this._telemetryTimer);
      this._telemetryTimer = null;
    }
    this._clearTourTimers();
  }

  // ---------------------------------------------------------------------------
  // Zero-Copy Shared Memory Telemetry Readers
  // ---------------------------------------------------------------------------
  private _updateMemorySlots(): void {
    const f = this.shm.floats;

    this.memoryTable.set([
      {
        index: '00',
        name: 'DRIVE',
        value: f[SharedMemorySlot.ENERGY].toFixed(2),
        origin: 'UIKit -> Both',
      },
      {
        index: '01',
        name: 'FREQ',
        value: f[SharedMemorySlot.SPEED].toFixed(2),
        origin: 'NS -> Dart',
      },
      {
        index: '02',
        name: 'DAMPING',
        value: f[SharedMemorySlot.TURBULENCE].toFixed(2),
        origin: 'NS -> Dart',
      },
      {
        index: '04',
        name: 'HARMONICS',
        value: Math.round(f[SharedMemorySlot.PARTICLE_COUNT]).toString(),
        origin: 'NS -> Dart',
      },
      {
        index: '05',
        name: 'TOPOLOGY',
        value: Math.round(f[SharedMemorySlot.MORPH_MODE]).toString(),
        origin: 'UIKit -> Both',
      },
      {
        index: '06',
        name: 'PHASE_LCK',
        value: f[SharedMemorySlot.GRAVITY_LOCK].toFixed(0),
        origin: 'UIKit -> Both',
      },
      {
        index: '08',
        name: 'LOCUS_X',
        value: f[SharedMemorySlot.TOUCH_X].toFixed(3),
        origin: 'Dart -> NS',
      },
      {
        index: '09',
        name: 'LOCUS_Y',
        value: f[SharedMemorySlot.TOUCH_Y].toFixed(3),
        origin: 'Dart -> NS',
      },
      {
        index: '16',
        name: 'IMPELLER',
        value: f[SharedMemorySlot.FLUTTER_FPS].toFixed(1),
        origin: 'Dart -> NS',
      },
      {
        index: '19',
        name: 'PHASE_J',
        value: f[SharedMemorySlot.KINETIC_ENERGY].toFixed(1),
        origin: 'Dart -> NS',
      },
      {
        index: '20',
        name: 'ISOLATE',
        value: Math.round(f[SharedMemorySlot.ISOLATE_OPS_PER_SEC]).toString(),
        origin: 'Dart -> NS',
      },
      {
        index: '22',
        name: 'MAGIC_ID',
        value: f[SharedMemorySlot.SHARED_PTR_MAGIC].toFixed(2),
        origin: 'Dart -> NS',
      },
    ]);
  }

  private _refreshZeroCopyTelemetry(): void {
    const f = this.shm.floats;
    const magic = f[SharedMemorySlot.SHARED_PTR_MAGIC];

    this.ffiVerified.set(Math.abs(magic - 1337.42) < 1.0);

    const fps = f[SharedMemorySlot.FLUTTER_FPS];
    if (fps > 1) {
      this.flutterFps.set(Math.min(120, Math.round(fps)));
    }

    this.frameTimeUs.set(Math.round(f[SharedMemorySlot.FRAME_TIME_US]));
    this.kineticEnergy.set(f[SharedMemorySlot.KINETIC_ENERGY].toFixed(1));

    const mops = f[SharedMemorySlot.ISOLATE_OPS_PER_SEC];
    const ms = f[SharedMemorySlot.ISOLATE_LAST_MS];
    if (mops > 0) {
      this.isolateMops.set(Math.round(mops).toString());
      this.isolateMs.set(ms.toFixed(1));
    }

    this.syncTicks.set(Math.round(f[SharedMemorySlot.MEMORY_SYNC_TICKS]).toString());
    this.touchCoords.set(
      `${f[SharedMemorySlot.TOUCH_X].toFixed(2)},${f[SharedMemorySlot.TOUCH_Y].toFixed(2)}`
    );

    if (this.activeDeckTab() === 1) {
      this._updateMemorySlots();
    }

    this._cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Interactive Deck Actions
  // ---------------------------------------------------------------------------
  selectDeckTab(index: number): void {
    NativeRuntimeProxy.triggerHaptic('selection');
    this.activeDeckTab.set(index);

    if (index === 1) {
      this._updateMemorySlots();
    }

    this._cdr.detectChanges();
  }

  setMorphMode(mode: number): void {
    NativeRuntimeProxy.triggerHaptic('selection');
    this.shm.writeSlot(SharedMemorySlot.MORPH_MODE, mode);
    this.morphMode.set(mode);
    animateEmbeddedUIKitControls({ morphMode: mode });

    const label = this.morphModes.find((m) => m.id === mode)?.label ?? 'Harmonic';
    this.lastBridgeEvent.set(`Angular Signal -> Topology: ${label}`);
    this._cdr.detectChanges();
  }

  onSpeedSliderChange(event: any): void {
    const pct = Number(event.value ?? 115);
    this.orbitalSpeedPct.set(pct);
    this.shm.writeSlot(SharedMemorySlot.SPEED, pct / 100);
  }

  onParticleSliderChange(event: any): void {
    const count = Math.round(Number(event.value ?? 140));
    this.particleCount.set(count);
    this.shm.writeSlot(SharedMemorySlot.PARTICLE_COUNT, count);
    this.shm.writeSlot(SharedMemorySlot.TURBULENCE, Math.min(1.0, count / 240));
  }

  triggerShockwave(): void {
    NativeRuntimeProxy.triggerHaptic('rigid');
    const pulse = this.shm.triggerShockwavePulse();
    broadcastToFlutter('triggerShockwave');
    this.lastBridgeEvent.set(`FFI Register [07] -> Impulse #${pulse}`);
    this._cdr.detectChanges();
  }

  runDartIsolate(): void {
    NativeRuntimeProxy.triggerHaptic('medium');
    this.lastBridgeEvent.set('Spawning Dart Isolate.run() (2,500,000 Lorenz steps)...');
    broadcastToFlutter('runIsolateBenchmark');
    this._cdr.detectChanges();
  }

  toggleNativeIsland(): void {
    NativeRuntimeProxy.triggerHaptic('selection');
    const next = !this.showNativeIsland();
    this.showNativeIsland.set(next);
    this.lastBridgeEvent.set(
      next
        ? 'Mounted NativeScript UIKit PlatformView inside Flutter'
        : 'Unmounted NativeScript UIKit PlatformView'
    );
    this._cdr.detectChanges();
  }

  async openNativeActionSheetFromAngular(): Promise<void> {
    const res = await NativeRuntimeProxy.handleRpc('native.alert', {
      title: 'NativeScript <-> Flutter Co-Processor',
      message:
        'Select a cross-runtime action to execute across UIKit, Angular Signals, and Dart FFI:',
      actions: [
        'Drive 1.00 + Impulse',
        'Switch to 3D Lorenz Attractor',
        'Run 2.5M-Step Isolate Benchmark',
      ],
    });

    const action = String(res?.action || '');
    if (action.includes('1.00')) {
      this.shm.writeSlot(SharedMemorySlot.ENERGY, 1.0);
      this.fieldEnergy.set(100);
      animateEmbeddedUIKitControls({ energy: 1.0, pulse: true });
      this.triggerShockwave();
    } else if (action.includes('Lorenz')) {
      this.setMorphMode(1);
    } else if (action.includes('Isolate')) {
      this.runDartIsolate();
    }
  }

  // ---------------------------------------------------------------------------
  // Choreographed 4-Act Showcase Tour
  // ---------------------------------------------------------------------------
  private _clearTourTimers(): void {
    for (const t of this._tourTimers) {
      clearTimeout(t);
    }
    this._tourTimers = [];

    if (this._locusAnimTimer) {
      clearInterval(this._locusAnimTimer);
      this._locusAnimTimer = null;
    }

    this.tourRunning.set(false);
  }

  startShowcaseTour(): void {
    this._clearTourTimers();
    this.tourRunning.set(true);
    this._cdr.detectChanges();

    let phase = 0;
    this._locusAnimTimer = setInterval(() => {
      phase += 0.055;
      const x = 0.5 + Math.cos(phase) * 0.24;
      const y = 0.37 + Math.sin(phase * 1.4) * 0.14;
      this.shm.writeSlot(SharedMemorySlot.TOUCH_X, x);
      this.shm.writeSlot(SharedMemorySlot.TOUCH_Y, y);
      this.shm.writeSlot(SharedMemorySlot.TOUCH_ACTIVE, 1.0);
    }, 33);

    const schedule = (ms: number, fn: () => void) => {
      this._tourTimers.push(
        setTimeout(() => {
          fn();
          this._cdr.detectChanges();
        }, ms)
      );
    };

    // Act I: Harmonic Isometric Surface + Zero-Copy FFI Drive Modulation
    schedule(200, () => {
      this.selectDeckTab(0);
      this.setMorphMode(0);
      this.triggerShockwave();
    });
    schedule(1800, () => {
      this.orbitalSpeedPct.set(210);
      this.shm.writeSlot(SharedMemorySlot.SPEED, 2.1);
      animateEmbeddedUIKitControls({ energy: 0.92, pulse: true });
    });
    schedule(3600, () => {
      animateEmbeddedUIKitControls({ gravityLock: true });
    });

    // Act II: UIKit PlatformView inside Flutter -> Switch to 3D Lorenz Oscilloscope
    schedule(5800, () => {
      animateEmbeddedUIKitControls({ morphMode: 1, energy: 0.85, gravityLock: false });
      broadcastToFlutter('inspectObjcClass', { className: 'UIVisualEffectView' });
    });
    schedule(8600, () => {
      animateEmbeddedUIKitControls({ morphMode: 2, energy: 0.95, gravityLock: true, pulse: true });
      broadcastToFlutter('inspectObjcClass', { className: 'CAMetalLayer' });
    });
    schedule(11000, () => {
      this.toggleNativeIsland();
    });
    schedule(12400, () => {
      if (!this.showNativeIsland()) {
        this.toggleNativeIsland();
      }
      animateEmbeddedUIKitControls({ morphMode: 1, gravityLock: false });
    });

    // Act III: Live 64-Float DMA Memory Register Table (Tab 1)
    schedule(13800, () => {
      this.selectDeckTab(1);
      this.triggerShockwave();
      this.lastBridgeEvent.set('Inspecting Live NSMutableData <-> dart:ffi Float32 Registers');
    });
    schedule(17000, () => {
      this.runDartIsolate();
    });

    // Act IV: Physical Footprint Ledger (Tab 2) + Final Harmonic Return
    schedule(19300, () => {
      this.selectDeckTab(2);
      broadcastToFlutter('inspectObjcClass', { className: 'FlutterViewController' });
      this.lastBridgeEvent.set('Footprint: 256B Bridge · 0 Swift Plugins · ~7.2MB AOT Delta');
    });
    schedule(22800, () => {
      this.selectDeckTab(0);
      animateEmbeddedUIKitControls({ morphMode: 0, energy: 0.78 });
      this.shm.writeSlot(SharedMemorySlot.TOUCH_X, 0.5);
      this.shm.writeSlot(SharedMemorySlot.TOUCH_Y, 0.38);
      this.shm.writeSlot(SharedMemorySlot.TOUCH_ACTIVE, 0.0);
      this.triggerShockwave();
      this._clearTourTimers();
    });
  }
}
