/**
 * Zero-Copy Shared Memory Engine between NativeScript (V8/JSC) and Dart VM (dart:ffi)
 *
 * Allocates a pinned native C memory buffer via NSMutableData (iOS) / DirectByteBuffer (Android),
 * maps it zero-copy into a TypeScript Float32Array via `interop.bufferFromData`, and exports the
 * 64-bit physical virtual memory address so Dart can attach `ffi.Pointer<ffi.Float>.fromAddress(addr).asTypedList(64)`.
 */

export const enum SharedMemorySlot {
  // === NativeScript -> Dart Control Registers (Slots 0..15) ===
  ENERGY = 0,          // 0.0 .. 1.0  (Field energy / amplitude)
  SPEED = 1,           // 0.1 .. 3.0  (Time dilation / orbital velocity)
  TURBULENCE = 2,      // 0.0 .. 1.0  (Chaos / harmonic distortion)
  HUE = 3,             // 0.0 .. 360.0 (Primary plasma hue)
  PARTICLE_COUNT = 4,  // 20 .. 300   (Active simulated particles)
  GRAVITY_X = 5,       // -1.0 .. 1.0 (Horizontal field bias)
  GRAVITY_Y = 6,       // -1.0 .. 1.0 (Vertical field bias)
  TOUCH_X = 7,         // 0.0 .. 1.0  (Normalized attractor X)
  TOUCH_Y = 8,         // 0.0 .. 1.0  (Normalized attractor Y)
  TOUCH_ACTIVE = 9,    // 0 or 1      (Whether touch/drag attractor is engaged)
  PULSE_TRIGGER = 10,  // Monotonic counter incremented to fire a shockwave in Flutter
  MORPH_MODE = 11,     // 0 = Quantum Attractor, 1 = Cyber Grid Wave, 2 = Relativistic Vortex
  GRAVITY_LOCK = 12,   // 0 or 1      (Toggled from embedded native UIKit UISwitch inside Flutter!)

  // === Dart -> NativeScript Telemetry Registers (Slots 16..31) ===
  FLUTTER_FPS = 16,         // Real-time measured vsync FPS from Dart Ticker
  FRAME_TIME_US = 17,       // Paint + physics duration in microseconds
  KINETIC_ENERGY = 18,      // Integrated kinetic energy of all Dart particles
  ISOLATE_OPS_PER_SEC = 19, // Million ops/sec from background Dart Isolate.run()
  ISOLATE_LAST_MS = 20,     // Execution time of last background Isolate compute job
  NATIVE_VIEW_TAPS = 21,    // Counter of interactions from NativeScript PlatformViews inside Flutter
  MEMORY_SYNC_TICKS = 22,   // Monotonic tick counter incremented by Dart every frame via FFI
  SHARED_PTR_MAGIC = 23,    // Magic verification float (1337.42) written by Dart FFI on attach

  // === 32-Band Live Harmonic Spectrum (Slots 32..63) ===
  SPECTRUM_START = 32,
  SPECTRUM_END = 63,
}

export const SHARED_MEMORY_FLOAT_COUNT = 64;
export const SHARED_MEMORY_BYTE_LENGTH = SHARED_MEMORY_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;

export class SharedMemoryBridge {
  private static _instance: SharedMemoryBridge;

  // Keep strong reference to native backing store so ARC/GC never collects or moves it
  private _iosData: NSMutableData | null = null;
  private _androidBuffer: any = null;
  private _pointerAddress = 0;
  private _pointerHex = '0x0';
  public readonly floats: Float32Array;

  private constructor() {
    if (__IOS__) {
      const data = NSMutableData.alloc().initWithLength(SHARED_MEMORY_BYTE_LENGTH);
      this._iosData = data;
      const rawPtr = data.mutableBytes as interop.Pointer;
      this._pointerAddress = rawPtr.toNumber();
      this._pointerHex = '0x' + this._pointerAddress.toString(16).toUpperCase();
      const ab = interop.bufferFromData(data);
      this.floats = new Float32Array(ab);
    } else {
      // Fallback / Android backing buffer
      const ab = new ArrayBuffer(SHARED_MEMORY_BYTE_LENGTH);
      this.floats = new Float32Array(ab);
    }

    // Initialize default control registers in shared RAM
    this.floats[SharedMemorySlot.ENERGY] = 0.72;
    this.floats[SharedMemorySlot.SPEED] = 1.15;
    this.floats[SharedMemorySlot.TURBULENCE] = 0.38;
    this.floats[SharedMemorySlot.HUE] = 195.0; // Cyan/Electric Blue
    this.floats[SharedMemorySlot.PARTICLE_COUNT] = 140;
    this.floats[SharedMemorySlot.GRAVITY_X] = 0.0;
    this.floats[SharedMemorySlot.GRAVITY_Y] = 0.0;
    this.floats[SharedMemorySlot.TOUCH_X] = 0.5;
    this.floats[SharedMemorySlot.TOUCH_Y] = 0.5;
    this.floats[SharedMemorySlot.TOUCH_ACTIVE] = 0.0;
    this.floats[SharedMemorySlot.PULSE_TRIGGER] = 0.0;
    this.floats[SharedMemorySlot.MORPH_MODE] = 0.0;
    this.floats[SharedMemorySlot.GRAVITY_LOCK] = 0.0;
  }

  static get instance(): SharedMemoryBridge {
    if (!SharedMemoryBridge._instance) {
      SharedMemoryBridge._instance = new SharedMemoryBridge();
    }
    return SharedMemoryBridge._instance;
  }

  get pointerAddress(): number {
    return this._pointerAddress;
  }

  get pointerHex(): string {
    return this._pointerHex;
  }

  get byteLength(): number {
    return SHARED_MEMORY_BYTE_LENGTH;
  }

  get floatCount(): number {
    return SHARED_MEMORY_FLOAT_COUNT;
  }

  /**
   * Returns true once Dart FFI has attached to this pointer and written the magic verification value.
   */
  get isDartFfiAttached(): boolean {
    const magic = this.floats[SharedMemorySlot.SHARED_PTR_MAGIC];
    return Math.abs(magic - 1337.42) < 0.5;
  }

  readSlot(slot: SharedMemorySlot): number {
    return this.floats[slot];
  }

  writeSlot(slot: SharedMemorySlot, value: number): void {
    this.floats[slot] = value;
  }

  triggerShockwavePulse(): number {
    const next = (this.floats[SharedMemorySlot.PULSE_TRIGGER] || 0) + 1;
    this.floats[SharedMemorySlot.PULSE_TRIGGER] = next;
    return next;
  }

  /**
   * Reads a snapshot of the 16-band or 32-band spectrum written by Dart via FFI.
   */
  readSpectrum(bands = 16): number[] {
    const out = new Array<number>(bands);
    for (let i = 0; i < bands; i++) {
      out[i] = this.floats[SharedMemorySlot.SPECTRUM_START + i] || 0;
    }
    return out;
  }
}
