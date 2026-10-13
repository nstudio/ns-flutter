import { Device, Utils } from '@nativescript/core';
import { SharedMemoryBridge } from './shared-memory';

declare function MTLCreateSystemDefaultDevice(): any;

export interface NativeDeviceProfile {
  deviceName: string;
  model: string;
  osVersion: string;
  gpuName: string;
  gpuPointer: string;
  cpuCores: number;
  physicalMemoryGB: string;
  maxFps: number;
  screenScale: number;
  thermalState: string;
  pid: number;
  sharedMemoryPointer: string;
  sharedMemoryBytes: number;
}

export class NativeRuntimeProxy {
  static getDeviceProfile(): NativeDeviceProfile {
    const shm = SharedMemoryBridge.instance;

    if (__IOS__) {
      const uid = UIDevice.currentDevice;
      const proc = NSProcessInfo.processInfo;
      const screen = UIScreen.mainScreen;

      let gpuName = 'Apple Metal GPU';
      let gpuPointer = '0x0';
      try {
        if (typeof MTLCreateSystemDefaultDevice === 'function') {
          const mtl = MTLCreateSystemDefaultDevice();
          if (mtl) {
            gpuName = mtl.name || gpuName;
            gpuPointer = '0x' + interop.handleof(mtl).toNumber().toString(16).toUpperCase();
          }
        }
      } catch (_) {}

      const thermalMap: Record<number, string> = {
        0: 'Nominal (Cool)',
        1: 'Fair (Warm)',
        2: 'Serious',
        3: 'Critical',
      };

      const ramBytes = Number(proc.physicalMemory || 0);
      const ramGB = ramBytes > 0 ? (ramBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : 'Unified RAM';

      return {
        deviceName: uid.name || 'iPhone',
        model: uid.model || Device.model,
        osVersion: `${uid.systemName} ${uid.systemVersion}`,
        gpuName,
        gpuPointer,
        cpuCores: Number(proc.activeProcessorCount || proc.processorCount || 6),
        physicalMemoryGB: ramGB,
        maxFps: Number(screen.maximumFramesPerSecond || 60),
        screenScale: Number(screen.scale || 3),
        thermalState: thermalMap[Number(proc.thermalState)] || 'Nominal',
        pid: Number(proc.processIdentifier || 0),
        sharedMemoryPointer: shm.pointerHex,
        sharedMemoryBytes: shm.byteLength,
      };
    } else {
      const runtime = java.lang.Runtime.getRuntime();
      const cores = runtime.availableProcessors();
      const maxMemMB = Math.round(runtime.maxMemory() / (1024 * 1024));
      return {
        deviceName: Device.manufacturer + ' ' + Device.model,
        model: Device.model,
        osVersion: `Android ${Device.osVersion} (API ${Device.sdkVersion})`,
        gpuName: 'Vulkan / Skia Graphite GPU',
        gpuPointer: '0x0',
        cpuCores: cores,
        physicalMemoryGB: `${maxMemMB} MB Heap`,
        maxFps: 120,
        screenScale: 3,
        thermalState: 'Nominal',
        pid: android.os.Process.myPid(),
        sharedMemoryPointer: shm.pointerHex,
        sharedMemoryBytes: shm.byteLength,
      };
    }
  }

  static triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'success' | 'selection' = 'medium'): void {
    if (__IOS__) {
      try {
        if (style === 'success') {
          const gen = UINotificationFeedbackGenerator.alloc().init();
          gen.prepare();
          gen.notificationOccurred(UINotificationFeedbackType.Success);
          return;
        }
        if (style === 'selection') {
          const gen = UISelectionFeedbackGenerator.alloc().init();
          gen.prepare();
          gen.selectionChanged();
          return;
        }
        const styleMap: Record<string, UIImpactFeedbackStyle> = {
          light: UIImpactFeedbackStyle.Light,
          medium: UIImpactFeedbackStyle.Medium,
          heavy: UIImpactFeedbackStyle.Heavy,
          rigid: UIImpactFeedbackStyle.Rigid,
          soft: UIImpactFeedbackStyle.Soft,
        };
        const impact = UIImpactFeedbackGenerator.alloc().initWithStyle(
          styleMap[style] ?? UIImpactFeedbackStyle.Medium
        );
        impact.prepare();
        impact.impactOccurred();
      } catch (_) {}
    }
  }

  static inspectNativeClass(className: string): {
    exists: boolean;
    className: string;
    superclassName: string;
    classPointer: string;
    description: string;
  } {
    if (__IOS__) {
      try {
        const cls: any = NSClassFromString(className);
        if (!cls) {
          return {
            exists: false,
            className,
            superclassName: 'nil',
            classPointer: '0x0',
            description: `Class '${className}' not loaded in Objective-C runtime`,
          };
        }
        const ptr = '0x' + interop.handleof(cls).toNumber().toString(16).toUpperCase();
        const superCls = cls.superclass ? cls.superclass() : null;
        const superName = superCls ? NSStringFromClass(superCls) : 'NSObject (root)';
        return {
          exists: true,
          className: NSStringFromClass(cls) || className,
          superclassName: superName,
          classPointer: ptr,
          description: `<ObjC Class ${className} : ${superName} @ ${ptr}>`,
        };
      } catch (err: any) {
        return {
          exists: false,
          className,
          superclassName: 'error',
          classPointer: '0x0',
          description: String(err?.message || err),
        };
      }
    }
    return {
      exists: true,
      className,
      superclassName: 'java.lang.Object',
      classPointer: '0xJVM',
      description: `JVM Class ${className}`,
    };
  }

  static async handleRpc(method: string, args: any): Promise<any> {
    switch (method) {
      case 'device.profile':
        return NativeRuntimeProxy.getDeviceProfile();

      case 'haptics.trigger':
        NativeRuntimeProxy.triggerHaptic(args?.style || 'medium');
        return { ok: true, style: args?.style || 'medium', timestamp: Date.now() };

      case 'objc.inspect':
        return NativeRuntimeProxy.inspectNativeClass(args?.className || 'FlutterEngine');

      case 'native.alert': {
        if (__IOS__) {
          return new Promise((resolve) => {
            const vc = Utils.ios.getRootViewController();
            if (!vc) {
              resolve({ action: 'dismissed' });
              return;
            }
            const alert = UIAlertController.alertControllerWithTitleMessagePreferredStyle(
              args?.title || 'NativeScript Runtime Proxy',
              args?.message || 'Invoked directly from Dart without any Flutter plugin!',
              UIAlertControllerStyle.ActionSheet
            );
            const actions: string[] = args?.actions || ['Boost Quantum Field', 'Trigger Shockwave', 'Inspect Metal GPU'];
            actions.forEach((label) => {
              alert.addAction(
                UIAlertAction.actionWithTitleStyleHandler(label, UIAlertActionStyle.Default, () => {
                  NativeRuntimeProxy.triggerHaptic('success');
                  resolve({ action: label });
                })
              );
            });
            alert.addAction(
              UIAlertAction.actionWithTitleStyleHandler('Cancel', UIAlertActionStyle.Cancel, () => {
                resolve({ action: 'Cancel' });
              })
            );
            vc.presentViewControllerAnimatedCompletion(alert, true, null);
          });
        }
        return { action: 'ok' };
      }

      default:
        return { error: `Unknown native RPC method: ${method}` };
    }
  }
}
