import { basenameWithoutExtension, joinPath, opfsDisplayPath } from "./shared/path-utils.js";
import { removePath, resetSessionFolder, writeBytesToFile, writeStreamToFile } from "./shared/opfs.js";
import { WorkerClient } from "./worker-client.js";
import { extractPodEntriesFromZipBytes } from "./zip-utils.js";

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
  const selected = findStagedTruckEntry(staged, trkNormalizedName);
  const { sessionId, opfsPodPath, podIndex, sourceMode, sourceLabel } = selected;
  const manifestInfo = await workerClient.call("extractTruckManifestByName", {
    sessionId,
    opfsPodPath,
    podIndex,
    normalizedName: selected.normalizedName,
    extractionScope: selected.podId
  });
  return await hydrateWithManifest(sessionId, opfsPodPath, podIndex, manifestInfo, {
    sourceMode,
    sourceLabel,
    podLabel: selected.podLabel,
    trkKey: selected.trkKey,
    extractionScope: selected.podId
  });
}

export async function describeTruckEntries(staged) {
  return await Promise.all((staged.trkEntries ?? []).map(async (entry) => {
    const pod = findStagedPod(staged, entry.podId);
    const manifestInfo = await workerClient.call("extractTruckManifestByName", {
      sessionId: staged.sessionId,
      opfsPodPath: pod.opfsPodPath,
      podIndex: pod.podIndex,
      normalizedName: entry.normalizedName,
      extractionScope: entry.podId
    });
    const manifest = await parseTruckManifest(manifestInfo.opfsTrkPath);
    return {
      ...entry,
      manifestTruckName: manifest.truckName || ""
    };
  }));
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
    manifestPath: session.manifestPath,
    extractionScope: session.extractionScope
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
    { sessionId, opfsPodPath, podIndex, manifestPath: manifestInfo.opfsTrkPath, extractionScope: metadata.extractionScope },
    manifest
  );
  return {
    sessionId,
    opfsPodPath,
    opfsPodDisplayPath: opfsDisplayPath(opfsPodPath),
    sourceMode: metadata.sourceMode,
    sourceLabel: metadata.sourceLabel,
    podLabel: metadata.podLabel,
    trkKey: metadata.trkKey,
    extractionScope: metadata.extractionScope,
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
  // ZIP loading is still fully client-side: stage each POD entry into OPFS so the
  // worker can index every truck manifest, even when the ZIP is a multi-POD pack.
  const podEntries = await extractPodEntriesFromZipBytes(bytes, zipName);
  const stagedPods = [];
  for (const [index, podEntry] of podEntries.entries()) {
    const podFileName = podNameFromZipEntry(zipName, podEntry.podEntryName);
    const sourcePath = joinPath("sessions", sessionId, "source", `${index + 1}-${podFileName}`);
    await writeBytesToFile(sourcePath, podEntry.podBytes);
    stagedPods.push({
      opfsPodPath: sourcePath,
      podLabel: podEntry.podEntryName
    });
  }
  return finalizeStagedPods(sessionId, stagedPods, "zip", zipName);
}

async function finalizeStagedPod(sessionId, sourcePath, podLabel, containerType, containerLabel = null) {
  return finalizeStagedPods(sessionId, [{ opfsPodPath: sourcePath, podLabel }], containerType, containerLabel);
}

async function finalizeStagedPods(sessionId, stagedPods, containerType, containerLabel = null) {
  const pods = [];
  const trkEntries = [];
  for (const [index, stagedPod] of stagedPods.entries()) {
    const podIndex = await indexPod(stagedPod.opfsPodPath);
    const podId = `pod-${index + 1}`;
    const podTrkEntries = await workerClient.call("listTruckManifests", { podIndex });
    pods.push({
      podId,
      opfsPodPath: stagedPod.opfsPodPath,
      podIndex,
      podLabel: stagedPod.podLabel
    });
    trkEntries.push(...podTrkEntries.map((entry) => ({
      ...entry,
      podId,
      podLabel: stagedPod.podLabel,
      trkKey: makeTruckKey(podId, entry.normalizedName)
    })));
  }
  const firstPod = pods[0] ?? {};
  return {
    sessionId,
    opfsPodPath: firstPod.opfsPodPath,
    podIndex: firstPod.podIndex,
    pods,
    trkEntries,
    podLabel: firstPod.podLabel,
    containerType,
    containerLabel
  };
}

function findStagedTruckEntry(staged, trkKeyOrNormalizedName) {
  const selected = staged.trkEntries?.find((entry) => entry.trkKey === trkKeyOrNormalizedName)
    ?? staged.trkEntries?.find((entry) => entry.normalizedName === trkKeyOrNormalizedName);
  if (!selected) {
    throw new Error(`TRK entry not found in staged archive: ${trkKeyOrNormalizedName}`);
  }
  const pod = findStagedPod(staged, selected.podId);
  return {
    ...selected,
    sessionId: staged.sessionId,
    sourceMode: staged.sourceMode,
    sourceLabel: staged.sourceLabel,
    opfsPodPath: pod.opfsPodPath,
    podIndex: pod.podIndex,
    podLabel: pod.podLabel
  };
}

function findStagedPod(staged, podId) {
  const pod = staged.pods?.find((entry) => entry.podId === podId) ?? staged.pods?.[0];
  if (!pod) {
    throw new Error("No staged POD is available.");
  }
  return pod;
}

function makeTruckKey(podId, normalizedName) {
  return `${podId}:${normalizedName}`;
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
