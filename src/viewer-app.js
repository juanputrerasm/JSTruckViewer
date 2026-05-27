import {
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
    this.truckSelect.addEventListener("change", () => this.handleTruckSelection());
    this.toggleTextures.addEventListener("change", () => this.scene.setTexturesEnabled(this.toggleTextures.checked));
    this.toggleWireframe.addEventListener("change", () => this.scene.setWireframeEnabled(this.toggleWireframe.checked));
    this.toggleGravity.addEventListener("change", () => {
      if (this.currentSession) {
        this.renderSession();
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
    this.toggleTextures = $("toggle-textures");
    this.toggleWireframe = $("toggle-wireframe");
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
    const url = this.urlInput.value.trim();
    if (!url) {
      this.setStatus("Enter a POD URL first.");
      return;
    }
    await this.withLoading(`Fetching ${url}...`, async () => {
      const staged = await stagePodFromUrl(url);
      await this.loadFromStaged(staged, buildLoadedMessage(staged, url));
    });
  }

  async loadFromStaged(staged, successMessage) {
    if (staged.trkEntries.length === 0) {
      throw new Error("No TRUCK/*.TRK files were found in the POD.");
    }
    this.stagedSession = staged;
    if (staged.trkEntries.length > 1) {
      this.renderTruckPicker(staged.trkEntries);
      this.setStatus(`Found ${staged.trkEntries.length} trucks — pick one to load.`);
    } else {
      this.hideTruckPicker();
      this.currentSession = await loadTruckFromStaged(staged, staged.trkEntries[0].normalizedName);
      this.renderSession();
      this.setStatus(successMessage);
    }
  }

  async handleTruckSelection() {
    const normalizedName = this.truckSelect.value;
    if (!normalizedName || !this.stagedSession) {
      return;
    }
    await this.withLoading(`Loading ${normalizedName}...`, async () => {
      this.currentSession = await loadTruckFromStaged(this.stagedSession, normalizedName);
      this.renderSession();
      this.setStatus(`Loaded ${normalizedName}.`);
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
    this.manifestSummary.innerHTML = "";
    this.warnings.innerHTML = '<div class="empty-state">No warnings.</div>';
    this.hideTruckPicker();
    this.truckTitle.textContent = "";
  }

  renderTruckPicker(entries) {
    this.truckSelect.innerHTML = entries
      .map((e) => `<option value="${escapeHtml(e.normalizedName)}">${escapeHtml(e.title)}</option>`)
      .join("");
    this.truckPickerPanel.hidden = false;
  }

  hideTruckPicker() {
    this.truckPickerPanel.hidden = true;
    this.truckSelect.innerHTML = "";
  }

  renderSession() {
    const session = this.currentSession;
    if (!session) {
      this.renderIdleState();
      return;
    }

    this.scene.setAssembly(session.assembly);
    this.scene.setGravityEnabled(this.toggleGravity.checked);
    this.applySceneToggles();

    this.truckTitle.textContent = session.manifest.truckName || "";

    this.manifestSummary.innerHTML = renderKeyValues([
      ["Truck name", session.manifest.truckName || "<missing>"],
      ["Model Base Name", session.manifest.truckModelBaseName || "<missing>"],
      ["Tire Model Name", session.manifest.tireModelBaseName || "<missing>"],
      ["Axle Model Name", session.manifest.axleModelName || "<missing>"],
      ["Shock Texture Name", session.manifest.shockTextureName || "<none>"],
      ["Bar Texture Name", session.manifest.barTextureName || "<none>"],
      ["Driveshaft Pos", formatVec3(session.manifest.driveshaftPos)],
      ["Axle Bar Offset", formatVec3(session.manifest.axlebarOffset)],
      ["Instrument Cluster", session.manifest.instrumentCluster || "<none>"],
      ["Wave files", session.manifest.waveFiles.join(", ") || "<none>"],
      ["Lights", String(session.manifest.numberOfLights ?? 0)],
      ["Wheel anchors", String(Object.keys(session.manifest.wheelAnchors).length)],
      ["Scrape points", String(session.manifest.scrapePoints.length)],
      ["Source", session.sourceMode === "disk" ? "disk" : "URL"],
      ["Entries", String(session.podIndex.entries.length)]
    ]);

    const warnings = session.assembly.warnings ?? [];
    this.warnings.innerHTML = warnings.length
      ? renderList(warnings.map((warning) => ({ title: warning, detail: "", kind: "warning" })))
      : '<div class="empty-state">No warnings.</div>';
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
      this.warnings.innerHTML = renderList([{ title: error.message, detail: "", kind: "warning" }]);
    } finally {
      this.loading = false;
      this.setControlsEnabled(true);
    }
  }

  setControlsEnabled(enabled) {
    for (const control of [
      this.openFileButton,
      this.openUrlButton,
      this.toggleSidebarButton,
      this.clearTempButton,
      this.resetCameraButton,
      this.urlInput,
      this.truckSelect
    ]) {
      control.disabled = !enabled;
    }
  }

  setStatus(message) {
    this.statusText.textContent = message;
  }

  applySceneToggles() {
    this.scene.setTexturesEnabled(this.toggleTextures.checked);
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
    return `Loaded ${staged.podLabel} from ${sourceLabel}.`;
  }
  return `Loaded ${sourceLabel}.`;
}

function formatVec3(vec) {
  if (!vec) {
    return "<none>";
  }
  return `${vec.x ?? 0}, ${vec.y ?? 0}, ${vec.z ?? 0}`;
}
