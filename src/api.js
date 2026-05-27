import { basenameWithoutExtension, joinPath, opfsDisplayPath } from "./shared/path-utils.js";
import { removePath, resetSessionFolder, writeBytesToFile, writeStreamToFile } from "./shared/opfs.js";
import { WorkerClient } from "./worker-client.js";
import { extractFirstPodFromZipBytes } from "./zip-utils.js";

const workerClient = new WorkerClient(new URL("./worker/truck-worker.js", import.meta.url));

let currentSessionId = null;

export async function stagePodFromFile(file) {
  const sessionId = await prepareFreshSession();
  try {
    const staged = isZipName(file.name)
      ? await stageZipBytes(sessionId, new Uint8Array(await file.arrayBuffer()), file.name || "trucks.zip")
      : await stagePodStream(sessionId, file.stream(), file.name || "truck.pod");
    return {
      ...staged,
      sourceMode: "disk",
      sourceLabel: file.name || "truck.pod"
    };
  } catch (error) {
    await disposeSession(sessionId);
    throw error;
  }
}

// Web-hosting entry point:
// 1. fetch a POD/ZIP from a URL the page can access
// 2. copy it into OPFS so the rest of the app can treat it like a local file
// 3. index the staged POD and return its truck manifests
//
// Important for webmasters: browser fetch still obeys same-origin/CORS rules.
// Relative URLs like "resources/truck.zip" work when hosted beside the page.
export async function stagePodFromUrl(url) {
  const sessionId = await prepareFreshSession();
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`Unable to fetch POD/ZIP from URL (${response.status} ${response.statusText}).`);
    }
    const fileName = nameFromUrl(url);
    const staged = isZipName(fileName)
      ? await stageZipBytes(sessionId, new Uint8Array(await response.arrayBuffer()), fileName)
      : await stagePodResponse(sessionId, response, fileName);
    return {
      ...staged,
      sourceMode: "url",
      sourceLabel: url
    };
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

async function stagePodStream(sessionId, readable, fileName) {
  const sourcePath = joinPath("sessions", sessionId, "source", fileName);
  await writeStreamToFile(sourcePath, readable);
  return finalizeStagedPod(sessionId, sourcePath, fileName, "pod");
}

async function stagePodResponse(sessionId, response, fileName) {
  if (!response.body) {
    throw new Error("The response body was empty.");
  }
  // Stream remote POD bytes straight into OPFS to avoid keeping a second full copy in memory.
  return stagePodStream(sessionId, response.body, fileName);
}

async function stageZipBytes(sessionId, bytes, zipName) {
  // ZIP loading is still fully client-side: extract the first POD from the fetched/uploaded ZIP,
  // then stage that POD into OPFS so the worker can index it normally.
  const { podBytes, podEntryName } = await extractFirstPodFromZipBytes(bytes, zipName);
  const podFileName = podNameFromZipEntry(zipName, podEntryName);
  const sourcePath = joinPath("sessions", sessionId, "source", podFileName);
  await writeBytesToFile(sourcePath, podBytes);
  return finalizeStagedPod(sessionId, sourcePath, podEntryName, "zip", zipName);
}

async function finalizeStagedPod(sessionId, sourcePath, podLabel, containerType, containerLabel = null) {
  const podIndex = await indexPod(sourcePath);
  const trkEntries = await workerClient.call("listTruckManifests", { podIndex });
  return {
    sessionId,
    opfsPodPath: sourcePath,
    podIndex,
    trkEntries,
    podLabel,
    containerType,
    containerLabel
  };
}

function isZipName(name) {
  return String(name ?? "").trim().toUpperCase().endsWith(".ZIP");
}

function podNameFromZipEntry(zipName, podEntryName) {
  const cleanEntry = String(podEntryName ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop();
  if (cleanEntry) {
    return cleanEntry;
  }
  return `${basenameWithoutExtension(zipName || "trucks")}.POD`;
}
