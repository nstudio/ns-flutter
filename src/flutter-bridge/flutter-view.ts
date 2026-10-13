import { Application, ContentView, Utils, ViewBase } from '@nativescript/core';
import { SharedMemoryBridge } from './shared-memory';
import { flutterSignalRegistry } from './flutter-signal';
import { NativeRuntimeProxy } from './native-runtime-proxy';
import { registerNativeScriptPlatformViewsOnEngine } from './platform-view-factory';

export type FlutterChannelType = { [key: string]: (...args: any[]) => any };

export interface IFlutterMessage {
  type: string;
  data?: any;
}

let flutterEngineGroup: any = null;
const activeFlutterViews = new Set<Flutter>();

export function ensureFlutterEngineGroup(): any {
  if (!flutterEngineGroup) {
    if (__IOS__) {
      flutterEngineGroup = FlutterEngineGroup.alloc().initWithNameProject(
        'ns_flutter_nexus_engine',
        null as any
      );
    } else if (__ANDROID__) {
      flutterEngineGroup = new io.flutter.embedding.engine.FlutterEngineGroup(
        Utils.android.getApplicationContext()
      );
    }
  }
  return flutterEngineGroup;
}

export function initFlutter(): void {
  if (__IOS__) {
    Application.on(Application.launchEvent, () => {
      ensureFlutterEngineGroup();
    });
  } else {
    ensureFlutterEngineGroup();
  }
}

// Register signal broadcaster once so any Angular `flutterSignal` mutation broadcasts to all mounted Flutter engines
flutterSignalRegistry.registerBroadcaster((key: string, value: any) => {
  for (const view of activeFlutterViews) {
    view.sendMessage('__signal_sync__', { key, value });
  }
});

/**
 * Broadcast a message to all active Flutter engine views, with optional reply callback from the primary engine.
 */
export function broadcastToFlutter<T = any>(type: string, data?: any): Promise<T | null> {
  const first = Array.from(activeFlutterViews)[0];
  if (!first) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    first.sendMessage(type, data, (rawReply?: string) => {
      if (!rawReply) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(rawReply) as T);
      } catch (_) {
        resolve(rawReply as unknown as T);
      }
    });
  });
}

export class Flutter extends ContentView {
  static sendMessageReplyEvent = 'sendMessageReplyEvent';
  static DEBUG = false;

  channel?: FlutterChannelType;
  private _flutterViewController: any;
  private _platformChannel: any;
  private _engine: any;
  private _enginePtrHex = '0x0';

  get enginePointerHex(): string {
    return this._enginePtrHex;
  }

  createNativeView(): any {
    const entrypoint = this.id || 'main';
    const group = ensureFlutterEngineGroup();

    if (__IOS__) {
      this._engine = group.makeEngineWithEntrypointLibraryURI(entrypoint, null as any);
      this._enginePtrHex =
        '0x' + interop.handleof(this._engine).toNumber().toString(16).toUpperCase();
      flutterSignalRegistry
        .createOrGet('flutterEnginePointer', '0x0')
        .set(this._enginePtrHex);

      if (typeof GeneratedPluginRegistrant !== 'undefined') {
        GeneratedPluginRegistrant.registerWithRegistry(this._engine);
      }

      // Register our TypeScript FlutterPlatformViewFactory ('nativescript-view') on this engine!
      registerNativeScriptPlatformViewsOnEngine(this._engine);

      this._flutterViewController = FlutterViewController.alloc().initWithEngineNibNameBundle(
        this._engine,
        null as any,
        null as any
      );
      this._flutterViewController.viewOpaque = false;
      this._flutterViewController.view.backgroundColor = UIColor.clearColor;
      return this._flutterViewController.view;
    }

    if (__ANDROID__) {
      this._engine = group.createAndRunEngine(
        Utils.android.getApplicationContext(),
        new io.flutter.embedding.engine.dart.DartExecutor.DartEntrypoint(null as any, entrypoint),
        null as any
      );
      io.flutter.embedding.engine.FlutterEngineCache.getInstance().put(entrypoint, this._engine);
      io.flutter.embedding.engine.plugins.util.GeneratedPluginRegister.registerGeneratedPlugins(
        this._engine
      );
      return new android.widget.FrameLayout(this._context);
    }

    return super.createNativeView();
  }

  initNativeView(): void {
    super.initNativeView();
    activeFlutterViews.add(this);

    if (__IOS__) {
      this._platformChannel =
        FlutterBasicMessageChannel.messageChannelWithNameBinaryMessengerCodec(
          'nativescript',
          this._flutterViewController.binaryMessenger,
          FlutterStringCodec.sharedInstance()
        );
      this._platformChannel.setMessageHandler(this._handleIncomingMessage.bind(this));
    }

    // Proactively send initial shared memory + signal handshake once Dart isolate boots
    setTimeout(() => this._sendBridgeHandshake(), 60);
    setTimeout(() => this._sendBridgeHandshake(), 250);
  }

  disposeNativeView(): void {
    activeFlutterViews.delete(this);
    if (this._platformChannel) {
      this._platformChannel.setMessageHandler(null as any);
      this._platformChannel = null;
    }
    super.disposeNativeView();
  }

  private _sendBridgeHandshake(): void {
    const shm = SharedMemoryBridge.instance;
    this.sendMessage('__bridge_init__', {
      pointerAddress: shm.pointerAddress,
      pointerHex: shm.pointerHex,
      floatCount: shm.floatCount,
      byteLength: shm.byteLength,
      enginePointerHex: this._enginePtrHex,
      signals: flutterSignalRegistry.getSnapshot(),
      deviceProfile: NativeRuntimeProxy.getDeviceProfile(),
    });
  }

  sendMessage(type: string, data?: any, callback?: (value?: any) => void): void {
    if (!this._platformChannel) return;

    const message: IFlutterMessage = { type };
    if (data !== undefined) {
      message.data = data;
    }

    try {
      const json = JSON.stringify(message);
      if (__IOS__) {
        if (callback) {
          this._platformChannel.sendMessageReply(json, (result: any) => {
            this.notify({
              eventName: Flutter.sendMessageReplyEvent,
              object: this,
              data: result,
            });
            callback(result);
          });
        } else {
          this._platformChannel.sendMessage(json);
        }
      }
    } catch (err) {
      console.error('[FlutterBridge] sendMessage error:', err);
    }
  }

  private async _handleIncomingMessage(
    rawMessage: string,
    replyCallback?: (reply: any) => void
  ): Promise<void> {
    try {
      const msg: IFlutterMessage = JSON.parse(rawMessage);
      if (!msg) return;

      // 1. Dart Isolate ready handshake -> reply immediately with Shared Memory pointer & signals
      if (msg.type === '__dart_ready__') {
        const shm = SharedMemoryBridge.instance;
        const payload = {
          pointerAddress: shm.pointerAddress,
          pointerHex: shm.pointerHex,
          floatCount: shm.floatCount,
          byteLength: shm.byteLength,
          enginePointerHex: this._enginePtrHex,
          signals: flutterSignalRegistry.getSnapshot(),
          deviceProfile: NativeRuntimeProxy.getDeviceProfile(),
        };
        if (replyCallback) {
          replyCallback(JSON.stringify(payload));
        }
        this._sendBridgeHandshake();
        return;
      }

      // 2. Reactive Signal Synchronization from Flutter -> Angular 22 Zoneless Signal
      if (msg.type === '__signal_sync__' && msg.data?.key) {
        flutterSignalRegistry.applyFromFlutter(msg.data.key, msg.data.value);
        if (replyCallback) {
          replyCallback(JSON.stringify({ ok: true }));
        }
        return;
      }

      // 3. Dynamic Native Runtime RPC from Dart -> NativeScript iOS/Android Runtime
      if (msg.type === '__native_rpc__' && msg.data?.method) {
        const res = await NativeRuntimeProxy.handleRpc(msg.data.method, msg.data.args);
        if (replyCallback) {
          replyCallback(JSON.stringify(res));
        }
        return;
      }

      // 4. Custom channel handlers on the component
      if (this.channel?.[msg.type]) {
        const out = await this.channel[msg.type](msg.data);
        if (replyCallback) {
          replyCallback(out !== undefined ? JSON.stringify(out) : 'ok');
        }
        return;
      }

      if (replyCallback) {
        replyCallback(JSON.stringify({ status: 'ack' }));
      }
    } catch (err) {
      console.error('[FlutterBridge] Incoming message error:', err);
      if (replyCallback) {
        replyCallback(JSON.stringify({ error: String(err) }));
      }
    }
  }

  onLoaded(): void {
    super.onLoaded();
    if (__IOS__) {
      let vcParent: ViewBase = this;
      while (vcParent && !vcParent.viewController) {
        vcParent = vcParent.parent;
      }
      const vc = vcParent?.viewController || Utils.ios.getRootViewController();
      if (vc && this._flutterViewController) {
        vc.addChildViewController(this._flutterViewController);
        this._flutterViewController.didMoveToParentViewController(vc);
      }
    }
  }
}
