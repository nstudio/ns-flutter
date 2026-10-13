import { View } from '@nativescript/core';
import { SharedMemoryBridge, SharedMemorySlot } from './shared-memory';
import { flutterSignalRegistry } from './flutter-signal';
import { NativeRuntimeProxy } from './native-runtime-proxy';

export type NativeViewBuilder = (
  frame: { width: number; height: number },
  viewId: number,
  params: Record<string, any>
) => any;

const customBuilders = new Map<string, NativeViewBuilder>();
const transferredViews = new Map<number, any>();
let nextTransferToken = 1000;

/**
 * Registers a custom TypeScript builder for a named `component` requested by Flutter's
 * `UiKitView` / `AndroidView` (`viewType: 'nativescript-view'`).
 */
export function registerFlutterNativeComponent(name: string, builder: NativeViewBuilder): void {
  customBuilders.set(name, builder);
}

/**
 * Stores an existing NativeScript View or native UIView/android.view.View in a transfer map
 * and returns an integer token that Dart can pass as `creationParams: { transferToken }`
 * to mount that exact view instance inside Flutter's widget tree (zero ObjC/C glue!).
 */
export function transferViewToFlutter(viewOrNative: View | any): number {
  const token = ++nextTransferToken;
  const nativeView = viewOrNative instanceof View ? viewOrNative.nativeViewProtected || viewOrNative.ios || viewOrNative.android : viewOrNative;
  transferredViews.set(token, nativeView);
  return token;
}

// Keep strong references to active platform views and their control handlers so GC/ARC doesn't collect them
const activePlatformViews = new Map<number, { view: any; handler?: any; subviews?: any[] }>();

function parseCreationParams(rawArgs: any): Record<string, any> {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'number') {
    return { transferToken: rawArgs };
  }
  if (__IOS__ && rawArgs instanceof NSDictionary) {
    const out: Record<string, any> = {};
    const keys = rawArgs.allKeys;
    for (let i = 0; i < keys.count; i++) {
      const k = String(keys.objectAtIndex(i));
      const v = rawArgs.objectForKey(k);
      out[k] = v;
    }
    return out;
  }
  if (typeof rawArgs === 'object') {
    return rawArgs;
  }
  return {};
}

let NativeControlTarget: any;
let IOSPlatformView: any;
let IOSPlatformViewFactory: any;

if (__IOS__) {
  @NativeClass()
  class NativeControlTargetImpl extends NSObject {
    static ObjCExposedMethods = {
      onSegmentChanged: { returns: interop.types.void, params: [UISegmentedControl] },
      onSliderChanged: { returns: interop.types.void, params: [UISlider] },
      onSwitchChanged: { returns: interop.types.void, params: [UISwitch] },
      onPulseTapped: { returns: interop.types.void, params: [UIButton] },
    };

    private _viewId = 0;
    private _ptrLabel: UILabel | null = null;
    private _energyValueLabel: UILabel | null = null;

    static initWithViewId(
      viewId: number,
      ptrLabel: UILabel,
      energyValueLabel: UILabel
    ): NativeControlTargetImpl {
      const inst = NativeControlTargetImpl.new() as NativeControlTargetImpl;
      inst._viewId = viewId;
      inst._ptrLabel = ptrLabel;
      inst._energyValueLabel = energyValueLabel;
      return inst;
    }

    onSegmentChanged(sender: UISegmentedControl): void {
      const idx = Number(sender.selectedSegmentIndex || 0);
      const shm = SharedMemoryBridge.instance;
      shm.writeSlot(SharedMemorySlot.MORPH_MODE, idx);
      const taps = shm.readSlot(SharedMemorySlot.NATIVE_VIEW_TAPS) + 1;
      shm.writeSlot(SharedMemorySlot.NATIVE_VIEW_TAPS, taps);

      const modeNames = ['Harmonic', 'Lorenz 3D', 'Vector'];
      NativeRuntimeProxy.triggerHaptic('selection');
      flutterSignalRegistry.createOrGet('morphMode', 0).set(idx);
      flutterSignalRegistry.createOrGet('nativeViewTaps', 0).set(taps);
      flutterSignalRegistry
        .createOrGet('lastBridgeEvent', 'Ready')
        .set(`UIKit UISegmentedControl -> ${modeNames[idx] || 'Harmonic'}`);
    }

    onSliderChanged(sender: UISlider): void {
      const val = Number(sender.value);
      const shm = SharedMemoryBridge.instance;
      shm.writeSlot(SharedMemorySlot.ENERGY, val);
      if (this._energyValueLabel) {
        this._energyValueLabel.text = val.toFixed(2);
      }
      flutterSignalRegistry.createOrGet('fieldEnergy', 72).set(Math.round(val * 100));
    }

    onSwitchChanged(sender: UISwitch): void {
      const isOn = Boolean(sender.on);
      const shm = SharedMemoryBridge.instance;
      shm.writeSlot(SharedMemorySlot.GRAVITY_LOCK, isOn ? 1.0 : 0.0);
      shm.triggerShockwavePulse();
      const taps = shm.readSlot(SharedMemorySlot.NATIVE_VIEW_TAPS) + 1;
      shm.writeSlot(SharedMemorySlot.NATIVE_VIEW_TAPS, taps);

      NativeRuntimeProxy.triggerHaptic(isOn ? 'heavy' : 'light');
      flutterSignalRegistry.createOrGet('gravityLock', false).set(isOn);
      flutterSignalRegistry.createOrGet('nativeViewTaps', 0).set(taps);
      flutterSignalRegistry
        .createOrGet('lastBridgeEvent', 'Ready')
        .set(`UIKit UISwitch -> Phase Lock ${isOn ? 'Engaged' : 'Released'}`);
    }

    onPulseTapped(_sender: UIButton): void {
      const shm = SharedMemoryBridge.instance;
      const pulseCount = shm.triggerShockwavePulse();
      const taps = shm.readSlot(SharedMemorySlot.NATIVE_VIEW_TAPS) + 1;
      shm.writeSlot(SharedMemorySlot.NATIVE_VIEW_TAPS, taps);

      NativeRuntimeProxy.triggerHaptic('rigid');
      flutterSignalRegistry.createOrGet('nativeViewTaps', 0).set(taps);
      flutterSignalRegistry
        .createOrGet('lastBridgeEvent', 'Ready')
        .set(`UIKit UIButton -> Impulse #${pulseCount} via FFI`);
    }
  }

  NativeControlTarget = NativeControlTargetImpl;

  function buildIOSLiquidGlassDeck(
    frame: CGRect,
    viewId: number,
    _params: Record<string, any>
  ): UIView {
    const shm = SharedMemoryBridge.instance;
    const width = frame.size.width > 20 ? frame.size.width : 340;
    const height = frame.size.height > 20 ? frame.size.height : 138;
    const initialRect = CGRectMake(0, 0, width, height);

    let effect: UIVisualEffect | null = null;
    try {
      const glassCls: any = NSClassFromString('UIGlassEffect');
      if (glassCls && typeof glassCls.effectWithStyle === 'function') {
        effect = glassCls.effectWithStyle(0);
      }
    } catch (_) {}
    if (!effect) {
      effect = UIBlurEffect.effectWithStyle(UIBlurEffectStyle.SystemThinMaterialDark);
    }

    const glassView = UIVisualEffectView.alloc().initWithEffect(effect);
    glassView.frame = initialRect;
    glassView.overrideUserInterfaceStyle = UIUserInterfaceStyle.Dark;
    glassView.backgroundColor = UIColor.colorWithRedGreenBlueAlpha(0.06, 0.06, 0.07, 0.84);
    glassView.autoresizingMask =
      UIViewAutoresizing.FlexibleWidth | UIViewAutoresizing.FlexibleHeight;
    glassView.clipsToBounds = true;
    glassView.layer.cornerRadius = 12;
    glassView.layer.borderWidth = 1.0;
    glassView.layer.borderColor = UIColor.colorWithWhiteAlpha(1.0, 0.14).CGColor;

    const ptrHex =
      '0x' + interop.handleof(glassView).toNumber().toString(16).toUpperCase();
    flutterSignalRegistry.createOrGet('embeddedUIViewPointer', '0x0').set(ptrHex);

    const content = glassView.contentView;

    // 1. Top Header Label + Live Pointer Readout
    const titleLabel = UILabel.alloc().initWithFrame(CGRectMake(14, 9, width - 148, 15));
    titleLabel.autoresizingMask = UIViewAutoresizing.FlexibleWidth;
    titleLabel.text = 'UIKIT PLATFORMVIEW · NATIVESCRIPT';
    titleLabel.font = UIFont.monospacedSystemFontOfSizeWeight(9.0, UIFontWeightSemibold);
    titleLabel.textColor = UIColor.colorWithRedGreenBlueAlpha(0.63, 0.63, 0.67, 1.0);
    content.addSubview(titleLabel);

    const ptrLabel = UILabel.alloc().initWithFrame(CGRectMake(width - 134, 9, 120, 15));
    ptrLabel.autoresizingMask = UIViewAutoresizing.FlexibleLeftMargin;
    ptrLabel.textAlignment = NSTextAlignment.Right;
    ptrLabel.text = `UIView ${ptrHex}`;
    ptrLabel.font = UIFont.monospacedSystemFontOfSizeWeight(9.0, UIFontWeightRegular);
    ptrLabel.textColor = UIColor.colorWithRedGreenBlueAlpha(1.0, 0.35, 0.05, 0.95);
    content.addSubview(ptrLabel);

    // 2. Native UISegmentedControl for Topology Mode
    const items = NSArray.arrayWithArray(['Harmonic', 'Lorenz 3D', 'Vector']);
    const segmented = UISegmentedControl.alloc().initWithItems(items);
    segmented.frame = CGRectMake(14, 30, width - 28, 29);
    segmented.autoresizingMask = UIViewAutoresizing.FlexibleWidth;
    segmented.selectedSegmentIndex = Math.round(shm.readSlot(SharedMemorySlot.MORPH_MODE));
    segmented.selectedSegmentTintColor = UIColor.colorWithRedGreenBlueAlpha(0.22, 0.22, 0.25, 1.0);
    content.addSubview(segmented);

    // 3. Native UISlider for Zero-Copy Field Drive
    const sliderLabel = UILabel.alloc().initWithFrame(CGRectMake(14, 68, 78, 22));
    sliderLabel.text = 'Field Drive';
    sliderLabel.font = UIFont.systemFontOfSizeWeight(11.5, UIFontWeightMedium);
    sliderLabel.textColor = UIColor.colorWithRedGreenBlueAlpha(0.90, 0.90, 0.92, 1.0);
    content.addSubview(sliderLabel);

    const energyValueLabel = UILabel.alloc().initWithFrame(CGRectMake(width - 52, 68, 38, 22));
    energyValueLabel.autoresizingMask = UIViewAutoresizing.FlexibleLeftMargin;
    energyValueLabel.textAlignment = NSTextAlignment.Right;
    const initialEnergy = shm.readSlot(SharedMemorySlot.ENERGY);
    energyValueLabel.text = initialEnergy.toFixed(2);
    energyValueLabel.font = UIFont.monospacedDigitSystemFontOfSizeWeight(11.5, UIFontWeightSemibold);
    energyValueLabel.textColor = UIColor.colorWithRedGreenBlueAlpha(1.0, 0.35, 0.05, 1.0);
    content.addSubview(energyValueLabel);

    const slider = UISlider.alloc().initWithFrame(CGRectMake(92, 66, width - 152, 26));
    slider.autoresizingMask = UIViewAutoresizing.FlexibleWidth;
    slider.minimumValue = 0.05;
    slider.maximumValue = 1.0;
    slider.value = initialEnergy;
    slider.minimumTrackTintColor = UIColor.colorWithRedGreenBlueAlpha(1.0, 0.35, 0.05, 1.0);
    content.addSubview(slider);

    // 4. Bottom Row: Native UISwitch (Phase Lock) + Native UIButton (Trigger Impulse)
    const switchLabel = UILabel.alloc().initWithFrame(CGRectMake(14, 102, 76, 26));
    switchLabel.text = 'Phase Lock';
    switchLabel.font = UIFont.systemFontOfSizeWeight(11.5, UIFontWeightMedium);
    switchLabel.textColor = UIColor.colorWithRedGreenBlueAlpha(0.90, 0.90, 0.92, 1.0);
    content.addSubview(switchLabel);

    const nativeSwitch = UISwitch.alloc().initWithFrame(CGRectMake(90, 99, 51, 31));
    nativeSwitch.transform = CGAffineTransformMakeScale(0.75, 0.75);
    nativeSwitch.on = shm.readSlot(SharedMemorySlot.GRAVITY_LOCK) > 0.5;
    nativeSwitch.onTintColor = UIColor.colorWithRedGreenBlueAlpha(1.0, 0.35, 0.05, 1.0);
    content.addSubview(nativeSwitch);

    const pulseBtn = UIButton.buttonWithType(UIButtonType.System);
    pulseBtn.frame = CGRectMake(width - 136, 101, 122, 27);
    pulseBtn.autoresizingMask = UIViewAutoresizing.FlexibleLeftMargin;
    pulseBtn.setTitleForState('Trigger Impulse', UIControlState.Normal);
    pulseBtn.titleLabel.font = UIFont.systemFontOfSizeWeight(11.0, UIFontWeightSemibold);
    pulseBtn.setTitleColorForState(
      UIColor.colorWithRedGreenBlueAlpha(0.96, 0.96, 0.97, 1.0),
      UIControlState.Normal
    );
    pulseBtn.backgroundColor = UIColor.colorWithRedGreenBlueAlpha(0.16, 0.16, 0.18, 0.95);
    pulseBtn.layer.cornerRadius = 7;
    pulseBtn.layer.borderWidth = 1.0;
    pulseBtn.layer.borderColor = UIColor.colorWithWhiteAlpha(1.0, 0.16).CGColor;
    content.addSubview(pulseBtn);

    const target = NativeControlTarget.initWithViewId(viewId, ptrLabel, energyValueLabel);
    segmented.addTargetActionForControlEvents(
      target,
      'onSegmentChanged:',
      UIControlEvents.ValueChanged
    );
    slider.addTargetActionForControlEvents(
      target,
      'onSliderChanged:',
      UIControlEvents.ValueChanged
    );
    nativeSwitch.addTargetActionForControlEvents(
      target,
      'onSwitchChanged:',
      UIControlEvents.ValueChanged
    );
    pulseBtn.addTargetActionForControlEvents(
      target,
      'onPulseTapped:',
      UIControlEvents.TouchUpInside
    );

    activePlatformViews.set(viewId, {
      view: glassView,
      handler: target,
      subviews: [segmented, slider, nativeSwitch, pulseBtn],
    });

    return glassView;
  }

  @NativeClass()
  class NativeScriptIOSPlatformView extends NSObject implements FlutterPlatformView {
    static ObjCProtocols = [FlutterPlatformView];
    private _view!: UIView;

    static initWithView(view: UIView): NativeScriptIOSPlatformView {
      const instance = NativeScriptIOSPlatformView.alloc().init() as NativeScriptIOSPlatformView;
      instance._view = view;
      return instance;
    }

    view(): UIView {
      return this._view;
    }
  }

  @NativeClass()
  class NativeScriptIOSPlatformViewFactory
    extends NSObject
    implements FlutterPlatformViewFactory
  {
    static ObjCProtocols = [FlutterPlatformViewFactory];

    createArgsCodec(): NSObject {
      return FlutterStandardMessageCodec.sharedInstance();
    }

    createWithFrameViewIdentifierArguments(
      frame: CGRect,
      viewId: number,
      args: any
    ): NSObject {
      const params = parseCreationParams(args);

      // 1. Check if a pre-built transferred UIView token was passed (dart_objc pattern in pure TS!)
      if (typeof params.transferToken === 'number' && transferredViews.has(params.transferToken)) {
        const transferred = transferredViews.get(params.transferToken) as UIView;
        transferredViews.delete(params.transferToken);
        transferred.frame = frame;
        transferred.autoresizingMask =
          UIViewAutoresizing.FlexibleWidth | UIViewAutoresizing.FlexibleHeight;
        activePlatformViews.set(viewId, { view: transferred });
        return NativeScriptIOSPlatformView.initWithView(transferred);
      }

      // 2. Check custom registered NativeScript builders
      const componentName = params.component || 'ios-liquid-glass-deck';
      const customBuilder = customBuilders.get(componentName);
      if (customBuilder) {
        const built = customBuilder(
          { width: frame.size.width, height: frame.size.height },
          viewId,
          params
        );
        const uiView: UIView =
          built instanceof View ? (built.ios as UIView) : (built as UIView);
        uiView.frame = frame;
        activePlatformViews.set(viewId, { view: uiView });
        return NativeScriptIOSPlatformView.initWithView(uiView);
      }

      // 3. Default flagship component: Real UIKit Liquid Glass Control Deck inside Flutter
      const deckView = buildIOSLiquidGlassDeck(frame, viewId, params);
      return NativeScriptIOSPlatformView.initWithView(deckView);
    }
  }

  IOSPlatformView = NativeScriptIOSPlatformView;
  IOSPlatformViewFactory = NativeScriptIOSPlatformViewFactory;
}

let sharedIOSFactory: any = null;

/**
 * Registers the `'nativescript-view'` PlatformViewFactory on the given FlutterEngine
 * so Flutter widgets can embed live NativeScript / UIKit / Android views via
 * `UiKitView(viewType: 'nativescript-view')` or `AndroidView(viewType: 'nativescript-view')`.
 */
export function registerNativeScriptPlatformViewsOnEngine(engine: any): void {
  if (__IOS__) {
    try {
      if (!sharedIOSFactory) {
        sharedIOSFactory = IOSPlatformViewFactory.alloc().init();
      }
      const registrar = engine.registrarForPlugin(
        'NativeScriptPlatformViews'
      ) as unknown as FlutterPluginRegistrar;
      if (registrar) {
        if (
          typeof registrar.registerViewFactoryWithIdGestureRecognizersBlockingPolicy ===
          'function'
        ) {
          registrar.registerViewFactoryWithIdGestureRecognizersBlockingPolicy(
            sharedIOSFactory,
            'nativescript-view',
            FlutterPlatformViewGestureRecognizersBlockingPolicy.Eager
          );
        } else {
          registrar.registerViewFactoryWithId(sharedIOSFactory, 'nativescript-view');
        }
      }
    } catch (err) {
      console.error('[NativeScriptPlatformViews] iOS registration error:', err);
    }
  }
}

/**
 * Animates and triggers the real embedded iOS UIKit controls inside Flutter's UiKitView
 * (`UISegmentedControl`, `UISlider`, `UISwitch`, `UIButton`) so both interactive touches
 * and programmatic choreography drive real native UIKit Target-Action events.
 */
export function animateEmbeddedUIKitControls(action: {
  morphMode?: number;
  energy?: number;
  gravityLock?: boolean;
  pulse?: boolean;
}): void {
  if (!__IOS__) return;
  for (const [, entry] of activePlatformViews) {
    if (!entry.subviews || entry.subviews.length < 4 || !entry.handler) continue;
    const [segmented, slider, nativeSwitch, pulseBtn] = entry.subviews as [
      UISegmentedControl,
      UISlider,
      UISwitch,
      UIButton,
    ];
    const target = entry.handler;

    if (typeof action.morphMode === 'number') {
      segmented.selectedSegmentIndex = action.morphMode;
      if (typeof target.onSegmentChanged === 'function') {
        target.onSegmentChanged(segmented);
      }
    }

    if (typeof action.energy === 'number') {
      if (typeof slider.setValueAnimated === 'function') {
        slider.setValueAnimated(action.energy, true);
      } else {
        slider.value = action.energy;
      }
      if (typeof target.onSliderChanged === 'function') {
        target.onSliderChanged(slider);
      }
    }

    if (typeof action.gravityLock === 'boolean') {
      if (typeof nativeSwitch.setOnAnimated === 'function') {
        nativeSwitch.setOnAnimated(action.gravityLock, true);
      } else {
        nativeSwitch.on = action.gravityLock;
      }
      if (typeof target.onSwitchChanged === 'function') {
        target.onSwitchChanged(nativeSwitch);
      }
    }

    if (action.pulse) {
      if (typeof target.onPulseTapped === 'function') {
        target.onPulseTapped(pulseBtn);
      }
    }
  }
}

