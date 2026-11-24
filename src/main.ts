import "./style.css";
import {
  MicrobitDistributorManager,
  type LogLevel,
  type ManagedDevice,
} from "./device-manager.ts";

interface LoadedHexFile {
  name: string;
  sizeBytes: number;
  content: string;
  isUniversal: boolean;
}

let loadedHex: LoadedHexFile | null = null;

// DOM Elements
const webusbBadge = document.getElementById("webusb-badge") as HTMLSpanElement;
const unsupportedBanner = document.getElementById("unsupported-banner") as HTMLDivElement;

const dropZone = document.getElementById("drop-zone") as HTMLDivElement;
const hexFileInput = document.getElementById("hex-file-input") as HTMLInputElement;
const dropZoneEmpty = document.getElementById("drop-zone-empty") as HTMLDivElement;
const dropZoneLoaded = document.getElementById("drop-zone-loaded") as HTMLDivElement;
const hexTypeTag = document.getElementById("hex-type-tag") as HTMLSpanElement;
const hexFileSize = document.getElementById("hex-file-size") as HTMLSpanElement;
const hexFileName = document.getElementById("hex-file-name") as HTMLParagraphElement;
const partialFlashToggle = document.getElementById("partial-flash-toggle") as HTMLInputElement;

const btnAddDevice = document.getElementById("btn-add-device") as HTMLButtonElement;
const btnReconnectAll = document.getElementById("btn-reconnect-all") as HTMLButtonElement;
const btnDisconnectAll = document.getElementById("btn-disconnect-all") as HTMLButtonElement;

const statConnected = document.getElementById("stat-connected") as HTMLSpanElement;
const statSelected = document.getElementById("stat-selected") as HTMLSpanElement;
const statSuccess = document.getElementById("stat-success") as HTMLSpanElement;
const statError = document.getElementById("stat-error") as HTMLSpanElement;

const globalProgressLabel = document.getElementById("global-progress-label") as HTMLSpanElement;
const globalProgressPercent = document.getElementById("global-progress-percent") as HTMLSpanElement;
const globalProgressBar = document.getElementById("global-progress-bar") as HTMLDivElement;

const btnFlashSelected = document.getElementById("btn-flash-selected") as HTMLButtonElement;
const btnRetryFailed = document.getElementById("btn-retry-failed") as HTMLButtonElement;

const deviceCountPill = document.getElementById("device-count-pill") as HTMLSpanElement;
const btnSelectAll = document.getElementById("btn-select-all") as HTMLButtonElement;
const btnDeselectAll = document.getElementById("btn-deselect-all") as HTMLButtonElement;
const devicesEmpty = document.getElementById("devices-empty") as HTMLDivElement;
const devicesGrid = document.getElementById("devices-grid") as HTMLDivElement;

const activityLog = document.getElementById("activity-log") as HTMLDivElement;
const btnClearLog = document.getElementById("btn-clear-log") as HTMLButtonElement;

function appendLog(level: LogLevel, message: string): void {
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 8);
  const entry = document.createElement("div");
  entry.className = "log-entry";

  const timeSpan = document.createElement("span");
  timeSpan.className = "log-time";
  timeSpan.textContent = `[${timeStr}]`;

  const msgSpan = document.createElement("span");
  msgSpan.className = `log-level-${level}`;
  msgSpan.textContent = message;

  entry.append(timeSpan, msgSpan);
  activityLog.appendChild(entry);
  activityLog.scrollTop = activityLog.scrollHeight;
}

const manager = new MicrobitDistributorManager({
  onChange: () => render(),
  onLog: (level, message) => appendLog(level, message),
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function isLikelyIntelHex(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith(":") && trimmed.includes(":00000001FF");
}

function isUniversalHex(text: string): boolean {
  // Universal Hex contains block start records (record type 0x0A)
  return /^:[0-9A-Fa-f]{6}0A/m.test(text);
}

async function handleHexFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".hex")) {
    appendLog("warn", `拡張子が .hex ではないファイルが選択されました: ${file.name}`);
  }
  const content = await file.text();
  if (!isLikelyIntelHex(content)) {
    appendLog("error", `${file.name} は有効な Intel HEX ファイルではありません`);
    return;
  }

  const universal = isUniversalHex(content);
  loadedHex = {
    name: file.name,
    sizeBytes: file.size,
    content,
    isUniversal: universal,
  };

  dropZone.classList.add("has-file");
  dropZoneEmpty.classList.add("hidden");
  dropZoneLoaded.classList.remove("hidden");

  hexTypeTag.textContent = universal ? "Universal HEX (V1/V2)" : "HEX";
  hexFileSize.textContent = formatBytes(file.size);
  hexFileName.textContent = file.name;

  appendLog(
    "info",
    `ファームウェアを読み込みました: ${file.name} (${formatBytes(file.size)}${universal ? ", Universal HEX" : ""})`
  );
  render();
}

function statusBadgeInfo(status: ManagedDevice["flashStatus"]): {
  text: string;
  cls: string;
} {
  switch (status) {
    case "idle":
      return { text: "待機中", cls: "status-idle" };
    case "flashing":
      return { text: "書き込み中", cls: "status-flashing" };
    case "success":
      return { text: "完了", cls: "status-success" };
    case "error":
      return { text: "エラー", cls: "status-error" };
    case "disconnected":
      return { text: "切断", cls: "status-disconnected" };
  }
}

function renderDeviceCard(dev: ManagedDevice, isBatchBusy: boolean): HTMLElement {
  const card = document.createElement("article");
  card.className = `device-card is-${dev.flashStatus}`;
  card.dataset.deviceId = dev.id;

  // Top row
  const top = document.createElement("div");
  top.className = "device-card-top";

  const selectLabel = document.createElement("label");
  selectLabel.className = "device-select-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = dev.selected;
  checkbox.disabled = dev.flashStatus === "disconnected" || isBatchBusy;
  checkbox.addEventListener("change", () => {
    manager.setSelected(dev.id, checkbox.checked);
  });

  const nameWrap = document.createElement("div");
  nameWrap.className = "device-name-wrap";

  const title = document.createElement("span");
  title.className = "device-title";
  title.textContent = dev.label;

  if (dev.boardVersion) {
    const verBadge = document.createElement("span");
    verBadge.className = `board-badge ${dev.boardVersion.toLowerCase()}`;
    verBadge.textContent = dev.boardVersion;
    title.appendChild(verBadge);
  }

  const serial = document.createElement("span");
  serial.className = "device-serial";
  serial.textContent =
    dev.serialNumber ||
    (dev.deviceId !== undefined ? `ID: 0x${dev.deviceId.toString(16)}` : "シリアル不明");

  nameWrap.append(title, serial);
  selectLabel.append(checkbox, nameWrap);

  const badgeInfo = statusBadgeInfo(dev.flashStatus);
  const pill = document.createElement("span");
  pill.className = `status-pill ${badgeInfo.cls}`;
  pill.textContent = badgeInfo.text;

  top.append(selectLabel, pill);
  card.appendChild(top);

  // Progress block
  const progBlock = document.createElement("div");
  progBlock.className = "device-progress-block";

  const progMeta = document.createElement("div");
  progMeta.className = "device-progress-meta";

  const stageSpan = document.createElement("span");
  stageSpan.textContent =
    dev.flashStatus === "success" && dev.durationMs !== undefined
      ? `${dev.stageLabel} (${(dev.durationMs / 1000).toFixed(1)}s)`
      : dev.stageLabel;

  const pctSpan = document.createElement("span");
  pctSpan.className = "mono";
  pctSpan.textContent = `${dev.progress}%`;

  progMeta.append(stageSpan, pctSpan);

  const track = document.createElement("div");
  track.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = `progress-fill${
    dev.flashStatus === "success"
      ? " is-success"
      : dev.flashStatus === "error"
      ? " is-error"
      : ""
  }`;
  fill.style.width = `${dev.progress}%`;
  track.appendChild(fill);

  progBlock.append(progMeta, track);
  card.appendChild(progBlock);

  // Error message
  if (dev.errorMessage) {
    const errP = document.createElement("p");
    errP.className = "device-error-msg";
    errP.textContent = dev.errorMessage;
    card.appendChild(errP);
  }

  // Card actions
  const actions = document.createElement("div");
  actions.className = "device-card-actions";

  const btnFlashOne = document.createElement("button");
  btnFlashOne.type = "button";
  btnFlashOne.className = "btn-mini";
  btnFlashOne.textContent = dev.flashStatus === "error" ? "再書き込み" : "単体書込";
  btnFlashOne.disabled =
    !loadedHex || dev.flashStatus === "disconnected" || dev.flashStatus === "flashing" || isBatchBusy;
  btnFlashOne.addEventListener("click", () => {
    if (!loadedHex) return;
    void manager.flashDevices([dev.id], loadedHex.content, {
      partial: partialFlashToggle.checked,
    });
  });

  const btnReset = document.createElement("button");
  btnReset.type = "button";
  btnReset.className = "btn-mini";
  btnReset.textContent = "リセット";
  btnReset.disabled =
    dev.flashStatus === "disconnected" || dev.flashStatus === "flashing" || isBatchBusy;
  btnReset.addEventListener("click", () => {
    void manager.resetDevice(dev.id);
  });

  const btnRemove = document.createElement("button");
  btnRemove.type = "button";
  btnRemove.className = "btn-mini btn-mini-danger";
  btnRemove.textContent = "削除";
  btnRemove.disabled = dev.flashStatus === "flashing" || isBatchBusy;
  btnRemove.addEventListener("click", () => {
    void manager.removeDevice(dev.id);
  });

  actions.append(btnFlashOne, btnReset, btnRemove);
  card.appendChild(actions);

  return card;
}

function render(): void {
  const devices = manager.getDevices();
  const isBusy = manager.getIsFlashingBatch();
  const webusbOk = manager.isWebUSBSupported();

  const connectedDevices = devices.filter((d) => d.flashStatus !== "disconnected");
  const selectedDevices = connectedDevices.filter((d) => d.selected);
  const flashingDevices = devices.filter((d) => d.flashStatus === "flashing");
  const successDevices = devices.filter((d) => d.flashStatus === "success");
  const errorDevices = devices.filter((d) => d.flashStatus === "error");

  // Stats
  statConnected.textContent = String(connectedDevices.length);
  statSelected.textContent = String(selectedDevices.length);
  statSuccess.textContent = String(successDevices.length);
  statError.textContent = String(errorDevices.length);
  deviceCountPill.textContent = `${devices.length} 台`;

  // Global progress
  const relevant = flashingDevices.length > 0 ? flashingDevices : selectedDevices;
  if (relevant.length > 0 && (isBusy || successDevices.length > 0 || errorDevices.length > 0)) {
    const activePool = devices.filter(
      (d) =>
        d.flashStatus === "flashing" ||
        d.flashStatus === "success" ||
        d.flashStatus === "error"
    );
    const avg =
      activePool.length > 0
        ? Math.round(activePool.reduce((acc, d) => acc + d.progress, 0) / activePool.length)
        : 0;
    globalProgressPercent.textContent = `${avg}%`;
    globalProgressBar.style.width = `${avg}%`;

    if (isBusy) {
      globalProgressLabel.textContent = `並列書き込み中 (${flashingDevices.length} 台実行中)...`;
      globalProgressBar.className = "progress-fill";
    } else if (errorDevices.length > 0) {
      globalProgressLabel.textContent = `完了（エラー ${errorDevices.length} 台）`;
      globalProgressBar.className = "progress-fill is-error";
    } else if (successDevices.length > 0) {
      globalProgressLabel.textContent = `すべて完了 (${successDevices.length} 台成功)`;
      globalProgressBar.className = "progress-fill is-success";
    }
  } else {
    globalProgressLabel.textContent = loadedHex
      ? connectedDevices.length > 0
        ? "書き込み準備完了"
        : "micro:bit を接続してください"
      : "HEX ファイルを選択してください";
    globalProgressPercent.textContent = "0%";
    globalProgressBar.style.width = "0%";
    globalProgressBar.className = "progress-fill";
  }

  // Buttons
  btnAddDevice.disabled = !webusbOk || isBusy;
  btnReconnectAll.disabled = !webusbOk || isBusy;
  btnDisconnectAll.disabled = devices.length === 0 || isBusy;
  btnSelectAll.disabled = connectedDevices.length === 0 || isBusy;
  btnDeselectAll.disabled = connectedDevices.length === 0 || isBusy;

  btnFlashSelected.disabled =
    !webusbOk || !loadedHex || selectedDevices.length === 0 || isBusy;
  btnFlashSelected.textContent = isBusy
    ? "並列書き込み中..."
    : `選択中の ${selectedDevices.length} 台に一斉書き込み`;

  if (errorDevices.length > 0 && loadedHex && !isBusy) {
    btnRetryFailed.classList.remove("hidden");
    btnRetryFailed.textContent = `失敗した ${errorDevices.length} 台を再試行`;
  } else {
    btnRetryFailed.classList.add("hidden");
  }

  // Grid
  if (devices.length === 0) {
    devicesEmpty.classList.remove("hidden");
    devicesGrid.classList.add("hidden");
    devicesGrid.innerHTML = "";
  } else {
    devicesEmpty.classList.add("hidden");
    devicesGrid.classList.remove("hidden");
    devicesGrid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const dev of devices) {
      fragment.appendChild(renderDeviceCard(dev, isBusy));
    }
    devicesGrid.appendChild(fragment);
  }
}

// Event Listeners
dropZone.addEventListener("click", () => hexFileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    hexFileInput.click();
  }
});

hexFileInput.addEventListener("change", () => {
  const file = hexFileInput.files?.[0];
  if (file) {
    void handleHexFile(file);
  }
  hexFileInput.value = "";
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    void handleHexFile(file);
  }
});

btnAddDevice.addEventListener("click", () => {
  void manager.addDeviceInteractive();
});

btnReconnectAll.addEventListener("click", () => {
  void manager.reconnectAllAuthorized();
});

btnDisconnectAll.addEventListener("click", () => {
  void manager.disconnectAll();
});

btnSelectAll.addEventListener("click", () => manager.setAllSelected(true));
btnDeselectAll.addEventListener("click", () => manager.setAllSelected(false));

btnFlashSelected.addEventListener("click", () => {
  if (!loadedHex) return;
  const targetIds = manager
    .getDevices()
    .filter((d) => d.selected && d.flashStatus !== "disconnected")
    .map((d) => d.id);
  void manager.flashDevices(targetIds, loadedHex.content, {
    partial: partialFlashToggle.checked,
  });
});

btnRetryFailed.addEventListener("click", () => {
  if (!loadedHex) return;
  const failedIds = manager
    .getDevices()
    .filter((d) => d.flashStatus === "error")
    .map((d) => d.id);
  void manager.flashDevices(failedIds, loadedHex.content, {
    partial: partialFlashToggle.checked,
  });
});

btnClearLog.addEventListener("click", () => {
  activityLog.innerHTML = "";
});

// Init
function init(): void {
  if (manager.isWebUSBSupported()) {
    webusbBadge.textContent = "WebUSB 利用可能";
    webusbBadge.className = "env-badge env-ready";
    appendLog("info", "準備完了: .hex ファイルを選択し、micro:bit を追加してください");
  } else {
    webusbBadge.textContent = "WebUSB 非対応";
    webusbBadge.className = "env-badge env-unsupported";
    unsupportedBanner.classList.remove("hidden");
    appendLog("error", "WebUSB API が利用できません（Chrome / Edge を使用してください）");
  }
  render();
}

init();
