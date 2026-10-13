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

interface MemorySlotDisplay {
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
  template: `
    <GridLayout rows="auto, *, auto" backgroundColor="#09090B">
      <!-- ZONE 1: PRECISION INSTRUMENT TELEMETRY HEADER -->
      <StackLayout
        row="0"
        paddingTop="8"
        paddingBottom="10"
        paddingLeft="14"
        paddingRight="14"
        backgroundColor="#0C0C0F"
        borderBottomWidth="1"
        borderColor="#1F1F23"
      >
        <!-- Title Bar + Live FFI Pointer Pill -->
        <GridLayout columns="*, auto" marginBottom="8">
          <StackLayout col="0">
            <Label
              text="NS // FLUTTER CO-PROCESSOR"
              fontSize="13"
              fontWeight="800"
              letterSpacing="0.08"
              color="#F4F4F5"
            ></Label>
            <Label
              [text]="lastBridgeEvent()"
              fontSize="10"
              fontFamily="Courier"
              color="#A1A1AA"
              marginTop="2"
              textWrap="false"
            ></Label>
          </StackLayout>

          <!-- Zero-Copy FFI Pointer Status Badge -->
          <GridLayout
            col="1"
            columns="auto, auto"
            backgroundColor="#141418"
            borderRadius="6"
            paddingLeft="9"
            paddingRight="9"
            paddingTop="5"
            paddingBottom="5"
            borderWidth="1"
            [borderColor]="ffiVerified() ? '#27272A' : '#78350F'"
            verticalAlignment="center"
            (tap)="triggerShockwave()"
          >
            <ContentView
              col="0"
              width="6"
              height="6"
              borderRadius="3"
              [backgroundColor]="ffiVerified() ? '#10B981' : '#F59E0B'"
              verticalAlignment="center"
              marginRight="6"
            ></ContentView>
            <Label
              col="1"
              [text]="'FFI ' + pointerHex()"
              fontSize="10"
              fontFamily="Courier"
              fontWeight="700"
              color="#E4E4E7"
            ></Label>
          </GridLayout>
        </GridLayout>

        <!-- 4-Column Hardware Readout Strip -->
        <GridLayout columns="*, *, *, *">
          <StackLayout
            col="0"
            backgroundColor="#121215"
            borderRadius="7"
            padding="7"
            marginRight="3"
            borderWidth="1"
            borderColor="#222226"
          >
            <Label
              text="FRAME RATE"
              fontSize="8.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#71717A"
            ></Label>
            <Label
              [text]="flutterFps() + ' fps'"
              fontSize="11.5"
              fontFamily="Courier"
              fontWeight="800"
              color="#F4F4F5"
              marginTop="2"
            ></Label>
            <Label
              [text]="frameTimeUs() + ' µs/frame'"
              fontSize="8.5"
              fontFamily="Courier"
              color="#71717A"
            ></Label>
          </StackLayout>

          <StackLayout
            col="1"
            backgroundColor="#121215"
            borderRadius="7"
            padding="7"
            marginLeft="3"
            marginRight="3"
            borderWidth="1"
            borderColor="#222226"
            (tap)="toggleNativeIsland()"
          >
            <Label
              text="UIKIT VIEW"
              fontSize="8.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#71717A"
            ></Label>
            <Label
              [text]="embeddedUIViewPointer()"
              fontSize="9.5"
              fontFamily="Courier"
              fontWeight="800"
              color="#FF5912"
              marginTop="3"
            ></Label>
            <Label
              [text]="nativeViewTaps() + ' events'"
              fontSize="8.5"
              fontFamily="Courier"
              color="#71717A"
            ></Label>
          </StackLayout>

          <StackLayout
            col="2"
            backgroundColor="#121215"
            borderRadius="7"
            padding="7"
            marginLeft="3"
            marginRight="3"
            borderWidth="1"
            borderColor="#222226"
            (tap)="runDartIsolate()"
          >
            <Label
              text="ISOLATE"
              fontSize="8.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#71717A"
            ></Label>
            <Label
              [text]="isolateMops() + ' Mops'"
              fontSize="11"
              fontFamily="Courier"
              fontWeight="800"
              color="#10B981"
              marginTop="2"
            ></Label>
            <Label
              [text]="isolateMs() + ' ms (2.5M)'"
              fontSize="8.5"
              fontFamily="Courier"
              color="#71717A"
            ></Label>
          </StackLayout>

          <StackLayout
            col="3"
            backgroundColor="#121215"
            borderRadius="7"
            padding="7"
            marginLeft="3"
            borderWidth="1"
            borderColor="#222226"
          >
            <Label
              text="DMA TICKS"
              fontSize="8.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#71717A"
            ></Label>
            <Label
              [text]="syncTicks()"
              fontSize="11.5"
              fontFamily="Courier"
              fontWeight="800"
              color="#F4F4F5"
              marginTop="2"
            ></Label>
            <Label
              [text]="'XY ' + touchCoords()"
              fontSize="8.5"
              fontFamily="Courier"
              color="#71717A"
            ></Label>
          </StackLayout>
        </GridLayout>
      </StackLayout>

      <!-- ZONE 2: LIVE FLUTTER IMPELLER VIEWPORT + EMBEDDED UIKIT PLATFORMVIEW -->
      <GridLayout row="1" backgroundColor="#09090B">
        <Flutter id="nexusMain" width="100%" height="100%"></Flutter>
      </GridLayout>

      <!-- ZONE 3: NATIVESCRIPT ANGULAR 22 ZONELESS INSPECTOR DECK -->
      <StackLayout
        row="2"
        backgroundColor="#0C0C0F"
        paddingTop="10"
        paddingBottom="22"
        paddingLeft="14"
        paddingRight="14"
        borderTopWidth="1"
        borderColor="#222226"
      >
        <!-- Compact DMA Status Line -->
        <GridLayout columns="*, auto" marginBottom="8">
          <Label
            col="0"
            text="NSMutableData <-> Pointer<Float> (64x f32)"
            fontSize="9.5"
            fontFamily="Courier"
            color="#71717A"
          ></Label>
          <Label
            col="1"
            [text]="'PHASE ' + kineticEnergy() + ' J'"
            fontSize="9.5"
            fontFamily="Courier"
            fontWeight="700"
            color="#A1A1AA"
          ></Label>
        </GridLayout>

        <!-- Clean 3-Tab Segmented Switcher -->
        <GridLayout
          columns="*, *, *"
          backgroundColor="#141418"
          borderRadius="8"
          padding="3"
          marginBottom="10"
          borderWidth="1"
          borderColor="#222226"
        >
          <Label
            col="0"
            text="Controls"
            fontSize="11"
            fontWeight="700"
            textAlignment="center"
            paddingTop="6"
            paddingBottom="6"
            borderRadius="6"
            [backgroundColor]="activeDeckTab() === 0 ? '#27272A' : 'transparent'"
            [color]="activeDeckTab() === 0 ? '#F4F4F5' : '#71717A'"
            (tap)="selectDeckTab(0)"
          ></Label>
          <Label
            col="1"
            text="Memory (FFI)"
            fontSize="11"
            fontWeight="700"
            textAlignment="center"
            paddingTop="6"
            paddingBottom="6"
            borderRadius="6"
            [backgroundColor]="activeDeckTab() === 1 ? '#27272A' : 'transparent'"
            [color]="activeDeckTab() === 1 ? '#F4F4F5' : '#71717A'"
            (tap)="selectDeckTab(1)"
          ></Label>
          <Label
            col="2"
            text="Footprint"
            fontSize="11"
            fontWeight="700"
            textAlignment="center"
            paddingTop="6"
            paddingBottom="6"
            borderRadius="6"
            [backgroundColor]="activeDeckTab() === 2 ? '#27272A' : 'transparent'"
            [color]="activeDeckTab() === 2 ? '#F4F4F5' : '#71717A'"
            (tap)="selectDeckTab(2)"
          ></Label>
        </GridLayout>

        <!-- TAB 0: Cross-Runtime Signal & Zero-Copy Parameter Controls -->
        <StackLayout [visibility]="activeDeckTab() === 0 ? 'visible' : 'collapsed'">
          <!-- Topology Mode Selector -->
          <GridLayout columns="auto, *, *, *" marginBottom="8">
            <Label
              col="0"
              text="Topology"
              fontSize="11"
              fontWeight="600"
              color="#A1A1AA"
              verticalAlignment="center"
              marginRight="10"
            ></Label>
            @for (mode of morphModes; track mode.id) {
              <Label
                [col]="mode.id + 1"
                [text]="mode.label"
                fontSize="10.5"
                fontFamily="Courier"
                fontWeight="700"
                textAlignment="center"
                paddingTop="6"
                paddingBottom="6"
                marginLeft="2"
                marginRight="2"
                borderRadius="6"
                borderWidth="1"
                [borderColor]="morphMode() === mode.id ? '#FF5912' : '#27272A'"
                [backgroundColor]="morphMode() === mode.id ? '#FF5912' : '#141418'"
                [color]="morphMode() === mode.id ? '#FFFFFF' : '#A1A1AA'"
                (tap)="setMorphMode(mode.id)"
              ></Label>
            }
          </GridLayout>

          <!-- Zero-Copy Slider 1: Frequency -->
          <GridLayout columns="76, *, 46" marginBottom="4">
            <Label
              col="0"
              text="Frequency"
              fontSize="11"
              color="#A1A1AA"
              verticalAlignment="center"
            ></Label>
            <Slider
              col="1"
              minValue="10"
              maxValue="320"
              [value]="orbitalSpeedPct()"
              (valueChange)="onSpeedSliderChange($event)"
              color="#FF5912"
              backgroundColor="#27272A"
            ></Slider>
            <Label
              col="2"
              [text]="(orbitalSpeedPct() / 100).toFixed(2) + 'x'"
              fontSize="10.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#F4F4F5"
              textAlignment="right"
              verticalAlignment="center"
            ></Label>
          </GridLayout>

          <!-- Zero-Copy Slider 2: Harmonics -->
          <GridLayout columns="76, *, 46" marginBottom="8">
            <Label
              col="0"
              text="Harmonics"
              fontSize="11"
              color="#A1A1AA"
              verticalAlignment="center"
            ></Label>
            <Slider
              col="1"
              minValue="30"
              maxValue="260"
              [value]="particleCount()"
              (valueChange)="onParticleSliderChange($event)"
              color="#E4E4E7"
              backgroundColor="#27272A"
            ></Slider>
            <Label
              col="2"
              [text]="particleCount() + 'n'"
              fontSize="10.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#F4F4F5"
              textAlignment="right"
              verticalAlignment="center"
            ></Label>
          </GridLayout>

          <!-- Action Row -->
          <GridLayout columns="*, *, *">
            <Label
              col="0"
              text="Step Impulse"
              fontSize="10.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#F4F4F5"
              backgroundColor="#16161A"
              borderRadius="7"
              paddingTop="8"
              paddingBottom="8"
              marginRight="4"
              textAlignment="center"
              borderWidth="1"
              borderColor="#27272A"
              (tap)="triggerShockwave()"
            ></Label>
            <Label
              col="1"
              text="Isolate (2.5M)"
              fontSize="10.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#FFFFFF"
              backgroundColor="#FF5912"
              borderRadius="7"
              paddingTop="8"
              paddingBottom="8"
              marginLeft="4"
              marginRight="4"
              textAlignment="center"
              (tap)="runDartIsolate()"
            ></Label>
            <Label
              col="2"
              [text]="tourRunning() ? 'Tour Active' : 'Auto Demo'"
              fontSize="10.5"
              fontFamily="Courier"
              fontWeight="700"
              [color]="tourRunning() ? '#10B981' : '#E4E4E7'"
              backgroundColor="#16161A"
              borderRadius="7"
              paddingTop="8"
              paddingBottom="8"
              marginLeft="4"
              textAlignment="center"
              borderWidth="1"
              [borderColor]="tourRunning() ? '#10B981' : '#27272A'"
              (tap)="startShowcaseTour()"
            ></Label>
          </GridLayout>
        </StackLayout>

        <!-- TAB 1: Live Zero-Copy Float32Array Shared Memory Inspector -->
        <StackLayout [visibility]="activeDeckTab() === 1 ? 'visible' : 'collapsed'">
          <GridLayout columns="*, auto" marginBottom="6">
            <Label
              col="0"
              [text]="'BASE ADDR ' + pointerHex() + ' · 256 BYTES'"
              fontSize="9.5"
              fontFamily="Courier"
              fontWeight="700"
              color="#FF5912"
            ></Label>
            <Label
              col="1"
              text="ZERO-COPY DMA"
              fontSize="9"
              fontFamily="Courier"
              fontWeight="700"
              color="#10B981"
            ></Label>
          </GridLayout>

          <GridLayout columns="*, *" rows="auto, auto, auto, auto, auto, auto">
            @for (slot of memoryTable(); track slot.index; let i = $index) {
              <GridLayout
                [row]="rowOf(i)"
                [col]="i % 2"
                columns="auto, *, auto"
                backgroundColor="#121216"
                borderRadius="5"
                paddingLeft="7"
                paddingRight="7"
                paddingTop="4"
                paddingBottom="4"
                margin="2"
                borderWidth="1"
                borderColor="#222226"
              >
                <Label
                  col="0"
                  [text]="'[' + slot.index + '] '"
                  fontSize="9"
                  fontFamily="Courier"
                  color="#71717A"
                ></Label>
                <Label
                  col="1"
                  [text]="slot.name"
                  fontSize="9"
                  fontFamily="Courier"
                  fontWeight="700"
                  color="#A1A1AA"
                ></Label>
                <Label
                  col="2"
                  [text]="slot.value"
                  fontSize="9.5"
                  fontFamily="Courier"
                  fontWeight="700"
                  color="#F4F4F5"
                ></Label>
              </GridLayout>
            }
          </GridLayout>
        </StackLayout>

        <!-- TAB 2: Physical Footprint & Production Outcome Ledger -->
        <StackLayout [visibility]="activeDeckTab() === 2 ? 'visible' : 'collapsed'">
          <GridLayout columns="*, *" rows="auto, auto" marginBottom="6">
            <StackLayout
              row="0"
              col="0"
              backgroundColor="#121216"
              borderRadius="6"
              padding="7"
              marginRight="3"
              marginBottom="5"
              borderWidth="1"
              borderColor="#222226"
            >
              <Label
                text="SHARED BRIDGE RAM"
                fontSize="8"
                fontFamily="Courier"
                fontWeight="700"
                color="#71717A"
              ></Label>
              <Label
                text="256 Bytes (0 Copies)"
                fontSize="10"
                fontFamily="Courier"
                fontWeight="800"
                color="#10B981"
                marginTop="2"
              ></Label>
            </StackLayout>

            <StackLayout
              row="0"
              col="1"
              backgroundColor="#121216"
              borderRadius="6"
              padding="7"
              marginLeft="3"
              marginBottom="5"
              borderWidth="1"
              borderColor="#222226"
            >
              <Label
                text="NATIVE GLUE CODE"
                fontSize="8"
                fontFamily="Courier"
                fontWeight="700"
                color="#71717A"
              ></Label>
              <Label
                text="0 Swift / Kotlin Files"
                fontSize="10"
                fontFamily="Courier"
                fontWeight="800"
                color="#FF5912"
                marginTop="2"
              ></Label>
            </StackLayout>

            <StackLayout
              row="1"
              col="0"
              backgroundColor="#121216"
              borderRadius="6"
              padding="7"
              marginRight="3"
              borderWidth="1"
              borderColor="#222226"
            >
              <Label
                text="RELEASE AOT DELTA"
                fontSize="8"
                fontFamily="Courier"
                fontWeight="700"
                color="#71717A"
              ></Label>
              <Label
                text="~7.2 MB ARM64 Code"
                fontSize="10"
                fontFamily="Courier"
                fontWeight="800"
                color="#F4F4F5"
                marginTop="2"
              ></Label>
            </StackLayout>

            <StackLayout
              row="1"
              col="1"
              backgroundColor="#121216"
              borderRadius="6"
              padding="7"
              marginLeft="3"
              borderWidth="1"
              borderColor="#222226"
            >
              <Label
                text="OS UIKIT & METAL"
                fontSize="8"
                fontFamily="Courier"
                fontWeight="700"
                color="#71717A"
              ></Label>
              <Label
                text="0 KB (dyld Shared)"
                fontSize="10"
                fontFamily="Courier"
                fontWeight="800"
                color="#E4E4E7"
                marginTop="2"
              ></Label>
            </StackLayout>
          </GridLayout>

          <GridLayout columns="*, *">
            <Label
              col="0"
              text="Open Native UIAlertController"
              fontSize="10"
              fontFamily="Courier"
              fontWeight="700"
              color="#F4F4F5"
              backgroundColor="#16161A"
              borderRadius="7"
              paddingTop="8"
              paddingBottom="8"
              marginRight="4"
              textAlignment="center"
              borderWidth="1"
              borderColor="#27272A"
              (tap)="openNativeActionSheetFromAngular()"
            ></Label>
            <Label
              col="1"
              [text]="showNativeIsland() ? 'Unmount UIKit View' : 'Mount UIKit View'"
              fontSize="10"
              fontFamily="Courier"
              fontWeight="700"
              color="#FF5912"
              backgroundColor="#16161A"
              borderRadius="7"
              paddingTop="8"
              paddingBottom="8"
              marginLeft="4"
              textAlignment="center"
              borderWidth="1"
              borderColor="#27272A"
              (tap)="toggleNativeIsland()"
            ></Label>
          </GridLayout>
        </StackLayout>
      </StackLayout>
    </GridLayout>
  `,
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly _page = inject(Page);
  private readonly _cdr = inject(ChangeDetectorRef);
  readonly shm = SharedMemoryBridge.instance;

  // Cross-Runtime Reactive Signals synced automatically with Flutter ValueNotifiers
  readonly morphMode = flutterSignal<number>('morphMode', 0);
  readonly fieldEnergy = flutterSignal<number>('fieldEnergy', 72);
  readonly showNativeIsland = flutterSignal<boolean>('showNativeIsland', true);
  readonly gravityLock = flutterSignal<boolean>('gravityLock', false);
  readonly nativeViewTaps = flutterSignal<number>('nativeViewTaps', 0);
  readonly embeddedUIViewPointer = flutterSignal<string>('embeddedUIViewPointer', '0x0');
  readonly lastBridgeEvent = flutterSignal<string>(
    'lastBridgeEvent',
    'NativeScript 9.1 + Flutter 3.41 · Zero-Copy FFI Online'
  );
  readonly isolateMetrics = flutterSignal<string>('isolateMetrics', 'Ready');

  // Local Angular Signals for 30Hz Zero-Copy RAM Telemetry
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

    // Poll the Zero-Copy Float32Array at 30Hz (pure array index reads, 0 bridge calls!)
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

  private _updateMemorySlots(): void {
    const f = this.shm.floats;
    this.memoryTable.set([
      { index: '00', name: 'DRIVE', value: f[SharedMemorySlot.ENERGY].toFixed(2), origin: 'UIKit -> Both' },
      { index: '01', name: 'FREQ', value: f[SharedMemorySlot.SPEED].toFixed(2), origin: 'NS -> Dart' },
      { index: '02', name: 'DAMPING', value: f[SharedMemorySlot.TURBULENCE].toFixed(2), origin: 'NS -> Dart' },
      { index: '04', name: 'HARMONICS', value: Math.round(f[SharedMemorySlot.PARTICLE_COUNT]).toString(), origin: 'NS -> Dart' },
      { index: '05', name: 'TOPOLOGY', value: Math.round(f[SharedMemorySlot.MORPH_MODE]).toString(), origin: 'UIKit -> Both' },
      { index: '06', name: 'PHASE_LCK', value: f[SharedMemorySlot.GRAVITY_LOCK].toFixed(0), origin: 'UIKit -> Both' },
      { index: '08', name: 'LOCUS_X', value: f[SharedMemorySlot.TOUCH_X].toFixed(3), origin: 'Dart -> NS' },
      { index: '09', name: 'LOCUS_Y', value: f[SharedMemorySlot.TOUCH_Y].toFixed(3), origin: 'Dart -> NS' },
      { index: '16', name: 'IMPELLER', value: f[SharedMemorySlot.FLUTTER_FPS].toFixed(1), origin: 'Dart -> NS' },
      { index: '19', name: 'PHASE_J', value: f[SharedMemorySlot.KINETIC_ENERGY].toFixed(1), origin: 'Dart -> NS' },
      { index: '20', name: 'ISOLATE', value: Math.round(f[SharedMemorySlot.ISOLATE_OPS_PER_SEC]).toString(), origin: 'Dart -> NS' },
      { index: '22', name: 'MAGIC_ID', value: f[SharedMemorySlot.SHARED_PTR_MAGIC].toFixed(2), origin: 'Dart -> NS' },
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
