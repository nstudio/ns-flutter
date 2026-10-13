import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

void main() => runApp(const NexusCoexistenceSurfaceApp());

@pragma('vm:entry-point')
void nexusMain() => runApp(const NexusCoexistenceSurfaceApp());

/// Shared Memory Slot indices matching `src/flutter-bridge/shared-memory.ts`
class ShmSlot {
  static const int energy = 0;
  static const int speed = 1;
  static const int turbulence = 2;
  static const int hue = 3;
  static const int particleCount = 4;
  static const int gravityX = 5;
  static const int gravityY = 6;
  static const int touchX = 7;
  static const int touchY = 8;
  static const int touchActive = 9;
  static const int pulseTrigger = 10;
  static const int morphMode = 11;
  static const int gravityLock = 12;

  static const int flutterFps = 16;
  static const int frameTimeUs = 17;
  static const int kineticEnergy = 18;
  static const int isolateOpsPerSec = 19;
  static const int isolateLastMs = 20;
  static const int nativeViewTaps = 21;
  static const int memorySyncTicks = 22;
  static const int sharedPtrMagic = 23;

  static const int spectrumStart = 32;
}

/// Two-way Reactive Signal synchronized with Angular 22's zoneless `flutterSignal<T>()`
class BridgedSignal<T> extends ValueNotifier<T> {
  final String key;
  final void Function(String key, T value) _onLocalMutate;
  bool _applyingRemote = false;

  BridgedSignal(this.key, super.initialValue, this._onLocalMutate);

  @override
  set value(T newValue) {
    if (super.value == newValue) return;
    super.value = newValue;
    if (!_applyingRemote) {
      _onLocalMutate(key, newValue);
    }
  }

  void applyFromNativeScript(T remoteValue) {
    _applyingRemote = true;
    super.value = remoteValue;
    _applyingRemote = false;
  }
}

/// Core NativeScript <-> Dart/Flutter Coexistence Bridge
class NSBridge {
  static final NSBridge instance = NSBridge._();

  static const BasicMessageChannel<String?> _channel = BasicMessageChannel<String?>(
    'nativescript',
    StringCodec(),
  );

  // Zero-Copy Shared Memory via dart:ffi
  int pointerAddress = 0;
  String pointerHex = '0x0';
  String enginePointerHex = '0x0';
  Float32List? _sharedFloats;

  final Map<String, BridgedSignal<dynamic>> _signals = {};
  final ValueNotifier<bool> ffiAttached = ValueNotifier<bool>(false);
  final ValueNotifier<Map<String, dynamic>> deviceProfile =
      ValueNotifier<Map<String, dynamic>>({});
  final ValueNotifier<String> objcInspectResult = ValueNotifier<String>(
    'ObjC Runtime Proxy · Ready (Zero Plugins)',
  );

  void Function()? onTriggerIsolateFromNS;
  void Function()? onShockwaveFromNS;

  NSBridge._() {
    _channel.setMessageHandler(_handleMessage);
  }

  Future<void> initialize() async {
    try {
      final reply = await _channel.send(jsonEncode({'type': '__dart_ready__'}));
      if (reply != null && reply.isNotEmpty) {
        final decoded = jsonDecode(reply);
        if (decoded is Map<String, dynamic>) {
          _applyBridgeInit(decoded);
        }
      }
    } catch (_) {}
  }

  BridgedSignal<T> signal<T>(String key, T initialValue) {
    final existing = _signals[key];
    if (existing != null) {
      return existing as BridgedSignal<T>;
    }
    final created = BridgedSignal<T>(key, initialValue, (k, v) {
      _sendToNativeScript('__signal_sync__', {'key': k, 'value': v});
    });
    _signals[key] = created;
    return created;
  }

  void _attachSharedMemory(int address, int floatCount, String hex) {
    if (address <= 0) return;
    try {
      pointerAddress = address;
      pointerHex = hex;
      final ptr = ffi.Pointer<ffi.Float>.fromAddress(address);
      _sharedFloats = ptr.asTypedList(floatCount);
      // Write magic verification value directly into physical RAM so NativeScript knows FFI is attached!
      _sharedFloats![ShmSlot.sharedPtrMagic] = 1337.42;
      ffiAttached.value = true;
    } catch (e) {
      debugPrint('[NSBridge] dart:ffi attach error: $e');
    }
  }

  Float32List? get sharedMemory => _sharedFloats;

  void _applyBridgeInit(Map<String, dynamic> data) {
    final addr = (data['pointerAddress'] as num?)?.toInt() ?? 0;
    final count = (data['floatCount'] as num?)?.toInt() ?? 64;
    final hex = (data['pointerHex'] as String?) ?? '0x0';
    enginePointerHex = (data['enginePointerHex'] as String?) ?? enginePointerHex;

    if (addr > 0 && _sharedFloats == null) {
      _attachSharedMemory(addr, count, hex);
      Future.delayed(const Duration(milliseconds: 220), () {
        onTriggerIsolateFromNS?.call();
      });
    }

    final signalsMap = data['signals'];
    if (signalsMap is Map) {
      signalsMap.forEach((k, v) {
        final sig = _signals[k.toString()];
        if (sig != null && v != null) {
          sig.applyFromNativeScript(v);
        }
      });
    }

    final profile = data['deviceProfile'];
    if (profile is Map<String, dynamic>) {
      deviceProfile.value = profile;
    }
  }

  Future<String?> _handleMessage(String? raw) async {
    if (raw == null || raw.isEmpty) return 'ack';
    try {
      final msg = jsonDecode(raw) as Map<String, dynamic>;
      final type = msg['type'] as String?;
      final data = msg['data'];

      if (type == '__bridge_init__' && data is Map<String, dynamic>) {
        _applyBridgeInit(data);
        return jsonEncode({'ok': true, 'ffiAttached': ffiAttached.value});
      }

      if (type == '__signal_sync__' && data is Map) {
        final key = data['key']?.toString();
        final value = data['value'];
        if (key != null && _signals.containsKey(key)) {
          _signals[key]!.applyFromNativeScript(value);
        }
        return jsonEncode({'ok': true});
      }

      if (type == 'runIsolateBenchmark') {
        onTriggerIsolateFromNS?.call();
        return jsonEncode({'status': 'started'});
      }

      if (type == 'triggerShockwave') {
        onShockwaveFromNS?.call();
        return jsonEncode({'status': 'pulsed'});
      }

      if (type == 'inspectObjcClass' && data is Map) {
        final cls = data['className']?.toString() ?? 'CAMetalLayer';
        onInspectObjcFromNS?.call(cls);
        return jsonEncode({'status': 'inspecting'});
      }
    } catch (e) {
      debugPrint('[NSBridge] Message parse error: $e');
    }
    return 'ack';
  }

  void Function(String className)? onInspectObjcFromNS;

  void _sendToNativeScript(String type, Map<String, dynamic> data) {
    _channel.send(jsonEncode({'type': type, 'data': data}));
  }

  Future<Map<String, dynamic>> invokeNative(
    String method, [
    Map<String, dynamic>? args,
  ]) async {
    try {
      final reply = await _channel.send(
        jsonEncode({
          'type': '__native_rpc__',
          'data': {'method': method, 'args': args ?? {}},
        }),
      );
      if (reply != null && reply.isNotEmpty) {
        final decoded = jsonDecode(reply);
        if (decoded is Map<String, dynamic>) {
          return decoded;
        }
      }
    } catch (e) {
      return {'error': e.toString()};
    }
    return {};
  }
}

/// Heavy CPU compute workload executed on a true parallel Dart OS thread via `Isolate.run()`
class IsolateComputeResult {
  final int iterations;
  final double elapsedMs;
  final double millionOpsPerSec;
  final List<Offset> lorenzProjectedPoints;
  final double lyapunovChecksum;

  const IsolateComputeResult({
    required this.iterations,
    required this.elapsedMs,
    required this.millionOpsPerSec,
    required this.lorenzProjectedPoints,
    required this.lyapunovChecksum,
  });
}

Future<IsolateComputeResult> runParallelLorenzCompute(int iterations) {
  return Isolate.run(() {
    final sw = Stopwatch()..start();
    double x = 0.1, y = 0.0, z = 0.0;
    const double sigma = 10.0;
    const double rho = 28.0;
    const double beta = 8.0 / 3.0;
    const double dt = 0.0045;

    final List<Offset> sampled = [];
    double checksum = 0.0;

    for (int i = 0; i < iterations; i++) {
      final double dx = sigma * (y - x);
      final double dy = x * (rho - z) - y;
      final double dz = x * y - beta * z;
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;
      checksum += (x * x + y * y) * 0.000001;

      // Capture a continuous 360-point butterfly trajectory across both wings
      if (i >= 800 && i < 6200 && i % 15 == 0) {
        sampled.add(Offset(x / 21.0, (z - 25.0) / 22.0));
      }
    }
    sw.stop();
    final double ms = math.max(0.1, sw.elapsedMicroseconds / 1000.0);
    // Each step performs 14 floating point operations
    final double totalOps = iterations * 14.0;
    final double mops = (totalOps / (ms / 1000.0)) / 1e6;

    return IsolateComputeResult(
      iterations: iterations,
      elapsedMs: ms,
      millionOpsPerSec: mops,
      lorenzProjectedPoints: sampled,
      lyapunovChecksum: checksum,
    );
  });
}

class NexusCoexistenceSurfaceApp extends StatelessWidget {
  const NexusCoexistenceSurfaceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: Colors.transparent,
      ),
      home: const NexusQuantumSurface(),
    );
  }
}

class _Particle {
  double x;
  double y;
  double vx;
  double vy;
  double radius;
  double phase;
  double orbitBias;

  _Particle({
    required this.x,
    required this.y,
    required this.vx,
    required this.vy,
    required this.radius,
    required this.phase,
    required this.orbitBias,
  });
}

class _Shockwave {
  Offset center;
  double progress; // 0.0 .. 1.0
  double hue;

  _Shockwave({required this.center, required this.progress, required this.hue});
}

class NexusQuantumSurface extends StatefulWidget {
  const NexusQuantumSurface({super.key});

  @override
  State<NexusQuantumSurface> createState() => _NexusQuantumSurfaceState();
}

class _NexusQuantumSurfaceState extends State<NexusQuantumSurface>
    with SingleTickerProviderStateMixin {
  final NSBridge _bridge = NSBridge.instance;

  late final BridgedSignal<int> _morphModeSignal;
  late final BridgedSignal<int> _fieldEnergySignal;
  late final BridgedSignal<bool> _showNativeIslandSignal;
  late final BridgedSignal<String> _lastBridgeEventSignal;
  late final BridgedSignal<String> _isolateMetricsSignal;

  late final Ticker _ticker;
  final math.Random _rng = math.Random(42);
  final List<_Particle> _particles = [];
  final List<_Shockwave> _shockwaves = [];

  List<Offset> _lorenzOverlay = const [];
  double _lorenzFade = 0.0;
  bool _computingIsolate = false;

  double _time = 0.0;
  Duration _lastTick = Duration.zero;
  double _smoothedFps = 120.0;
  double _lastPulseTriggerSeen = 0.0;
  int _frameCount = 0;

  // Live parameters read directly from Zero-Copy Shared Memory
  double _energy = 0.72;
  double _speed = 1.15;
  double _turbulence = 0.38;
  double _hue = 195.0;
  int _activeCount = 140;
  int _morphMode = 0;
  bool _gravityLock = false;
  Offset _attractor = const Offset(0.5, 0.45);
  bool _touchActive = false;

  @override
  void initState() {
    super.initState();

    _morphModeSignal = _bridge.signal<int>('morphMode', 0);
    _fieldEnergySignal = _bridge.signal<int>('fieldEnergy', 72);
    _showNativeIslandSignal = _bridge.signal<bool>('showNativeIsland', true);
    _lastBridgeEventSignal = _bridge.signal<String>(
      'lastBridgeEvent',
      'Dart VM + NativeScript FFI Online',
    );
    _isolateMetricsSignal = _bridge.signal<String>(
      'isolateMetrics',
      'Ready (2.5M Lorenz steps)',
    );

    _bridge.onTriggerIsolateFromNS = _triggerBackgroundIsolate;
    _bridge.onShockwaveFromNS = () => _spawnShockwave(_attractor);
    _bridge.onInspectObjcFromNS = _inspectObjcClass;

    _initParticles(260);
    _bridge.initialize();

    _ticker = createTicker(_onTick)..start();
  }

  void _initParticles(int maxCount) {
    _particles.clear();
    for (int i = 0; i < maxCount; i++) {
      final angle = (i / maxCount) * math.pi * 2.0;
      final dist = 0.12 + _rng.nextDouble() * 0.36;
      _particles.add(
        _Particle(
          x: 0.5 + math.cos(angle) * dist,
          y: 0.45 + math.sin(angle) * dist,
          vx: (-math.sin(angle)) * (0.002 + _rng.nextDouble() * 0.003),
          vy: (math.cos(angle)) * (0.002 + _rng.nextDouble() * 0.003),
          radius: 1.6 + _rng.nextDouble() * 2.8,
          phase: _rng.nextDouble() * math.pi * 2.0,
          orbitBias: _rng.nextBool() ? 1.0 : -1.0,
        ),
      );
    }
  }

  void _spawnShockwave([Offset? origin]) {
    _shockwaves.add(
      _Shockwave(
        center: origin ?? _attractor,
        progress: 0.0,
        hue: (_hue + 45.0) % 360.0,
      ),
    );
  }

  Future<void> _triggerBackgroundIsolate() async {
    if (_computingIsolate) return;
    setState(() {
      _computingIsolate = true;
    });
    _bridge.invokeNative('haptics.trigger', {'style': 'medium'});
    _lastBridgeEventSignal.value = 'Dart Isolate.run() computing 2.5M steps...';

    final res = await runParallelLorenzCompute(2500000);

    final shm = _bridge.sharedMemory;
    if (shm != null) {
      shm[ShmSlot.isolateOpsPerSec] = res.millionOpsPerSec;
      shm[ShmSlot.isolateLastMs] = res.elapsedMs;
    }

    final summary =
        '${res.millionOpsPerSec.toStringAsFixed(0)} Mops/s in ${res.elapsedMs.toStringAsFixed(1)}ms';
    _isolateMetricsSignal.value = summary;
    _lastBridgeEventSignal.value = 'Isolate.run() -> $summary · 0 drops';
    _bridge.invokeNative('haptics.trigger', {'style': 'success'});

    if (mounted) {
      setState(() {
        _computingIsolate = false;
        _lorenzOverlay = res.lorenzProjectedPoints;
        _lorenzFade = 1.0;
      });
      _spawnShockwave(const Offset(0.5, 0.42));
    }
  }

  void _onTick(Duration elapsed) {
    final sw = Stopwatch()..start();
    double dt = 1.0 / 60.0;
    if (_lastTick != Duration.zero) {
      final diffUs = (elapsed - _lastTick).inMicroseconds;
      if (diffUs > 0 && diffUs < 100000) {
        dt = diffUs / 1000000.0;
        final instantFps = 1000000.0 / diffUs;
        _smoothedFps = _smoothedFps * 0.92 + instantFps * 0.08;
      }
    }
    _lastTick = elapsed;
    _frameCount++;

    // 1. Read Zero-Copy Shared Memory Controls written by NativeScript/Angular or UIKit!
    final shm = _bridge.sharedMemory;
    if (shm != null) {
      _energy = shm[ShmSlot.energy].clamp(0.05, 1.0);
      _speed = shm[ShmSlot.speed].clamp(0.1, 3.5);
      _turbulence = shm[ShmSlot.turbulence].clamp(0.0, 1.0);
      _hue = shm[ShmSlot.hue].clamp(0.0, 360.0);
      _activeCount = shm[ShmSlot.particleCount].round().clamp(20, _particles.length);
      _morphMode = shm[ShmSlot.morphMode].round().clamp(0, 2);
      _gravityLock = shm[ShmSlot.gravityLock] > 0.5;

      final pulseVal = shm[ShmSlot.pulseTrigger];
      if (pulseVal > _lastPulseTriggerSeen) {
        _lastPulseTriggerSeen = pulseVal;
        _spawnShockwave(_attractor);
      }

      if (!_touchActive && shm[ShmSlot.touchActive] > 0.5) {
        _attractor = Offset(
          shm[ShmSlot.touchX].clamp(0.05, 0.95),
          shm[ShmSlot.touchY].clamp(0.05, 0.95),
        );
      }
    }

    _time += dt * _speed;
    if (_lorenzFade > 0) {
      _lorenzFade = math.max(0.0, _lorenzFade - dt * 0.14);
    }

    // 2. Step Relativistic Particle & Wave Physics
    double totalKinetic = 0.0;
    final double pullStrength = (_gravityLock ? 0.022 : 0.0085) * (0.5 + _energy);
    final double swirlStrength = (0.004 + _energy * 0.009) * (_morphMode == 2 ? 1.8 : 1.0);

    for (int i = 0; i < _activeCount; i++) {
      final p = _particles[i];
      final dx = _attractor.dx - p.x;
      final dy = _attractor.dy - p.y;
      final distSq = dx * dx + dy * dy + 0.0025;
      final dist = math.sqrt(distSq);

      // Orbital + radial forces
      final radialForce = (dist - (_gravityLock ? 0.08 : 0.20)) * pullStrength;
      final nx = dx / dist;
      final ny = dy / dist;

      // Tangential swirl
      final tx = -ny * p.orbitBias;
      final ty = nx * p.orbitBias;

      // Harmonic turbulence
      final noiseX = math.sin(_time * 2.3 + p.phase + p.y * 9.0) * _turbulence * 0.0018;
      final noiseY = math.cos(_time * 1.9 + p.phase + p.x * 9.0) * _turbulence * 0.0018;

      p.vx = (p.vx + nx * radialForce + tx * swirlStrength + noiseX) * 0.965;
      p.vy = (p.vy + ny * radialForce + ty * swirlStrength + noiseY) * 0.965;

      p.x += p.vx * _speed;
      p.y += p.vy * _speed;

      // Soft boundary reflection
      if (p.x < 0.03) {
        p.x = 0.03;
        p.vx = p.vx.abs() * 0.8;
      } else if (p.x > 0.97) {
        p.x = 0.97;
        p.vx = -p.vx.abs() * 0.8;
      }
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy = p.vy.abs() * 0.8;
      } else if (p.y > 0.97) {
        p.y = 0.97;
        p.vy = -p.vy.abs() * 0.8;
      }

      totalKinetic += (p.vx * p.vx + p.vy * p.vy) * 10000.0;
    }

    // Step shockwaves
    for (int i = _shockwaves.length - 1; i >= 0; i--) {
      _shockwaves[i].progress += dt * 0.85;
      if (_shockwaves[i].progress >= 1.0) {
        _shockwaves.removeAt(i);
      }
    }

    sw.stop();

    // 3. Write live telemetry & 32-band harmonic wave spectrum directly back into Shared Memory!
    if (shm != null) {
      shm[ShmSlot.flutterFps] = _smoothedFps;
      shm[ShmSlot.frameTimeUs] = sw.elapsedMicroseconds.toDouble();
      shm[ShmSlot.kineticEnergy] = totalKinetic;
      shm[ShmSlot.memorySyncTicks] = _frameCount.toDouble();

      for (int b = 0; b < 32; b++) {
        final wave =
            0.5 +
            0.48 *
                math.sin(_time * 3.2 + b * 0.36) *
                math.cos(_time * 1.4 - b * 0.19) *
                (0.45 + 0.55 * _energy);
        shm[ShmSlot.spectrumStart + b] = wave.clamp(0.04, 1.0);
      }
    }

    setState(() {});
  }

  void _onPanUpdate(DragUpdateDetails details, Size size) {
    final nx = (details.localPosition.dx / size.width).clamp(0.05, 0.95);
    final ny = (details.localPosition.dy / size.height).clamp(0.05, 0.95);
    _attractor = Offset(nx, ny);
    _touchActive = true;

    final shm = _bridge.sharedMemory;
    if (shm != null) {
      shm[ShmSlot.touchX] = nx;
      shm[ShmSlot.touchY] = ny;
      shm[ShmSlot.touchActive] = 1.0;
    }
  }

  void _onPanEnd(DragEndDetails _) {
    _touchActive = false;
    final shm = _bridge.sharedMemory;
    if (shm != null) {
      shm[ShmSlot.touchActive] = 0.0;
    }
  }

  Future<void> _inspectObjcClass(String className) async {
    _bridge.invokeNative('haptics.trigger', {'style': 'selection'});
    final res = await _bridge.invokeNative('objc.inspect', {'className': className});
    final desc = res['description']?.toString() ?? 'Inspected $className';
    _bridge.objcInspectResult.value = desc;
    _lastBridgeEventSignal.value = 'Dart -> NativeScript ObjC Inspect: $className';
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF060913),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final size = Size(constraints.maxWidth, constraints.maxHeight);
          return Stack(
            children: [
              // 1. 120fps Interactive Impeller/Skia Quantum Field Canvas driven by Zero-Copy RAM
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onPanDown: (d) {
                    final nx = (d.localPosition.dx / size.width).clamp(0.05, 0.95);
                    final ny = (d.localPosition.dy / size.height).clamp(0.05, 0.95);
                    _attractor = Offset(nx, ny);
                    _spawnShockwave(_attractor);
                    _bridge.invokeNative('haptics.trigger', {'style': 'light'});
                  },
                  onPanUpdate: (d) => _onPanUpdate(d, size),
                  onPanEnd: _onPanEnd,
                  child: CustomPaint(
                    painter: _QuantumFieldPainter(
                      time: _time,
                      energy: _energy,
                      turbulence: _turbulence,
                      hue: _hue,
                      morphMode: _morphMode,
                      gravityLock: _gravityLock,
                      attractor: _attractor,
                      particles: _particles,
                      activeCount: _activeCount,
                      shockwaves: _shockwaves,
                      lorenzPoints: _lorenzOverlay,
                      lorenzFade: _lorenzFade,
                      spectrum: _bridge.sharedMemory,
                    ),
                  ),
                ),
              ),

              // 2. Top Floating Flutter HUD: FFI Pointer Status + Isolate Compute + ObjC Runtime Inspector
              Positioned(
                top: 10,
                left: 12,
                right: 12,
                child: _buildFlutterTopHud(),
              ),

              // 3. Bottom Embedded NativeScript UIKit PlatformView Island inside Flutter!
              Positioned(
                left: 12,
                right: 12,
                bottom: 10,
                child: ValueListenableBuilder<bool>(
                  valueListenable: _showNativeIslandSignal,
                  builder: (context, showIsland, _) {
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Quick Dart -> NativeScript Dynamic Runtime Action Row
                        _buildDartToNativeBar(),
                        if (showIsland) ...[
                          const SizedBox(height: 8),
                          _buildEmbeddedNativeScriptIsland(),
                        ],
                      ],
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildFlutterTopHud() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xE6111113),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: const Color(0xFF27272A),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _bridge.ffiAttached.value
                  ? const Color(0xFF10B981)
                  : const Color(0xFFF59E0B),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _bridge.ffiAttached.value
                      ? 'IMPELLER · FFI BUFFER ${_bridge.pointerHex}'
                      : 'INITIALIZING FFI BUFFER',
                  style: const TextStyle(
                    fontSize: 9.5,
                    fontFamily: 'Courier',
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: Color(0xFFA1A1AA),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                ValueListenableBuilder<String>(
                  valueListenable: _bridge.objcInspectResult,
                  builder: (context, inspectText, _) {
                    return Text(
                      inspectText,
                      style: const TextStyle(
                        fontSize: 10.5,
                        fontFamily: 'Courier',
                        color: Color(0xFFF4F4F5),
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    );
                  },
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: _triggerBackgroundIsolate,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF1F1F23),
                borderRadius: BorderRadius.circular(7),
                border: Border.all(
                  color: const Color(0xFFFF5912).withValues(alpha: 0.65),
                  width: 1,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_computingIsolate)
                    const SizedBox(
                      width: 10,
                      height: 10,
                      child: CircularProgressIndicator(
                        strokeWidth: 1.5,
                        valueColor: AlwaysStoppedAnimation<Color>(Color(0xFFFF5912)),
                      ),
                    )
                  else
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: Color(0xFFFF5912),
                        shape: BoxShape.circle,
                      ),
                    ),
                  const SizedBox(width: 6),
                  Text(
                    _computingIsolate ? 'COMPUTING' : 'ISOLATE 2.5M',
                    style: const TextStyle(
                      fontSize: 9.5,
                      fontFamily: 'Courier',
                      fontWeight: FontWeight.w700,
                      color: Color(0xFFF4F4F5),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDartToNativeBar() {
    return Row(
      children: [
        Expanded(
          child: _buildActionChip(
            label: _showNativeIslandSignal.value ? 'Hide UIKit' : 'Show UIKit',
            isActive: _showNativeIslandSignal.value,
            onTap: () {
              _bridge.invokeNative('haptics.trigger', {'style': 'selection'});
              _showNativeIslandSignal.value = !_showNativeIslandSignal.value;
            },
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _buildActionChip(
            label: 'iOS Sheet',
            isActive: false,
            onTap: () async {
              final res = await _bridge.invokeNative('native.alert', {
                'title': 'NativeScript UIAlertController',
                'message':
                    'Invoked directly from Dart over NativeScript Runtime Proxy without Flutter plugins.',
                'actions': [
                  'Drive 1.00 (Full Scale)',
                  'Switch to Vector Field',
                  'Run 2.5M Isolate Benchmark',
                ],
              });
              final action = res['action']?.toString() ?? '';
              final shm = _bridge.sharedMemory;
              if (action.contains('1.00') && shm != null) {
                shm[ShmSlot.energy] = 1.0;
                _fieldEnergySignal.value = 100;
              } else if (action.contains('Vector') && shm != null) {
                shm[ShmSlot.morphMode] = 2.0;
                _morphModeSignal.value = 2;
              } else if (action.contains('Isolate')) {
                _triggerBackgroundIsolate();
              }
            },
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _buildActionChip(
            label: 'CAMetalLayer',
            isActive: false,
            onTap: () => _inspectObjcClass('CAMetalLayer'),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _buildActionChip(
            label: 'FlutterVC',
            isActive: false,
            onTap: () => _inspectObjcClass('FlutterViewController'),
          ),
        ),
      ],
    );
  }

  Widget _buildActionChip({
    required String label,
    required bool isActive,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 6),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFF1F1F23) : const Color(0xE6111113),
          borderRadius: BorderRadius.circular(7),
          border: Border.all(
            color: isActive ? const Color(0xFF52525B) : const Color(0xFF27272A),
            width: 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10.0,
            fontFamily: 'Courier',
            fontWeight: FontWeight.w600,
            color: isActive ? const Color(0xFFF4F4F5) : const Color(0xFFA1A1AA),
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }

  /// Mounts a genuine NativeScript UIView inside Flutter's widget tree via `UiKitView`!
  Widget _buildEmbeddedNativeScriptIsland() {
    if (!kIsWeb && Platform.isIOS) {
      return SizedBox(
        height: 138,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: const UiKitView(
            viewType: 'nativescript-view',
            creationParams: <String, dynamic>{
              'component': 'ios-liquid-glass-deck',
            },
            creationParamsCodec: StandardMessageCodec(),
          ),
        ),
      );
    }
    return Container(
      height: 80,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFF121214),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Text(
        'NativeScript PlatformView',
        style: TextStyle(color: Colors.white70, fontSize: 12),
      ),
    );
  }
}

class _QuantumFieldPainter extends CustomPainter {
  final double time;
  final double energy;
  final double turbulence;
  final double hue;
  final int morphMode;
  final bool gravityLock;
  final Offset attractor;
  final List<_Particle> particles;
  final int activeCount;
  final List<_Shockwave> shockwaves;
  final List<Offset> lorenzPoints;
  final double lorenzFade;
  final Float32List? spectrum;

  _QuantumFieldPainter({
    required this.time,
    required this.energy,
    required this.turbulence,
    required this.hue,
    required this.morphMode,
    required this.gravityLock,
    required this.attractor,
    required this.particles,
    required this.activeCount,
    required this.shockwaves,
    required this.lorenzPoints,
    required this.lorenzFade,
    required this.spectrum,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    // 1. Matte Carbon Instrument Surface
    final bgPaint = Paint()..color = const Color(0xFF09090B);
    canvas.drawRect(rect, bgPaint);

    // 2. Precision CAD Reticle & Calibration Grid
    _paintCalibrationGrid(canvas, size);

    final centerPx = Offset(attractor.dx * size.width, attractor.dy * size.height);
    const orangeAccent = Color(0xFFFF5912);
    const warmIvory = Color(0xFFF4F4F5);
    const mutedZinc = Color(0xFF52525B);

    // 3. Render Active Engineering Topology
    if (morphMode == 0) {
      _paintHarmonicIsometricSurface(canvas, size, centerPx, orangeAccent, warmIvory, mutedZinc);
    } else if (morphMode == 1) {
      _paintLorenzPhaseOscilloscope(canvas, size, centerPx, orangeAccent, warmIvory, mutedZinc);
    } else {
      _paintDirectionalVectorField(canvas, size, centerPx, orangeAccent, warmIvory, mutedZinc);
    }

    // 4. Overlay Background Isolate 2.5M-Step Lorenz Trajectory when active
    if (lorenzFade > 0.01 && lorenzPoints.length > 2 && morphMode != 1) {
      _paintLorenzIsolateOverlay(canvas, size, orangeAccent, warmIvory);
    }

    // 5. Precision Impulse Rings triggered via FFI / UIKit
    for (final sw in shockwaves) {
      final swCenter = Offset(sw.center.dx * size.width, sw.center.dy * size.height);
      final radius = sw.progress * size.longestSide * 0.55;
      final alpha = (1.0 - sw.progress).clamp(0.0, 1.0);
      final swPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6
        ..color = orangeAccent.withValues(alpha: alpha * 0.85);
      canvas.drawCircle(swCenter, radius, swPaint);
    }

    // 6. Precision Target Crosshair Locus
    _paintTargetLocus(canvas, size, centerPx, orangeAccent, warmIvory);
  }

  void _paintCalibrationGrid(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = const Color(0xFF18181B)
      ..strokeWidth = 1.0;

    const double step = 36.0;
    for (double x = step; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), gridPaint);
    }
    for (double y = step; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    // Crosshair intersections
    final tickPaint = Paint()
      ..color = const Color(0xFF27272A)
      ..strokeWidth = 1.0;
    for (double x = step; x < size.width; x += step * 2) {
      for (double y = step; y < size.height; y += step * 2) {
        canvas.drawLine(Offset(x - 3, y), Offset(x + 3, y), tickPaint);
        canvas.drawLine(Offset(x, y - 3), Offset(x, y + 3), tickPaint);
      }
    }
  }

  void _paintHarmonicIsometricSurface(
    Canvas canvas,
    Size size,
    Offset focus,
    Color orange,
    Color ivory,
    Color zinc,
  ) {
    const int lines = 11;
    final double topY = size.height * 0.19;
    final double bottomY = size.height * 0.56;
    final double spanY = bottomY - topY;

    for (int row = 0; row < lines; row++) {
      final double rowNorm = row / (lines - 1);
      final double baseY = topY + rowNorm * spanY;
      final bool isCarrier = row == lines ~/ 2;
      final path = Path();

      for (double x = 16; x <= size.width - 16; x += 5) {
        final double nx = (x - 16) / (size.width - 32);
        final double dx = nx - attractor.dx;
        final double dy = (baseY / size.height) - attractor.dy;
        final double env = math.exp(-(dx * dx * 7.5 + dy * dy * 9.0));

        final double freq = 6.0 + energy * 10.0;
        final double amp = (12.0 + energy * 34.0) * (gravityLock ? 1.35 : 1.0);
        final double wave =
            math.sin(nx * freq + time * 2.4 + row * 0.55) *
            math.cos(nx * 3.2 - time * 1.3 + row * 0.3) *
            amp *
            (0.28 + 0.72 * env);

        final double py = baseY - wave;
        if (x == 16) {
          path.moveTo(x, py);
        } else {
          path.lineTo(x, py);
        }
      }

      final stroke = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = isCarrier ? 2.0 : 1.1
        ..color = isCarrier
            ? orange
            : Color.lerp(zinc, ivory, (1.0 - (rowNorm - 0.5).abs() * 1.6).clamp(0.0, 1.0))!
                  .withValues(alpha: 0.55);
      canvas.drawPath(path, stroke);
    }

    // Subtle phase nodes on the carrier wave
    final nodePaint = Paint()..color = ivory;
    final int midRow = lines ~/ 2;
    final double midBaseY = topY + (midRow / (lines - 1)) * spanY;
    for (int n = 1; n <= 7; n++) {
      final double nx = n / 8.0;
      final double x = 16 + nx * (size.width - 32);
      final double dx = nx - attractor.dx;
      final double env = math.exp(-(dx * dx * 7.5));
      final double freq = 6.0 + energy * 10.0;
      final double amp = (12.0 + energy * 34.0) * (gravityLock ? 1.35 : 1.0);
      final double wave =
          math.sin(nx * freq + time * 2.4 + midRow * 0.55) *
          math.cos(nx * 3.2 - time * 1.3 + midRow * 0.3) *
          amp *
          (0.28 + 0.72 * env);
      final double py = midBaseY - wave;

      canvas.drawCircle(Offset(x, py), 2.2, nodePaint);
    }
  }

  void _paintLorenzPhaseOscilloscope(
    Canvas canvas,
    Size size,
    Offset focus,
    Color orange,
    Color ivory,
    Color zinc,
  ) {
    double x = 0.1, y = 0.0, z = 0.0;
    const double sigma = 10.0;
    const double rho = 28.0;
    const double beta = 8.0 / 3.0;
    const double dt = 0.0055;

    final double rotAngle = time * 0.45 + (attractor.dx - 0.5) * 2.2;
    final double cosA = math.cos(rotAngle);
    final double sinA = math.sin(rotAngle);

    final double cx = size.width * 0.5;
    final double cy = size.height * 0.38;
    final double scale = size.width * (0.0105 + energy * 0.0035);

    final Path backPath = Path();
    final Path frontPath = Path();
    bool backStarted = false;
    bool frontStarted = false;

    for (int i = 0; i < 950; i++) {
      final double dx = sigma * (y - x);
      final double dy = x * (rho - z) - y;
      final double dz = x * y - beta * z;
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;

      if (i < 80) continue;

      final double rx = x * cosA - y * sinA;
      final double rz = z - 25.0;
      final double px = cx + rx * scale;
      final double py = cy - rz * scale * 0.82;

      if (i < 520) {
        if (!backStarted) {
          backPath.moveTo(px, py);
          backStarted = true;
        } else {
          backPath.lineTo(px, py);
        }
      } else {
        if (!frontStarted) {
          frontPath.moveTo(px, py);
          frontStarted = true;
        } else {
          frontPath.lineTo(px, py);
        }
      }
    }

    canvas.drawPath(
      backPath,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..color = ivory.withValues(alpha: 0.35),
    );
    canvas.drawPath(
      frontPath,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.7
        ..color = orange.withValues(alpha: 0.92),
    );
  }

  void _paintDirectionalVectorField(
    Canvas canvas,
    Size size,
    Offset focus,
    Color orange,
    Color ivory,
    Color zinc,
  ) {
    const int cols = 13;
    const int rows = 7;
    final double startX = 24.0;
    final double endX = size.width - 24.0;
    final double startY = size.height * 0.16;
    final double endY = size.height * 0.56;

    final vecPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.25
      ..strokeCap = StrokeCap.round;

    for (int r = 0; r < rows; r++) {
      for (int c = 0; c < cols; c++) {
        final double px = startX + (c / (cols - 1)) * (endX - startX);
        final double py = startY + (r / (rows - 1)) * (endY - startY);

        final double dx = focus.dx - px;
        final double dy = focus.dy - py;
        final double dist = math.sqrt(dx * dx + dy * dy) + 1.0;

        // Tangential + radial field angle
        final double baseAngle = math.atan2(dy, dx);
        final double swirl = gravityLock ? 0.35 : 1.15;
        final double angle =
            baseAngle + swirl + math.sin(time * 1.8 + c * 0.35 + r * 0.4) * 0.25;

        final double proximity = (1.0 - (dist / (size.width * 0.65))).clamp(0.0, 1.0);
        final double len = 8.0 + proximity * 10.0 * (0.5 + energy * 0.6);

        final Offset p1 = Offset(
          px - math.cos(angle) * len * 0.45,
          py - math.sin(angle) * len * 0.45,
        );
        final Offset p2 = Offset(
          px + math.cos(angle) * len * 0.55,
          py + math.sin(angle) * len * 0.55,
        );

        vecPaint.color = proximity > 0.52
            ? Color.lerp(ivory, orange, (proximity - 0.52) * 2.0)!
            : Color.lerp(zinc, ivory, proximity * 1.5)!.withValues(alpha: 0.65);

        canvas.drawLine(p1, p2, vecPaint);
        canvas.drawCircle(p2, 1.4, Paint()..color = vecPaint.color);
      }
    }
  }

  void _paintLorenzIsolateOverlay(
    Canvas canvas,
    Size size,
    Color orange,
    Color ivory,
  ) {
    final path = Path();
    for (int i = 0; i < lorenzPoints.length; i++) {
      final pt = lorenzPoints[i];
      final x = size.width * (0.5 + pt.dx * 0.34);
      final y = size.height * (0.37 + pt.dy * 0.23);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    final lorenzPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..color = orange.withValues(alpha: lorenzFade * 0.88);
    canvas.drawPath(path, lorenzPaint);
  }

  void _paintTargetLocus(
    Canvas canvas,
    Size size,
    Offset centerPx,
    Color orange,
    Color ivory,
  ) {
    final double r = gravityLock ? 14.0 : 9.0;
    final hairPaint = Paint()
      ..color = const Color(0xFF27272A)
      ..strokeWidth = 0.8;

    // Subtle full-span guides
    canvas.drawLine(Offset(centerPx.dx, 48), Offset(centerPx.dx, size.height * 0.62), hairPaint);
    canvas.drawLine(Offset(12, centerPx.dy), Offset(size.width - 12, centerPx.dy), hairPaint);

    final ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..color = gravityLock ? orange : ivory.withValues(alpha: 0.9);
    canvas.drawCircle(centerPx, r, ringPaint);
    canvas.drawCircle(centerPx, 2.2, Paint()..color = orange);
  }

  @override
  bool shouldRepaint(covariant _QuantumFieldPainter oldDelegate) => true;
}

