import { opfsDisplayPath, joinPath } from "./shared/path-utils.js";
import { removePath, resetSessionFolder, writeStreamToFile } from "./shared/opfs.js";
import { WorkerClient } from "./worker-client.js";

const workerClient = new WorkerClient(new URL("./worker/truck-worker.js", import.meta.url));

let currentSessionId = null;

export async function stagePodFromFile(file) {
  const sessionId = await prepareFreshSession();
  try {
    const sourcePath = joinPath("sessions", sessionId, "source", file.name || "truck.pod");
    await writeStreamToFile(sourcePath, file.stream());
    const podIndex = await indexPod(sourcePath);
    const trkEntries = await workerClient.call("listTruckManifests", { podIndex });
    return { sessionId, opfsPodPath: sourcePath, podIndex, trkEntries, sourceMode: "disk", sourceLabel: file.name || "truck.pod" };
  } catch (error) {
    await disposeSession(sessionId);
    throw error;
  }
}

export async function stagePodFromUrl(url) {
  const sessionId = await prepareFreshSession();
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok || !response.body) {
      throw new Error(`Unable to fetch POD from URL (${response.status} ${response.statusText}).`);
    }
    const fileName = nameFromUrl(url);
    const sourcePath = joinPath("sessions", sessionId, "source", fileName);
    await writeStreamToFile(sourcePath, response.body);
    const podIndex = await indexPod(sourcePath);
    const trkEntries = await workerClient.call("listTruckManifests", { podIndex });
    return { sessionId, opfsPodPath: sourcePath, podIndex, trkEntries, sourceMode: "url", sourceLabel: url };
  } catch (error) {
    await disposeSession(sessionId);
    throw error;
  }
}

export async function loadTruckFromStaged(staged, trkNormalizedName) {
  const { sessionId, opfsPodPath, podIndex, sourceMode, sourceLabel } = staged;
  const manifestInfo = await workerClient.call("extractTruckManifestByName", {
    sessionId,
    opfsPodPath,
    podIndex,
    normalizedName: trkNormalizedName
  });
  return await hydrateWithManifest(sessionId, opfsPodPath, podIndex, manifestInfo, { sourceMode, sourceLabel });
}

export async function indexPod(opfsPodPath) {
  return workerClient.call("indexPod", { opfsPodPath });
}

export async function parseTruckManifest(opfsTrkPath) {
  return workerClient.call("parseTruckManifest", { opfsTrkPath });
}

export async function assembleTruck(session, manifest) {
  return workerClient.call("assembleTruck", {
    sessionId: session.sessionId,
    opfsPodPath: session.opfsPodPath,
    podIndex: session.podIndex,
    manifest,
    manifestPath: session.manifestPath
  });
}

export async function disposeSession(sessionId) {
  if (!sessionId) {
    return;
  }
  await removePath(joinPath("sessions", sessionId));
  if (currentSessionId === sessionId) {
    currentSessionId = null;
  }
}

async function prepareFreshSession() {
  if (currentSessionId) {
    await disposeSession(currentSessionId);
  }
  currentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await resetSessionFolder(currentSessionId);
  return currentSessionId;
}

async function hydrateWithManifest(sessionId, opfsPodPath, podIndex, manifestInfo, metadata) {
  const manifest = await parseTruckManifest(manifestInfo.opfsTrkPath);
  const assembly = await assembleTruck(
    { sessionId, opfsPodPath, podIndex, manifestPath: manifestInfo.opfsTrkPath },
    manifest
  );
  return {
    sessionId,
    opfsPodPath,
    opfsPodDisplayPath: opfsDisplayPath(opfsPodPath),
    sourceMode: metadata.sourceMode,
    sourceLabel: metadata.sourceLabel,
    podIndex,
    manifest,
    manifestPath: manifestInfo.opfsTrkPath,
    manifestDisplayPath: opfsDisplayPath(manifestInfo.opfsTrkPath),
    extractedFiles: assembly.extractedFiles,
    assembly
  };
}

function nameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last || "truck.pod";
  } catch {
    return "truck.pod";
  }
}
