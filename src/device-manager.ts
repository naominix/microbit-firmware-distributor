import {
  ConnectionStatus,
  DeviceError,
  FlashDataError,
  ProgressStage,
  type BoardVersion,
} from "@microbit/microbit-connection";
import {
  createUSBConnection,
  DeviceSelectionMode,
  type MicrobitUSBConnection,
} from "@microbit/microbit-connection/usb";
import { createUniversalHexFlashDataSource } from "@microbit/microbit-connection/universal-hex";

const MICROBIT_VENDOR_ID = 0x0d28;
const MICROBIT_PRODUCT_ID = 0x0204;

export type DeviceFlashStatus =
  | "idle"
  | "flashing"
  | "success"
  | "error"
  | "disconnected";

export interface ManagedDevice {
  id: string;
  index: number;
  label: string;
  connection: MicrobitUSBConnection;
  usbDevice: USBDevice | undefined;
  serialNumber: string | undefined;
  deviceId: number | undefined;
  boardVersion: BoardVersion | undefined;
  selected: boolean;
  flashStatus: DeviceFlashStatus;
  stageLabel: string;
  progress: number;
  durationMs: number | undefined;
  errorMessage: string | undefined;
}

export type LogLevel = "info" | "success" | "warn" | "error";

export interface ManagerCallbacks {
  onChange: () => void;
  onLog: (level: LogLevel, message: string) => void;
}

export function formatDeviceError(error: unknown): string {
  if (error instanceof FlashDataError) {
    return `HEXファイル形式エラー: ${error.message}`;
  }
  if (error instanceof DeviceError) {
    switch (error.code) {
      case "no-device-selected":
        return "デバイスが選択されませんでした";
      case "unsupported":
        return "このブラウザは WebUSB に対応していません";
      case "device-in-use":
        return "他のタブ（MakeCode等）またはアプリがこの micro:bit を使用中です";
      case "device-disconnected":
        return "USB 接続が切断されました（ケーブルやハブ電源を確認してください）";
      case "timeout":
        return "通信タイムアウト（ハブの電力不足や接続不安定の可能性があります）";
      case "firmware-update-required":
        return "micro:bit V1 の DAPLink ファームウェアが古いため WebUSB 非対応です（更新が必要）";
      case "not-connected":
        return "デバイスが接続されていません";
      default:
        return error.message || `デバイスエラー (${error.code})`;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function stageToJapanese(stage: ProgressStage): string {
  switch (stage) {
    case ProgressStage.Initializing:
      return "初期化中...";
    case ProgressStage.FindingDevice:
      return "デバイス検索中...";
    case ProgressStage.Connecting:
      return "接続中...";
    case ProgressStage.PartialFlashing:
      return "高速差分書き込み中...";
    case ProgressStage.FullFlashing:
      return "フル書き込み中...";
    default:
      return "処理中...";
  }
}

export class MicrobitDistributorManager {
  private devices: ManagedDevice[] = [];
  private nextIndex = 1;
  private callbacks: ManagerCallbacks;
  private isFlashingBatch = false;

  constructor(callbacks: ManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public isWebUSBSupported(): boolean {
    return typeof navigator !== "undefined" && "usb" in navigator;
  }

  public getDevices(): readonly ManagedDevice[] {
    return this.devices;
  }

  public getIsFlashingBatch(): boolean {
    return this.isFlashingBatch;
  }

  private buildExclusionFilters(extraSerials: string[] = []): USBDeviceFilter[] {
    const serials = new Set<string>(extraSerials);
    for (const d of this.devices) {
      if (d.flashStatus !== "disconnected" && d.serialNumber) {
        serials.add(d.serialNumber);
      }
    }
    return Array.from(serials).map((serialNumber) => ({
      vendorId: MICROBIT_VENDOR_ID,
      productId: MICROBIT_PRODUCT_ID,
      serialNumber,
    }));
  }

  private attachConnectionListeners(managed: ManagedDevice): void {
    managed.connection.addEventListener("status", ({ status }) => {
      if (
        status === ConnectionStatus.NoAuthorizedDevice ||
        status === ConnectionStatus.Disconnected
      ) {
        if (managed.flashStatus !== "flashing") {
          managed.flashStatus = "disconnected";
          managed.stageLabel = "切断されました";
          this.callbacks.onLog("warn", `${managed.label} が切断されました`);
          this.callbacks.onChange();
        }
      } else if (status === ConnectionStatus.Connected) {
        if (managed.flashStatus === "disconnected") {
          managed.flashStatus = "idle";
          managed.stageLabel = "待機中";
          this.callbacks.onChange();
        }
      }
    });
  }

  private createManagedRecord(connection: MicrobitUSBConnection): ManagedDevice {
    const usbDevice = connection.getDevice();
    let deviceId: number | undefined;
    let boardVersion: BoardVersion | undefined;
    try {
      deviceId = connection.getDeviceId();
      boardVersion = connection.getBoardVersion();
    } catch {
      // Ignore if not yet populated
    }
    const serialNumber = usbDevice?.serialNumber || undefined;
    const index = this.nextIndex++;
    const managed: ManagedDevice = {
      id: serialNumber || `dev-${index}-${Date.now()}`,
      index,
      label: `micro:bit #${index}`,
      connection,
      usbDevice,
      serialNumber,
      deviceId,
      boardVersion,
      selected: true,
      flashStatus: "idle",
      stageLabel: "待機中",
      progress: 0,
      durationMs: undefined,
      errorMessage: undefined,
    };
    this.attachConnectionListeners(managed);
    return managed;
  }

  public async addDeviceInteractive(): Promise<boolean> {
    if (!this.isWebUSBSupported()) {
      this.callbacks.onLog("error", "このブラウザは WebUSB に対応していません");
      return false;
    }

    const connection = createUSBConnection({
      deviceSelectionMode: DeviceSelectionMode.AlwaysAsk,
      pauseOnHidden: false,
    });
    await connection.initialize();

    const exclusionFilters = this.buildExclusionFilters();
    if (exclusionFilters.length > 0) {
      connection.setRequestDeviceExclusionFilters(exclusionFilters);
    }

    try {
      await connection.connect();
      const usbDevice = connection.getDevice();

      // Check if same physical USBDevice is already managed
      const existing = this.devices.find(
        (d) =>
          (usbDevice && d.usbDevice === usbDevice) ||
          (usbDevice?.serialNumber && d.serialNumber === usbDevice.serialNumber)
      );

      if (existing) {
        await connection.disconnect().catch(() => {});
        connection.dispose();
        if (existing.flashStatus === "disconnected") {
          await existing.connection.connect();
          existing.usbDevice = existing.connection.getDevice();
          existing.flashStatus = "idle";
          existing.stageLabel = "待機中";
          existing.errorMessage = undefined;
          this.callbacks.onLog("info", `${existing.label} に再接続しました`);
        } else {
          this.callbacks.onLog("info", `${existing.label} はすでに接続済みです`);
        }
        this.callbacks.onChange();
        return true;
      }

      const managed = this.createManagedRecord(connection);
      this.devices.push(managed);
      this.callbacks.onLog(
        "success",
        `${managed.label} (${managed.boardVersion ?? "Unknown"}${managed.serialNumber ? ` / ${managed.serialNumber}` : ""}) を接続しました`
      );
      this.callbacks.onChange();
      return true;
    } catch (error) {
      connection.dispose();
      if (error instanceof DeviceError && error.code === "no-device-selected") {
        return false;
      }
      const msg = formatDeviceError(error);
      this.callbacks.onLog("error", `デバイス追加に失敗: ${msg}`);
      return false;
    }
  }

  public async reconnectAllAuthorized(): Promise<number> {
    if (!this.isWebUSBSupported()) {
      return 0;
    }

    const authorized = (await navigator.usb.getDevices()).filter(
      (d) => d.vendorId === MICROBIT_VENDOR_ID && d.productId === MICROBIT_PRODUCT_ID
    );

    if (authorized.length === 0) {
      this.callbacks.onLog("info", "ペアリング済みの micro:bit が見つかりませんでした");
      return 0;
    }

    // Reconnect already-known disconnected devices first
    let connectedCount = 0;
    for (const managed of this.devices) {
      if (managed.flashStatus === "disconnected") {
        try {
          await managed.connection.connect();
          managed.usbDevice = managed.connection.getDevice();
          managed.flashStatus = "idle";
          managed.stageLabel = "待機中";
          managed.errorMessage = undefined;
          connectedCount++;
        } catch {
          // Device may not be physically plugged in
        }
      }
    }

    // Connect remaining authorized devices not yet in this.devices
    const knownSerials = new Set(
      this.devices.map((d) => d.serialNumber).filter((s): s is string => Boolean(s))
    );
    const knownUsbDevices = new Set(
      this.devices.map((d) => d.usbDevice).filter((u): u is USBDevice => Boolean(u))
    );

    const candidates = authorized.filter(
      (u) => !knownUsbDevices.has(u) && (!u.serialNumber || !knownSerials.has(u.serialNumber))
    );

    for (const candidate of candidates) {
      const otherSerials = authorized
        .filter((u) => u !== candidate && u.serialNumber)
        .map((u) => u.serialNumber as string);

      const connection = createUSBConnection({
        deviceSelectionMode: DeviceSelectionMode.UseAnyAllowed,
        pauseOnHidden: false,
      });
      await connection.initialize();

      const exclusions = this.buildExclusionFilters(otherSerials);
      if (exclusions.length > 0) {
        connection.setRequestDeviceExclusionFilters(exclusions);
      }

      try {
        await connection.connect();
        const managed = this.createManagedRecord(connection);
        this.devices.push(managed);
        connectedCount++;
        this.callbacks.onLog(
          "success",
          `${managed.label} (${managed.boardVersion ?? "Unknown"}) を自動接続しました`
        );
      } catch {
        connection.dispose();
      }
    }

    if (connectedCount > 0) {
      this.callbacks.onChange();
    } else {
      this.callbacks.onLog(
        "info",
        "新しく接続できるペアリング済み micro:bit はありませんでした（USB接続を確認してください）"
      );
    }

    return connectedCount;
  }

  public setSelected(id: string, selected: boolean): void {
    const dev = this.devices.find((d) => d.id === id);
    if (dev) {
      dev.selected = selected;
      this.callbacks.onChange();
    }
  }

  public setAllSelected(selected: boolean): void {
    for (const d of this.devices) {
      if (d.flashStatus !== "disconnected") {
        d.selected = selected;
      }
    }
    this.callbacks.onChange();
  }

  public async resetDevice(id: string): Promise<void> {
    const dev = this.devices.find((d) => d.id === id);
    if (!dev || dev.flashStatus === "disconnected" || dev.flashStatus === "flashing") {
      return;
    }
    try {
      await dev.connection.softwareReset();
      this.callbacks.onLog("info", `${dev.label} をソフトウェアリセットしました`);
    } catch (error) {
      this.callbacks.onLog("warn", `${dev.label} のリセットに失敗: ${formatDeviceError(error)}`);
    }
  }

  public async removeDevice(id: string): Promise<void> {
    const idx = this.devices.findIndex((d) => d.id === id);
    if (idx === -1) return;
    const [dev] = this.devices.splice(idx, 1);
    try {
      await dev.connection.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    dev.connection.dispose();
    this.callbacks.onLog("info", `${dev.label} をリストから切断・削除しました`);
    this.callbacks.onChange();
  }

  public async disconnectAll(): Promise<void> {
    const targets = [...this.devices];
    this.devices = [];
    await Promise.allSettled(
      targets.map(async (dev) => {
        try {
          await dev.connection.disconnect();
        } catch {
          // Ignore
        }
        dev.connection.dispose();
      })
    );
    this.callbacks.onLog("info", "すべての micro:bit を切断しました");
    this.callbacks.onChange();
  }

  public async flashDevices(
    targetIds: string[],
    hexContent: string,
    options: { partial: boolean }
  ): Promise<{ succeeded: number; failed: number }> {
    const targets = this.devices.filter(
      (d) => targetIds.includes(d.id) && d.flashStatus !== "disconnected"
    );

    if (targets.length === 0) {
      return { succeeded: 0, failed: 0 };
    }

    this.isFlashingBatch = true;
    const dataSource = createUniversalHexFlashDataSource(hexContent);

    this.callbacks.onLog(
      "info",
      `${targets.length} 台の micro:bit へ並列書き込みを開始します（${options.partial ? "高速差分モード" : "フル書き込みモード"}）`
    );

    for (const dev of targets) {
      dev.flashStatus = "flashing";
      dev.progress = 0;
      dev.stageLabel = "準備中...";
      dev.durationMs = undefined;
      dev.errorMessage = undefined;
    }
    this.callbacks.onChange();

    let succeeded = 0;
    let failed = 0;

    await Promise.allSettled(
      targets.map(async (dev) => {
        const startTime = performance.now();
        try {
          await dev.connection.flash(dataSource, {
            partial: options.partial,
            progress: (stage, percentage) => {
              dev.stageLabel = stageToJapanese(stage);
              if (typeof percentage === "number") {
                dev.progress = Math.round(percentage * 100);
              }
              this.callbacks.onChange();
            },
          });
          dev.durationMs = Math.round(performance.now() - startTime);
          dev.flashStatus = "success";
          dev.progress = 100;
          dev.stageLabel = "書き込み完了";
          succeeded++;
          this.callbacks.onLog(
            "success",
            `${dev.label} 書き込み完了 (${(dev.durationMs / 1000).toFixed(1)}秒)`
          );
        } catch (error) {
          dev.durationMs = Math.round(performance.now() - startTime);
          dev.flashStatus = "error";
          dev.stageLabel = "書き込み失敗";
          dev.errorMessage = formatDeviceError(error);
          failed++;
          this.callbacks.onLog("error", `${dev.label} 失敗: ${dev.errorMessage}`);
        } finally {
          this.callbacks.onChange();
        }
      })
    );

    this.isFlashingBatch = false;
    this.callbacks.onLog(
      failed === 0 ? "success" : "warn",
      `一斉書き込み終了: 成功 ${succeeded} 台 / 失敗 ${failed} 台`
    );
    this.callbacks.onChange();

    return { succeeded, failed };
  }
}
