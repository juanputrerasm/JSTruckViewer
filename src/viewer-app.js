import {
  describeTruckEntries,
  disposeSession,
  loadTruckFromStaged,
  stagePodFromFile,
  stagePodFromUrl
} from "./api.js";
import { ViewerScene } from "./viewer-scene.js";

export class TruckViewerApp {
  constructor(documentRef) {
    this.document = documentRef;
    this.scene = null;
    this.currentSession = null;
    this.stagedSession = null;
    this.loading = false;
  }

  mount() {
    this.cacheDom();
    this.scene = new ViewerScene(this.viewport);
    this.fileInput.addEventListener("change", () => this.handleLocalFile());
    this.openFileButton.addEventListener("click", () => this.fileInput.click());
    this.openUrlButton.addEventListener("click", () => this.handleUrlOpen());
    this.toggleSidebarButton.addEventListener("click", () => this.toggleSidebar());
    this.clearTempButton.addEventListener("click", () => this.clearSession());
    this.resetCameraButton.addEventListener("click", () => this.scene.resetCamera());
    this.saveScreenshotButton.addEventListener("click", () => this.handleSaveScreenshot());
    this.truckSelect.addEventListener("change", () => this.handleTruckSelection());
    this.backgroundColor.addEventListener("input", () => this.scene.setBackgroundColor(this.backgroundColor.value));
    this.lightPosition.addEventListener("change", () => this.scene.setSceneLightPosition(this.lightPosition.value));
    this.toggleTextures.addEventListener("change", () => this.scene.setTexturesEnabled(this.toggleTextures.checked));
    this.toggleSmoothTextures.addEventListener("change", () => this.scene.setTextureSmoothingEnabled(this.toggleSmoothTextures.checked));
    this.toggleWireframe.addEventListener("change", () => this.scene.setWireframeEnabled(this.toggleWireframe.checked));
    this.toggleSceneLighting.addEventListener("change", () => this.scene.setSceneLightingEnabled(this.toggleSceneLighting.checked));
    this.toggleGravity.addEventListener("change", () => {
      if (this.currentSession) {
        this.scene.setGravityEnabled(this.toggleGravity.checked);
        this.applySceneToggles();
      } else {
        this.scene.setGravityEnabled(this.toggleGravity.checked);
      }
    });
    this.toggleWheels.addEventListener("change", () => this.scene.setWheelsVisible(this.toggleWheels.checked));
    this.toggleAxle.addEventListener("change", () => this.scene.setAxleVisible(this.toggleAxle.checked));
    this.toggleAxleBars.addEventListener("change", () => this.scene.setAxleBarsVisible(this.toggleAxleBars.checked));
    this.toggleShocks.addEventListener("change", () => this.scene.setShocksVisible(this.toggleShocks.checked));
    this.toggleDriveshaft.addEventListener("change", () => this.scene.setDriveshaftVisible(this.toggleDriveshaft.checked));
    this.toggleScrape.addEventListener("change", () => this.scene.setScrapePointsVisible(this.toggleScrape.checked));
    this.toggleLights.addEventListener("change", () => this.scene.setLightsVisible(this.toggleLights.checked));
    this.renderIdleState();
    void this.autoloadFromPageQuery();
  }

  cacheDom() {
    const $ = (id) => this.document.getElementById(id);
    this.fileInput = $("file-input");
    this.openFileButton = $("open-file-button");
    this.urlInput = $("url-input");
    this.openUrlButton = $("open-url-button");
    this.toggleSidebarButton = $("toggle-sidebar-button");
    this.clearTempButton = $("clear-temp-button");
    this.resetCameraButton = $("reset-camera-button");
    this.saveScreenshotButton = $("save-screenshot-button");
    this.backgroundColor = $("background-color");
    this.lightPosition = $("light-position");
    this.toggleTextures = $("toggle-textures");
    this.toggleSmoothTextures = $("toggle-smooth-textures");
    this.toggleWireframe = $("toggle-wireframe");
    this.toggleSceneLighting = $("toggle-scene-lighting");
    this.toggleGravity = $("toggle-gravity");
    this.toggleWheels = $("toggle-wheels");
    this.toggleAxle = $("toggle-axle");
    this.toggleAxleBars = $("toggle-axle-bars");
    this.toggleShocks = $("toggle-shocks");
    this.toggleDriveshaft = $("toggle-driveshaft");
    this.toggleScrape = $("toggle-scrape");
    this.toggleLights = $("toggle-lights");
    this.statusText = $("status-text");
    this.viewport = $("viewport");
    this.mainLayout = $("main-layout");
    this.manifestSummary = $("manifest-summary");
    this.warnings = $("warnings");
    this.warningsPanel = $("warnings-panel");
    this.truckPickerPanel = $("truck-picker-panel");
    this.truckSelect = $("truck-select");
    this.truckTitle = $("truck-title");
  }

  toggleSidebar() {
    const collapsed = this.mainLayout.classList.toggle("sidebar-collapsed");
    this.toggleSidebarButton.textContent = collapsed ? "Show details" : "Hide details";
    requestAnimationFrame(() => this.scene.resize());
  }

  async handleLocalFile() {
    const file = this.fileInput.files?.[0];
    if (!file) {
      return;
    }
    await this.withLoading(`Copying ${file.name} into OPFS...`, async () => {
      const staged = await stagePodFromFile(file);
      await this.loadFromStaged(staged, buildLoadedMessage(staged, file.name));
    });
    this.fileInput.value = "";
  }

  async handleUrlOpen() {
    const url = this.normalizeArchiveUrl(this.urlInput.value.trim());
    if (!url) {
      this.setStatus("Enter a POD/ZIP URL first.");
      return;
    }
    this.urlInput.value = url;
    await this.loadArchiveFromUrl(url);
  }

  async loadFromStaged(staged, successMessage) {
    if (staged.trkEntries.length === 0) {
      throw new Error("No TRUCK/*.TRK files were found in the POD.");
    }
    this.stagedSession = staged;
    const firstEntry = staged.trkEntries[0];
    this.currentSession = await loadTruckFromStaged(staged, firstEntry.trkKey);
    this.renderSession({ fitCamera: true });
    if (staged.trkEntries.length > 1) {
      const pickerEntries = await describeTruckEntries(staged);
      this.renderTruckPicker(pickerEntries, firstEntry.trkKey);
      this.setStatus(`${successMessage} Found ${formatTruckCount(staged.trkEntries.length)} across ${formatPodCount(staged.pods?.length ?? 1)}.`);
    } else {
      this.hideTruckPicker();
      this.setStatus(successMessage);
    }
  }

  async handleTruckSelection() {
    const trkKey = this.truckSelect.value;
    if (!trkKey || !this.stagedSession) {
      return;
    }
    const selectedEntry = this.stagedSession.trkEntries.find((entry) => entry.trkKey === trkKey);
    const label = selectedEntry?.podLabel ? `${selectedEntry.podLabel} / ${selectedEntry.normalizedName}` : trkKey;
    await this.withLoading(`Loading ${label}...`, async () => {
      this.currentSession = await loadTruckFromStaged(this.stagedSession, trkKey);
      this.renderSession({ fitCamera: false });
      this.setStatus(`Loaded ${label}.`);
    });
  }

  async clearSession() {
    if (this.currentSession?.sessionId) {
      await disposeSession(this.currentSession.sessionId);
    }
    this.currentSession = null;
    this.stagedSession = null;
    this.scene.setAssembly(null);
    this.renderIdleState();
    this.setStatus("Session temp files cleared.");
  }

  renderIdleState() {
    this.setMtm2PartTogglesEnabled(true);
    this.manifestSummary.innerHTML = "";
    this.warnings.innerHTML = "";
    this.warningsPanel.hidden = true;
    this.hideTruckPicker();
    this.truckTitle.textContent = "";
  }

  renderTruckPicker(entries, selectedNormalizedName = "") {
    const showPodLabel = new Set(entries.map((entry) => entry.podId)).size > 1;
    this.truckSelect.innerHTML = entries
      .map((e) => {
        const title = e.manifestTruckName ? `${e.title} (${e.manifestTruckName})` : e.title;
        const label = showPodLabel ? `${e.podLabel} / ${title}` : title;
        const selected = e.trkKey === selectedNormalizedName ? " selected" : "";
        return `<option value="${escapeHtml(e.trkKey)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
    this.truckPickerPanel.hidden = false;
  }

  hideTruckPicker() {
    this.truckPickerPanel.hidden = true;
    this.truckSelect.innerHTML = "";
  }

  renderSession(options = {}) {
    const session = this.currentSession;
    if (!session) {
      this.renderIdleState();
      return;
    }

    this.scene.setGravityEnabled(this.toggleGravity.checked, { rerender: false });
    this.scene.setAssembly(session.assembly, { fitCamera: options.fitCamera !== false });
    this.applySceneToggles();

    this.truckTitle.textContent = session.manifest.truckName || "";

    // MTM1 manifests stop at the body, tires, anchors and metadata, so the axle, suspension
    // and light rows are omitted rather than shown as "<missing>" on every classic truck.
    const manifest = session.manifest;
    const isMtm1 = manifest.formatVersion === "MTM1";
    this.setMtm2PartTogglesEnabled(!isMtm1);
    this.manifestSummary.innerHTML = renderKeyValues([
      ["Format", manifest.formatVersion || "MTM2"],
      ["Truck name", manifest.truckName || "<missing>"],
      [isMtm1 ? "Truck Model Name" : "Model Base Name", manifest.truckModelBaseName || "<missing>"],
      ["Tire Model Name", manifest.tireModelBaseName || "<missing>"],
      ...(isMtm1 ? [] : [
        ["Axle Model Name", manifest.axleModelName || "<missing>"],
        ["Shock Texture Name", manifest.shockTextureName || "<none>"],
        ["Bar Texture Name", manifest.barTextureName || "<none>"],
        ["Driveshaft Pos", formatVec3(manifest.driveshaftPos)],
        ["Axle Bar Offset", formatVec3(manifest.axlebarOffset)]
      ]),
      ["Instrument Cluster", manifest.instrumentCluster || "<none>"],
      ["Wave files", manifest.waveFiles.join(", ") || "<none>"],
      ...(isMtm1 ? [] : [["Lights", String(manifest.numberOfLights ?? 0)]]),
      ["Scrape points", String(manifest.scrapePoints.length)],
      ["Source", session.sourceMode === "disk" ? "disk" : "URL"]
    ]);

    const warnings = session.assembly.warnings ?? [];
    this.warningsPanel.hidden = warnings.length === 0;
    this.warnings.innerHTML = warnings.length
      ? renderList(warnings.map((warning) => ({ title: warning, detail: "", kind: "warning" })))
      : "";
  }

  async withLoading(message, work) {
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.setControlsEnabled(false);
    this.setStatus(message);
    try {
      await work();
    } catch (error) {
      this.setStatus(error.message);
      this.warningsPanel.hidden = false;
      this.warnings.innerHTML = renderList([{ title: error.message, detail: "", kind: "warning" }]);
    } finally {
      this.loading = false;
      this.setControlsEnabled(true);
    }
  }

  async handleSaveScreenshot() {
    try {
      this.setStatus("Saving screenshot...");
      const blob = await this.scene.saveScreenshotJpeg();
      const truckName = this.currentSession?.manifest?.truckName?.trim();
      const base = truckName ? sanitizeFilename(truckName) : "jstruckviewer";
      const filename = `${base}-${formatScreenshotTimestamp()}.jpg`;
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      this.setStatus(`Saved ${filename}.`);
    } catch (error) {
      this.setStatus(error.message);
    }
  }

  setControlsEnabled(enabled) {
    for (const control of [
      this.openFileButton,
      this.openUrlButton,
      this.toggleSidebarButton,
      this.clearTempButton,
      this.resetCameraButton,
      this.saveScreenshotButton,
      this.backgroundColor,
      this.lightPosition,
      this.toggleSceneLighting,
      this.urlInput,
      this.truckSelect
    ]) {
      control.disabled = !enabled;
    }
  }

  // Axles, axle bars, shocks, the driveshaft and lights only exist on MTM2 trucks. Their
  // scene groups stay empty for MTM1, so the matching toggles are greyed out instead of
  // looking broken.
  setMtm2PartTogglesEnabled(enabled) {
    for (const toggle of [
      this.toggleAxle,
      this.toggleAxleBars,
      this.toggleShocks,
      this.toggleDriveshaft,
      this.toggleLights
    ]) {
      toggle.disabled = !enabled;
      toggle.closest("label")?.classList.toggle("control-unavailable", !enabled);
    }
  }

  setStatus(message) {
    this.statusText.textContent = message;
  }

  // Shared URL-loading path used by both the "Open from URL" button and ?file= links.
  // This keeps the webmaster integration obvious: if you can provide a reachable POD/ZIP URL,
  // the viewer can fetch it, stage it into OPFS, and load it without any server-side code.
  async loadArchiveFromUrl(url) {
    await this.withLoading(`Fetching ${url}...`, async () => {
      const staged = await stagePodFromUrl(url);
      await this.loadFromStaged(staged, buildLoadedMessage(staged, url));
    });
  }

  async autoloadFromPageQuery() {
    const url = getArchiveUrlFromPageQuery(this.document.defaultView?.location);
    if (!url) {
      return;
    }
    this.urlInput.value = url;
    await this.loadArchiveFromUrl(url);
  }

  normalizeArchiveUrl(value) {
    if (!value) {
      return "";
    }
    try {
      return new URL(value, this.document.baseURI).toString();
    } catch {
      return value;
    }
  }

  applySceneToggles() {
    this.scene.setBackgroundColor(this.backgroundColor.value);
    this.scene.setSceneLightingEnabled(this.toggleSceneLighting.checked, { rerender: false });
    this.scene.setSceneLightPosition(this.lightPosition.value);
    this.scene.setTexturesEnabled(this.toggleTextures.checked);
    this.scene.setTextureSmoothingEnabled(this.toggleSmoothTextures.checked);
    this.scene.setWireframeEnabled(this.toggleWireframe.checked);
    this.scene.setWheelsVisible(this.toggleWheels.checked);
    this.scene.setAxleVisible(this.toggleAxle.checked);
    this.scene.setAxleBarsVisible(this.toggleAxleBars.checked);
    this.scene.setShocksVisible(this.toggleShocks.checked);
    this.scene.setDriveshaftVisible(this.toggleDriveshaft.checked);
    this.scene.setScrapePointsVisible(this.toggleScrape.checked);
    this.scene.setLightsVisible(this.toggleLights.checked);
  }
}

function renderKeyValues(entries) {
  return entries
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

function renderList(items) {
  if (!items.length) {
    return '<div class="empty-state">Nothing to display.</div>';
  }
  return items
    .map((item) => {
      const klass = item.kind === "warning" ? "list-item warning-item" : "list-item";
      return `<div class="${klass}"><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}</div>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildLoadedMessage(staged, sourceLabel) {
  if (staged?.containerType === "zip") {
    return `Loaded ${formatPodCount(staged.pods?.length ?? 1)} from ${sourceLabel}.`;
  }
  return `Loaded ${sourceLabel}.`;
}

function formatTruckCount(count) {
  return `${count} ${count === 1 ? "truck" : "trucks"}`;
}

function formatPodCount(count) {
  return `${count} ${count === 1 ? "POD" : "PODs"}`;
}

function formatVec3(vec) {
  if (!vec) {
    return "<none>";
  }
  return `${vec.x ?? 0}, ${vec.y ?? 0}, ${vec.z ?? 0}`;
}

function sanitizeFilename(value) {
  return String(value)
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "jstruckviewer";
}

function formatScreenshotTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// Hosting helper:
//   /JSTruckViewer/?file=resources/truck.zip
//   /JSTruckViewer/?url=https://example.com/truck.pod
//
// Browsers expose query parameters to client-side code, so a static page can use them
// to auto-load a remote or relative archive as long as the target URL is fetchable.
function getArchiveUrlFromPageQuery(location) {
  if (!location) {
    return "";
  }
  const params = new URLSearchParams(location.search);
  const rawValue = params.get("file") || params.get("url") || "";
  if (!rawValue) {
    return "";
  }
  try {
    return new URL(rawValue, location.href).toString();
  } catch {
    return rawValue;
  }
}
